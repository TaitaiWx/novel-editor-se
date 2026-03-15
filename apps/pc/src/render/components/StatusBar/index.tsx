import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { VscHistory } from 'react-icons/vsc';
import { formatNumber } from '@novel-editor/helpers';
import Tooltip from '../Tooltip';
import styles from './styles.module.scss';

const ENCODINGS = ['UTF-8', 'GBK', 'GB2312', 'Big5', 'Shift_JIS', 'ISO-8859-1', 'ASCII'];
const MAX_FILENAME_LEN = 20;

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
  const [appVersion, setAppVersion] = useState('');
  const [updateReady, setUpdateReady] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
    window.electron?.ipcRenderer
      ?.invoke('get-app-version')
      .then((v) => setAppVersion(v))
      .catch(() => setAppVersion('1.0.0'));
  }, []);

  useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    const handler = () => setUpdateReady(true);
    ipc.on('update-downloaded', handler);
    return () => ipc.removeAllListeners('update-downloaded');
  }, []);

  const handleRestartUpdate = useCallback(async () => {
    try {
      await window.electron.ipcRenderer.invoke('update-install');
    } catch (error) {
      console.error('Failed to install update:', error);
    }
  }, []);

  useEffect(() => {
    if (!showEncodingMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowEncodingMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEncodingMenu]);

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
        {updateReady && (
          <span className={`${styles.item} ${styles.updateReady}`} onClick={handleRestartUpdate}>
            重启以更新
          </span>
        )}
        <div className={styles.encodingWrapper} ref={menuRef}>
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
        {appVersion && (
          <>
            <span className={styles.separator}>|</span>
            <span className={styles.version}>v{appVersion}</span>
          </>
        )}
      </div>
    </div>
  );
};

export default StatusBar;
