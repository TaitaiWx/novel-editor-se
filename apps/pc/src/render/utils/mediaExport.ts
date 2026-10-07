/**
 * 单个图片 / 视频 / 音频导出（参考窗格、图集、资料右键菜单、场景视频版本列表共用）。
 *
 * - 图片可导出为 PNG / JPEG / WebP：目标格式与源文件相同时原样复制，不同时在渲染进程用 canvas 转换后交给主进程写入
 * - 视频 / 音频只按原容器导出（mp4 / webm / mov / m4a / wav … 原样复制，绝不转码）
 * 主进程 `media-export` 负责另存为对话框与校验（见 main/handlers/media-export.ts）。
 */
import { referenceKindOf } from './referencePane';

export type ImageExportFormat = 'png' | 'jpeg' | 'webp';

export const IMAGE_EXPORT_FORMATS: ReadonlyArray<{ format: ImageExportFormat; label: string }> = [
  { format: 'png', label: 'PNG' },
  { format: 'jpeg', label: 'JPEG' },
  { format: 'webp', label: 'WebP' },
];

const MIME: Record<ImageExportFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export interface MediaExportChoice {
  /** 目标格式（扩展名）；省略表示原格式 */
  format?: string;
  label: string;
}

export interface MediaExportResult {
  saved: boolean;
  filePath?: string;
  error?: string;
}

function extensionOf(filePath: string): string {
  const name = filePath.split(/[\\/]/).pop() ?? filePath;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function canonical(ext: string): string {
  return ext === 'jpg' ? 'jpeg' : ext;
}

/** 某个文件可选的导出格式：图片 PNG / JPEG / WebP，视频 / 音频只有原格式 */
export function exportChoicesFor(filePath: string): MediaExportChoice[] {
  const kind = referenceKindOf(filePath);
  if (kind === 'image') {
    return IMAGE_EXPORT_FORMATS.map(({ format, label }) => ({ format, label }));
  }
  if (kind === 'video' || kind === 'audio') {
    const ext = extensionOf(filePath);
    return [{ format: ext, label: ext.toUpperCase() }];
  }
  return [];
}

export type MediaExportPlan =
  | { mode: 'copy'; format: string }
  | { mode: 'convert'; format: ImageExportFormat; mime: string };

/**
 * 导出方式：视频 / 音频与「同格式」图片原样复制；图片换格式时转换。
 * 不是图片 / 视频 / 音频，或视频 / 音频要求换格式时返回 null（不支持）。
 */
export function planMediaExport(sourcePath: string, target?: string): MediaExportPlan | null {
  const kind = referenceKindOf(sourcePath);
  const sourceExt = extensionOf(sourcePath);
  const wanted = target ? canonical(target.toLowerCase().replace(/^\./, '')) : canonical(sourceExt);
  if (kind === 'video' || kind === 'audio') {
    return wanted === canonical(sourceExt) ? { mode: 'copy', format: sourceExt } : null;
  }
  if (kind !== 'image') return null;
  if (wanted === canonical(sourceExt)) return { mode: 'copy', format: sourceExt };
  if (wanted === 'png' || wanted === 'jpeg' || wanted === 'webp') {
    return { mode: 'convert', format: wanted, mime: MIME[wanted] };
  }
  return null;
}

/** 建议的文件名：去掉原扩展名，换成目标格式 */
export function exportFileName(sourcePath: string, format: string, title?: string): string {
  const name = sourcePath.split(/[\\/]/).pop() ?? sourcePath;
  const base = (title?.trim() || name).replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const ext = format === 'jpeg' ? 'jpg' : format;
  return `${base}.${ext}`;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function decodeImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 用 canvas 把图片转成目标格式（JPEG 没有透明通道，先铺白底） */
export async function convertImage(
  bytes: Uint8Array,
  sourceMime: string,
  format: ImageExportFormat
): Promise<Uint8Array> {
  const image = await decodeImage(new Blob([bytes], { type: sourceMime }));
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) throw new Error('无法读取图片尺寸');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前环境不支持图片转换');
  if (format === 'jpeg') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(image, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, MIME[format], format === 'png' ? undefined : 0.92)
  );
  if (!blob || blob.type !== MIME[format]) throw new Error(`当前环境不支持导出为 ${format}`);
  return new Uint8Array(await blob.arrayBuffer());
}

/** 导出一个图片 / 视频 / 音频：弹出另存为对话框；作者取消时 saved 为 false */
export async function exportMediaFile(input: {
  sourcePath: string;
  format?: string;
  title?: string;
}): Promise<MediaExportResult> {
  const ipc = window.electron?.ipcRenderer;
  if (!ipc) return { saved: false, error: '当前环境无法导出文件' };
  const plan = planMediaExport(input.sourcePath, input.format);
  if (!plan) return { saved: false, error: '这个文件不能导出为该格式' };
  const defaultName = exportFileName(input.sourcePath, plan.format, input.title);
  try {
    if (plan.mode === 'copy') {
      return await ipc.invoke('media-export', {
        sourcePath: input.sourcePath,
        defaultName,
        format: plan.format,
      });
    }
    const source = (await ipc.invoke('read-file-binary', input.sourcePath)) as {
      base64Content: string;
      mimeType: string;
    } | null;
    if (!source?.base64Content) return { saved: false, error: '无法读取文件' };
    const data = await convertImage(
      base64ToBytes(source.base64Content),
      source.mimeType,
      plan.format
    );
    return await ipc.invoke('media-export', {
      sourcePath: input.sourcePath,
      defaultName,
      format: plan.format,
      data,
    });
  } catch (error) {
    return { saved: false, error: error instanceof Error ? error.message : String(error) };
  }
}

interface ToastLike {
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
}

/** 导出并提示结果（保存位置 / 失败原因；取消时不提示） */
export async function exportMediaWithToast(
  input: { sourcePath: string; format?: string; title?: string },
  toast: ToastLike | null
): Promise<MediaExportResult> {
  const result = await exportMediaFile(input);
  if (result.saved) toast?.success(`已导出到 ${result.filePath ?? ''}`, 5000);
  else if (result.error) toast?.error(`导出失败：${result.error}`);
  return result;
}

/** 播放器截图 / 录制可保存的格式（MIME → 主进程格式名） */
const GENERATED_FORMATS: Record<string, 'png' | 'jpeg' | 'webp' | 'webm' | 'mp4'> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'video/webm': 'webm',
  'video/mp4': 'mp4',
};

/** MIME（可带参数）→ 主进程格式名；不支持时为 null */
export function generatedFormatOf(mimeType: string) {
  return GENERATED_FORMATS[mimeType.split(';')[0].trim().toLowerCase()] ?? null;
}

/** 保存播放器生成的截图 / 录制（弹出另存为对话框；作者取消时 saved 为 false） */
export async function saveGeneratedMedia(blob: Blob, fileName: string): Promise<MediaExportResult> {
  const ipc = window.electron?.ipcRenderer;
  if (!ipc) return { saved: false, error: '当前环境无法保存文件' };
  const format = generatedFormatOf(blob.type);
  if (!format) return { saved: false, error: `不支持保存 ${blob.type || '未知'} 格式` };
  try {
    const data = new Uint8Array(await blob.arrayBuffer());
    return await ipc.invoke('media-save-generated', { defaultName: fileName, format, data });
  } catch (error) {
    return { saved: false, error: error instanceof Error ? error.message : String(error) };
  }
}
