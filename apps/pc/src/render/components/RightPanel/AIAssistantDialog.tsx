import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AIView } from './AIView';
import type { AISessionState } from './AIView';
import Tooltip from '../Tooltip';
import styles from './styles.module.scss';

export const AIAssistantDialog: React.FC<{
  visible: boolean;
  onClose: () => void;
  folderPath: string | null;
  content: string;
  filePath?: string | null;
  onApplyFix?: (
    original: string,
    modified: string,
    targetPath?: string,
    targetLine?: number
  ) => void;
  onOpenFile?: (filePath: string) => void;
  onOpenSettings?: () => void;
  onPreviewDiff?: (original: string, modified: string) => void;
}> = React.memo(
  ({
    visible,
    onClose,
    folderPath,
    content,
    filePath,
    onApplyFix,
    onOpenFile,
    onOpenSettings,
    onPreviewDiff,
  }) => {
    const [expanded, setExpanded] = useState(false);
    const resultRef = useRef<HTMLDivElement>(null);
    const aiStateRef = useRef<AISessionState | null>(null);

    useEffect(() => {
      if (!visible) return;
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
      };
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }, [visible, onClose]);

    useEffect(() => {
      if (!visible) setExpanded(false);
    }, [visible]);

    // 打开新窗口前，保存当前 AI 状态到主进程内存
    const handleOpenNewWindow = useCallback(async () => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) return;
      // 保存当前 AI 会话状态
      if (aiStateRef.current) {
        await ipc.invoke('ai-save-session-state', JSON.stringify(aiStateRef.current));
      }
      void ipc.invoke('open-ai-assistant-window', folderPath || '');
      onClose();
    }, [folderPath, onClose]);

    if (!visible) return null;

    const panelClassName = `${styles.aiDialogPanel} ${expanded ? styles.aiDialogExpanded : ''}`;

    return createPortal(
      <>
        <div className={styles.aiDialogBackdrop} onClick={onClose} />
        <div className={panelClassName}>
          <div className={styles.aiDialogHeader}>
            <span>AI 助手</span>
            <div className={styles.aiDialogHeaderActions}>
              <Tooltip content={expanded ? '收起面板' : '展开面板'} position="bottom">
                <button className={styles.aiDialogExpand} onClick={() => setExpanded(!expanded)}>
                  {expanded ? '⊟' : '⊞'}
                </button>
              </Tooltip>
              <Tooltip content="在新窗口中打开" position="bottom">
                <button className={styles.aiDialogExpand} onClick={handleOpenNewWindow}>
                  ⧉
                </button>
              </Tooltip>
              <Tooltip content="关闭" position="bottom">
                <button className={styles.aiDialogClose} onClick={onClose}>
                  ✕
                </button>
              </Tooltip>
            </div>
          </div>
          <div className={styles.aiDialogBody} ref={resultRef}>
            <AIView
              folderPath={folderPath}
              content={content}
              filePath={filePath}
              onApplyFix={onApplyFix}
              onOpenFile={onOpenFile}
              onOpenSettings={onOpenSettings}
              onPreviewDiff={onPreviewDiff}
              stateRef={aiStateRef}
            />
          </div>
        </div>
      </>,
      document.body
    );
  }
);
