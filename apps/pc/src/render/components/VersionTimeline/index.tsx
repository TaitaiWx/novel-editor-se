/**
 * VersionTimeline — 版本历史模态框
 *
 * 从 StatusBar 触发，以模态弹窗展示当前文件的 SQLite 版本快照历史。
 * 点击某个版本可打开 DiffEditor 对比。
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { VscHistory, VscDiffAdded, VscClose, VscEdit, VscTrash } from 'react-icons/vsc';
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
  dataUrl: string;
  kind: 'image' | 'pdf';
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
}

const PdfPreviewContent: React.FC<PdfPreviewContentProps> = ({ dataUrl }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [mainPageDataUrl, setMainPageDataUrl] = useState<string | null>(null);
  const [thumbnailMap, setThumbnailMap] = useState<Record<number, string>>({});
  const pdfDocumentRef = useRef<PdfDocumentProxy | null>(null);

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
        setCurrentPage(1);

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
        const renderedPage = await renderPageToDataUrl(currentPage, 1.35);
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
  }, [currentPage, renderPageToDataUrl]);

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
              className={`${styles.pdfThumbButton} ${pageNumber === currentPage ? styles.pdfThumbButtonActive : ''}`}
              onClick={() => setCurrentPage(pageNumber)}
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
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
          >
            上一页
          </button>
          <span className={styles.pdfPageIndicator}>
            第 {currentPage} / {pageCount} 页
          </span>
          <button
            className={styles.pdfPageButton}
            disabled={currentPage >= pageCount}
            onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}
          >
            下一页
          </button>
        </div>
        <div className={styles.pdfCanvasStage}>
          {mainPageDataUrl ? (
            <img
              className={styles.pdfMainImage}
              src={mainPageDataUrl}
              alt={`PDF 第 ${currentPage} 页`}
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
  const modalRef = useRef<HTMLDivElement>(null);
  const pollTimerRef = useRef<number | null>(null);
  const toast = useToast();
  const dialog = useDialog();

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
      setSnapshotJob(null);
      if (pollTimerRef.current) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }
  }, [visible]);

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
        if (snapshotFile.isBinary || snapshotFile.content === null) {
          if (snapshotFile.base64Content && snapshotFile.mimeType.startsWith('image/')) {
            let currentBinary: BinaryReadResult | null = null;
            try {
              currentBinary = (await window.electron.ipcRenderer.invoke(
                'read-file-binary',
                filePath
              )) as BinaryReadResult;
            } catch {
              currentBinary = null;
            }

            setPreviewState({
              snapshotId: snapshot.id,
              snapshotMessage: snapshot.message,
              mimeType: snapshotFile.mimeType,
              byteSize: snapshotFile.byteSize,
              dataUrl: `data:${snapshotFile.mimeType};base64,${snapshotFile.base64Content}`,
              kind: 'image',
              currentDataUrl: currentBinary
                ? `data:${currentBinary.mimeType};base64,${currentBinary.base64Content}`
                : null,
              currentByteSize: currentBinary?.byteSize ?? null,
              currentMimeType: currentBinary?.mimeType ?? null,
            });
            return;
          }

          if (snapshotFile.base64Content && snapshotFile.mimeType === 'application/pdf') {
            setPreviewState({
              snapshotId: snapshot.id,
              snapshotMessage: snapshot.message,
              mimeType: snapshotFile.mimeType,
              byteSize: snapshotFile.byteSize,
              dataUrl: `data:${snapshotFile.mimeType};base64,${snapshotFile.base64Content}`,
              kind: 'pdf',
            });
            return;
          }

          toast.info(`当前文件是二进制资源（${snapshotFile.mimeType}），暂不支持该类型预览`);
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
    [folderPath, filePath, onDiffRequest, toast, onClose]
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
          {previewState && (
            <div className={styles.previewPanel}>
              <div className={styles.previewHeader}>
                <div>
                  <div className={styles.previewTitle}>版本预览</div>
                  <div className={styles.previewMeta}>
                    {previewState.snapshotMessage} · {previewState.mimeType} ·{' '}
                    {Math.round(previewState.byteSize / 1024)} KB
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
                        {previewState.mimeType} · {Math.round(previewState.byteSize / 1024)} KB
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
                            {Math.round((previewState.currentByteSize ?? 0) / 1024)} KB
                          </div>
                        </>
                      ) : (
                        <div className={styles.previewPlaceholder}>当前文件暂时无法读取</div>
                      )}
                    </div>
                  </div>
                ) : (
                  <PdfPreviewContent dataUrl={previewState.dataUrl} />
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
          ) : (
            <div className={styles.timeline}>
              {snapshots.map((snapshot, i) => (
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
                    <span className={styles.commitMessage}>{snapshot.message}</span>
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
