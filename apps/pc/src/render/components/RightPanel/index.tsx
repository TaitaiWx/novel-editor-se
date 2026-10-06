import React from 'react';
import { VscMultipleWindows } from 'react-icons/vsc';
import styles from './styles.module.scss';
import type { RightPanelProps } from './types';
import { StorylineView } from './StorylineView';

/**
 * 右侧「大纲」面板：只保留 目录 / 章纲 / 卷纲 三个视图。
 * 作用域 AI 上下文（人物 / 设定 / 资料）在 AI 助手的「上下文」分区，灵感抽签在编辑器工具栏。
 */
const RightPanel: React.FC<RightPanelProps> = ({
  content,
  collapsed,
  onToggle,
  onPopOut,
  onScrollToLine,
  onReplaceLineText,
  folderPath,
  dbReady,
  enabled = true,
  scopeKind = 'project',
  scopeLabel = '当前作品',
  outlineScope = null,
}) => {
  if (collapsed) {
    return (
      <div className={styles.collapsedPanel}>
        <button className={styles.expandButton} onClick={onToggle} title="展开面板">
          ◀
        </button>
      </div>
    );
  }

  return (
    <div className={styles.rightPanel}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>大纲</h2>
        <div className={styles.headerActions}>
          {onPopOut && (
            <button
              className={styles.popOutButton}
              onClick={onPopOut}
              title="在新窗口中打开"
              aria-label="在新窗口中打开"
            >
              <VscMultipleWindows />
            </button>
          )}
          <button
            className={styles.collapseButton}
            onClick={onToggle}
            title="折叠面板"
            aria-label="折叠面板"
          >
            ▶
          </button>
        </div>
      </div>
      <div className={styles.panelContent}>
        {enabled ? (
          <StorylineView
            content={content}
            onScrollToLine={onScrollToLine}
            onReplaceLineText={onReplaceLineText}
            folderPath={folderPath}
            dbReady={dbReady}
            scopeKind={scopeKind}
            scopeLabel={scopeLabel}
            outlineScope={outlineScope}
          />
        ) : (
          <div className={styles.emptyHint}>打开作品后，可在这里查看目录、章纲与卷纲。</div>
        )}
      </div>
    </div>
  );
};

export default RightPanel;
