import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { VscHistory, VscSync, VscError, VscCheck } from 'react-icons/vsc';
import { formatNumber } from '@novel-editor/helpers';
import type { UpdateStatus } from '@/render/types/electron-api';
import Tooltip from '../Tooltip';
import CopyTooltip from '../CopyTooltip';
import styles from './styles.module.scss';

const MAX_FILENAME_LEN = 20;

const ENCODINGS = ['UTF-8', 'GBK', 'GB2312', 'Big5', 'Shift_JIS', 'EUC-KR', 'ISO-8859-1'];

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
  const [showUpdatePanel, setShowUpdatePanel] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [upToDate, setUpToDate] = useState(false);
  const prevCheckingRef = useRef(false);
  const encodingMenuRef = useRef<HTMLDivElement>(null);
  const updatePanelRef = useRef<HTMLDivElement>(null);

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
    ipc
      .invoke('get-device-id')
      .then((id) => setDeviceId(id as string))
      .catch(() => {});
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

  const [restarting, setRestarting] = useState(false);

  const handleRestartUpdate = useCallback(async () => {
    setRestarting(true);
    // Brief delay so the modal renders before the process quits
    await new Promise((r) => setTimeout(r, 300));
    try {
      await window.electron.ipcRenderer.invoke('update-install');
    } catch (error) {
      console.error('Failed to install update:', error);
      setRestarting(false);
    }
  }, []);

  // Detect "checking finished with no update" transition → show brief "已是最新版"
  useEffect(() => {
    if (!updateStatus) return;
    const wasChecking = prevCheckingRef.current;
    prevCheckingRef.current = updateStatus.checking;

    if (
      wasChecking &&
      !updateStatus.checking &&
      !updateStatus.availableVersion &&
      !updateStatus.lastError
    ) {
      setUpToDate(true);
      const timer = setTimeout(() => setUpToDate(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [updateStatus]);

  useEffect(() => {
    if (!showEncodingMenu && !showUpdatePanel) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        showEncodingMenu &&
        encodingMenuRef.current &&
        !encodingMenuRef.current.contains(e.target as Node)
      ) {
        setShowEncodingMenu(false);
      }
      if (
        showUpdatePanel &&
        updatePanelRef.current &&
        !updatePanelRef.current.contains(e.target as Node)
      ) {
        setShowUpdatePanel(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEncodingMenu, showUpdatePanel]);

  const handleCheckUpdates = useCallback(async () => {
    try {
      await window.electron.ipcRenderer.invoke('update-check');
    } catch (error) {
      console.error('Failed to check updates:', error);
    }
  }, []);

  const appVersion = updateStatus?.currentVersion ?? '';
  const updateReady = updateStatus?.updateReady ?? false;
  const lastError = updateStatus?.lastError ?? null;
  const downloadPercent = updateStatus?.downloadPercent ?? null;
  const updateSummary = useMemo(() => {
    if (!updateStatus) return null;

    if (updateStatus.updateReady && updateStatus.downloadedVersion) {
      return { text: `已下载 ${updateStatus.downloadedVersion}`, type: 'ready' as const };
    }

    if (typeof updateStatus.downloadPercent === 'number' && updateStatus.availableVersion) {
      return {
        text: `下载中 ${Math.round(updateStatus.downloadPercent)}%`,
        type: 'progress' as const,
      };
    }

    if (updateStatus.checking) {
      return { text: '检查更新中...', type: 'checking' as const };
    }

    if (updateStatus.availableVersion) {
      return { text: `发现 ${updateStatus.availableVersion}`, type: 'available' as const };
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
        {/* Inline status hints in status bar */}
        {updateSummary && !updateReady && (
          <span
            className={`${styles.item} ${styles.updateHint} ${updateSummary.type === 'checking' ? styles.updateChecking : ''}`}
          >
            {updateSummary.type === 'checking' && <VscSync className={styles.spinIcon} />}
            {updateSummary.text}
          </span>
        )}
        {lastError && !updateSummary && !updateReady && (
          <Tooltip content={lastError} position="top">
            <span className={`${styles.item} ${styles.updateError}`}>
              <VscError className={styles.errorIcon} />
              更新失败
            </span>
          </Tooltip>
        )}
        {upToDate && !updateSummary && !updateReady && !lastError && (
          <span className={`${styles.item} ${styles.updateUpToDate}`}>
            <VscCheck className={styles.checkIcon} />
            已是最新版
          </span>
        )}
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
        {/* Version + Update panel */}
        <div className={styles.menuWrapper} ref={updatePanelRef}>
          <span
            className={`${styles.version} ${styles.clickableVersion}`}
            onClick={() => setShowUpdatePanel((prev) => !prev)}
          >
            v{appVersion}
          </span>
          {showUpdatePanel && (
            <div className={styles.updatePanel}>
              <div className={styles.panelSection}>
                <div className={styles.panelTitle}>检查更新</div>
                <div className={styles.panelInfo}>当前版本 {appVersion}</div>
                {deviceId && (
                  <CopyTooltip text={deviceId} position="bottom">
                    <div
                      className={styles.panelInfo}
                      style={{ cursor: 'pointer', fontSize: '11px', opacity: 0.7 }}
                    >
                      设备 ID: {deviceId.slice(0, 8)}...
                    </div>
                  </CopyTooltip>
                )}
                {/* Progress bar */}
                {typeof downloadPercent === 'number' && updateStatus?.availableVersion && (
                  <div className={styles.progressSection}>
                    <div className={styles.progressText}>
                      下载 {updateStatus.availableVersion} — {Math.round(downloadPercent)}%
                    </div>
                    <div className={styles.progressBar}>
                      <div
                        className={styles.progressFill}
                        style={{ width: `${Math.min(downloadPercent, 100)}%` }}
                      />
                    </div>
                  </div>
                )}
                {/* Checking spinner */}
                {updateStatus?.checking &&
                  !(typeof downloadPercent === 'number' && updateStatus.availableVersion) && (
                    <div className={styles.panelCheckingRow}>
                      <VscSync className={styles.spinIcon} />
                      检查更新中...
                    </div>
                  )}
                {/* Found update (not yet downloading) */}
                {updateStatus?.availableVersion &&
                  !updateStatus.checking &&
                  typeof downloadPercent !== 'number' &&
                  !updateReady && (
                    <div className={styles.panelFoundRow}>
                      发现新版本 {updateStatus.availableVersion}
                    </div>
                  )}
                {/* Ready to install */}
                {updateReady && updateStatus?.downloadedVersion && (
                  <div className={styles.panelReadyRow} onClick={handleRestartUpdate}>
                    已下载 {updateStatus.downloadedVersion}，点击重启安装
                  </div>
                )}
                {/* Up to date */}
                {upToDate && !updateSummary && !updateReady && !lastError && (
                  <div className={styles.panelUpToDate}>
                    <VscCheck className={styles.checkIcon} />
                    已是最新版本
                  </div>
                )}
                {/* Error */}
                {lastError && <div className={styles.panelError}>{lastError}</div>}
              </div>
              {/* Check button */}
              <div className={styles.panelFooter}>
                <button
                  className={styles.checkBtn}
                  onClick={handleCheckUpdates}
                  disabled={updateStatus?.checking}
                >
                  {updateStatus?.checking ? '检查中...' : '检查更新'}
                </button>
              </div>
            </div>
          )}
        </div>
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
      {restarting && (
        <div className={styles.restartOverlay}>
          <div className={styles.restartModal}>
            <VscSync className={styles.restartSpinner} />
            <div className={styles.restartText}>正在准备更新，即将重启...</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StatusBar;
