/**
 * 资源预览的纯函数工具：MIME 推断、data URL 构建、大小 / 时长格式化
 */
export interface BinaryReadResult {
  base64Content: string;
  byteSize: number;
  mimeType: string;
}

export type ResourceKind = 'image' | 'pdf' | 'audio' | 'video' | 'binary';

export interface LoadedResource {
  kind: ResourceKind;
  mimeType: string;
  byteSize: number;
  dataUrl?: string;
}

export const MIME_BY_EXT: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.yml': 'application/yaml',
  '.yaml': 'application/yaml',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.scss': 'text/x-scss',
  '.css': 'text/css',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};

export const guessMimeTypeByPath = (filePath: string | null) => {
  if (!filePath) {
    return 'application/octet-stream';
  }

  const normalizedPath = filePath.toLowerCase();
  const matchedEntry = Object.entries(MIME_BY_EXT).find(([ext]) => normalizedPath.endsWith(ext));
  return matchedEntry?.[1] ?? 'application/octet-stream';
};

export const buildDataUrl = (mimeType: string, base64Content: string) =>
  `data:${mimeType};base64,${base64Content}`;

export const buildTextDataUrl = (mimeType: string, content: string) =>
  `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;

export const formatByteSize = (byteSize: number | null | undefined) => {
  if (!byteSize) {
    return '0 KB';
  }

  if (byteSize < 1024) {
    return `${byteSize} B`;
  }

  if (byteSize < 1024 * 1024) {
    return `${(byteSize / 1024).toFixed(1)} KB`;
  }

  return `${(byteSize / (1024 * 1024)).toFixed(2)} MB`;
};

export const formatDuration = (seconds: number | null) => {
  if (seconds === null || !Number.isFinite(seconds)) {
    return '读取中';
  }

  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

export const isUntitledPath = (filePath: string | null) =>
  Boolean(filePath && filePath.startsWith('__untitled__:'));

export const isTextBackedPreviewMime = (mimeType: string) => mimeType === 'image/svg+xml';

export const isPreviewableResourcePath = (filePath: string | null) => {
  if (!filePath || isUntitledPath(filePath)) {
    return false;
  }

  const mimeType = guessMimeTypeByPath(filePath);
  return (
    mimeType.startsWith('image/') ||
    mimeType === 'application/pdf' ||
    mimeType.startsWith('audio/') ||
    mimeType.startsWith('video/')
  );
};

export const isTextBackedPreviewResourcePath = (filePath: string | null) =>
  isTextBackedPreviewMime(guessMimeTypeByPath(filePath));
