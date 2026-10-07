import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
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
  getWorkspaceRootForSender: () => null,
}));

const { registerMediaExportHandlers } = await import('../../src/main/handlers/media-export');
const { detectGeneratedFormat, planGeneratedSave } = await import(
  '../../src/main/handlers/media-save'
);
registerMediaExportHandlers();

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

let out: string;

async function run(request: unknown) {
  const handler = handlers.get('media-save-generated');
  if (!handler) throw new Error('未注册');
  return (await handler({ sender: { id: 1 } }, request)) as {
    saved: boolean;
    filePath?: string;
    error?: string;
  };
}

beforeEach(async () => {
  out = await mkdtemp(path.join(os.tmpdir(), 'media-save-'));
  showSaveDialog.mockClear();
});

afterEach(async () => {
  await rm(out, { recursive: true, force: true });
  delete process.env.NOVEL_EDITOR_E2E;
  delete process.env.NOVEL_EDITOR_E2E_SAVE_PATH;
});

describe('media-save-generated（播放器截图 / 录制另存为）', () => {
  it('按文件头识别 PNG / WebM / MP4', () => {
    expect(detectGeneratedFormat(PNG)).toBe('png');
    expect(detectGeneratedFormat(WEBM)).toBe('webm');
    expect(detectGeneratedFormat(MP4)).toBe('mp4');
    expect(detectGeneratedFormat(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('截图写入另存为位置；对话框默认文件名清洗、按格式过滤；缺扩展名时补上', async () => {
    dialogResult.value = { canceled: false, filePath: path.join(out, 'shot') };
    const result = await run({ defaultName: '离港/第1场-0m03s.png', format: 'png', data: PNG });
    expect(result).toEqual({ saved: true, filePath: path.join(out, 'shot.png') });
    expect(new Uint8Array(await readFile(path.join(out, 'shot.png')))).toEqual(PNG);
    const options = showSaveDialog.mock.calls[0][0] as {
      defaultPath: string;
      filters: Array<{ extensions: string[] }>;
    };
    expect(path.basename(options.defaultPath)).toBe('离港第1场-0m03s.png');
    expect(options.filters[0].extensions).toEqual(['png']);
  });

  it('录制 WebM / MP4 原样写入；取消时不写文件', async () => {
    dialogResult.value = { canceled: false, filePath: path.join(out, 'rec.webm') };
    expect((await run({ defaultName: 'a.webm', format: 'webm', data: WEBM })).saved).toBe(true);
    dialogResult.value = { canceled: true };
    expect(await run({ defaultName: 'a.mp4', format: 'mp4', data: MP4 })).toEqual({ saved: false });
  });

  it('不信任渲染进程：格式白名单、内容与格式一致、不能为空', async () => {
    expect((await run({ format: 'exe', data: PNG })).error).toMatch(/只支持/);
    expect((await run({ format: 'webm', data: PNG })).error).toMatch(/不符/);
    expect((await run({ format: 'png', data: new Uint8Array() })).error).toMatch(/没有可保存/);
    expect((await run(null)).error).toMatch(/无效/);
    expect(() => planGeneratedSave({ format: 'png', data: 'not-bytes' })).toThrow(/没有可保存/);
    expect(showSaveDialog).not.toHaveBeenCalled();
  });

  it('E2E 模式下 NOVEL_EDITOR_E2E_SAVE_PATH 替代对话框', async () => {
    process.env.NOVEL_EDITOR_E2E = '1';
    process.env.NOVEL_EDITOR_E2E_SAVE_PATH = path.join(out, 'e2e');
    const result = await run({ defaultName: 'x.webm', format: 'webm', data: WEBM });
    expect(result).toEqual({ saved: true, filePath: path.join(out, 'e2e.webm') });
    expect(showSaveDialog).not.toHaveBeenCalled();
  });
});
