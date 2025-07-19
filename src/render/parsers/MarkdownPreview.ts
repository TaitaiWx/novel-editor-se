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
}
