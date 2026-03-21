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

type NetworkQuality = 'good' | 'weak' | 'offline';

interface NetworkStatusState {
  online: boolean;
  quality: NetworkQuality;
  effectiveType: string;
  downlink: number | null;
  rtt: number | null;
  updatedAt: number;
}

function getConnectionInfo(): {
  effectiveType: string;
  downlink: number | null;
  rtt: number | null;
} {
  const connection =
    (
      navigator as Navigator & {
        connection?: { effectiveType?: string; downlink?: number; rtt?: number };
        mozConnection?: { effectiveType?: string; downlink?: number; rtt?: number };
        webkitConnection?: { effectiveType?: string; downlink?: number; rtt?: number };
      }
    ).connection ||
    (
      navigator as Navigator & {
        mozConnection?: { effectiveType?: string; downlink?: number; rtt?: number };
      }
    ).mozConnection ||
    (
      navigator as Navigator & {
        webkitConnection?: { effectiveType?: string; downlink?: number; rtt?: number };
      }
    ).webkitConnection;

  return {
    effectiveType: connection?.effectiveType || 'unknown',
    downlink: typeof connection?.downlink === 'number' ? connection.downlink : null,
    rtt: typeof connection?.rtt === 'number' ? connection.rtt : null,
  };
}

function evaluateNetworkQuality(
  online: boolean,
  effectiveType: string,
  downlink: number | null,
  rtt: number | null
): NetworkQuality {
  if (!online) return 'offline';
  if (
    effectiveType === 'slow-2g' ||
    effectiveType === '2g' ||
    (typeof downlink === 'number' && downlink < 1.2) ||
    (typeof rtt === 'number' && rtt > 500)
  ) {
    return 'weak';
  }
  return 'good';
}

function createNetworkStatusState(): NetworkStatusState {
  const online = navigator.onLine;
  const { effectiveType, downlink, rtt } = getConnectionInfo();
  return {
    online,
    quality: evaluateNetworkQuality(online, effectiveType, downlink, rtt),
    effectiveType,
    downlink,
    rtt,
    updatedAt: Date.now(),
  };
}

function formatNetworkTooltip(status: NetworkStatusState): string {
  const updatedAt = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(status.updatedAt);
  const qualityLabel =
    status.quality === 'offline' ? '离线' : status.quality === 'weak' ? '弱网' : '稳定';
  const bandwidthLabel =
    typeof status.downlink === 'number' ? `${status.downlink.toFixed(1)} Mbps` : '不可用';
  const rttLabel = typeof status.rtt === 'number' ? `${Math.round(status.rtt)} ms` : '不可用';
  return [
    `网络: ${qualityLabel}`,
    `在线状态: ${status.online ? '已连接' : '已断开'}`,
    `链路类型: ${status.effectiveType}`,
    `带宽: ${bandwidthLabel}`,
    `时延: ${rttLabel}`,
    `最近更新: ${updatedAt}`,
  ].join('\n');
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
  const [networkStatus, setNetworkStatus] = useState<NetworkStatusState>(() =>
    createNetworkStatusState()
  );
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
    const updateNetworkStatus = () => {
      setNetworkStatus(createNetworkStatusState());
    };

    const connection =
      (
        navigator as Navigator & {
          connection?: EventTarget;
          mozConnection?: EventTarget;
          webkitConnection?: EventTarget;
        }
      ).connection ||
      (navigator as Navigator & { mozConnection?: EventTarget }).mozConnection ||
      (navigator as Navigator & { webkitConnection?: EventTarget }).webkitConnection;

    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);
    connection?.addEventListener?.('change', updateNetworkStatus);

    return () => {
      window.removeEventListener('online', updateNetworkStatus);
      window.removeEventListener('offline', updateNetworkStatus);
      connection?.removeEventListener?.('change', updateNetworkStatus);
    };
  }, []);

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

    const dispose = ipc.on('update-state-changed', handleStateChanged);
    return () => {
      dispose?.();
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

  const networkTooltip = useMemo(() => formatNetworkTooltip(networkStatus), [networkStatus]);

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
        <span className={styles.separator}>|</span>
        <Tooltip content={networkTooltip} position="top">
          <span
            className={`${styles.item} ${styles.networkStatus} ${styles[`network${networkStatus.quality[0].toUpperCase()}${networkStatus.quality.slice(1)}`]}`}
          >
            <span className={styles.networkDot} />
            <span>
              {networkStatus.quality === 'offline'
                ? '离线'
                : networkStatus.quality === 'weak'
                  ? '弱网'
                  : '网络正常'}
            </span>
          </span>
        </Tooltip>
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
        {filePath &&
          (() => {
            const isUntitled = filePath.startsWith('__untitled__:');
            const isChangelog = filePath.startsWith('__changelog__:');
            const name = isUntitled
              ? filePath.replace('__untitled__:', '')
              : isChangelog
                ? filePath.replace('__changelog__:', '')
                : filePath.split('/').pop() || filePath.split('\\').pop() || '';
            const dotIdx = name.lastIndexOf('.');
            const ext = isChangelog
              ? 'MD'
              : dotIdx > 0
                ? name.slice(dotIdx + 1).toUpperCase()
                : 'TXT';
            const truncated =
              name.length > MAX_FILENAME_LEN ? name.slice(0, MAX_FILENAME_LEN) + '...' : name;
            const needsTooltip = name.length > MAX_FILENAME_LEN;
            return (
              <>
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
        <span className={styles.separator}>|</span>
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
