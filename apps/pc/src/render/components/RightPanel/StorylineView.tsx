import React, { useState } from 'react';
import styles from './styles.module.scss';
import type { StorylineViewMode } from './types';
import { OutlineView } from './OutlineView';
import { ActsView } from './ActsView';
import { AiCacheProvider } from './AiCacheContext';
import { ThreeSignView } from './ThreeSignView';
import type {
  PersistedOutlineScopeInput,
  PersistedOutlineScopeKind,
} from '../../types/electron-api';

const OPEN_STORYLINE_MODE_EVENT = 'open-storyline-mode';

function getOutlineModeLabel(scopeKind: PersistedOutlineScopeKind): string {
  switch (scopeKind) {
    case 'chapter':
      return '本章大纲';
    case 'volume':
      return '本卷大纲';
    default:
      return '作品大纲';
  }
}

export const StorylineView: React.FC<{
  content: string;
  onScrollToLine?: (line: number, contentKey?: string) => void;
  onReplaceLineText?: (line: number, text: string) => void;
  folderPath: string | null;
  dbReady: boolean;
  currentLine?: number;
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
    currentLine,
    scopeKind = 'project',
    scopeLabel = '当前作品',
    outlineScope = null,
  }) => {
    const [viewMode, setViewMode] = useState<StorylineViewMode>('catalog');

    React.useEffect(() => {
      const handleOpenMode = (event: Event) => {
        const customEvent = event as CustomEvent<{ mode?: StorylineViewMode }>;
        if (customEvent.detail?.mode) {
          setViewMode(customEvent.detail.mode);
        }
      };

      window.addEventListener(OPEN_STORYLINE_MODE_EVENT, handleOpenMode as EventListener);
      return () => {
        window.removeEventListener(OPEN_STORYLINE_MODE_EVENT, handleOpenMode as EventListener);
      };
    }, []);

    return (
      <AiCacheProvider dbReady={dbReady}>
        <div className={styles.storylineView}>
          <div className={styles.storylineToolbar}>
            <button
              className={`${styles.storylineToggle} ${viewMode === 'catalog' ? styles.storylineToggleActive : ''}`}
              onClick={() => setViewMode('catalog')}
            >
              目录
            </button>
            <button
              className={`${styles.storylineToggle} ${viewMode === 'outline' ? styles.storylineToggleActive : ''}`}
              onClick={() => setViewMode('outline')}
            >
              {getOutlineModeLabel(scopeKind)}
            </button>
            <button
              className={`${styles.storylineToggle} ${viewMode === 'acts' ? styles.storylineToggleActive : ''}`}
              onClick={() => setViewMode('acts')}
            >
              卷规划
            </button>
            <button
              className={`${styles.storylineToggle} ${viewMode === 'ideas' ? styles.storylineToggleActive : ''}`}
              onClick={() => setViewMode('ideas')}
            >
              三签卡
            </button>
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
          ) : viewMode === 'ideas' ? (
            <ThreeSignView
              content={content}
              folderPath={folderPath}
              dbReady={dbReady}
              currentLine={currentLine}
            />
          ) : (
            <ActsView content={content} onScrollToLine={onScrollToLine} folderPath={folderPath} />
          )}
        </div>
      </AiCacheProvider>
    );
  }
);
