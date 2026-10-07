/**
 * 单个媒体文件导出 IPC：media-export
 *
 * 参考窗格、图集、资料右键菜单、场景视频版本列表的「导出…」都走这里：
 * - 弹出系统「另存为」对话框（按目标格式过滤），作者取消时不写任何文件
 * - 没有传入字节时原样复制源文件（视频永远不转码：mp4 / webm / mov 保持原容器）
 * - 传入字节时（渲染进程用 canvas 转好的 PNG / JPEG / WebP）按文件头校验后写入
 *
 * 不信任渲染进程：源文件必须是存在的绝对路径、普通文件、扩展名在白名单内，
 * 且（解析符号链接后）位于该窗口已上报的工作区内；字节不超过 50MB。
 * E2E 测试（NOVEL_EDITOR_E2E=1）可用 NOVEL_EDITOR_E2E_SAVE_PATH 跳过对话框，其他情况忽略该变量。
 * 播放器截图 / 录制生成的字节（没有源文件）走 media-save-generated（见 media-save.ts）。
 */
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { copyFile, realpath, stat, writeFile } from 'fs/promises';
import path from 'path';
import { isPathInWorkspace } from './database/workspace-path';
import { detectImageExtension } from './character-avatar';
import { getWorkspaceRootForSender } from './session';
import { isE2ETestMode } from '../launch-mode';
import { registerMediaSaveHandler } from './media-save';

export const MAX_MEDIA_EXPORT_BYTES = 50 * 1024 * 1024;

export const EXPORT_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] as const;
export const EXPORT_VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'm4v'] as const;
/** 渲染进程转换后可写入的图片格式 */
export const CONVERTED_IMAGE_FORMATS = ['png', 'jpeg', 'webp'] as const;

export interface MediaExportRequest {
  sourcePath: string;
  /** 建议的文件名（不含目录） */
  defaultName?: string;
  /** 目标格式（扩展名）；省略时与源文件相同 */
  format?: string;
  /** 渲染进程转换好的图片字节（只允许 PNG / JPEG / WebP） */
  data?: Uint8Array;
}

export interface MediaExportResult {
  saved: boolean;
  filePath?: string;
  error?: string;
}

export type SaveDialogFn = (options: {
  defaultPath: string;
  filters: Array<{ name: string; extensions: string[] }>;
}) => Promise<{ canceled: boolean; filePath?: string }>;

function extensionOf(filePath: string): string {
  return path.extname(filePath).slice(1).toLowerCase();
}

/** jpg / jpeg 视为同一种格式 */
function canonicalFormat(ext: string): string {
  return ext === 'jpg' ? 'jpeg' : ext;
}

function isImageExt(ext: string): boolean {
  return (EXPORT_IMAGE_EXTENSIONS as readonly string[]).includes(ext);
}

function isVideoExt(ext: string): boolean {
  return (EXPORT_VIDEO_EXTENSIONS as readonly string[]).includes(ext);
}

function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

/** 建议文件名：去掉路径分隔符与控制字符，扩展名换成目标格式 */
export function sanitizeExportName(raw: unknown, fallback: string, ext: string): string {
  const source = typeof raw === 'string' && raw.trim() ? raw : fallback;
  const cleaned = Array.from(source)
    .filter((char) => (char.codePointAt(0) ?? 0) >= 0x20 && !'\\/:*?"<>|'.includes(char))
    .join('')
    .replace(/^\.+/, '')
    .trim();
  const base = (cleaned || 'media').replace(/\.[A-Za-z0-9]{1,5}$/, '');
  return `${Array.from(base).slice(0, 80).join('')}.${ext}`;
}

/** 源文件校验：绝对路径、存在的普通文件、扩展名在白名单内、位于工作区内 */
export async function assertExportSource(raw: unknown, workspaceRoot: string | null) {
  if (typeof raw !== 'string' || !raw.trim() || !path.isAbsolute(raw)) {
    throw new Error('无效的文件路径');
  }
  if (!workspaceRoot) throw new Error('没有打开项目');
  const resolved = path.resolve(raw);
  const ext = extensionOf(resolved);
  if (!isImageExt(ext) && !isVideoExt(ext)) throw new Error('只能导出图片或视频文件');
  const info = await stat(resolved).catch(() => null);
  if (!info?.isFile()) throw new Error('文件不存在');
  const [realSource, realRoot] = await Promise.all([
    realpath(resolved),
    realpath(workspaceRoot).catch(() => workspaceRoot),
  ]);
  if (!isPathInWorkspace(realSource, realRoot)) throw new Error('文件不在当前打开的项目内');
  return { path: realSource, ext, size: info.size };
}

/** 选定导出方式：原样复制或写入转换后的字节；不合法时抛错 */
export function planExport(
  sourceExt: string,
  formatRaw: unknown,
  dataRaw: unknown
): { ext: string; bytes: Uint8Array | null } {
  const format =
    typeof formatRaw === 'string' && formatRaw.trim()
      ? formatRaw.trim().toLowerCase().replace(/^\./, '')
      : sourceExt;
  if (dataRaw !== undefined && dataRaw !== null) {
    const bytes = toBytes(dataRaw);
    if (!bytes || bytes.length === 0) throw new Error('没有读取到图片内容');
    if (bytes.length > MAX_MEDIA_EXPORT_BYTES) throw new Error('文件不能超过 50MB');
    if (!isImageExt(sourceExt)) throw new Error('视频只能按原格式导出');
    const target = canonicalFormat(format);
    if (!(CONVERTED_IMAGE_FORMATS as readonly string[]).includes(target)) {
      throw new Error('只支持导出为 PNG / JPEG / WebP');
    }
    const detected = detectImageExtension(bytes);
    if (!detected || canonicalFormat(detected) !== target) throw new Error('图片内容与格式不符');
    return { ext: target === 'jpeg' ? 'jpg' : target, bytes };
  }
  if (canonicalFormat(format) !== canonicalFormat(sourceExt)) {
    throw new Error(isVideoExt(sourceExt) ? '视频只能按原格式导出' : '需要先转换图片格式');
  }
  return { ext: sourceExt, bytes: null };
}

const FILTER_NAMES: Record<string, string> = {
  png: 'PNG 图片',
  jpg: 'JPEG 图片',
  jpeg: 'JPEG 图片',
  webp: 'WebP 图片',
  gif: 'GIF 图片',
  bmp: 'BMP 图片',
  svg: 'SVG 图片',
  mp4: 'MP4 视频',
  webm: 'WebM 视频',
  mov: 'QuickTime 视频',
  m4v: 'M4V 视频',
};

export interface ExportMediaDeps {
  workspaceRoot: string | null;
  showSaveDialog: SaveDialogFn;
  /** 对话框默认目录 */
  defaultDir: string;
}

export async function exportMedia(
  request: unknown,
  deps: ExportMediaDeps
): Promise<MediaExportResult> {
  if (!request || typeof request !== 'object') throw new Error('无效的导出请求');
  const input = request as Partial<Record<keyof MediaExportRequest, unknown>>;
  const source = await assertExportSource(input.sourcePath, deps.workspaceRoot);
  const plan = planExport(source.ext, input.format, input.data);
  const fileName = sanitizeExportName(input.defaultName, path.basename(source.path), plan.ext);
  const picked = await deps.showSaveDialog({
    defaultPath: path.join(deps.defaultDir, fileName),
    filters: [{ name: FILTER_NAMES[plan.ext] ?? plan.ext.toUpperCase(), extensions: [plan.ext] }],
  });
  if (picked.canceled || !picked.filePath) return { saved: false };
  let target = path.resolve(picked.filePath);
  // 作者删掉了扩展名时补上目标格式
  if (!extensionOf(target)) target = `${target}.${plan.ext}`;
  if (plan.bytes) {
    await writeFile(target, plan.bytes);
  } else if (target !== source.path) {
    await copyFile(source.path, target);
  }
  return { saved: true, filePath: target };
}

/** E2E 测试替身：只在 NOVEL_EDITOR_E2E=1 时生效 */
export function e2eSavePath(): string | null {
  if (!isE2ETestMode()) return null;
  const value = process.env.NOVEL_EDITOR_E2E_SAVE_PATH;
  return value && path.isAbsolute(value) ? value : null;
}

export function registerMediaExportHandlers(): void {
  registerMediaSaveHandler();
  ipcMain.handle('media-export', async (event, request: unknown): Promise<MediaExportResult> => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender);
      return await exportMedia(request, {
        workspaceRoot: getWorkspaceRootForSender(event.sender.id),
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
  });
}
