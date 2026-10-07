/**
 * 主画面下方的信息行：类型 · 文件名 · 尺寸 / 时长，以及操作
 * （插入到正文、导出、用系统应用打开、在资料中定位、从列表移除）。
 */
import React, { useState } from 'react';
import { VscClose, VscCloudDownload, VscInsert, VscLinkExternal, VscTarget } from 'react-icons/vsc';
import Tooltip from '../Tooltip';
import ContextMenu from '../ContextMenu';
import { useOptionalToast } from '../Toast';
import { formatTime } from '@novel-editor/media-player';
import { REFERENCE_KIND_LABELS, type ReferenceItem } from '../../utils/referencePane';
import { requestRevealInFilePanel } from '../../utils/workspaceFiles';
import { exportChoicesFor, exportMediaWithToast } from '../../utils/mediaExport';
import { getActiveEditor } from '../TextEditor/active-editor';
import type { MediaInfo } from './ReferenceStage';
import styles from './styles.module.scss';

/** 信息行文字：类型、文件名、尺寸、时长（已知时） */
export function describeReference(item: ReferenceItem, info: MediaInfo | null): string[] {
  const name = item.path.split(/[\\/]/).pop() ?? item.path;
  const parts = [REFERENCE_KIND_LABELS[item.kind], name];
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
  /** 插入正文的指令（::image / ::video / ::audio，路径相对作品目录） */
  directive: string;
}> = ({ item, info, onRemove, directive }) => {
  const [kind, ...rest] = describeReference(item, info);
  const toast = useOptionalToast();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const choices = exportChoicesFor(item.path);
  const runExport = (format?: string) =>
    void exportMediaWithToast({ sourcePath: item.path, format, title: item.title }, toast);

  const insert = () => {
    const editor = getActiveEditor();
    if (editor?.insertBlock?.(directive)) {
      toast?.success('已插入到正文');
    } else {
      toast?.error('没有可插入的正文（先打开一个章节）');
    }
  };

  return (
    <div className={styles.info} data-testid="reference-info">
      <div className={styles.meta} title={item.path}>
        <span className={styles.kindBadge}>{kind}</span>
        <span className={styles.metaText}>{rest.join(' · ')}</span>
      </div>
      <div className={styles.infoActions}>
        <Tooltip content={`插入到正文（::${item.kind}）`}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="插入到正文"
            onMouseDown={(event) => event.preventDefault()}
            onClick={insert}
          >
            <VscInsert />
          </button>
        </Tooltip>
        {choices.length > 0 && (
          <Tooltip
            content={
              item.kind === 'image' ? '导出为 PNG / JPEG / WebP…' : `导出 ${choices[0].label}…`
            }
          >
            <button
              type="button"
              className={styles.iconButton}
              aria-label="导出"
              aria-haspopup={item.kind === 'image' ? 'menu' : undefined}
              onClick={(event) => {
                if (item.kind !== 'image') {
                  runExport(choices[0].format);
                  return;
                }
                const rect = event.currentTarget.getBoundingClientRect();
                setMenu({ x: rect.left, y: rect.bottom + 4 });
              }}
            >
              <VscCloudDownload />
            </button>
          </Tooltip>
        )}
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
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={choices.map((choice) => ({
            label: `导出为 ${choice.label}…`,
            onClick: () => runExport(choice.format),
          }))}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
};

export default ReferenceInfo;
