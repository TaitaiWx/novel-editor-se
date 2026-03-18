import React, { useState, useCallback } from 'react';
import styles from './styles.module.scss';
import type { TabType, RightPanelProps } from './types';
import { TAB_KEYS, TAB_LABELS } from './constants';
import { StorylineView } from './StorylineView';
import { CharactersView } from './CharactersView';
import { LoreView } from './LoreView';

const RightPanel: React.FC<RightPanelProps> = ({
  content,
  collapsed,
  onToggle,
  onScrollToLine,
  onReplaceLineText,
  folderPath,
  dbReady,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('storyline');

  const handleTabClick = useCallback((tab: TabType) => {
    setActiveTab(tab);
  }, []);

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
        <div className={styles.tabs}>
          {TAB_KEYS.map((tab) => (
            <button
              key={tab}
              className={`${styles.tab} ${activeTab === tab ? styles.active : ''}`}
              onClick={() => handleTabClick(tab)}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
        <button className={styles.collapseButton} onClick={onToggle} title="折叠面板">
          ▶
        </button>
      </div>
      <div className={styles.panelContent}>
        {activeTab === 'storyline' && (
          <StorylineView
            content={content}
            onScrollToLine={onScrollToLine}
            onReplaceLineText={onReplaceLineText}
            folderPath={folderPath}
            dbReady={dbReady}
          />
        )}
        {activeTab === 'characters' && <CharactersView folderPath={folderPath} content={content} />}
        {activeTab === 'lore' && <LoreView folderPath={folderPath} content={content} />}
      </div>
    </div>
  );
};

export default RightPanel;
