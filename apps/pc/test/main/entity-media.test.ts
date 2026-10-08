import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIError, type ImageGenerationRequest } from '@novel-editor/ai';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
const workspaceRoot = { value: null as string | null };
const imageProvider = {
  id: 'seedream-image',
  kind: 'image' as const,
  supportsReferences: true,
  generate: vi.fn(async (_request: ImageGenerationRequest) => ({
    images: [{ base64: 'AAAA', mimeType: 'image/png' }],
    model: 'seedream-test',
  })),
  testConnection: vi.fn(),
};
const service = {
  getImageProvider: vi.fn((_id?: string) => imageProvider),
  // 返回图片地址时的下载通道（这里直连）
  resolveDefaultId: vi.fn(() => 'image-1'),
  fetchFor: vi.fn(() => undefined),
};

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
  },
}));
vi.mock('../../src/main/handlers/session', () => ({
  getWorkspaceRootForSender: () => workspaceRoot.value,
}));
vi.mock('../../src/main/ai/runtime', () => ({
  getAIService: () => service,
}));

const { registerEntityMediaHandlers, saveEntityImage, loadReferenceImages } = await import(
  '../../src/main/handlers/entity-media'
);
registerEntityMediaHandlers();

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`未注册 ${channel}`);
  return (await handler({ sender: { id: 1 } }, ...args)) as T;
}

let root: string;
let work: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'entity-media-'));
  work = path.join(root, 'novels', '星河旅人');
  await mkdir(work, { recursive: true });
  workspaceRoot.value = root;
  imageProvider.generate.mockClear();
  imageProvider.supportsReferences = true;
  service.getImageProvider.mockClear();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('entity-image-save / delete', () => {
  it('保存到 资料/图集/人物|设定/<名称>/，AI 图同时写 .prompt.json', async () => {
    const result = await call<{ ok: true; data: { relativePath: string } }>(
      'entity-image-save',
      work,
      {
        entity: 'character',
        name: '林舟',
        data: PNG,
        prompt: '三视图',
        providerId: 'p',
        model: 'm',
      }
    );
    expect(result.ok).toBe(true);
    expect(result.data.relativePath).toMatch(
      /^资料\/图集\/人物\/林舟\/\d{8}-\d{6}-[0-9a-f]{8}\.png$/
    );
    const file = path.join(work, ...result.data.relativePath.split('/'));
    expect(new Uint8Array(await readFile(file))).toEqual(PNG);
    const sidecar = JSON.parse(await readFile(file.replace(/\.png$/, '.prompt.json'), 'utf-8'));
    expect(sidecar).toMatchObject({ prompt: '三视图', providerId: 'p', model: 'm' });

    const lore = await saveEntityImage(work, { entity: 'lore', name: '../北境', data: PNG }, root);
    expect(lore.relativePath.startsWith('资料/图集/设定/北境/')).toBe(true);
    const loreDir = path.join(work, '资料', '图集', '设定', '北境');
    expect((await readdir(loreDir)).some((name) => name.endsWith('.prompt.json'))).toBe(false);
  });

  it('拒绝非图片、过大、工作区外的目录与无效参数', async () => {
    const bad = async (...args: unknown[]) =>
      (await call<{ ok: boolean; error?: string }>('entity-image-save', ...args)).error;
    expect(
      await bad(work, {
        entity: 'character',
        name: '林舟',
        data: new TextEncoder().encode('<svg/>'),
      })
    ).toContain('只支持');
    expect(
      await bad(work, { entity: 'character', name: '林舟', data: new Uint8Array(11 * 1024 * 1024) })
    ).toContain('10MB');
    expect(await bad(work, { entity: 'other', name: '林舟', data: PNG })).toContain('图集类型');
    expect(await bad(work, { entity: 'lore', name: '', data: PNG })).toContain('名称');
    const outside = await mkdtemp(path.join(os.tmpdir(), 'outside-'));
    expect(await bad(outside, { entity: 'lore', name: 'x', data: PNG })).toContain(
      '不在当前打开的项目内'
    );
    await rm(outside, { recursive: true, force: true });
  });

  it('删除只允许 资料/图集/ 下的图片，连同 .prompt.json；不存在时也成功', async () => {
    const saved = await saveEntityImage(
      work,
      { entity: 'character', name: '林舟', data: PNG, prompt: 'x' },
      root
    );
    const file = path.join(work, ...saved.relativePath.split('/'));
    const ok = await call<{ ok: boolean }>('entity-image-delete', work, saved.relativePath);
    expect(ok.ok).toBe(true);
    expect(await readdir(path.dirname(file))).toEqual([]);
    expect((await call<{ ok: boolean }>('entity-image-delete', work, saved.relativePath)).ok).toBe(
      true
    );

    await mkdir(path.join(work, '资料'), { recursive: true });
    await writeFile(path.join(work, '资料', 'note.png'), PNG);
    for (const target of [
      '资料/note.png',
      '资料/图集/../note.png',
      '/etc/passwd',
      '资料/图集/a.md',
    ]) {
      const result = await call<{ ok: boolean; error?: string }>(
        'entity-image-delete',
        work,
        target
      );
      expect(result.ok, target).toBe(false);
    }
  });
});

describe('ai-image-generate', () => {
  it('读取作品内的参考图转成 data URL，交给图片服务；返回候选图', async () => {
    const saved = await saveEntityImage(
      work,
      { entity: 'character', name: '林舟', data: PNG },
      root
    );
    const result = await call<{
      ok: true;
      data: { images: Array<{ dataUrl: string }>; providerId: string; model: string };
    }>('ai-image-generate', {
      workPath: work,
      prompt: '林舟 三视图',
      aspectRatio: '16:9',
      count: 4,
      references: [saved.relativePath, '../escape.png', '资料/不存在.png'],
    });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ providerId: 'seedream-image', model: 'seedream-test' });
    expect(result.data.images[0].dataUrl).toBe('data:image/png;base64,AAAA');
    const request = imageProvider.generate.mock.calls[0][0];
    expect(request).toMatchObject({ prompt: '林舟 三视图', aspectRatio: '16:9', count: 4 });
    expect(request.referenceImages).toEqual([
      `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`,
    ]);
  });

  it('服务不支持参考图时不读取；描述为空 / 比例无效；服务未配置时返回规范化错误', async () => {
    imageProvider.supportsReferences = false;
    await call('ai-image-generate', {
      workPath: '/not/exists',
      prompt: '雪原',
      aspectRatio: 'wide',
      references: ['a.png'],
    });
    expect(imageProvider.generate.mock.calls[0][0]).toMatchObject({
      aspectRatio: undefined,
      referenceImages: [],
    });

    const empty = await call<{ ok: false; error: { message: string } }>('ai-image-generate', {
      prompt: '  ',
    });
    expect(empty.error.message).toContain('不能为空');

    service.getImageProvider.mockImplementationOnce(() => {
      throw new AIError({ kind: 'not-configured', message: '还没有配置图片服务' });
    });
    const missing = await call<{ ok: false; error: { kind: string } }>('ai-image-generate', {
      prompt: '雪原',
    });
    expect(missing.error.kind).toBe('not-configured');
  });

  it('参考图经符号链接逃出作品目录时忽略', async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), 'outside-'));
    await writeFile(path.join(outside, 'secret.png'), PNG);
    await mkdir(path.join(work, '资料'), { recursive: true });
    await symlink(path.join(outside, 'secret.png'), path.join(work, '资料', 'link.png'));
    expect(await loadReferenceImages(work, ['资料/link.png'])).toEqual([]);
    await rm(outside, { recursive: true, force: true });
  });
});
