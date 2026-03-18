import React, { useState, useCallback } from 'react';
import styles from './styles.module.scss';
import type { StorylineViewMode } from './types';
import { OutlineView } from './OutlineView';
import { ActsView } from './ActsView';
import { AiCacheProvider } from './AiCacheContext';

export const StorylineView: React.FC<{
  content: string;
  onScrollToLine?: (line: number) => void;
  onReplaceLineText?: (line: number, text: string) => void;
  folderPath: string | null;
  dbReady: boolean;
}> = React.memo(({ content, onScrollToLine, onReplaceLineText, folderPath, dbReady }) => {
  const [viewMode, setViewMode] = useState<StorylineViewMode>('outline');

  const toggleMode = useCallback(() => {
    setViewMode((prev) => (prev === 'outline' ? 'acts' : 'outline'));
  }, []);

  return (
    <AiCacheProvider dbReady={dbReady}>
      <div className={styles.storylineView}>
        <div className={styles.storylineToolbar}>
          <button
            className={`${styles.storylineToggle} ${viewMode === 'outline' ? styles.storylineToggleActive : ''}`}
            onClick={() => setViewMode('outline')}
          >
            目录
          </button>
          <button
            className={`${styles.storylineToggle} ${viewMode === 'acts' ? styles.storylineToggleActive : ''}`}
            onClick={() => setViewMode('acts')}
          >
            情节板
          </button>
        </div>
        {viewMode === 'outline' ? (
          <OutlineView
            content={content}
            onScrollToLine={onScrollToLine}
            onReplaceLineText={onReplaceLineText}
          />
        ) : (
          <ActsView content={content} onScrollToLine={onScrollToLine} folderPath={folderPath} />
        )}
      </div>
    </AiCacheProvider>
  );
});
