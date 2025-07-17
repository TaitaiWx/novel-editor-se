import React from 'react';
import OutlineItem from './OutlineItem';
import styles from './styles.module.scss';
import type { OutlineItem as OutlineItemType } from '../../parsers/types';

interface OutlineTreeProps {
  items: OutlineItemType[];
  currentLine: number;
  onNavigateToLine: (lineNumber: number) => void;
  documentContent?: string;
  filePath?: string;
}

const OutlineTree: React.FC<OutlineTreeProps> = ({ 
  items, 
  currentLine, 
  onNavigateToLine, 
  documentContent, 
  filePath 
}) => {
  if (items.length === 0) {
    return (
      <div className={styles.emptyTree}>
        <div className={styles.emptyMessage}>暂无大纲内容</div>
      </div>
    );
  }

  return (
    <div className={styles.outlineTree}>
      {items.map((item) => (
        <OutlineItem
          key={item.id}
          item={item}
          currentLine={currentLine}
          onNavigateToLine={onNavigateToLine}
          documentContent={documentContent}
          filePath={filePath}
        />
      ))}
    </div>
  );
};

export default OutlineTree; 