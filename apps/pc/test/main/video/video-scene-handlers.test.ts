import { existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
  },
}));

const {
  registerVideoSceneHandlers,
  isAllowedSceneMediaName,
  sceneImageFileName,
  MAX_SCENE_IMAGE_BYTES,
} = await import('../../../src/main/handlers/video-scene');

// macOS 的临时目录经 /var → /private/var 符号链接，主进程返回的是真实路径
const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ne-video-scene-')));
const work = path.join(root, 'novels', '星河旅人');
const outside = path.join(root, 'outside');
const sceneDir = path.join(work, '资料', '视频', '001-启程', '第一场 清晨');

registerVideoSceneHandlers({
  // 与真实 assertWorkPath 一样只接受存在的绝对路径；工作区校验由 video-handlers.test.ts 覆盖
  assertWorkPath: async (raw: unknown) => {
    if (typeof raw !== 'string' || !path.isAbsolute(raw) || !existsSync(raw)) {
      throw new Error('无效的作品目录');
    }
    return raw;
  },
  workspaceRootFor: () => null,
});

async function call<T>(channel: string, payload: unknown): Promise<T> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`未注册: ${channel}`);
  return (await handler({ sender: { id: 1 } }, payload)) as T;
}

const ref = { workPath: work, chapter: '001-启程', scene: '第一场 清晨' };

beforeEach(async () => {
  rmSync(root, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  await mkdir(outside, { recursive: true });
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('场景视频工作区 IPC', () => {
  it('没有保存过时返回空状态，不创建目录', async () => {
    const result = await call<{ ok: boolean; data: { state: unknown; files: string[] } }>(
      'video-scene-load',
      ref
    );
    expect(result).toEqual({ ok: true, data: { dir: sceneDir, state: null, files: [] } });
    expect(existsSync(sceneDir)).toBe(false);
  });

  it('保存 分镜.json + 分镜.md 后可读回，并列出目录内文件', async () => {
    const state = { schemaVersion: 1, chapter: '001-启程', scene: '第一场 清晨' };
    const saved = await call<{ ok: true; data: { jsonPath: string; markdownPath: string } }>(
      'video-scene-save',
      { ...ref, state, markdown: '# 分镜表\n' }
    );
    expect(saved.ok).toBe(true);
    expect(saved.data.jsonPath).toBe(path.join(sceneDir, '分镜.json'));
    expect(await readFile(path.join(sceneDir, '分镜.md'), 'utf-8')).toBe('# 分镜表\n');
    await writeFile(path.join(sceneDir, '镜头1-v1.mp4'), 'video');
    const loaded = await call<{ ok: true; data: { state: unknown; files: string[] } }>(
      'video-scene-load',
      ref
    );
    expect(loaded.data.state).toEqual(state);
    expect(loaded.data.files.sort()).toEqual(['分镜.json', '分镜.md', '镜头1-v1.mp4']);
  });

  it('损坏的 分镜.json 当作没有保存过', async () => {
    await mkdir(sceneDir, { recursive: true });
    await writeFile(path.join(sceneDir, '分镜.json'), '{oops');
    const loaded = await call<{ ok: true; data: { state: unknown } }>('video-scene-load', ref);
    expect(loaded.data.state).toBeNull();
  });

  it('章 / 场景名清洗为单个路径段，不能逃出作品目录', async () => {
    const result = await call<{ ok: true; data: { jsonPath: string } }>('video-scene-save', {
      workPath: work,
      chapter: '../../..',
      scene: '../outside',
      state: { a: 1 },
    });
    expect(result.ok).toBe(true);
    expect(result.data.jsonPath.startsWith(path.join(work, '资料', '视频'))).toBe(true);
    expect(
      await call('video-scene-save', { workPath: 'relative', chapter: 'a', scene: 'b', state: {} })
    ).toMatchObject({ ok: false });
    expect(await call('video-scene-save', { ...ref, state: 'x' })).toMatchObject({
      ok: false,
      error: { message: '缺少分镜内容' },
    });
  });

  it('只能读取场景目录内的成片 / 样片文件', async () => {
    expect(isAllowedSceneMediaName('镜头2-v3.mp4')).toBe(true);
    expect(isAllowedSceneMediaName('样片-20261007-090000.webm')).toBe(true);
    expect(isAllowedSceneMediaName('../镜头1-v1.mp4')).toBe(false);
    expect(isAllowedSceneMediaName('分镜.json')).toBe(false);
    await mkdir(sceneDir, { recursive: true });
    await writeFile(path.join(sceneDir, '镜头1-v1.mp4'), Buffer.from([1, 2, 3]));
    const read = await call<{ ok: true; data: Uint8Array }>('video-scene-read-file', {
      ...ref,
      fileName: '镜头1-v1.mp4',
    });
    expect(Array.from(read.data)).toEqual([1, 2, 3]);
    expect(
      await call('video-scene-read-file', { ...ref, fileName: '../../../../outside/a.mp4' })
    ).toMatchObject({ ok: false, error: { message: '不支持读取该文件' } });
    expect(await call('video-scene-read-file', { ...ref, fileName: '镜头9-v1.mp4' })).toMatchObject(
      { ok: false, error: { message: '视频文件不存在' } }
    );
  });

  it.skipIf(process.platform === 'win32')('经符号链接指向作品外的文件被拒绝', async () => {
    await mkdir(sceneDir, { recursive: true });
    await writeFile(path.join(outside, 'secret.mp4'), 'secret');
    symlinkSync(path.join(outside, 'secret.mp4'), path.join(sceneDir, '镜头1-v1.mp4'));
    expect(await call('video-scene-read-file', { ...ref, fileName: '镜头1-v1.mp4' })).toMatchObject(
      { ok: false, error: { message: '文件经符号链接指向了作品目录之外' } }
    );
  });

  it('拼接样片写入场景目录，文件名由主进程生成', async () => {
    const result = await call<{ ok: true; data: { fileName: string; path: string } }>(
      'video-scene-write-animatic',
      { ...ref, ext: 'webm', data: new Uint8Array([9, 9]) }
    );
    expect(result.ok).toBe(true);
    expect(result.data.fileName).toMatch(/^样片-\d{8}-\d{6}\.webm$/);
    expect(path.dirname(result.data.path)).toBe(sceneDir);
    expect(Array.from(await readFile(result.data.path))).toEqual([9, 9]);
    expect(
      await call('video-scene-write-animatic', { ...ref, ext: 'exe', data: new Uint8Array([1]) })
    ).toMatchObject({ ok: false });
    expect(
      await call('video-scene-write-animatic', { ...ref, ext: 'mp4', data: new Uint8Array() })
    ).toMatchObject({ ok: false, error: { message: '样片内容为空' } });
  });
});

describe('video-scene-write-image', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9]);
  type WriteResult = { ok: true; data: { fileName: string; relativePath: string } };

  it('文件名：首帧带时间戳，预演每个镜头固定一张', () => {
    const date = new Date(2026, 9, 7, 9, 5, 3);
    expect(sceneImageFileName('keyframe', 3, 'png', date)).toBe('镜头3-首帧-20261007-090503.png');
    expect(sceneImageFileName('previz', 3, 'jpg', date)).toBe('镜头3-预演.jpg');
  });

  it('首帧图写入场景目录，返回相对作品目录的路径', async () => {
    const result = await call<WriteResult>('video-scene-write-image', {
      ...ref,
      kind: 'keyframe',
      shotIndex: 2,
      data: PNG,
    });
    expect(result.ok).toBe(true);
    expect(result.data.fileName).toMatch(/^镜头2-首帧-\d{8}-\d{6}\.png$/);
    expect(result.data.relativePath).toBe(`资料/视频/001-启程/第一场 清晨/${result.data.fileName}`);
    expect(Array.from(await readFile(path.join(sceneDir, result.data.fileName)))).toEqual(
      Array.from(PNG)
    );
  });

  it('预演图同一镜头覆盖写入，扩展名按文件头识别', async () => {
    const first = await call<WriteResult>('video-scene-write-image', {
      ...ref,
      kind: 'previz',
      shotIndex: 1,
      data: PNG,
    });
    expect(first.data).toEqual({
      fileName: '镜头1-预演.png',
      relativePath: '资料/视频/001-启程/第一场 清晨/镜头1-预演.png',
    });
    const updated = new Uint8Array([...PNG, 4, 5]);
    await call('video-scene-write-image', { ...ref, kind: 'previz', shotIndex: 1, data: updated });
    expect(Array.from(await readFile(path.join(sceneDir, '镜头1-预演.png')))).toEqual(
      Array.from(updated)
    );
    const jpg = await call<WriteResult>('video-scene-write-image', {
      ...ref,
      kind: 'previz',
      shotIndex: 1,
      data: JPG,
    });
    expect(jpg.data.fileName).toBe('镜头1-预演.jpg');
  });

  it('同名文件是指向作品目录外的符号链接时只替换链接，不写穿到外部文件', async () => {
    const outside = path.join(await mkdtemp(path.join(os.tmpdir(), 'scene-outside-')), 'x.png');
    await writeFile(outside, 'outside');
    await mkdir(sceneDir, { recursive: true });
    await symlink(outside, path.join(sceneDir, '镜头5-预演.png'));
    const result = await call<WriteResult>('video-scene-write-image', {
      ...ref,
      kind: 'previz',
      shotIndex: 5,
      data: PNG,
    });
    expect(result.ok).toBe(true);
    expect(await readFile(outside, 'utf-8')).toBe('outside');
    const written = path.join(sceneDir, '镜头5-预演.png');
    expect((await lstat(written)).isSymbolicLink()).toBe(false);
    expect(Array.from(await readFile(written))).toEqual(Array.from(PNG));
  });

  it('拒绝非图片内容、空内容、过大、未知类型与无效镜头序号', async () => {
    const write = (patch: Record<string, unknown>) =>
      call('video-scene-write-image', {
        ...ref,
        kind: 'keyframe',
        shotIndex: 1,
        data: PNG,
        ...patch,
      });
    expect(await write({ data: new TextEncoder().encode('<script>') })).toMatchObject({
      ok: false,
      error: { message: '只支持 PNG / JPEG / GIF / WebP 图片' },
    });
    expect(await write({ data: new Uint8Array() })).toMatchObject({
      ok: false,
      error: { message: '图片内容为空' },
    });
    expect(await write({ data: 'iVBORw0KGgo=' })).toMatchObject({
      ok: false,
      error: { message: '图片内容为空' },
    });
    const huge = new Uint8Array(MAX_SCENE_IMAGE_BYTES + 1);
    huge.set(PNG);
    expect(await write({ data: huge })).toMatchObject({
      ok: false,
      error: { message: '图片过大' },
    });
    expect(await write({ kind: 'video' })).toMatchObject({
      ok: false,
      error: { message: '不支持的图片类型' },
    });
    for (const shotIndex of [0, 1.5, 1000, '1']) {
      expect(await write({ shotIndex })).toMatchObject({
        ok: false,
        error: { message: '无效的镜头序号' },
      });
    }
    expect(existsSync(sceneDir)).toBe(false);
  });
});
