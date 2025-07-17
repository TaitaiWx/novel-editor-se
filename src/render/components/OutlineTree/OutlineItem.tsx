import React, { useState } from 'react';
import { IoChevronForward, IoChevronDown } from 'react-icons/io5';
import styles from './styles.module.scss';
import DocumentPreview from '../DocumentPreview';
import type { OutlineItem as OutlineItemType } from '../../parsers/types';

interface OutlineItemProps {
  item: OutlineItemType;
  currentLine: number;
  onNavigateToLine: (lineNumber: number) => void;
  documentContent?: string;
  filePath?: string;
}

const OutlineItem: React.FC<OutlineItemProps> = ({ 
  item, 
  currentLine, 
  onNavigateToLine, 
  documentContent, 
  filePath 
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [previewPosition, setPreviewPosition] = useState({ x: 0, y: 0 });
  const hasChildren = item.children && item.children.length > 0;
  const isActive = item.lineNumber === currentLine;

  const handleClick = () => {
    onNavigateToLine(item.lineNumber);
  };

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  const handleMouseEnter = (e: React.MouseEvent) => {
    if (documentContent && filePath) {
      setPreviewPosition({ x: e.clientX, y: e.clientY });
      setShowPreview(true);
    }
  };

  const handleMouseLeave = () => {
    setShowPreview(false);
  };

  const getItemIcon = () => {
    switch (item.type) {
      case 'heading':
        return '📖';
      case 'function':
        return '⚡';
      case 'class':
        return '🏗️';
      case 'comment':
        return '💬';
      case 'chapter':
        return '📚';
      case 'paragraph':
        return '📝';
      case 'list':
        return '📋';
      default:
        return '📄';
    }
  };

  return (
    <div className={styles.outlineItem}>
      <div
        className={`${styles.itemContent} ${isActive ? styles.active : ''}`}
        style={{ paddingLeft: `${8 + (item.level - 1) * 16}px` }}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {hasChildren && (
          <button
            className={styles.expandButton}
            onClick={handleToggleExpand}
            title={isExpanded ? '折叠' : '展开'}
          >
            {isExpanded ? <IoChevronDown size={12} /> : <IoChevronForward size={12} />}
          </button>
        )}
        
        {!hasChildren && <div className={styles.expandPlaceholder} />}
        
        <span className={styles.itemIcon}>{getItemIcon()}</span>
        
        <span className={styles.itemTitle} title={item.title}>
          {item.title}
        </span>
        
        <span className={styles.itemLine}>{item.lineNumber}</span>
      </div>
      
      {hasChildren && isExpanded && (
        <div className={styles.itemChildren}>
          {item.children!.map((child) => (
            <OutlineItem
              key={child.id}
              item={child}
              currentLine={currentLine}
              onNavigateToLine={onNavigateToLine}
            />
          ))}
        </div>
      )}
      
      {showPreview && documentContent && filePath && (
        <DocumentPreview
          content={documentContent}
          item={item}
          filePath={filePath}
          position={previewPosition}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  );
};

export default OutlineItem; 