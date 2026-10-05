/**
 * VersionTimeline 相关类型定义
 */
import type React from 'react';

export type PdfJsModule = typeof import('pdfjs-dist');
export type PdfLoadingTask = ReturnType<PdfJsModule['getDocument']>;
export type PdfDocumentProxy = Awaited<PdfLoadingTask['promise']>;

export interface SnapshotInfo {
  id: number;
  date: string;
  message: string;
  totalFiles: number;
  totalBytes: number;
}

export interface SnapshotJobStatus {
  id: string;
  status: 'running' | 'completed' | 'failed';
  stage: 'scanning' | 'persisting' | 'completed' | 'failed';
  discoveredFiles: number;
  processedFiles: number;
  totalFiles: number;
  processedBytes: number;
  totalBytes: number;
  snapshotId: number | null;
  error: string | null;
}

export interface PreviewState {
  snapshotId: number;
  snapshotMessage: string;
  mimeType: string;
  byteSize: number;
  dataUrl?: string;
  kind: 'image' | 'pdf' | 'audio' | 'video' | 'binary';
  currentDataUrl?: string | null;
  currentByteSize?: number | null;
  currentMimeType?: string | null;
}

export interface BinaryReadResult {
  base64Content: string;
  byteSize: number;
  mimeType: string;
}

/** db-version-get-file-content 返回的快照文件内容 */
export interface SnapshotFileContent {
  content: string | null;
  base64Content: string | null;
  isBinary: boolean;
  mimeType: string;
  byteSize: number;
}

export type SnapshotTimeFilter = 'all' | 'today' | '7d' | '30d';

export type FileTypeKind = 'text' | 'image' | 'audio' | 'video' | 'pdf' | 'binary';

export type FileTypeMeta = {
  kind: FileTypeKind;
  label: string;
  icon: React.ReactNode;
};

export type DiffRequestHandler = (
  original: string,
  modified: string,
  originalLabel: string,
  modifiedLabel: string
) => void;

export type RestoreFileHandler = (filePath: string) => void | Promise<void>;

export interface VersionTimelineProps {
  /** 是否显示模态框 */
  visible: boolean;
  /** 关闭模态框 */
  onClose: () => void;
  /** 当前工作区目录 */
  folderPath: string | null;
  /** 当前激活的文件路径 */
  filePath: string | null;
  /** 点击版本时回调，传入旧版本内容和当前内容用于 Diff */
  onDiffRequest?: DiffRequestHandler;
  onRestoreFile?: RestoreFileHandler;
}
