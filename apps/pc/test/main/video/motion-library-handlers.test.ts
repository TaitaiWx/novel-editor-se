import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { builtinMotionBvh } from '@novel-editor/video';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
  },
}));

const { registerMotionLibraryHandlers } = await import('../../../src/main/handlers/motion-library');

const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ne-motion-library-')));
const work = path.join(root, 'novels', '星河旅人');
const outside = path.join(root, 'outside');
const libraryDir = path.join(work, '资料', '动作库');
const BVH = builtinMotionBvh('builtin:nod') ?? '';

registerMotionLibraryHandlers({
  assertWorkPath: async (raw: unknown) => {
    if (typeof raw !== 'string' || !path.isAbsolute(raw) || !existsSync(raw)) {
      throw new Error('无效的作品目录');
    }
    return raw;
  },
  workspaceRootFor: () => null,
});

type Result<T> = { ok: true; data: T } | { ok: false; error: { kind: string; message: string } };

async function call<T>(channel: string, payload: unknown): Promise<Result<T>> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`未注册: ${channel}`);
  return (await handler({ sender: { id: 1 } }, payload)) as Result<T>;
}

beforeEach(async () => {
  rmSync(root, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  await mkdir(outside, { recursive: true });
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('作品动作库 IPC', () => {
  it('没有动作库时列表为空，不创建目录', async () => {
    expect(await call('motion-library-list', { workPath: work })).toEqual({
      ok: true,
      data: { files: [] },
    });
    expect(existsSync(libraryDir)).toBe(false);
  });

  it('导入 → 列出 → 读取；同名自动加序号，不覆盖', async () => {
    const first = await call<{ fileName: string; clipId: string }>('motion-library-import', {
      workPath: work,
      fileName: 'nod.bvh',
      data: BVH,
    });
    expect(first).toEqual({ ok: true, data: { fileName: 'nod.bvh', clipId: 'lib:nod' } });
    const second = await call<{ fileName: string }>('motion-library-import', {
      workPath: work,
      fileName: 'nod.bvh',
      data: BVH,
    });
    expect(second.ok && second.data.fileName).toBe('nod-2.bvh');
    await writeFile(path.join(libraryDir, 'notes.txt'), 'x');
    const list = await call<{ files: { fileName: string; clipId: string }[] }>(
      'motion-library-list',
      { workPath: work }
    );
    expect(list.ok && list.data.files.map((file) => file.clipId)).toEqual(['lib:nod-2', 'lib:nod']);
    const read = await call<string>('motion-library-read', { workPath: work, fileName: 'nod.bvh' });
    expect(read).toEqual({ ok: true, data: BVH });
    expect(await readFile(path.join(libraryDir, 'nod-2.bvh'), 'utf-8')).toBe(BVH);
  });

  it('拒绝非 .bvh、带路径的文件名、无法解析的内容与超大文件', async () => {
    for (const fileName of ['a.txt', '../a.bvh', 'x/a.bvh', '.a.bvh']) {
      const result = await call('motion-library-import', { workPath: work, fileName, data: BVH });
      expect(result.ok, fileName).toBe(false);
    }
    const broken = await call('motion-library-import', {
      workPath: work,
      fileName: 'b.bvh',
      data: 'hello',
    });
    expect(broken.ok).toBe(false);
    const huge = await call('motion-library-import', {
      workPath: work,
      fileName: 'h.bvh',
      data: `${BVH}${' '.repeat(5 * 1024 * 1024)}`,
    });
    expect(huge.ok).toBe(false);
    const read = await call('motion-library-read', { workPath: work, fileName: '../../a.bvh' });
    expect(read.ok).toBe(false);
    const bad = await call('motion-library-list', { workPath: 'relative/path' });
    expect(bad.ok).toBe(false);
  });

  it('动作库或其中的文件经符号链接指向作品目录之外时拒绝', async () => {
    await writeFile(path.join(outside, 'secret.bvh'), BVH);
    await mkdir(libraryDir, { recursive: true });
    await symlink(path.join(outside, 'secret.bvh'), path.join(libraryDir, 'link.bvh'));
    const read = await call('motion-library-read', { workPath: work, fileName: 'link.bvh' });
    expect(read.ok).toBe(false);

    rmSync(libraryDir, { recursive: true, force: true });
    await symlink(outside, libraryDir);
    const list = await call('motion-library-list', { workPath: work });
    expect(list.ok).toBe(false);
  });
});
