import { BasePreview } from './BasePreview';
import type { OutlineItem } from './types';

/**
 * Markdown 文档预览器
 * 提供 Markdown 文档的预览功能
 */
export class MarkdownPreview extends BasePreview {
  getSupportedExtensions(): string[] {
    return ['md', 'markdown', 'mdown'];
  }

  getPreviewName(): string {
    return 'Markdown';
  }

  generatePreview(content: string, item: OutlineItem): string {
    // 获取上下文内容
    let preview = this.getPreviewContext(content, item, 2);
    
    // 高亮目标行
    preview = this.highlightTargetLine(preview, item);
    
    // 清理内容
    preview = this.cleanPreviewContent(preview);
    
    // 截断过长内容
    preview = this.truncatePreview(preview, 400);
    
    return preview;
  }

  /**
   * 格式化 Markdown 预览内容
   */
  private formatMarkdownPreview(content: string): string {
    return content
      // 简化标题显示
      .replace(/^(#{1,6})\s+(.+)$/gm, (match, hashes, title) => {
        const level = hashes.length;
        const indent = '  '.repeat(level - 1);
        return `${indent}📖 ${title}`;
      })
      // 简化列表显示
      .replace(/^(\s*)([-*+])\s+(.+)$/gm, (match, spaces, marker, text) => {
        const indent = '  '.repeat(Math.floor(spaces.length / 2));
        return `${indent}📋 ${text}`;
      })
      // 简化代码块
      .replace(/```[\s\S]*?```/g, '```代码块```')
      // 简化行内代码
      .replace(/`([^`]+)`/g, '`$1`')
      // 简化链接
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // 简化粗体
      .replace(/\*\*([^*]+)\*\*/g, '**$1**')
      // 简化斜体
      .replace(/\*([^*]+)\*/g, '*$1*');
  }
} 