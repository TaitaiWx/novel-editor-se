import React, { useState } from 'react';
import styles from './styles.module.scss';
import type { StorylineViewMode } from './types';
import { OutlineView } from './OutlineView';
import { ActsView } from './ActsView';
import { AiCacheProvider } from './AiCacheContext';
import { useHorizontalOverflow } from './useHorizontalOverflow';
import type {
  PersistedOutlineScopeInput,
  PersistedOutlineScopeKind,
} from '../../types/electron-api';

/** 右侧「大纲」面板的三个视图：目录 / 章纲（作用域大纲）/ 卷纲（幕剧规划） */
export const STORYLINE_MODES: ReadonlyArray<{ mode: StorylineViewMode; label: string }> = [
  { mode: 'catalog', label: '目录' },
  { mode: 'outline', label: '章纲' },
  { mode: 'acts', label: '卷纲' },
];

/** 章纲按钮的提示：随当前作用域说明它展示的是哪一级大纲 */
export function getOutlineModeTitle(scopeKind: PersistedOutlineScopeKind): string {
  switch (scopeKind) {
    case 'chapter':
      return '本章的章纲';
    case 'volume':
      return '本卷各章的章纲';
    default:
      return '整部作品的章纲';
  }
}

export const StorylineView: React.FC<{
  content: string;
  onScrollToLine?: (line: number, contentKey?: string) => void;
  onReplaceLineText?: (line: number, text: string) => void;
  folderPath: string | null;
  dbReady: boolean;
  scopeKind?: PersistedOutlineScopeKind;
  scopeLabel?: string;
  outlineScope?: PersistedOutlineScopeInput | null;
}> = React.memo(
  ({
    content,
    onScrollToLine,
    onReplaceLineText,
    folderPath,
    dbReady,
    scopeKind = 'project',
    scopeLabel = '当前作品',
    outlineScope = null,
  }) => {
    const [viewMode, setViewMode] = useState<StorylineViewMode>('catalog');
    // 面板过窄时模式切换栏可横向滚动，用边缘渐隐提示还有被遮住的按钮
    const { ref: toolbarRef, overflow: toolbarOverflow } = useHorizontalOverflow<HTMLDivElement>();
    const toolbarClassName = [
      styles.storylineToolbar,
      toolbarOverflow.start ? styles.storylineToolbarFadeStart : '',
      toolbarOverflow.end ? styles.storylineToolbarFadeEnd : '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <AiCacheProvider dbReady={dbReady}>
        <div className={styles.storylineView}>
          <div
            ref={toolbarRef}
            className={toolbarClassName}
            data-overflow-start={toolbarOverflow.start || undefined}
            data-overflow-end={toolbarOverflow.end || undefined}
          >
            {STORYLINE_MODES.map(({ mode, label }) => (
              <button
                key={mode}
                type="button"
                className={`${styles.storylineToggle} ${viewMode === mode ? styles.storylineToggleActive : ''}`}
                aria-pressed={viewMode === mode}
                title={mode === 'outline' ? getOutlineModeTitle(scopeKind) : undefined}
                onClick={() => setViewMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
          {viewMode === 'catalog' ? (
            <OutlineView
              mode="catalog"
              content={content}
              folderPath={folderPath}
              dbReady={dbReady}
              scope={outlineScope}
              scopeLabel={scopeLabel}
              onScrollToLine={onScrollToLine}
              onReplaceLineText={onReplaceLineText}
            />
          ) : viewMode === 'outline' ? (
            <OutlineView
              mode="outline"
              content={content}
              folderPath={folderPath}
              dbReady={dbReady}
              scope={outlineScope}
              scopeLabel={scopeLabel}
              onScrollToLine={onScrollToLine}
              onReplaceLineText={onReplaceLineText}
            />
          ) : (
            <ActsView content={content} onScrollToLine={onScrollToLine} folderPath={folderPath} />
          )}
        </div>
      </AiCacheProvider>
    );
  }
);
