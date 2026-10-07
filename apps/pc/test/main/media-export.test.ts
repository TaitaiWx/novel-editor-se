import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
const workspaceRoot = { value: null as string | null };
const dialogResult = {
  value: { canceled: false, filePath: '' } as { canceled: boolean; filePath?: string },
};
const showSaveDialog = vi.fn(async (..._args: unknown[]) => dialogResult.value);

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showSaveDialog: (...args: unknown[]) => showSaveDialog(...args) },
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
  },
}));
vi.mock('../../src/main/handlers/session', () => ({
  getWorkspaceRootForSender: () => workspaceRoot.value,
}));

const { registerMediaExportHandlers, planExport, sanitizeExportName, MAX_MEDIA_EXPORT_BYTES } =
  await import('../../src/main/handlers/media-export');
registerMediaExportHandlers();

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1]);

let root: string;
let out: string;
let image: string;
let video: string;

async function run(request: unknown) {
  const handler = handlers.get('media-export');
  if (!handler) throw new Error('未注册');
  return (await handler({ sender: { id: 1 } }, request)) as {
    saved: boolean;
    filePath?: string;
    error?: string;
  };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'media-export-'));
  out = await mkdtemp(path.join(os.tmpdir(), 'media-export-out-'));
  const dir = path.join(root, 'novels', '星河旅人', '资料', '视频');
  await mkdir(dir, { recursive: true });
  image = path.join(dir, '三视图.webp');
  video = path.join(dir, '离港.mp4');
  await writeFile(image, WEBP);
  await writeFile(video, Buffer.from('fake-mp4-bytes'));
  workspaceRoot.value = root;
  dialogResult.value = { canceled: false, filePath: path.join(out, 'saved.mp4') };
  showSaveDialog.mockClear();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
  delete process.env.NOVEL_EDITOR_E2E;
  delete process.env.NOVEL_EDITOR_E2E_SAVE_PATH;
});

describe('media-export', () => {
  it('视频原样复制到另存为位置（不转码），对话框按格式过滤', async () => {
    const result = await run({ sourcePath: video, defaultName: '离港.mp4' });
    expect(result).toEqual({ saved: true, filePath: path.join(out, 'saved.mp4') });
    expect(await readFile(path.join(out, 'saved.mp4'), 'utf8')).toBe('fake-mp4-bytes');
    const options = showSaveDialog.mock.calls[0][0] as {
      defaultPath: string;
      filters: Array<{ extensions: string[] }>;
    };
    expect(path.basename(options.defaultPath)).toBe('离港.mp4');
    expect(options.filters[0].extensions).toEqual(['mp4']);
  });

  it('音频（配乐 / 音效）同样原样复制，只能按原格式导出', async () => {
    const audio = path.join(root, 'novels', '星河旅人', '资料', '视频', '海港.m4a');
    await writeFile(audio, Buffer.from('fake-m4a-bytes'));
    dialogResult.value = { canceled: false, filePath: path.join(out, '海港.m4a') };
    const result = await run({ sourcePath: audio, defaultName: '海港' });
    expect(result).toEqual({ saved: true, filePath: path.join(out, '海港.m4a') });
    expect(await readFile(path.join(out, '海港.m4a'), 'utf8')).toBe('fake-m4a-bytes');
    const options = showSaveDialog.mock.calls[0][0] as {
      filters: Array<{ name: string; extensions: string[] }>;
    };
    expect(options.filters[0]).toEqual({ name: 'M4A 音频', extensions: ['m4a'] });
    expect((await run({ sourcePath: audio, format: 'mp3' })).error).toBe(
      '视频 / 音频只能按原格式导出'
    );
  });

  it('作者取消时不写任何文件', async () => {
    dialogResult.value = { canceled: true };
    await expect(run({ sourcePath: video })).resolves.toEqual({ saved: false });
    expect(existsSync(path.join(out, 'saved.mp4'))).toBe(false);
  });

  it('写入转换后的图片字节（按文件头校验），没有扩展名时补上', async () => {
    dialogResult.value = { canceled: false, filePath: path.join(out, '林舟') };
    const result = await run({ sourcePath: image, format: 'png', data: PNG });
    expect(result).toEqual({ saved: true, filePath: path.join(out, '林舟.png') });
    expect(new Uint8Array(await readFile(path.join(out, '林舟.png')))).toEqual(PNG);
  });

  it('拒绝：工作区外 / 相对路径 / 不存在 / 目录 / 非媒体扩展名 / 未打开项目', async () => {
    const outside = path.join(out, 'outside.png');
    await writeFile(outside, PNG);
    expect((await run({ sourcePath: outside })).error).toBe('文件不在当前打开的项目内');
    expect((await run({ sourcePath: 'novels/a.png' })).error).toBe('无效的文件路径');
    expect((await run({ sourcePath: path.join(root, 'none.png') })).error).toBe('文件不存在');
    const dirLike = path.join(root, 'folder.png');
    await mkdir(dirLike);
    expect((await run({ sourcePath: dirLike })).error).toBe('文件不存在');
    const text = path.join(root, '说明.md');
    await writeFile(text, '# x');
    expect((await run({ sourcePath: text })).error).toBe('只能导出图片、视频或音频文件');
    expect((await run(null)).error).toBe('无效的导出请求');
    workspaceRoot.value = null;
    expect((await run({ sourcePath: image })).error).toBe('没有打开项目');
    expect(showSaveDialog).not.toHaveBeenCalled();
  });

  it('拒绝经符号链接逃出工作区的文件', async () => {
    const outside = path.join(out, 'secret.png');
    await writeFile(outside, PNG);
    const link = path.join(root, 'link.png');
    await symlink(outside, link);
    expect((await run({ sourcePath: link })).error).toBe('文件不在当前打开的项目内');
  });

  it('拒绝：字节与格式不符、超过 50MB、视频换格式、图片换格式却没有字节', async () => {
    expect((await run({ sourcePath: image, format: 'png', data: JPG })).error).toBe(
      '图片内容与格式不符'
    );
    expect(
      (
        await run({
          sourcePath: image,
          format: 'png',
          data: new Uint8Array(MAX_MEDIA_EXPORT_BYTES + 1),
        })
      ).error
    ).toBe('文件不能超过 50MB');
    expect((await run({ sourcePath: video, format: 'webm' })).error).toBe(
      '视频 / 音频只能按原格式导出'
    );
    expect((await run({ sourcePath: video, format: 'png', data: PNG })).error).toBe(
      '视频 / 音频只能按原格式导出'
    );
    expect((await run({ sourcePath: image, format: 'png' })).error).toBe('需要先转换图片格式');
    expect((await run({ sourcePath: image, format: 'gif', data: PNG })).error).toBe(
      '只支持导出为 PNG / JPEG / WebP'
    );
    expect(showSaveDialog).not.toHaveBeenCalled();
  });

  it('E2E 替身：只在 NOVEL_EDITOR_E2E=1 时用 NOVEL_EDITOR_E2E_SAVE_PATH 跳过对话框', async () => {
    const target = path.join(out, 'e2e.mp4');
    process.env.NOVEL_EDITOR_E2E_SAVE_PATH = target;
    dialogResult.value = { canceled: true };
    await expect(run({ sourcePath: video })).resolves.toEqual({ saved: false });
    process.env.NOVEL_EDITOR_E2E = '1';
    await expect(run({ sourcePath: video })).resolves.toEqual({ saved: true, filePath: target });
    expect(existsSync(target)).toBe(true);
  });
});

describe('纯函数', () => {
  it('planExport：jpg 与 jpeg 视为同一格式', () => {
    expect(planExport('jpg', 'jpeg', undefined)).toEqual({ ext: 'jpg', bytes: null });
    expect(planExport('webp', 'jpeg', JPG)).toEqual({ ext: 'jpg', bytes: JPG });
    expect(planExport('png', undefined, undefined)).toEqual({ ext: 'png', bytes: null });
  });

  it('sanitizeExportName：去掉路径分隔符，换成目标扩展名', () => {
    expect(sanitizeExportName('../林舟/三视图.webp', 'x', 'png')).toBe('林舟三视图.png');
    expect(sanitizeExportName('', '离港.mp4', 'mp4')).toBe('离港.mp4');
    expect(sanitizeExportName(undefined, '', 'png')).toBe('media.png');
  });
});
