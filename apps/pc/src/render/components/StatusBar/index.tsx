import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { VscHistory } from 'react-icons/vsc';
import { formatNumber } from '@novel-editor/helpers';
import type { UpdateChannel, UpdateStatus } from '@/render/types/electron-api';
import Tooltip from '../Tooltip';
import styles from './styles.module.scss';

const ENCODINGS = ['UTF-8', 'GBK', 'GB2312', 'Big5', 'Shift_JIS', 'ISO-8859-1', 'ASCII'];
const MAX_FILENAME_LEN = 20;
const UPDATE_CHANNELS: { value: UpdateChannel; label: string; description: string }[] = [
  { value: 'stable', label: '稳定版', description: '正式发布，默认通道' },
  { value: 'beta', label: 'Beta', description: '提前验证新版本' },
  { value: 'canary', label: 'Canary', description: '金丝雀小流量版本' },
];

function getChannelLabel(channel: UpdateChannel) {
  return UPDATE_CHANNELS.find((item) => item.value === channel)?.label ?? channel;
}

interface StatusBarProps {
  content: string;
  currentLine: number;
  currentColumn: number;
  filePath: string | null;
  encoding: string;
  onEncodingChange: (encoding: string) => void;
  folderPath: string | null;
  onToggleVersionHistory?: () => void;
}

const StatusBar: React.FC<StatusBarProps> = ({
  content,
  currentLine,
  currentColumn,
  filePath,
  encoding,
  onEncodingChange,
  folderPath,
  onToggleVersionHistory,
}) => {
  const [showEncodingMenu, setShowEncodingMenu] = useState(false);
  const [showUpdateMenu, setShowUpdateMenu] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const encodingMenuRef = useRef<HTMLDivElement>(null);
  const updateMenuRef = useRef<HTMLDivElement>(null);

  // O(n) single-pass line+char count — avoids split() and replace() allocations
  const { lineCount, charCount } = useMemo(() => {
    if (!content) return { lineCount: 0, charCount: 0 };
    let lines = 1;
    let chars = 0;
    for (let i = 0; i < content.length; i++) {
      const c = content.charCodeAt(i);
      if (c === 10)
        lines++; // \n
      else if (c !== 13 && c !== 9 && c !== 32) chars++; // skip \r \t space
    }
    return { lineCount: lines, charCount: chars };
  }, [content]);

  useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;

    ipc
      .invoke('update-status')
      .then((status) => setUpdateStatus(status))
      .catch((error) => {
        console.error('Failed to get update status:', error);
      });
  }, []);

  useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;

    const handleStateChanged = (_event: unknown, nextStatus: UpdateStatus) => {
      setUpdateStatus(nextStatus);
    };

    ipc.on('update-state-changed', handleStateChanged);
    return () => {
      ipc.removeAllListeners('update-state-changed');
    };
  }, []);

  const handleRestartUpdate = useCallback(async () => {
    try {
      await window.electron.ipcRenderer.invoke('update-install');
    } catch (error) {
      console.error('Failed to install update:', error);
    }
  }, []);

  useEffect(() => {
    if (!showEncodingMenu && !showUpdateMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (encodingMenuRef.current && !encodingMenuRef.current.contains(e.target as Node)) {
        setShowEncodingMenu(false);
      }

      if (updateMenuRef.current && !updateMenuRef.current.contains(e.target as Node)) {
        setShowUpdateMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEncodingMenu, showUpdateMenu]);

  const handleCheckUpdates = useCallback(async () => {
    try {
      await window.electron.ipcRenderer.invoke('update-check');
    } catch (error) {
      console.error('Failed to check updates:', error);
    }
  }, []);

  const handleChangeChannel = useCallback(async (channel: UpdateChannel) => {
    try {
      const nextStatus = (await window.electron.ipcRenderer.invoke(
        'update-set-channel',
        channel
      )) as UpdateStatus;
      setUpdateStatus(nextStatus);
      setShowUpdateMenu(false);
    } catch (error) {
      console.error('Failed to change update channel:', error);
    }
  }, []);

  const handleRollback = useCallback(async () => {
    try {
      await window.electron.ipcRenderer.invoke('update-rollback');
      setShowUpdateMenu(false);
    } catch (error) {
      console.error('Failed to rollback:', error);
    }
  }, []);

  const appVersion = updateStatus?.currentVersion ?? '';
  const updateReady = updateStatus?.updateReady ?? false;
  const updateSummary = useMemo(() => {
    if (!updateStatus) return null;

    if (updateStatus.updateReady && updateStatus.downloadedVersion) {
      return `已下载 ${updateStatus.downloadedVersion}`;
    }

    if (typeof updateStatus.downloadPercent === 'number' && updateStatus.availableVersion) {
      return `下载 ${Math.round(updateStatus.downloadPercent)}%`;
    }

    if (updateStatus.checking) {
      return '检查更新中';
    }

    if (updateStatus.availableVersion) {
      return `发现 ${updateStatus.availableVersion}`;
    }

    return null;
  }, [updateStatus]);

  return (
    <div className={styles.statusBar}>
      <div className={styles.left}>
        {folderPath && onToggleVersionHistory && (
          <>
            <span
              className={`${styles.item} ${styles.clickable} ${styles.versionHistoryBtn}`}
              onClick={onToggleVersionHistory}
              title="版本历史"
            >
              <VscHistory className={styles.versionIcon} />
              <span>版本历史</span>
            </span>
            {filePath && <span className={styles.separator}>|</span>}
          </>
        )}
        {filePath && (
          <>
            <span className={styles.item}>
              行 {currentLine}, 列 {currentColumn}
            </span>
            <span className={styles.separator}>|</span>
            <span className={styles.item}>{formatNumber(lineCount)} 行</span>
            <span className={styles.separator}>|</span>
            <span className={styles.item}>{formatNumber(charCount)} 字</span>
          </>
        )}
      </div>
      <div className={styles.right}>
        {updateSummary && <span className={styles.item}>{updateSummary}</span>}
        {updateReady && (
          <span className={`${styles.item} ${styles.updateReady}`} onClick={handleRestartUpdate}>
            重启以更新
          </span>
        )}
        <div className={styles.menuWrapper} ref={encodingMenuRef}>
          <span
            className={`${styles.item} ${styles.clickable}`}
            onClick={() => setShowEncodingMenu((prev) => !prev)}
          >
            {encoding}
          </span>
          {showEncodingMenu && (
            <div className={styles.encodingMenu}>
              {ENCODINGS.map((enc) => (
                <div
                  key={enc}
                  className={`${styles.encodingOption} ${enc === encoding ? styles.active : ''}`}
                  onClick={() => {
                    onEncodingChange(enc);
                    setShowEncodingMenu(false);
                  }}
                >
                  {enc}
                </div>
              ))}
            </div>
          )}
        </div>
        {appVersion && updateStatus && (
          <div className={styles.menuWrapper} ref={updateMenuRef}>
            <span
              className={`${styles.version} ${styles.clickableVersion}`}
              onClick={() => setShowUpdateMenu((prev) => !prev)}
              title="更新通道与回退"
            >
              v{appVersion} · {getChannelLabel(updateStatus.channel)}
            </span>
            {showUpdateMenu && (
              <div className={`${styles.encodingMenu} ${styles.updateMenu}`}>
                <div className={styles.menuSectionTitle}>更新通道</div>
                {UPDATE_CHANNELS.map((channel) => (
                  <button
                    key={channel.value}
                    className={`${styles.menuButton} ${
                      updateStatus.channel === channel.value ? styles.active : ''
                    }`}
                    onClick={() => handleChangeChannel(channel.value)}
                  >
                    <span>{channel.label}</span>
                    <span className={styles.menuMeta}>{channel.description}</span>
                  </button>
                ))}
                <div className={styles.menuDivider}></div>
                <button className={styles.menuButton} onClick={handleCheckUpdates}>
                  手动检查更新
                </button>
                {updateStatus.rollbackAvailable && updateStatus.rollbackVersion && (
                  <button className={styles.menuButton} onClick={handleRollback}>
                    回退到 {updateStatus.rollbackVersion}
                  </button>
                )}
                {updateStatus.channelVersion && (
                  <div className={styles.menuHint}>
                    通道文件 {updateStatus.channelFile} · 版本 {updateStatus.channelVersion}
                    {typeof updateStatus.rolloutPercentage === 'number' &&
                      ` · 灰度 ${updateStatus.rolloutPercentage}%`}
                  </div>
                )}
                {updateStatus.lastError && (
                  <div className={styles.menuError}>{updateStatus.lastError}</div>
                )}
              </div>
            )}
          </div>
        )}
        {filePath &&
          (() => {
            const isUntitled = filePath.startsWith('__untitled__:');
            const name = isUntitled
              ? filePath.replace('__untitled__:', '')
              : filePath.split('/').pop() || filePath.split('\\').pop() || '';
            const dotIdx = name.lastIndexOf('.');
            const ext = dotIdx > 0 ? name.slice(dotIdx + 1).toUpperCase() : 'TXT';
            const truncated =
              name.length > MAX_FILENAME_LEN ? name.slice(0, MAX_FILENAME_LEN) + '...' : name;
            const needsTooltip = name.length > MAX_FILENAME_LEN;
            return (
              <>
                <span className={styles.separator}>|</span>
                {needsTooltip ? (
                  <Tooltip content={name} position="top">
                    <span className={styles.item}>{truncated}</span>
                  </Tooltip>
                ) : (
                  <span className={styles.item}>{name}</span>
                )}
                <span className={styles.separator}>|</span>
                <span className={styles.item}>{ext}</span>
              </>
            );
          })()}
      </div>
    </div>
  );
};

export default StatusBar;
