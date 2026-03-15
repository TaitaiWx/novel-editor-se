/**
 * VersionTimeline — 版本历史模态框
 *
 * 从 StatusBar 触发，以模态弹窗展示当前文件的 SQLite 版本快照历史。
 * 点击某个版本可打开 DiffEditor 对比。
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  VscHistory,
  VscDiffAdded,
  VscClose,
  VscEdit,
  VscTrash,
  VscFileMedia,
  VscFilePdf,
  VscMusic,
  VscCode,
  VscMarkdown,
  VscJson,
  VscFile,
  VscSearch,
  VscListFilter,
} from 'react-icons/vsc';
import { useToast } from '../Toast';
import { useDialog } from '../Dialog';
import styles from './styles.module.scss';

type PdfJsModule = typeof import('pdfjs-dist');
type PdfLoadingTask = ReturnType<PdfJsModule['getDocument']>;
type PdfDocumentProxy = Awaited<PdfLoadingTask['promise']>;

export interface SnapshotInfo {
  id: number;
  date: string;
  message: string;
  totalFiles: number;
  totalBytes: number;
}

interface SnapshotJobStatus {
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

interface PreviewState {
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

interface BinaryReadResult {
  base64Content: string;
  byteSize: number;
  mimeType: string;
}

interface PdfPreviewContentProps {
  dataUrl: string;
  currentPage: number;
  onPageChange: (page: number) => void;
}

type SnapshotTimeFilter = 'all' | 'today' | '7d' | '30d';

type FileTypeMeta = {
  kind: 'text' | 'image' | 'audio' | 'video' | 'pdf' | 'binary';
  label: string;
  icon: React.ReactNode;
};

const CLIENT_MIME_BY_EXT: Record<string, string> = {
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

const formatByteSize = (byteSize: number | null | undefined) => {
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

const formatDuration = (seconds: number | null) => {
  if (seconds === null || !Number.isFinite(seconds)) {
    return '时长读取中';
  }

  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

const buildDataUrl = (mimeType: string, base64Content: string) =>
  `data:${mimeType};base64,${base64Content}`;

const buildTextDataUrl = (mimeType: string, content: string) =>
  `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;

const guessMimeTypeByPath = (filePath: string | null) => {
  if (!filePath) {
    return 'application/octet-stream';
  }

  const normalizedPath = filePath.toLowerCase();
  const matchedEntry = Object.entries(CLIENT_MIME_BY_EXT).find(([ext]) =>
    normalizedPath.endsWith(ext)
  );
  return matchedEntry?.[1] ?? 'application/octet-stream';
};

const getFileTypeMeta = (mimeType: string): FileTypeMeta => {
  if (mimeType === 'application/pdf') {
    return { kind: 'pdf', label: 'PDF', icon: <VscFilePdf /> };
  }

  if (mimeType.startsWith('image/')) {
    return { kind: 'image', label: '图片', icon: <VscFileMedia /> };
  }

  if (mimeType.startsWith('audio/')) {
    return { kind: 'audio', label: '音频', icon: <VscMusic /> };
  }

  if (mimeType.startsWith('video/')) {
    return { kind: 'video', label: '视频', icon: <VscFileMedia /> };
  }

  if (mimeType === 'application/json') {
    return { kind: 'text', label: 'JSON', icon: <VscJson /> };
  }

  if (mimeType === 'text/markdown') {
    return { kind: 'text', label: 'Markdown', icon: <VscMarkdown /> };
  }

  if (mimeType.startsWith('text/')) {
    return { kind: 'text', label: '文本', icon: <VscCode /> };
  }

  return { kind: 'binary', label: '二进制', icon: <VscFile /> };
};

const drawWaveform = (canvas: HTMLCanvasElement, audioBuffer: AudioBuffer) => {
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }

  const width = canvas.width;
  const height = canvas.height;
  const channelData = audioBuffer.getChannelData(0);
  const step = Math.max(1, Math.floor(channelData.length / width));
  const centerY = height / 2;

  context.clearRect(0, 0, width, height);
  context.fillStyle = '#11161c';
  context.fillRect(0, 0, width, height);

  const gradient = context.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, '#569cd6');
  gradient.addColorStop(1, '#4ec9b0');

  context.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, centerY);
  context.lineTo(width, centerY);
  context.stroke();

  context.fillStyle = gradient;
  for (let x = 0; x < width; x += 1) {
    let min = 1;
    let max = -1;
    const start = x * step;
    const end = Math.min(start + step, channelData.length);
    for (let index = start; index < end; index += 1) {
      const sample = channelData[index];
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }

    const amplitude = Math.max(Math.abs(min), Math.abs(max));
    const barHeight = Math.max(2, amplitude * (height - 20));
    context.fillRect(x, centerY - barHeight / 2, 1, barHeight);
  }
};

interface AudioPreviewCardProps {
  title: string;
  dataUrl?: string | null;
  mimeType?: string | null;
  byteSize?: number | null;
  emptyText: string;
}

const AudioPreviewCard: React.FC<AudioPreviewCardProps> = ({
  title,
  dataUrl,
  mimeType,
  byteSize,
  emptyText,
}) => {
  const [duration, setDuration] = useState<number | null>(null);
  const [sampleRate, setSampleRate] = useState<number | null>(null);
  const [channels, setChannels] = useState<number | null>(null);
  const [bitrateKbps, setBitrateKbps] = useState<number | null>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let disposed = false;
    let audioContext: AudioContext | null = null;

    const analyzeAudio = async () => {
      if (!dataUrl) {
        setDuration(null);
        setSampleRate(null);
        setChannels(null);
        setBitrateKbps(null);
        return;
      }

      try {
        const response = await fetch(dataUrl);
        const arrayBuffer = await response.arrayBuffer();
        const AudioContextCtor = window.AudioContext;
        if (!AudioContextCtor) {
          return;
        }

        audioContext = new AudioContextCtor();
        const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));

        if (disposed) {
          return;
        }

        setDuration(decoded.duration);
        setSampleRate(decoded.sampleRate);
        setChannels(decoded.numberOfChannels);
        if (byteSize && decoded.duration > 0) {
          setBitrateKbps(Math.round((byteSize * 8) / decoded.duration / 1000));
        } else {
          setBitrateKbps(null);
        }

        if (waveformCanvasRef.current) {
          drawWaveform(waveformCanvasRef.current, decoded);
        }
      } catch {
        if (!disposed) {
          setSampleRate(null);
          setChannels(null);
          setBitrateKbps(null);
        }
      } finally {
        if (audioContext) {
          void audioContext.close();
        }
      }
    };

    void analyzeAudio();

    return () => {
      disposed = true;
      if (audioContext && audioContext.state !== 'closed') {
        void audioContext.close();
      }
    };
  }, [byteSize, dataUrl]);

  return (
    <div className={styles.audioComparePane}>
      <div className={styles.audioCompareLabel}>{title}</div>
      {dataUrl ? (
        <>
          <canvas
            ref={waveformCanvasRef}
            className={styles.waveformCanvas}
            width={560}
            height={144}
          />
          <audio
            className={styles.audioPlayer}
            controls
            preload="metadata"
            onLoadedMetadata={(event) => {
              setDuration(
                Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : null
              );
            }}
          >
            <source src={dataUrl} type={mimeType ?? undefined} />
          </audio>
          <div className={styles.audioMetaGrid}>
            <div className={styles.audioMetaItem}>
              <span className={styles.audioMetaLabel}>格式</span>
              <span className={styles.audioMetaValue}>{mimeType ?? '未知'}</span>
            </div>
            <div className={styles.audioMetaItem}>
              <span className={styles.audioMetaLabel}>大小</span>
              <span className={styles.audioMetaValue}>{formatByteSize(byteSize)}</span>
            </div>
            <div className={styles.audioMetaItem}>
              <span className={styles.audioMetaLabel}>时长</span>
              <span className={styles.audioMetaValue}>{formatDuration(duration)}</span>
            </div>
            <div className={styles.audioMetaItem}>
              <span className={styles.audioMetaLabel}>采样率</span>
              <span className={styles.audioMetaValue}>
                {sampleRate ? `${Math.round(sampleRate)} Hz` : '读取中'}
              </span>
            </div>
            <div className={styles.audioMetaItem}>
              <span className={styles.audioMetaLabel}>声道</span>
              <span className={styles.audioMetaValue}>
                {channels ? `${channels} 声道` : '读取中'}
              </span>
            </div>
            <div className={styles.audioMetaItem}>
              <span className={styles.audioMetaLabel}>估算码率</span>
              <span className={styles.audioMetaValue}>
                {bitrateKbps ? `${bitrateKbps} kbps` : '读取中'}
              </span>
            </div>
          </div>
        </>
      ) : (
        <div className={styles.previewPlaceholder}>{emptyText}</div>
      )}
    </div>
  );
};

interface VideoPreviewCardProps {
  title: string;
  dataUrl?: string | null;
  mimeType?: string | null;
  byteSize?: number | null;
  emptyText: string;
}

const VideoPreviewCard: React.FC<VideoPreviewCardProps> = ({
  title,
  dataUrl,
  mimeType,
  byteSize,
  emptyText,
}) => {
  return (
    <div className={styles.audioComparePane}>
      <div className={styles.audioCompareLabel}>{title}</div>
      {dataUrl ? (
        <>
          <video className={styles.videoPlayer} src={dataUrl} controls preload="metadata" />
          <div className={styles.videoMetaGrid}>
            <div className={styles.videoMetaItem}>
              <span className={styles.videoMetaLabel}>MIME</span>
              <span className={styles.videoMetaValue}>{mimeType ?? '未知'}</span>
            </div>
            <div className={styles.videoMetaItem}>
              <span className={styles.videoMetaLabel}>大小</span>
              <span className={styles.videoMetaValue}>{formatByteSize(byteSize)}</span>
            </div>
          </div>
        </>
      ) : (
        <div className={styles.previewPlaceholder}>{emptyText}</div>
      )}
    </div>
  );
};

const PdfPreviewContent: React.FC<PdfPreviewContentProps> = ({
  dataUrl,
  currentPage,
  onPageChange,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [mainPageDataUrl, setMainPageDataUrl] = useState<string | null>(null);
  const [thumbnailMap, setThumbnailMap] = useState<Record<number, string>>({});
  const pdfDocumentRef = useRef<PdfDocumentProxy | null>(null);
  const safeCurrentPage = pageCount > 0 ? Math.min(Math.max(currentPage, 1), pageCount) : 1;

  const renderPageToDataUrl = useCallback(async (pageNumber: number, scale: number) => {
    const pdfDocument = pdfDocumentRef.current;
    if (!pdfDocument) {
      throw new Error('PDF 文档尚未加载');
    }

    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('无法创建 PDF 预览画布');
    }

    await page.render({ canvasContext: context, viewport, canvas }).promise;
    return canvas.toDataURL('image/png');
  }, []);

  useEffect(() => {
    let disposed = false;
    let loadingTask: PdfLoadingTask | null = null;

    const loadPdf = async () => {
      try {
        setLoading(true);
        setError(null);
        setThumbnailMap({});
        setMainPageDataUrl(null);

        const pdfjs = (await import('pdfjs-dist')) as PdfJsModule;
        const workerModule = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;

        const response = await fetch(dataUrl);
        const buffer = await response.arrayBuffer();
        loadingTask = pdfjs.getDocument({ data: buffer });
        const pdfDocument = await loadingTask.promise;

        if (disposed) {
          await loadingTask.destroy();
          return;
        }

        pdfDocumentRef.current = pdfDocument;
        setPageCount(pdfDocument.numPages);

        const firstPage = await renderPageToDataUrl(1, 1.35);
        if (!disposed) {
          setMainPageDataUrl(firstPage);
        }

        for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
          const thumbnail = await renderPageToDataUrl(pageNumber, 0.24);
          if (disposed) {
            break;
          }

          setThumbnailMap((prev) => ({
            ...prev,
            [pageNumber]: thumbnail,
          }));
        }
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : 'PDF 预览加载失败');
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    void loadPdf();

    return () => {
      disposed = true;
      pdfDocumentRef.current = null;
      if (loadingTask) {
        void loadingTask.destroy();
      }
    };
  }, [dataUrl, renderPageToDataUrl]);

  useEffect(() => {
    let disposed = false;
    if (!pdfDocumentRef.current) return;

    const updateMainPage = async () => {
      try {
        const renderedPage = await renderPageToDataUrl(safeCurrentPage, 1.35);
        if (!disposed) {
          setMainPageDataUrl(renderedPage);
        }
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : 'PDF 页面渲染失败');
        }
      }
    };

    void updateMainPage();
    return () => {
      disposed = true;
    };
  }, [renderPageToDataUrl, safeCurrentPage]);

  if (loading) {
    return <div className={styles.previewPlaceholder}>正在渲染 PDF 页面...</div>;
  }

  if (error) {
    return <div className={styles.previewPlaceholder}>PDF 预览失败: {error}</div>;
  }

  return (
    <div className={styles.pdfPreviewLayout}>
      <div className={styles.pdfSidebar}>
        {Array.from({ length: pageCount }, (_, index) => {
          const pageNumber = index + 1;
          const thumbnail = thumbnailMap[pageNumber];
          return (
            <button
              key={pageNumber}
              className={`${styles.pdfThumbButton} ${pageNumber === safeCurrentPage ? styles.pdfThumbButtonActive : ''}`}
              onClick={() => onPageChange(pageNumber)}
            >
              <span className={styles.pdfThumbNumber}>第 {pageNumber} 页</span>
              {thumbnail ? (
                <img className={styles.pdfThumbImage} src={thumbnail} alt={`第 ${pageNumber} 页`} />
              ) : (
                <span className={styles.pdfThumbPlaceholder}>渲染中...</span>
              )}
            </button>
          );
        })}
      </div>
      <div className={styles.pdfMainStage}>
        <div className={styles.pdfToolbar}>
          <button
            className={styles.pdfPageButton}
            disabled={safeCurrentPage <= 1}
            onClick={() => onPageChange(Math.max(1, safeCurrentPage - 1))}
          >
            上一页
          </button>
          <span className={styles.pdfPageIndicator}>
            第 {safeCurrentPage} / {pageCount} 页
          </span>
          <button
            className={styles.pdfPageButton}
            disabled={safeCurrentPage >= pageCount}
            onClick={() => onPageChange(Math.min(pageCount, safeCurrentPage + 1))}
          >
            下一页
          </button>
        </div>
        <div className={styles.pdfCanvasStage}>
          {mainPageDataUrl ? (
            <img
              className={styles.pdfMainImage}
              src={mainPageDataUrl}
              alt={`PDF 第 ${safeCurrentPage} 页`}
            />
          ) : (
            <div className={styles.previewPlaceholder}>正在渲染当前页...</div>
          )}
        </div>
      </div>
    </div>
  );
};

interface VersionTimelineProps {
  /** 是否显示模态框 */
  visible: boolean;
  /** 关闭模态框 */
  onClose: () => void;
  /** 当前工作区目录 */
  folderPath: string | null;
  /** 当前激活的文件路径 */
  filePath: string | null;
  /** 点击版本时回调，传入旧版本内容和当前内容用于 Diff */
  onDiffRequest?: (
    original: string,
    modified: string,
    originalLabel: string,
    modifiedLabel: string
  ) => void;
  onRestoreFile?: (filePath: string) => void | Promise<void>;
}

const VersionTimeline: React.FC<VersionTimelineProps> = ({
  visible,
  onClose,
  folderPath,
  filePath,
  onDiffRequest,
  onRestoreFile,
}) => {
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [snapshotJob, setSnapshotJob] = useState<SnapshotJobStatus | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [timeFilter, setTimeFilter] = useState<SnapshotTimeFilter>('all');
  const [pdfComparePage, setPdfComparePage] = useState(1);
  const modalRef = useRef<HTMLDivElement>(null);
  const pollTimerRef = useRef<number | null>(null);
  const toast = useToast();
  const dialog = useDialog();

  const loadCurrentBinaryFile = useCallback(async () => {
    if (!filePath) {
      return null;
    }

    try {
      return (await window.electron.ipcRenderer.invoke(
        'read-file-binary',
        filePath
      )) as BinaryReadResult;
    } catch {
      return null;
    }
  }, [filePath]);

  // 加载当前文件的版本历史
  const loadHistory = useCallback(async () => {
    if (!folderPath || !visible) return;
    setLoading(true);
    try {
      const snapshotsResult = await window.electron.ipcRenderer.invoke(
        'db-version-list',
        folderPath,
        filePath,
        50
      );
      setSnapshots((snapshotsResult as SnapshotInfo[]) || []);
    } catch {
      setSnapshots([]);
    } finally {
      setLoading(false);
    }
  }, [folderPath, filePath, visible]);

  // 打开时自动加载
  useEffect(() => {
    if (visible && folderPath) {
      loadHistory();
    }
  }, [visible, folderPath, loadHistory]);

  useEffect(() => {
    if (!visible) {
      setPreviewState(null);
      setPdfComparePage(1);
      setSnapshotJob(null);
      if (pollTimerRef.current) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }
  }, [visible]);

  useEffect(() => {
    setPdfComparePage(1);
  }, [previewState?.snapshotId, previewState?.kind]);

  // 关闭事件：ESC 键 / 点击遮罩
  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, onClose]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  const pollSnapshotJob = useCallback(
    async (jobId: string) => {
      try {
        const status = (await window.electron.ipcRenderer.invoke(
          'db-version-job-status',
          jobId
        )) as SnapshotJobStatus | null;
        if (!status) {
          setSnapshotJob(null);
          return;
        }

        setSnapshotJob(status);

        if (status.status === 'running') {
          pollTimerRef.current = window.setTimeout(() => {
            void pollSnapshotJob(jobId);
          }, 250);
          return;
        }

        pollTimerRef.current = null;
        if (status.status === 'completed') {
          if (status.snapshotId) {
            toast.success('版本保存成功');
            await loadHistory();
          } else {
            toast.info('当前没有新的更改需要保存');
          }
        } else if (status.error) {
          toast.error(`保存版本失败: ${status.error}`);
        }
      } catch (err) {
        pollTimerRef.current = null;
        setSnapshotJob(null);
        toast.error(`保存版本失败: ${err instanceof Error ? err.message : '未知错误'}`);
      }
    },
    [loadHistory, toast]
  );

  const handleCreateSnapshot = useCallback(async () => {
    if (!folderPath) return;
    try {
      const jobId = (await window.electron.ipcRenderer.invoke(
        'db-version-start-create',
        folderPath
      )) as string;
      setSnapshotJob({
        id: jobId,
        status: 'running',
        stage: 'scanning',
        discoveredFiles: 0,
        processedFiles: 0,
        totalFiles: 0,
        processedBytes: 0,
        totalBytes: 0,
        snapshotId: null,
        error: null,
      });
      void pollSnapshotJob(jobId);
    } catch (err) {
      toast.error(`保存版本失败: ${err instanceof Error ? err.message : '未知错误'}`);
    }
  }, [folderPath, pollSnapshotJob, toast]);

  const handleDeleteCommit = useCallback(
    async (snapshot: SnapshotInfo, e: React.MouseEvent) => {
      e.stopPropagation();
      const confirmed = await dialog.confirm(
        '删除版本',
        `确定要删除版本 "${snapshot.message}" 吗？此操作不可撤销。`
      );
      if (!confirmed) return;
      try {
        await window.electron.ipcRenderer.invoke('db-version-delete', snapshot.id);
        toast.success('版本已删除');
        loadHistory();
      } catch (err) {
        toast.error(`删除版本失败: ${err instanceof Error ? err.message : '未知错误'}`);
      }
    },
    [dialog, toast, loadHistory]
  );

  const handleRenameCommit = useCallback(
    async (snapshot: SnapshotInfo, e: React.MouseEvent) => {
      e.stopPropagation();
      const newMessage = await dialog.prompt('重命名版本', '请输入新的版本名称', snapshot.message);
      if (!newMessage || newMessage === snapshot.message) return;
      try {
        await window.electron.ipcRenderer.invoke('db-version-rename', snapshot.id, newMessage);
        toast.success('版本已重命名');
        loadHistory();
      } catch (err) {
        toast.error(`重命名失败: ${err instanceof Error ? err.message : '未知错误'}`);
      }
    },
    [dialog, toast, loadHistory]
  );

  const handleViewDiff = useCallback(
    async (snapshot: SnapshotInfo) => {
      if (!folderPath || !filePath) return;
      try {
        const snapshotFile = (await window.electron.ipcRenderer.invoke(
          'db-version-get-file-content',
          folderPath,
          snapshot.id,
          filePath
        )) as {
          content: string | null;
          base64Content: string | null;
          isBinary: boolean;
          mimeType: string;
          byteSize: number;
        };

        if (snapshotFile.mimeType === 'image/svg+xml' && snapshotFile.content !== null) {
          let currentSvgContent: string | null = null;
          try {
            currentSvgContent = (await window.electron.ipcRenderer.invoke(
              'read-file',
              filePath
            )) as string;
          } catch {
            currentSvgContent = null;
          }

          setPreviewState({
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
          return;
        }

        if (snapshotFile.isBinary || snapshotFile.content === null) {
          const currentBinary = await loadCurrentBinaryFile();
          const snapshotDataUrl = snapshotFile.base64Content
            ? buildDataUrl(snapshotFile.mimeType, snapshotFile.base64Content)
            : undefined;

          if (snapshotDataUrl && snapshotFile.mimeType.startsWith('image/')) {
            setPreviewState({
              snapshotId: snapshot.id,
              snapshotMessage: snapshot.message,
              mimeType: snapshotFile.mimeType,
              byteSize: snapshotFile.byteSize,
              dataUrl: snapshotDataUrl,
              kind: 'image',
              currentDataUrl: currentBinary
                ? buildDataUrl(currentBinary.mimeType, currentBinary.base64Content)
                : null,
              currentByteSize: currentBinary?.byteSize ?? null,
              currentMimeType: currentBinary?.mimeType ?? null,
            });
            return;
          }

          if (snapshotDataUrl && snapshotFile.mimeType === 'application/pdf') {
            setPreviewState({
              snapshotId: snapshot.id,
              snapshotMessage: snapshot.message,
              mimeType: snapshotFile.mimeType,
              byteSize: snapshotFile.byteSize,
              dataUrl: snapshotDataUrl,
              kind: 'pdf',
              currentDataUrl: currentBinary
                ? buildDataUrl(currentBinary.mimeType, currentBinary.base64Content)
                : null,
              currentByteSize: currentBinary?.byteSize ?? null,
              currentMimeType: currentBinary?.mimeType ?? null,
            });
            return;
          }

          if (snapshotDataUrl && snapshotFile.mimeType.startsWith('audio/')) {
            setPreviewState({
              snapshotId: snapshot.id,
              snapshotMessage: snapshot.message,
              mimeType: snapshotFile.mimeType,
              byteSize: snapshotFile.byteSize,
              dataUrl: snapshotDataUrl,
              kind: 'audio',
              currentDataUrl: currentBinary
                ? buildDataUrl(currentBinary.mimeType, currentBinary.base64Content)
                : null,
              currentByteSize: currentBinary?.byteSize ?? null,
              currentMimeType: currentBinary?.mimeType ?? null,
            });
            return;
          }

          if (snapshotDataUrl && snapshotFile.mimeType.startsWith('video/')) {
            setPreviewState({
              snapshotId: snapshot.id,
              snapshotMessage: snapshot.message,
              mimeType: snapshotFile.mimeType,
              byteSize: snapshotFile.byteSize,
              dataUrl: snapshotDataUrl,
              kind: 'video',
              currentDataUrl: currentBinary
                ? buildDataUrl(currentBinary.mimeType, currentBinary.base64Content)
                : null,
              currentByteSize: currentBinary?.byteSize ?? null,
              currentMimeType: currentBinary?.mimeType ?? null,
            });
            return;
          }

          setPreviewState({
            snapshotId: snapshot.id,
            snapshotMessage: snapshot.message,
            mimeType: snapshotFile.mimeType,
            byteSize: snapshotFile.byteSize,
            kind: 'binary',
            currentByteSize: currentBinary?.byteSize ?? null,
            currentMimeType: currentBinary?.mimeType ?? null,
          });
          return;
        }
        if (!onDiffRequest) return;
        const currentContent = await window.electron.ipcRenderer.invoke('read-file', filePath);
        onDiffRequest(snapshotFile.content, currentContent, snapshot.message, '当前版本');
        toast.success('版本对比已加载');
        onClose();
      } catch (err) {
        toast.error(`加载版本失败: ${err instanceof Error ? err.message : '未知错误'}`);
      }
    },
    [folderPath, loadCurrentBinaryFile, onDiffRequest, toast, onClose]
  );

  const handleRestoreSnapshot = useCallback(
    async (snapshot: SnapshotInfo, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!folderPath || !filePath) return;
      const confirmed = await dialog.confirm(
        '恢复当前文件',
        `确定要将当前文件恢复到版本「${snapshot.message}」吗？当前未提交更改会被覆盖。`
      );
      if (!confirmed) return;

      try {
        await window.electron.ipcRenderer.invoke(
          'db-version-restore-file',
          folderPath,
          snapshot.id,
          filePath
        );
        await onRestoreFile?.(filePath);
        setPreviewState(null);
        toast.success('已恢复到所选版本');
      } catch (err) {
        toast.error(`恢复版本失败: ${err instanceof Error ? err.message : '未知错误'}`);
      }
    },
    [dialog, filePath, folderPath, onRestoreFile, toast]
  );

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
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

  const activeMimeType = previewState?.mimeType ?? guessMimeTypeByPath(filePath);
  const fileTypeMeta = useMemo(() => getFileTypeMeta(activeMimeType), [activeMimeType]);

  const filteredSnapshots = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const now = Date.now();

    return snapshots.filter((snapshot) => {
      const snapshotTime = new Date(snapshot.date).getTime();
      const queryMatched =
        normalizedQuery.length === 0 || snapshot.message.toLowerCase().includes(normalizedQuery);

      let timeMatched = true;
      if (timeFilter === 'today') {
        const today = new Date();
        const snapshotDate = new Date(snapshot.date);
        timeMatched = snapshotDate.toDateString() === today.toDateString();
      } else if (timeFilter === '7d') {
        timeMatched = now - snapshotTime <= 7 * 24 * 60 * 60 * 1000;
      } else if (timeFilter === '30d') {
        timeMatched = now - snapshotTime <= 30 * 24 * 60 * 60 * 1000;
      }

      return queryMatched && timeMatched;
    });
  }, [searchQuery, snapshots, timeFilter]);

  if (!visible) return null;

  const fileName = filePath
    ? filePath.split('/').pop() || filePath.split('\\').pop() || filePath
    : null;
  const progressRatio =
    snapshotJob && snapshotJob.totalFiles > 0
      ? Math.min(snapshotJob.processedFiles / snapshotJob.totalFiles, 1)
      : 0;

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={`${styles.modal} ${previewState ? styles.previewModal : ''}`} ref={modalRef}>
        {/* 模态框顶部 */}
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>
            <span>版本历史</span>
            {fileName && <span className={styles.fileName}>{fileName}</span>}
            <span className={`${styles.fileTypeBadge} ${styles[`fileType${fileTypeMeta.kind}`]}`}>
              {fileTypeMeta.icon}
              <span>{fileTypeMeta.label}</span>
            </span>
          </div>
          <div className={styles.modalActions}>
            {folderPath && (
              <button
                className={styles.actionButton}
                onClick={handleCreateSnapshot}
                title="保存版本"
                disabled={snapshotJob?.status === 'running'}
              >
                <VscDiffAdded />
                <span>{snapshotJob?.status === 'running' ? '保存中...' : '保存版本'}</span>
              </button>
            )}
            <button className={styles.closeButton} onClick={onClose} title="关闭">
              <VscClose />
            </button>
          </div>
        </div>

        {snapshotJob?.status === 'running' && (
          <div className={styles.progressPanel}>
            <div className={styles.progressHeader}>
              <span>
                {snapshotJob.stage === 'scanning' ? '正在扫描项目文件...' : '正在写入版本快照...'}
              </span>
              <span>
                {snapshotJob.processedFiles}/
                {Math.max(snapshotJob.totalFiles, snapshotJob.discoveredFiles || 0)}
              </span>
            </div>
            <div className={styles.progressBarTrack}>
              <div
                className={`${styles.progressBarFill} ${snapshotJob.totalFiles === 0 ? styles.progressBarIndeterminate : ''}`}
                style={
                  snapshotJob.totalFiles > 0 ? { width: `${progressRatio * 100}%` } : undefined
                }
              />
            </div>
            <div className={styles.progressMeta}>
              已处理 {Math.round(snapshotJob.processedBytes / 1024)} KB /{' '}
              {Math.round(snapshotJob.totalBytes / 1024)} KB
            </div>
          </div>
        )}

        {/* 模态框内容 */}
        <div className={styles.modalContent}>
          <div className={styles.filterBar}>
            <div className={styles.filterSearchWrap}>
              <VscSearch className={styles.filterIcon} />
              <input
                className={styles.filterSearchInput}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="按版本说明筛选"
              />
            </div>
            <div className={styles.filterActions}>
              <span className={styles.filterLabel}>
                <VscListFilter />
                <span>时间范围</span>
              </span>
              {[
                ['all', '全部'],
                ['today', '今天'],
                ['7d', '7 天'],
                ['30d', '30 天'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={`${styles.filterChip} ${timeFilter === value ? styles.filterChipActive : ''}`}
                  onClick={() => setTimeFilter(value as SnapshotTimeFilter)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className={styles.filterSummary}>
              {filteredSnapshots.length} / {snapshots.length}
            </div>
          </div>
          {previewState && (
            <div className={styles.previewPanel}>
              <div className={styles.previewHeader}>
                <div>
                  <div className={styles.previewTitle}>版本预览</div>
                  <div className={styles.previewMeta}>
                    {previewState.snapshotMessage} · {previewState.mimeType} ·{' '}
                    {formatByteSize(previewState.byteSize)}
                  </div>
                </div>
                <div className={styles.previewActions}>
                  {filePath && (
                    <button
                      className={styles.previewActionButton}
                      onClick={(e) => {
                        const snapshot = snapshots.find(
                          (item) => item.id === previewState.snapshotId
                        );
                        if (snapshot) {
                          void handleRestoreSnapshot(snapshot, e as unknown as React.MouseEvent);
                        }
                      }}
                    >
                      恢复当前文件
                    </button>
                  )}
                  <button
                    className={styles.previewCloseButton}
                    onClick={() => setPreviewState(null)}
                  >
                    关闭预览
                  </button>
                </div>
              </div>
              <div className={styles.previewBody}>
                {previewState.kind === 'image' ? (
                  <div className={styles.imageCompareLayout}>
                    <div className={styles.imageComparePane}>
                      <div className={styles.imageCompareLabel}>版本快照</div>
                      <img
                        className={styles.previewImage}
                        src={previewState.dataUrl}
                        alt={previewState.snapshotMessage}
                      />
                      <div className={styles.imageCompareMeta}>
                        {previewState.mimeType} · {formatByteSize(previewState.byteSize)}
                      </div>
                    </div>
                    <div className={styles.imageComparePane}>
                      <div className={styles.imageCompareLabel}>当前文件</div>
                      {previewState.currentDataUrl ? (
                        <>
                          <img
                            className={styles.previewImage}
                            src={previewState.currentDataUrl}
                            alt="当前文件"
                          />
                          <div className={styles.imageCompareMeta}>
                            {previewState.currentMimeType} ·{' '}
                            {formatByteSize(previewState.currentByteSize)}
                          </div>
                        </>
                      ) : (
                        <div className={styles.previewPlaceholder}>当前文件暂时无法读取</div>
                      )}
                    </div>
                  </div>
                ) : previewState.kind === 'pdf' ? (
                  <div className={styles.pdfCompareLayout}>
                    <div className={styles.pdfComparePane}>
                      <div className={styles.imageCompareLabel}>版本快照</div>
                      <div className={styles.imageCompareMeta}>
                        {previewState.mimeType} · {formatByteSize(previewState.byteSize)}
                      </div>
                      <PdfPreviewContent
                        dataUrl={previewState.dataUrl ?? ''}
                        currentPage={pdfComparePage}
                        onPageChange={setPdfComparePage}
                      />
                    </div>
                    <div className={styles.pdfComparePane}>
                      <div className={styles.imageCompareLabel}>当前文件</div>
                      {previewState.currentDataUrl ? (
                        <>
                          <div className={styles.imageCompareMeta}>
                            {previewState.currentMimeType} ·{' '}
                            {formatByteSize(previewState.currentByteSize)}
                          </div>
                          <PdfPreviewContent
                            dataUrl={previewState.currentDataUrl}
                            currentPage={pdfComparePage}
                            onPageChange={setPdfComparePage}
                          />
                        </>
                      ) : (
                        <div className={styles.previewPlaceholder}>当前文件暂时无法读取</div>
                      )}
                    </div>
                  </div>
                ) : previewState.kind === 'audio' ? (
                  <div className={styles.audioCompareLayout}>
                    <AudioPreviewCard
                      title="版本快照"
                      dataUrl={previewState.dataUrl}
                      mimeType={previewState.mimeType}
                      byteSize={previewState.byteSize}
                      emptyText="当前快照音频无法加载"
                    />
                    <AudioPreviewCard
                      title="当前文件"
                      dataUrl={previewState.currentDataUrl}
                      mimeType={previewState.currentMimeType}
                      byteSize={previewState.currentByteSize}
                      emptyText="当前文件暂时无法读取"
                    />
                  </div>
                ) : previewState.kind === 'video' ? (
                  <div className={styles.videoCompareLayout}>
                    <VideoPreviewCard
                      title="版本快照"
                      dataUrl={previewState.dataUrl}
                      mimeType={previewState.mimeType}
                      byteSize={previewState.byteSize}
                      emptyText="当前快照视频无法加载"
                    />
                    <VideoPreviewCard
                      title="当前文件"
                      dataUrl={previewState.currentDataUrl}
                      mimeType={previewState.currentMimeType}
                      byteSize={previewState.currentByteSize}
                      emptyText="当前文件暂时无法读取"
                    />
                  </div>
                ) : (
                  <div className={styles.binaryInfoLayout}>
                    <div className={styles.binaryInfoCard}>
                      <div className={styles.binaryInfoTitle}>版本快照</div>
                      <div className={styles.binaryInfoRow}>
                        <span className={styles.binaryInfoLabel}>MIME</span>
                        <span className={styles.binaryInfoValue}>{previewState.mimeType}</span>
                      </div>
                      <div className={styles.binaryInfoRow}>
                        <span className={styles.binaryInfoLabel}>大小</span>
                        <span className={styles.binaryInfoValue}>
                          {formatByteSize(previewState.byteSize)}
                        </span>
                      </div>
                      <div className={styles.binaryInfoHint}>
                        当前类型暂不适合做结构化内容预览，但已经保留了专用元信息对比。
                      </div>
                    </div>
                    <div className={styles.binaryInfoCard}>
                      <div className={styles.binaryInfoTitle}>当前文件</div>
                      <div className={styles.binaryInfoRow}>
                        <span className={styles.binaryInfoLabel}>MIME</span>
                        <span className={styles.binaryInfoValue}>
                          {previewState.currentMimeType ?? '无法读取'}
                        </span>
                      </div>
                      <div className={styles.binaryInfoRow}>
                        <span className={styles.binaryInfoLabel}>大小</span>
                        <span className={styles.binaryInfoValue}>
                          {formatByteSize(previewState.currentByteSize)}
                        </span>
                      </div>
                      <div className={styles.binaryInfoHint}>
                        可先恢复到目标版本，或使用系统关联应用进一步检查差异。
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          {!folderPath ? (
            <div className={styles.emptyState}>
              <span>请先打开一个项目文件夹</span>
            </div>
          ) : loading ? (
            <div className={styles.loadingState}>加载中...</div>
          ) : snapshots.length === 0 ? (
            <div className={styles.emptyState}>
              <span>暂无版本记录</span>
              <span className={styles.emptyHint}>点击右上角「保存版本」来创建第一个版本快照</span>
            </div>
          ) : filteredSnapshots.length === 0 ? (
            <div className={styles.emptyState}>
              <span>没有符合筛选条件的版本</span>
              <span className={styles.emptyHint}>可以清空关键词或调整时间范围</span>
            </div>
          ) : (
            <div className={styles.timeline}>
              {filteredSnapshots.map((snapshot, i) => (
                <div
                  key={snapshot.id}
                  className={styles.commitItem}
                  onClick={() => handleViewDiff(snapshot)}
                  title={`${snapshot.message}\n${snapshot.date}`}
                >
                  <div className={styles.timelineDot}>
                    <VscHistory />
                    {i < snapshots.length - 1 && <div className={styles.timelineLine} />}
                  </div>
                  <div className={styles.commitInfo}>
                    <span className={styles.commitMessageRow}>
                      <span
                        className={`${styles.commitTypeBadge} ${styles[`fileType${fileTypeMeta.kind}`]}`}
                      >
                        {fileTypeMeta.icon}
                      </span>
                      <span className={styles.commitMessage}>{snapshot.message}</span>
                    </span>
                    <span className={styles.commitMeta}>
                      <span className={styles.commitAuthor}>{snapshot.totalFiles} 个文件</span>
                      <span className={styles.commitDate}>{formatDate(snapshot.date)}</span>
                    </span>
                  </div>
                  <div className={styles.commitActions}>
                    <button
                      className={styles.commitActionBtn}
                      onClick={(e) => handleRenameCommit(snapshot, e)}
                      title="重命名版本"
                    >
                      <VscEdit />
                    </button>
                    <button
                      className={styles.commitActionBtn}
                      onClick={(e) => handleRestoreSnapshot(snapshot, e)}
                      title="恢复当前文件到此版本"
                    >
                      ↺
                    </button>
                    <button
                      className={`${styles.commitActionBtn} ${styles.dangerBtn}`}
                      onClick={(e) => handleDeleteCommit(snapshot, e)}
                      title="删除版本"
                    >
                      <VscTrash />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VersionTimeline;
