import React, { useState, useEffect } from 'react';
import { IoChevronForward, IoChevronDown } from 'react-icons/io5';
import styles from './styles.module.scss';
import { PreviewManager } from '../../constants/PreviewManager';
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
  filePath,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  // 清理预览
  useEffect(() => {
    return () => {
      // 组件卸载时隐藏预览
      const manager = PreviewManager.getInstance();
      manager.hidePreview();
    };
  }, []);
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
      // 立即显示预览，PreviewManager 会处理所有动画逻辑
      const manager = PreviewManager.getInstance();
      manager.showPreview(documentContent, item, filePath, { x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseLeave = () => {
    // 隐藏预览，使用动画
    const manager = PreviewManager.getInstance();
    manager.hidePreview();
  };

  const itemIconMap = new Map([
    ['heading', '📖'],
    ['function', '⚡'],
    ['class', '🏗️'],
    ['comment', '💬'],
    ['chapter', '📚'],
    ['paragraph', '📝'],
    ['list', '📋'],
  ]);

  const getItemIcon = () => {
    return itemIconMap.get(item.type) || '📄';
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
              documentContent={documentContent}
              filePath={filePath}
            />
          ))}
        </div>
      )}
    </div>
  );
};
export default OutlineItem;
