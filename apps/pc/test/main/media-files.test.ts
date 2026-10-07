import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { mkdir, symlink, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// character-avatar 顶层引入了 electron 与 session，这里只需要 detectImageExtension
vi.mock('electron', () => ({ ipcMain: { handle: () => undefined } }));
vi.mock('../../src/main/handlers/session', () => ({ getWorkspaceRootForSender: () => null }));

const { loadReferenceImages, resolveExistingInsideWork, MAX_ENTITY_IMAGE_BYTES } = await import(
  '../../src/main/media-files'
);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9]);

const dataUrl = (mime: string, bytes: Uint8Array) =>
  `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;

let root: string;
let work: string;
let outside: string;

beforeEach(async () => {
  // macOS 临时目录经 /var → /private/var 符号链接，统一用真实路径
  root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ne-media-files-')));
  work = path.join(root, 'novels', '星河旅人');
  outside = path.join(root, 'outside');
  await mkdir(path.join(work, '资料', '图集'), { recursive: true });
  await mkdir(outside, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('resolveExistingInsideWork', () => {
  it('作品内已存在的文件返回真实路径，不存在返回 null', async () => {
    await writeFile(path.join(work, '资料', '图集', 'a.png'), PNG);
    expect(await resolveExistingInsideWork(work, '资料/图集/a.png')).toBe(
      path.join(work, '资料', '图集', 'a.png')
    );
    expect(await resolveExistingInsideWork(work, '资料/图集/missing.png')).toBeNull();
  });

  it('拒绝不安全路径与经符号链接逃出作品目录的文件', async () => {
    await expect(resolveExistingInsideWork(work, '../outside/a.png')).rejects.toThrow(
      '无效的图片路径'
    );
    await expect(resolveExistingInsideWork(work, '/etc/passwd')).rejects.toThrow('无效的图片路径');
    await writeFile(path.join(outside, 'secret.png'), PNG);
    await symlink(path.join(outside, 'secret.png'), path.join(work, '资料', '图集', 'link.png'));
    await expect(resolveExistingInsideWork(work, '资料/图集/link.png')).rejects.toThrow(
      '作品目录之外'
    );
    await symlink(outside, path.join(work, '资料', '外链目录'));
    await expect(resolveExistingInsideWork(work, '资料/外链目录/secret.png')).rejects.toThrow(
      '作品目录之外'
    );
  });
});

describe('loadReferenceImages', () => {
  it('按顺序把作品内图片读成 data URL', async () => {
    await writeFile(path.join(work, '资料', '图集', 'a.png'), PNG);
    await writeFile(path.join(work, '资料', '图集', 'b.jpg'), JPG);
    expect(await loadReferenceImages(work, ['资料/图集/b.jpg', '资料/图集/a.png'])).toEqual([
      dataUrl('image/jpeg', JPG),
      dataUrl('image/png', PNG),
    ]);
  });

  it('非数组输入返回空列表', async () => {
    expect(await loadReferenceImages(work, undefined)).toEqual([]);
    expect(await loadReferenceImages(work, '资料/图集/a.png')).toEqual([]);
  });

  it('跳过缺失、不安全、非图片、目录、过大与符号链接逃出的项', async () => {
    const dir = path.join(work, '资料', '图集');
    await writeFile(path.join(dir, 'ok.png'), PNG);
    await writeFile(path.join(dir, 'fake.png'), 'not an image');
    await writeFile(path.join(dir, 'huge.png'), PNG);
    await truncate(path.join(dir, 'huge.png'), MAX_ENTITY_IMAGE_BYTES + 1);
    await mkdir(path.join(dir, 'folder.png'));
    await writeFile(path.join(outside, 'secret.png'), PNG);
    await symlink(path.join(outside, 'secret.png'), path.join(dir, 'link.png'));
    const result = await loadReferenceImages(
      work,
      [
        '资料/图集/missing.png',
        '../outside/secret.png',
        42,
        '资料/图集/fake.png',
        '资料/图集/huge.png',
        '资料/图集/folder.png',
        '资料/图集/link.png',
        '资料/图集/ok.png',
      ],
      20
    );
    expect(result).toEqual([dataUrl('image/png', PNG)]);
  });

  it('最多返回 limit 张（默认 4），跳过的项不占名额', async () => {
    const refs: string[] = [];
    for (let i = 1; i <= 6; i += 1) {
      await writeFile(path.join(work, '资料', '图集', `${i}.png`), PNG);
      refs.push(`资料/图集/${i}.png`);
    }
    expect(await loadReferenceImages(work, refs)).toHaveLength(4);
    expect(await loadReferenceImages(work, refs, 1)).toHaveLength(1);
    // 被跳过的项不占名额
    expect(await loadReferenceImages(work, ['资料/图集/missing.png', refs[0]], 1)).toEqual([
      dataUrl('image/png', PNG),
    ]);
  });
});
