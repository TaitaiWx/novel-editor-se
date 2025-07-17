import type { OutlineItem, DocumentPreview } from './types';

/**
 * 基础预览器类
 * 提供通用的预览功能和工具方法
 */
export abstract class BasePreview implements DocumentPreview {
  abstract getSupportedExtensions(): string[];
  abstract getPreviewName(): string;
  abstract generatePreview(content: string, item: OutlineItem): string;

  /**
   * 获取预览内容的上下文
   */
  protected getPreviewContext(content: string, item: OutlineItem, contextLines: number = 3): string {
    const lines = content.split('\n');
    const startLine = Math.max(0, item.lineNumber - contextLines - 1);
    const endLine = Math.min(lines.length, item.lineNumber + contextLines);
    
    const previewLines = lines.slice(startLine, endLine);
    return previewLines.join('\n');
  }

  /**
   * 高亮目标行
   */
  protected highlightTargetLine(content: string, item: OutlineItem): string {
    const lines = content.split('\n');
    const targetLineIndex = item.lineNumber - 1;
    
    if (targetLineIndex >= 0 && targetLineIndex < lines.length) {
      lines[targetLineIndex] = `>>> ${lines[targetLineIndex]} <<<`;
    }
    
    return lines.join('\n');
  }

  /**
   * 截断过长的预览内容
   */
  protected truncatePreview(content: string, maxLength: number = 500): string {
    if (content.length <= maxLength) {
      return content;
    }
    
    const truncated = content.substring(0, maxLength);
    const lastNewline = truncated.lastIndexOf('\n');
    
    if (lastNewline > 0) {
      return truncated.substring(0, lastNewline) + '\n...';
    }
    
    return truncated + '...';
  }

  /**
   * 清理预览内容
   */
  protected cleanPreviewContent(content: string): string {
    return content
      .replace(/\r\n/g, '\n')  // 统一换行符
      .replace(/\t/g, '  ')    // 替换制表符
      .trim();                 // 去除首尾空白
  }
} 