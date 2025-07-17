import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { OutlineItem } from '../../parsers/types';

interface DocumentPreviewProps {
  content: string;
  item: OutlineItem;
  filePath: string;
  position: { x: number; y: number };
  onClose: () => void;
}

// 全局预览窗管理器
class PreviewManager {
  private static instance: PreviewManager;
  private currentPreview: {
    content: string;
    item: OutlineItem;
    filePath: string;
    position: { x: number; y: number };
  } | null = null;
  private listeners: Set<(preview: any) => void> = new Set();

  static getInstance(): PreviewManager {
    if (!PreviewManager.instance) {
      PreviewManager.instance = new PreviewManager();
    }
    return PreviewManager.instance;
  }

  showPreview(content: string, item: OutlineItem, filePath: string, position: { x: number; y: number }) {
    this.currentPreview = { content, item, filePath, position };
    this.notifyListeners();
  }

  hidePreview() {
    this.currentPreview = null;
    this.notifyListeners();
  }

  updatePosition(position: { x: number; y: number }) {
    if (this.currentPreview) {
      this.currentPreview.position = position;
      this.notifyListeners();
    }
  }

  getCurrentPreview() {
    return this.currentPreview;
  }

  subscribe(listener: (preview: any) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener(this.currentPreview));
  }
}

// 全局预览窗组件
const GlobalPreviewWindow: React.FC = () => {
  const [preview, setPreview] = useState<any>(null);
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
    const maxLineLength = Math.max(...lines.map(line => line.length));
    
    // 基于字符数计算宽度，每个字符约8px，加上padding和边框
    const charWidth = 8;
    const padding = 24; // 左右padding各12px
    const border = 4; // 左右边框各2px
    const minWidth = 300;
    const maxWidth = 600;
    
    const calculatedWidth = Math.max(minWidth, Math.min(maxWidth, maxLineLength * charWidth + padding + border));
    setPreviewWidth(calculatedWidth);
  };

  // 计算预览窗口位置 - 避开大纲视图
  const previewPosition = (() => {
    if (!preview) return { x: 0, y: 0 };
    
    const previewHeight = 400;
    const outlinePanelWidth = 320; // 大纲面板宽度
    const margin = 10;
    
    // 大纲面板在右侧，预览窗显示在大纲面板的左侧
    const outlinePanelX = window.innerWidth - outlinePanelWidth;
    
    // 预览窗显示在大纲面板的左侧，与大纲面板有一定间距
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
  })();

  if (!preview) return null;

  const previewElement = (
    <div
      style={{
        left: previewPosition.x,
        top: previewPosition.y,
        position: 'fixed',
        zIndex: 9999999,
        backgroundColor: '#1e1e1e',
        border: '2px solid #007acc',
        borderRadius: '4px',
        padding: '12px',
        width: `${previewWidth}px`,
        height: '400px',
        overflow: 'hidden',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.8)',
        display: 'block',
        visibility: 'visible',
        opacity: 1,
        pointerEvents: 'none',
        transform: 'none',
      }}
    >
      <div style={{ 
        display: 'flex', 
        alignItems: 'center',
        marginBottom: '8px',
        paddingBottom: '8px',
        borderBottom: '1px solid #404040',
        pointerEvents: 'none'
      }}>
        <span style={{ color: '#d4d4d4', fontWeight: 'bold', fontSize: '14px' }}>
          {preview.item.title} (行 {preview.item.lineNumber})
        </span>
      </div>
      
      <div style={{ 
        color: '#d4d4d4', 
        fontSize: '13px', 
        lineHeight: '1.5',
        height: '340px',
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        pointerEvents: 'none'
      }}>
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <div style={{ fontSize: '20px', marginBottom: '8px' }}>⏳</div>
            <div>生成预览中...</div>
          </div>
        ) : (
          <pre style={{ 
            margin: 0, 
            whiteSpace: 'pre-wrap', 
            wordWrap: 'break-word',
            fontFamily: 'monospace',
            fontSize: '12px',
            lineHeight: '1.4',
            flex: 1,
            overflow: 'auto'
          }}>
            {previewContent}
          </pre>
        )}
      </div>
      
      <div style={{ 
        marginTop: '8px', 
        paddingTop: '8px', 
        borderTop: '1px solid #404040',
        fontSize: '11px',
        color: '#888',
        textAlign: 'right',
        pointerEvents: 'none'
      }}>
        {preview.filePath.split('/').pop() || preview.filePath}
      </div>
    </div>
  );

  return createPortal(previewElement, document.body);
};

// 导出全局预览窗组件和管理器
export { GlobalPreviewWindow, PreviewManager };

// 保持原有接口兼容性
const DocumentPreview: React.FC<DocumentPreviewProps> = ({
  content,
  item,
  filePath,
  position,
  onClose,
}) => {
  // 使用全局管理器
  useEffect(() => {
    const manager = PreviewManager.getInstance();
    manager.showPreview(content, item, filePath, position);
    
    return () => {
      manager.hidePreview();
    };
  }, [content, item, filePath, position]);

  // 监听鼠标移动更新位置
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const manager = PreviewManager.getInstance();
      manager.updatePosition({ x: e.clientX, y: e.clientY });
    };

    document.addEventListener('mousemove', handleMouseMove);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  // 这个组件不再渲染任何内容，由全局组件处理
  return null;
};

export default DocumentPreview; 