import React, { useState, useEffect } from 'react';
import styles from './styles.module.scss';
import type { OutlineItem } from '../../parsers/types';

interface DocumentPreviewProps {
  content: string;
  item: OutlineItem;
  filePath: string;
  position: { x: number; y: number };
  onClose: () => void;
}

const DocumentPreview: React.FC<DocumentPreviewProps> = ({
  content,
  item,
  filePath,
  position,
  onClose,
}) => {
  const [previewContent, setPreviewContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const generatePreview = async () => {
      try {
        setIsLoading(true);
        
        // 动态导入预览器系统
        const { PreviewFactory } = await import('../../parsers');
        const preview = PreviewFactory.getPreview(filePath);
        const result = preview.generatePreview(content, item);
        
        setPreviewContent(result);
      } catch (error) {
        console.error('Failed to generate preview:', error);
        setPreviewContent('预览生成失败');
      } finally {
        setIsLoading(false);
      }
    };

    generatePreview();
  }, [content, item, filePath]);

  // 计算预览窗口位置
  const getPreviewPosition = () => {
    const offset = 10;
    const maxWidth = 400;
    const maxHeight = 300;
    
    let x = position.x + offset;
    let y = position.y + offset;
    
    // 确保预览窗口不超出屏幕边界
    if (x + maxWidth > window.innerWidth) {
      x = position.x - maxWidth - offset;
    }
    
    if (y + maxHeight > window.innerHeight) {
      y = position.y - maxHeight - offset;
    }
    
    return { x: Math.max(0, x), y: Math.max(0, y) };
  };

  const previewPosition = getPreviewPosition();

  if (isLoading) {
    return (
      <div
        className={styles.previewContainer}
        style={{
          left: previewPosition.x,
          top: previewPosition.y,
        }}
      >
        <div className={styles.previewHeader}>
          <span className={styles.previewTitle}>生成预览中...</span>
          <button className={styles.closeButton} onClick={onClose}>
            ×
          </button>
        </div>
        <div className={styles.previewContent}>
          <div className={styles.loadingSpinner}>⏳</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.previewContainer}
      style={{
        left: previewPosition.x,
        top: previewPosition.y,
      }}
    >
      <div className={styles.previewHeader}>
        <span className={styles.previewTitle}>
          {item.title} (行 {item.lineNumber})
        </span>
        <button className={styles.closeButton} onClick={onClose}>
          ×
        </button>
      </div>
      
      <div className={styles.previewContent}>
        <pre className={styles.previewText}>{previewContent}</pre>
      </div>
      
      <div className={styles.previewFooter}>
        <span className={styles.previewInfo}>
          {filePath.split('/').pop() || filePath}
        </span>
      </div>
    </div>
  );
};

export default DocumentPreview; 