import type { DocumentPreview } from './types';

/**
 * 预览器工厂类
 * 负责管理和选择适合的文档预览器
 */
export class PreviewFactory {
  private static previews: Map<string, DocumentPreview> = new Map();

  /**
   * 注册预览器
   */
  static registerPreview(preview: DocumentPreview): void {
    preview.getSupportedExtensions().forEach(ext => {
      this.previews.set(ext, preview);
    });
  }

  /**
   * 根据文件路径获取预览器
   */
  static getPreview(filePath: string): DocumentPreview {
    const ext = this.getFileExtension(filePath);
    const preview = this.previews.get(ext);
    
    if (!preview) {
      // 如果没有找到对应的预览器，返回文本预览器作为默认
      return this.previews.get('txt') || this.getDefaultPreview();
    }
    
    return preview;
  }

  /**
   * 获取支持的文件类型列表
   */
  static getSupportedTypes(): string[] {
    return Array.from(this.previews.keys());
  }

  /**
   * 检查文件类型是否被支持
   */
  static isSupported(filePath: string): boolean {
    const ext = this.getFileExtension(filePath);
    return this.previews.has(ext);
  }

  /**
   * 获取所有注册的预览器
   */
  static getAllPreviews(): DocumentPreview[] {
    const uniquePreviews = new Set<DocumentPreview>();
    this.previews.forEach(preview => uniquePreviews.add(preview));
    return Array.from(uniquePreviews);
  }

  /**
   * 从文件路径中提取扩展名
   */
  private static getFileExtension(filePath: string): string {
    if (!filePath) return '';
    
    const lastDotIndex = filePath.lastIndexOf('.');
    if (lastDotIndex === -1) return '';
    
    return filePath.substring(lastDotIndex + 1).toLowerCase();
  }

  /**
   * 获取默认预览器（文本预览器）
   */
  private static getDefaultPreview(): DocumentPreview {
    // 返回一个简单的文本预览器作为默认
    return {
      generatePreview: (content: string, item: any) => {
        const lines = content.split('\n');
        const startLine = Math.max(0, item.lineNumber - 2);
        const endLine = Math.min(lines.length, item.lineNumber + 2);
        return lines.slice(startLine, endLine).join('\n');
      },
      getSupportedExtensions: () => ['txt'],
      getPreviewName: () => 'Text'
    };
  }
} 