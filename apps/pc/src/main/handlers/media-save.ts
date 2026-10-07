/**
 * 播放器截图 / 录制结果保存 IPC：media-save-generated
 *
 * 字节由渲染进程生成（canvas 截图 PNG / JPEG / WebP，MediaRecorder 录制 WebM / MP4），没有源文件：
 * - 弹出系统「另存为」对话框（默认「下载」目录，按格式过滤），作者取消时不写任何文件
 * - 不信任渲染进程：格式必须在白名单内且与文件头一致，大小有上限，文件名清洗为单个路径段
 * E2E 测试（NOVEL_EDITOR_E2E=1）可用 NOVEL_EDITOR_E2E_SAVE_PATH 跳过对话框。
 */
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { writeFile } from 'fs/promises';
import path from 'path';
import { detectImageExtension } from './character-avatar';
import {
  e2eSavePath,
  sanitizeExportName,
  type MediaExportResult,
  type SaveDialogFn,
} from './media-export';

/** 录制可能较长：最多 512MB */
export const MAX_GENERATED_MEDIA_BYTES = 512 * 1024 * 1024;

export const GENERATED_MEDIA_FORMATS = ['png', 'jpeg', 'webp', 'webm', 'mp4'] as const;
export type GeneratedMediaFormat = (typeof GENERATED_MEDIA_FORMATS)[number];

const FILTERS: Record<GeneratedMediaFormat, { name: string; ext: string }> = {
  png: { name: 'PNG 图片', ext: 'png' },
  jpeg: { name: 'JPEG 图片', ext: 'jpg' },
  webp: { name: 'WebP 图片', ext: 'webp' },
  webm: { name: 'WebM 视频', ext: 'webm' },
  mp4: { name: 'MP4 视频', ext: 'mp4' },
};

export interface GeneratedMediaRequest {
  /** 建议的文件名（不含目录） */
  defaultName?: string;
  format: GeneratedMediaFormat;
  data: Uint8Array;
}

/** 按文件头识别：PNG / JPEG / WebP（图片）、WebM（EBML 头）、MP4（ftyp box） */
export function detectGeneratedFormat(bytes: Uint8Array): GeneratedMediaFormat | null {
  const image = detectImageExtension(bytes);
  if (image === 'png' || image === 'webp') return image;
  if (image === 'jpg') return 'jpeg';
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return 'webm';
  }
  if (
    bytes.length >= 8 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return 'mp4';
  }
  return null;
}

function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

/** 校验请求，返回格式与字节；不合法时抛错 */
export function planGeneratedSave(request: unknown): {
  format: GeneratedMediaFormat;
  bytes: Uint8Array;
  name: string;
} {
  if (!request || typeof request !== 'object') throw new Error('无效的保存请求');
  const input = request as Partial<Record<keyof GeneratedMediaRequest, unknown>>;
  const format = typeof input.format === 'string' ? input.format.toLowerCase() : '';
  if (!(GENERATED_MEDIA_FORMATS as readonly string[]).includes(format)) {
    throw new Error('只支持保存 PNG / JPEG / WebP 图片与 WebM / MP4 视频');
  }
  const bytes = toBytes(input.data);
  if (!bytes || bytes.length === 0) throw new Error('没有可保存的内容');
  if (bytes.length > MAX_GENERATED_MEDIA_BYTES) throw new Error('文件不能超过 512MB');
  const typed = format as GeneratedMediaFormat;
  if (detectGeneratedFormat(bytes) !== typed) throw new Error('文件内容与格式不符');
  const name = sanitizeExportName(input.defaultName, 'media', FILTERS[typed].ext);
  return { format: typed, bytes, name };
}

export async function saveGeneratedMedia(
  request: unknown,
  deps: { showSaveDialog: SaveDialogFn; defaultDir: string }
): Promise<MediaExportResult> {
  const plan = planGeneratedSave(request);
  const filter = FILTERS[plan.format];
  const picked = await deps.showSaveDialog({
    defaultPath: path.join(deps.defaultDir, plan.name),
    filters: [{ name: filter.name, extensions: [filter.ext] }],
  });
  if (picked.canceled || !picked.filePath) return { saved: false };
  let target = path.resolve(picked.filePath);
  // 作者删掉了扩展名时补上
  if (!path.extname(target)) target = `${target}.${filter.ext}`;
  await writeFile(target, plan.bytes);
  return { saved: true, filePath: target };
}

export function registerMediaSaveHandler(): void {
  ipcMain.handle(
    'media-save-generated',
    async (event, request: unknown): Promise<MediaExportResult> => {
      try {
        const window = BrowserWindow.fromWebContents(event.sender);
        return await saveGeneratedMedia(request, {
          defaultDir: app.getPath('downloads'),
          showSaveDialog: async (options) => {
            const override = e2eSavePath();
            if (override) return { canceled: false, filePath: override };
            const result = window
              ? await dialog.showSaveDialog(window, options)
              : await dialog.showSaveDialog(options);
            return { canceled: result.canceled, filePath: result.filePath };
          },
        });
      } catch (error) {
        return { saved: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );
}
