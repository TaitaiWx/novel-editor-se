/**
 * 文件树行展示用的纯函数：文件类型识别、机器生成文件名识别、中间省略拆分、悬停提示文本。
 * 不依赖 React / DOM，便于单测，也便于在大目录下按文件名缓存计算结果。
 */

/** 文件大类（决定图标与类型标签） */
export type FileKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'word'
  | 'excel'
  | 'ppt'
  | 'archive'
  | 'markdown'
  | 'text'
  | 'code'
  | 'unknown';

export const FILE_KIND_LABELS: Record<FileKind, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  pdf: 'PDF',
  word: '文档',
  excel: '表格',
  ppt: '演示',
  archive: '压缩包',
  markdown: 'Markdown',
  text: '文本',
  code: '代码',
  unknown: '文件',
};

const KIND_EXTENSIONS: Record<Exclude<FileKind, 'unknown'>, string[]> = {
  image: [
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'bmp',
    'svg',
    'ico',
    'tif',
    'tiff',
    'heic',
    'heif',
    'avif',
    'psd',
  ],
  video: ['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'mpg', 'mpeg', '3gp'],
  audio: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'amr'],
  pdf: ['pdf'],
  word: ['doc', 'docx', 'rtf', 'odt', 'pages', 'wps'],
  excel: ['xls', 'xlsx', 'xlsm', 'csv', 'tsv', 'ods', 'numbers', 'et'],
  ppt: ['ppt', 'pptx', 'pps', 'ppsx', 'odp', 'key', 'dps'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst'],
  markdown: ['md', 'markdown', 'mdx'],
  text: ['txt', 'log', 'text', 'fountain', 'epub'],
  code: [
    'js',
    'mjs',
    'cjs',
    'ts',
    'jsx',
    'tsx',
    'json',
    'jsonc',
    'yaml',
    'yml',
    'toml',
    'xml',
    'html',
    'htm',
    'css',
    'scss',
    'less',
    'py',
    'sh',
    'ini',
    'sql',
  ],
};

const KIND_BY_EXTENSION: ReadonlyMap<string, FileKind> = new Map(
  (Object.entries(KIND_EXTENSIONS) as [FileKind, string[]][]).flatMap(([kind, exts]) =>
    exts.map((ext) => [ext, kind] as const)
  )
);

/** 扩展名最长长度（含点）；更长的「扩展名」通常是文件名中的句点，不当作扩展名 */
const MAX_EXTENSION_LENGTH = 12;
const EXTENSION_PATTERN = /^\.[\p{L}\p{N}_-]+$/u;

/** 拆分主名与扩展名（扩展名含前导点；`.gitignore` 这类点文件视为无扩展名） */
export function splitFileName(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return { stem: name, ext: '' };
  const ext = name.slice(dot);
  if (ext.length > MAX_EXTENSION_LENGTH || !EXTENSION_PATTERN.test(ext)) {
    return { stem: name, ext: '' };
  }
  return { stem: name.slice(0, dot), ext };
}

/** 按扩展名判断文件大类 */
export function getFileKind(name: string): FileKind {
  const { ext } = splitFileName(name);
  if (!ext) return 'unknown';
  return KIND_BY_EXTENSION.get(ext.slice(1).toLowerCase()) ?? 'unknown';
}

const HEX_HASH = /^[0-9a-f]{16,}$/i;
const GUID = /^\{?[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\}?$/i;
const LONG_DIGITS = /^\d{13,}$/;
/** 复制 / 重复下载产生的后缀：`(1)`、`_2`、`-3`、` copy` */
const DUPLICATE_SUFFIX = /(?:\s*\(\d{1,3}\)|[_-]\d{1,3}|\s+copy)$/i;

/**
 * 是否是机器生成的文件名（哈希、GUID / UUID、毫秒时间戳），这类名字对作者没有可读信息，
 * 行内需要额外展示类型标签
 */
export function isMachineGeneratedName(name: string): boolean {
  const stem = splitFileName(name).stem.trim().replace(DUPLICATE_SUFFIX, '');
  return HEX_HASH.test(stem) || GUID.test(stem) || LONG_DIGITS.test(stem);
}

/** 中间省略时尾部保留的主名字符数 */
export const TAIL_STEM_CHARS = 6;

/** 低于该视觉宽度（半角字符计 1、全角字符计 2）的名字在侧栏中不会被截断，无需拆分 */
export const MIN_SPLIT_VISUAL_WIDTH = 20;

/** 粗略视觉宽度：CJK 等全角字符按 2 计，其余按 1 计 */
export function visualWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += (char.codePointAt(0) ?? 0) >= 0x2e80 ? 2 : 1;
  }
  return width;
}

/**
 * 拆分为「可收缩的头部」与「始终完整显示的尾部」（主名末尾若干字符 + 扩展名）。
 * 头部由 CSS 省略号截断，因此最终效果为 `08980f83…2060.mp4`；空间足够时两段无缝拼接。
 * 短名字、无扩展名的普通名字不拆分（tail 为空），沿用末尾省略。
 */
export function splitMiddleEllipsis(
  name: string,
  tailStemChars = TAIL_STEM_CHARS
): { head: string; tail: string } {
  const { stem, ext } = splitFileName(name);
  if (visualWidth(name) < MIN_SPLIT_VISUAL_WIDTH) return { head: name, tail: '' };
  if (!ext && !isMachineGeneratedName(name)) return { head: name, tail: '' };
  // 按码点切分，避免拆开代理对（emoji 等）
  const stemChars = Array.from(stem);
  if (stemChars.length <= tailStemChars) {
    return ext ? { head: stem, tail: ext } : { head: name, tail: '' };
  }
  const cut = stemChars.length - tailStemChars;
  return {
    head: stemChars.slice(0, cut).join(''),
    tail: stemChars.slice(cut).join('') + ext,
  };
}

export const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const pad = (value: number) => String(value).padStart(2, '0');

/** 本地时间 `YYYY-MM-DD HH:mm`（不依赖系统区域设置，保证各平台一致） */
export function formatModifiedTime(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

/** 悬停提示：完整文件名 + 类型 / 大小 + 修改时间 */
export function buildFileTooltip(
  name: string,
  kindLabel: string | null,
  info?: { size: number; modified: Date | string | number } | null
): string {
  const lines = [name];
  const facts: string[] = [];
  if (kindLabel) facts.push(kindLabel);
  if (info) facts.push(formatFileSize(info.size));
  if (facts.length > 0) lines.push(facts.join(' · '));
  if (info) {
    const modified = formatModifiedTime(info.modified);
    if (modified) lines.push(`修改于 ${modified}`);
  }
  return lines.join('\n');
}

/** 单行文件名的全部派生展示信息（按文件名计算一次） */
export interface FileDisplayInfo {
  kind: FileKind;
  kindLabel: string;
  machineGenerated: boolean;
  head: string;
  tail: string;
}

export function describeFileName(name: string): FileDisplayInfo {
  const kind = getFileKind(name);
  const { head, tail } = splitMiddleEllipsis(name);
  const { ext } = splitFileName(name);
  return {
    kind,
    // 未知类型有扩展名时直接显示扩展名（如 BIN），比笼统的「文件」更有辨识度
    kindLabel: kind === 'unknown' && ext ? ext.slice(1).toUpperCase() : FILE_KIND_LABELS[kind],
    machineGenerated: isMachineGeneratedName(name),
    head,
    tail,
  };
}
