/**
 * 主画面下方的信息行：类型 · 文件名 · 尺寸 / 时长，以及操作（用系统应用打开、在资料中定位、从列表移除）。
 */
import React from 'react';
import { VscClose, VscLinkExternal, VscTarget } from 'react-icons/vsc';
import Tooltip from '../Tooltip';
import { formatTime } from '../VideoPlayer/format';
import type { ReferenceItem } from '../../utils/referencePane';
import { requestRevealInFilePanel } from '../../utils/workspaceFiles';
import type { MediaInfo } from './ReferenceStage';
import styles from './styles.module.scss';

/** 信息行文字：类型、文件名、尺寸、时长（已知时） */
export function describeReference(item: ReferenceItem, info: MediaInfo | null): string[] {
  const name = item.path.split(/[\\/]/).pop() ?? item.path;
  const parts = [item.kind === 'video' ? '视频' : '图片', name];
  if (info && info.path === item.path) {
    if (info.width > 0 && info.height > 0) parts.push(`${info.width}×${info.height}`);
    if (info.duration !== undefined && Number.isFinite(info.duration) && info.duration > 0) {
      parts.push(formatTime(info.duration));
    }
  }
  return parts;
}

function openInSystemApp(path: string) {
  const ipc = window.electron?.ipcRenderer;
  if (!ipc) return;
  void ipc.invoke('open-in-system-app', path).catch(() => undefined);
}

const ReferenceInfo: React.FC<{
  item: ReferenceItem;
  info: MediaInfo | null;
  onRemove: () => void;
}> = ({ item, info, onRemove }) => {
  const [kind, ...rest] = describeReference(item, info);
  return (
    <div className={styles.info} data-testid="reference-info">
      <div className={styles.meta} title={item.path}>
        <span className={styles.kindBadge}>{kind}</span>
        <span className={styles.metaText}>{rest.join(' · ')}</span>
      </div>
      <div className={styles.infoActions}>
        <Tooltip content="用系统应用打开">
          <button
            type="button"
            className={styles.iconButton}
            aria-label="用系统应用打开"
            onClick={() => openInSystemApp(item.path)}
          >
            <VscLinkExternal />
          </button>
        </Tooltip>
        <Tooltip content="在资料中定位">
          <button
            type="button"
            className={styles.iconButton}
            aria-label="在资料中定位"
            onClick={() => requestRevealInFilePanel(item.path)}
          >
            <VscTarget />
          </button>
        </Tooltip>
        <Tooltip content="从参考列表移除">
          <button
            type="button"
            className={styles.iconButton}
            aria-label="从参考列表移除"
            onClick={onRemove}
          >
            <VscClose />
          </button>
        </Tooltip>
      </div>
    </div>
  );
};

export default ReferenceInfo;
