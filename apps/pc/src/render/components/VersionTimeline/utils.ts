/**
 * VersionTimeline 纯函数工具集
 */
import type {
  BinaryReadResult,
  PreviewState,
  SnapshotFileContent,
  SnapshotInfo,
  SnapshotJobStatus,
  SnapshotTimeFilter,
} from './types';
import { getPathBasename } from '@/render/utils/path';

export const CLIENT_MIME_BY_EXT: Record<string, string> = {
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
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

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
    return '时长读取中';
  }

  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

export const buildDataUrl = (mimeType: string, base64Content: string) =>
  `data:${mimeType};base64,${base64Content}`;

export const buildTextDataUrl = (mimeType: string, content: string) =>
  `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;

export const guessMimeTypeByPath = (filePath: string | null) => {
  if (!filePath) {
    return 'application/octet-stream';
  }

  const normalizedPath = filePath.toLowerCase();
  const matchedEntry = Object.entries(CLIENT_MIME_BY_EXT).find(([ext]) =>
    normalizedPath.endsWith(ext)
  );
  return matchedEntry?.[1] ?? 'application/octet-stream';
};

/** 相对时间格式化（now 可注入，便于测试） */
export const formatDate = (dateStr: string, now: Date = new Date()) => {
  const d = new Date(dateStr);
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
};

/** 按版本说明关键词与时间范围筛选快照 */
export const filterSnapshots = (
  snapshots: SnapshotInfo[],
  searchQuery: string,
  timeFilter: SnapshotTimeFilter,
  nowDate: Date = new Date()
): SnapshotInfo[] => {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const now = nowDate.getTime();

  return snapshots.filter((snapshot) => {
    const snapshotTime = new Date(snapshot.date).getTime();
    const queryMatched =
      normalizedQuery.length === 0 || snapshot.message.toLowerCase().includes(normalizedQuery);

    let timeMatched = true;
    if (timeFilter === 'today') {
      const snapshotDate = new Date(snapshot.date);
      timeMatched = snapshotDate.toDateString() === nowDate.toDateString();
    } else if (timeFilter === '7d') {
      timeMatched = now - snapshotTime <= 7 * 24 * 60 * 60 * 1000;
    } else if (timeFilter === '30d') {
      timeMatched = now - snapshotTime <= 30 * 24 * 60 * 60 * 1000;
    }

    return queryMatched && timeMatched;
  });
};

/** 从路径中取文件名（兼容 / 与 \ 分隔符） */
export const getFileName = (filePath: string | null) =>
  filePath ? getPathBasename(filePath) : null;

/** 快照任务进度比例（0~1） */
export const computeProgressRatio = (job: SnapshotJobStatus | null) =>
  job && job.totalFiles > 0 ? Math.min(job.processedFiles / job.totalFiles, 1) : 0;

/** SVG 快照（文本内容）的预览状态 */
export const buildSvgPreviewState = (
  snapshot: SnapshotInfo,
  snapshotFile: SnapshotFileContent & { content: string },
  currentSvgContent: string | null
): PreviewState => ({
  snapshotId: snapshot.id,
  snapshotMessage: snapshot.message,
  mimeType: snapshotFile.mimeType,
  byteSize: snapshotFile.byteSize,
  dataUrl: buildTextDataUrl(snapshotFile.mimeType, snapshotFile.content),
  kind: 'image',
  currentDataUrl: currentSvgContent
    ? buildTextDataUrl(snapshotFile.mimeType, currentSvgContent)
    : null,
  currentByteSize: currentSvgContent ? new Blob([currentSvgContent]).size : null,
  currentMimeType: currentSvgContent ? snapshotFile.mimeType : null,
});

/** 根据 MIME 推断可视化预览类型；非图片/PDF/音视频返回 null */
const resolveMediaKind = (mimeType: string): Exclude<PreviewState['kind'], 'binary'> | null => {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return null;
};

/** 二进制快照（图片/PDF/音频/视频/其他）的预览状态 */
export const buildBinaryPreviewState = (
  snapshot: SnapshotInfo,
  snapshotFile: SnapshotFileContent,
  currentBinary: BinaryReadResult | null
): PreviewState => {
  const snapshotDataUrl = snapshotFile.base64Content
    ? buildDataUrl(snapshotFile.mimeType, snapshotFile.base64Content)
    : undefined;
  const mediaKind = resolveMediaKind(snapshotFile.mimeType);

  if (snapshotDataUrl && mediaKind) {
    return {
      snapshotId: snapshot.id,
      snapshotMessage: snapshot.message,
      mimeType: snapshotFile.mimeType,
      byteSize: snapshotFile.byteSize,
      dataUrl: snapshotDataUrl,
      kind: mediaKind,
      currentDataUrl: currentBinary
        ? buildDataUrl(currentBinary.mimeType, currentBinary.base64Content)
        : null,
      currentByteSize: currentBinary?.byteSize ?? null,
      currentMimeType: currentBinary?.mimeType ?? null,
    };
  }

  return {
    snapshotId: snapshot.id,
    snapshotMessage: snapshot.message,
    mimeType: snapshotFile.mimeType,
    byteSize: snapshotFile.byteSize,
    kind: 'binary',
    currentByteSize: currentBinary?.byteSize ?? null,
    currentMimeType: currentBinary?.mimeType ?? null,
  };
};
