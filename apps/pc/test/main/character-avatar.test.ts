import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
const workspaceRoot = { value: null as string | null };

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

const { detectImageExtension, registerCharacterAvatarHandlers, sanitizeAvatarBaseName } =
  await import('../../src/main/handlers/character-avatar');
registerCharacterAvatarHandlers();

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9]);

let root: string;
let work: string;

async function save(...args: unknown[]) {
  const handler = handlers.get('character-avatar-save');
  if (!handler) throw new Error('未注册');
  return (await handler({ sender: { id: 1 } }, ...args)) as
    | { ok: true; data: { relativePath: string; absolutePath: string } }
    | { ok: false; error: string };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'avatar-'));
  work = path.join(root, 'novels', '星河旅人');
  await mkdir(work, { recursive: true });
  workspaceRoot.value = root;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('character-avatar-save', () => {
  it('按文件头识别图片；人物名去掉路径字符', () => {
    expect(detectImageExtension(PNG)).toBe('png');
    expect(detectImageExtension(JPG)).toBe('jpg');
    expect(detectImageExtension(new TextEncoder().encode('GIF89a...'))).toBe('gif');
    expect(
      detectImageExtension(
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
      )
    ).toBe('webp');
    expect(detectImageExtension(new TextEncoder().encode('<svg/>'))).toBeNull();
    expect(sanitizeAvatarBaseName('../林/舟:\u0001')).toBe('林舟');
    expect(sanitizeAvatarBaseName('...')).toBe('人物');
  });

  it('保存到 <作品>/资料/人物头像/，返回相对路径；更换时清理旧头像', async () => {
    const first = await save(work, '林舟', PNG);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.relativePath).toMatch(/^资料\/人物头像\/林舟-[0-9a-f]{8}\.png$/);
    expect(await readFile(first.data.absolutePath)).toEqual(Buffer.from(PNG));

    const other = path.join(work, '资料', '人物头像', '苏晴-0000aaaa.png');
    await writeFile(other, PNG);
    const second = await save(work, '林舟', JPG);
    expect(second.ok && second.data.relativePath.endsWith('.jpg')).toBe(true);
    const files = await readdir(path.join(work, '资料', '人物头像'));
    expect(files.sort()).toEqual(
      [path.basename(other), path.basename(second.ok ? second.data.absolutePath : '')].sort()
    );
  });

  it('拒绝：非图片、超过 5MB、相对路径、不存在的目录、工作区之外、无效人物名', async () => {
    expect(await save(work, '林舟', new TextEncoder().encode('hello'))).toMatchObject({
      ok: false,
      error: expect.stringContaining('只支持'),
    });
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PNG);
    expect(await save(work, '林舟', big)).toMatchObject({
      ok: false,
      error: expect.stringContaining('5MB'),
    });
    expect((await save('novels/星河旅人', '林舟', PNG)).ok).toBe(false);
    expect((await save(path.join(root, 'missing'), '林舟', PNG)).ok).toBe(false);
    expect((await save(work, '', PNG)).ok).toBe(false);
    expect((await save(work, '林舟', 'not-bytes')).ok).toBe(false);

    const outside = await mkdtemp(path.join(os.tmpdir(), 'avatar-outside-'));
    try {
      expect(await save(outside, '林舟', PNG)).toMatchObject({
        ok: false,
        error: expect.stringContaining('不在当前打开的项目内'),
      });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
