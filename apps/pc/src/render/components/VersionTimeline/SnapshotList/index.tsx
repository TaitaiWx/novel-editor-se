/**
 * SnapshotList — 版本时间线列表（点击查看对比，悬浮显示重命名/恢复/删除操作）
 */
import React from 'react';
import { VscHistory, VscEdit, VscTrash } from 'react-icons/vsc';
import type { FileTypeMeta, SnapshotInfo } from '../types';
import { formatDate } from '../utils';
import styles from './styles.module.scss';

export type SnapshotItemAction = (snapshot: SnapshotInfo, e: React.MouseEvent) => void;

export interface SnapshotListProps {
  snapshots: SnapshotInfo[];
  fileTypeMeta: FileTypeMeta;
  onSelect: (snapshot: SnapshotInfo) => void;
  onRename: SnapshotItemAction;
  onRestore: SnapshotItemAction;
  onDelete: SnapshotItemAction;
}

const SnapshotList: React.FC<SnapshotListProps> = ({
  snapshots,
  fileTypeMeta,
  onSelect,
  onRename,
  onRestore,
  onDelete,
}) => {
  return (
    <div className={styles.timeline}>
      {snapshots.map((snapshot, i) => (
        <div
          key={snapshot.id}
          className={styles.commitItem}
          onClick={() => onSelect(snapshot)}
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
              onClick={(e) => onRename(snapshot, e)}
              title="重命名版本"
            >
              <VscEdit />
            </button>
            <button
              className={styles.commitActionBtn}
              onClick={(e) => onRestore(snapshot, e)}
              title="恢复当前文件到此版本"
            >
              ↺
            </button>
            <button
              className={`${styles.commitActionBtn} ${styles.dangerBtn}`}
              onClick={(e) => onDelete(snapshot, e)}
              title="删除版本"
            >
              <VscTrash />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default SnapshotList;
