/**
 * VersionTimeline — 版本历史模态框
 *
 * 从 StatusBar 触发，以模态弹窗展示当前文件的 SQLite 版本快照历史。
 * 点击某个版本可打开 DiffEditor 对比。
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { VscDiffAdded, VscClose } from 'react-icons/vsc';
import { isImeComposing } from '../../utils/ime';
import PreviewPanel from './PreviewPanel';
import SnapshotProgress from './SnapshotProgress';
import SnapshotFilterBar from './SnapshotFilterBar';
import SnapshotList from './SnapshotList';
import { getFileTypeMeta } from './fileTypeMeta';
import { useSnapshotHistory } from './useSnapshotHistory';
import { useSnapshotJob } from './useSnapshotJob';
import { useSnapshotActions } from './useSnapshotActions';
import { filterSnapshots, getFileName, guessMimeTypeByPath } from './utils';
import type { PreviewState, SnapshotTimeFilter, VersionTimelineProps } from './types';
import styles from './styles.module.scss';

export type { SnapshotInfo } from './types';

const VersionTimeline: React.FC<VersionTimelineProps> = ({
  visible,
  onClose,
  folderPath,
  filePath,
  onDiffRequest,
  onRestoreFile,
}) => {
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [timeFilter, setTimeFilter] = useState<SnapshotTimeFilter>('all');
  const [pdfComparePage, setPdfComparePage] = useState(1);
  const modalRef = useRef<HTMLDivElement>(null);

  // 版本列表（含打开时自动加载 effect）
  const { snapshots, loading, loadHistory } = useSnapshotHistory({
    visible,
    folderPath,
    filePath,
  });
  const { snapshotJob, setSnapshotJob, pollTimerRef, handleCreateSnapshot } = useSnapshotJob({
    folderPath,
    loadHistory,
  });
  const { handleDeleteCommit, handleRenameCommit, handleViewDiff, handleRestoreSnapshot } =
    useSnapshotActions({
      folderPath,
      filePath,
      onClose,
      onDiffRequest,
      onRestoreFile,
      loadHistory,
      setPreviewState,
    });

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
    // setSnapshotJob / pollTimerRef 均为稳定引用，实际只随 visible 变化重新执行
  }, [pollTimerRef, setSnapshotJob, visible]);

  useEffect(() => {
    setPdfComparePage(1);
  }, [previewState?.snapshotId, previewState?.kind]);

  // 关闭事件：ESC 键 / 点击遮罩
  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return;
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

  const activeMimeType = previewState?.mimeType ?? guessMimeTypeByPath(filePath);
  const fileTypeMeta = useMemo(() => getFileTypeMeta(activeMimeType), [activeMimeType]);

  const filteredSnapshots = useMemo(
    () => filterSnapshots(snapshots, searchQuery, timeFilter),
    [searchQuery, snapshots, timeFilter]
  );

  if (!visible) return null;

  const fileName = getFileName(filePath);

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

        {snapshotJob?.status === 'running' && <SnapshotProgress job={snapshotJob} />}

        {/* 模态框内容 */}
        <div className={styles.modalContent}>
          <SnapshotFilterBar
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            timeFilter={timeFilter}
            onTimeFilterChange={setTimeFilter}
            filteredCount={filteredSnapshots.length}
            totalCount={snapshots.length}
          />
          {previewState && (
            <PreviewPanel
              previewState={previewState}
              canRestore={Boolean(filePath)}
              pdfComparePage={pdfComparePage}
              onPdfPageChange={setPdfComparePage}
              onRestore={(e) => {
                const snapshot = snapshots.find((item) => item.id === previewState.snapshotId);
                if (snapshot) {
                  void handleRestoreSnapshot(snapshot, e);
                }
              }}
              onClose={() => setPreviewState(null)}
            />
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
            <SnapshotList
              snapshots={filteredSnapshots}
              fileTypeMeta={fileTypeMeta}
              onSelect={handleViewDiff}
              onRename={handleRenameCommit}
              onRestore={handleRestoreSnapshot}
              onDelete={handleDeleteCommit}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default VersionTimeline;
