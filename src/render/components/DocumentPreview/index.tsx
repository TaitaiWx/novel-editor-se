import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { OutlineItem } from '../../parsers/types';
import {
  PreviewManager,
  PreviewAnimationState,
  type PreviewDataWithState,
} from '../../constants/PreviewManager';
import styles from './styles.module.scss';

// 全局预览窗组件
const GlobalPreviewWindow: React.FC = () => {
  const [preview, setPreview] = useState<PreviewDataWithState | null>(null);
  const [previewWidth, setPreviewWidth] = useState<number>(300);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const manager = PreviewManager.getInstance();
    const unsubscribe = manager.subscribe((currentPreview) => {
      setPreview(currentPreview);
      if (currentPreview) {
        setPreviewContent('');
        setIsLoading(true);
        generatePreview(currentPreview.content, currentPreview.item, currentPreview.filePath);
      }
    });

    return unsubscribe;
  }, []);

  const generatePreview = async (content: string, item: OutlineItem, filePath: string) => {
    try {
      setIsLoading(true);

      // 动态导入预览器系统
      const { PreviewFactory } = await import('../../parsers');
      const preview = PreviewFactory.getPreview(filePath);

      const result = preview.generatePreview(content, item);
      setPreviewContent(result);

      // 计算预览窗口宽度
      calculatePreviewWidth(result);
    } catch (error) {
      console.error('Failed to generate preview:', error);
      setPreviewContent('预览生成失败');
    } finally {
      setIsLoading(false);
    }
  };

  // 计算预览窗口宽度
  const calculatePreviewWidth = (text: string) => {
    const lines = text.split('\n');
    const maxLineLength = Math.max(...lines.map((line) => line.length));

    // 基于字符数计算宽度，每个字符约8px，加上padding和边框
    const charWidth = 8;
    const padding = 24; // 左右padding各12px
    const border = 4; // 左右边框各2px
    const minWidth = 300;
    const maxWidth = 600;

    const calculatedWidth = Math.max(
      minWidth,
      Math.min(maxWidth, maxLineLength * charWidth + padding + border)
    );
    setPreviewWidth(calculatedWidth);
  };

  if (!preview) return null;

  // 计算预览窗口位置 - 基于鼠标位置和大纲面板位置
  const calculatePosition = () => {
    const previewHeight = 400;
    const outlinePanelWidth = 320; // 大纲面板宽度
    const margin = 10;

    // 大纲面板在右侧
    const outlinePanelX = window.innerWidth - outlinePanelWidth;

    // 基于鼠标位置计算预览窗位置
    let x = Math.max(margin, outlinePanelX - previewWidth - margin);
    let y = preview.position.y;

    // 确保不超出屏幕边界
    if (y + previewHeight > window.innerHeight) {
      y = Math.max(margin, window.innerHeight - previewHeight - margin);
    }

    // 确保预览窗不会超出左边界
    if (x < margin) {
      // 如果预览窗太宽，显示在大纲面板的右侧
      x = outlinePanelX + margin;
    }

    // 确保预览窗不会超出上边界
    if (y < margin) {
      y = margin;
    }

    // 如果预览窗仍然超出右边界，调整到大纲面板左侧
    if (x + previewWidth > outlinePanelX - margin) {
      x = Math.max(margin, outlinePanelX - previewWidth - margin);
    }

    return { x, y };
  };

  // 根据动画状态确定CSS类名
  const getAnimationClass = () => {
    switch (preview.animationState) {
      case PreviewAnimationState.SHOWING:
        return styles.showing;
      case PreviewAnimationState.HIDING:
        return styles.hiding;
      case PreviewAnimationState.TRANSITIONING:
        return styles.transitioning;
      case PreviewAnimationState.VISIBLE:
      default:
        return styles.visible;
    }
  };

  const previewElement = (
    <div
      className={`${styles.previewWindow} ${getAnimationClass()}`}
      data-preview-window="true"
      // eslint-disable-next-line
      style={{
        left: `${calculatePosition().x}px`,
        top: `${calculatePosition().y}px`,
        width: `${previewWidth}px`,
      }}
    >
      <div className={styles.previewWindowHeader}>
        <span className={styles.previewWindowTitle}>
          {preview.item.title} (行 {preview.item.lineNumber})
        </span>
      </div>

      <div className={styles.previewWindowContent}>
        {isLoading ? (
          <div className={styles.loadingContainer}>
            <div className={styles.loadingIcon}>⏳</div>
            <div className={styles.loadingText}>生成预览中...</div>
          </div>
        ) : (
          <pre className={styles.previewTextContent}>{previewContent}</pre>
        )}
      </div>

      <div className={styles.previewWindowFooter}>
        {preview.filePath.split('/').pop() || preview.filePath}
      </div>
    </div>
  );

  return createPortal(previewElement, document.body);
};

// 导出全局预览窗组件和管理器
export { GlobalPreviewWindow, PreviewManager };
