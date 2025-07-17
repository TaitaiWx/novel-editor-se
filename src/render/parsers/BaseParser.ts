import type { OutlineItem, DocumentParser } from './types';

/**
 * 基础解析器类
 * 提供通用的解析功能和工具方法
 */
export abstract class BaseParser implements DocumentParser {
  abstract getSupportedExtensions(): string[];
  abstract getParserName(): string;
  abstract parse(content: string): OutlineItem[];

  /**
   * 构建大纲层级关系
   */
  protected buildHierarchy(items: OutlineItem[]): OutlineItem[] {
    const result: OutlineItem[] = [];
    const stack: OutlineItem[] = [];

    items.forEach(item => {
      // 找到合适的父级
      while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
        stack.pop();
      }

      if (stack.length === 0) {
        // 顶级项目
        result.push(item);
      } else {
        // 添加到父级的子项中
        const parent = stack[stack.length - 1];
        if (!parent.children) {
          parent.children = [];
        }
        parent.children.push(item);
      }

      stack.push(item);
    });

    return result;
  }

  /**
   * 计算文本在文档中的位置
   */
  protected calculatePositions(content: string, lineNumber: number, lineText: string): { startPos: number; endPos: number } {
    const lines = content.split('\n');
    let startPos = 0;

    // 计算到当前行的字符数
    for (let i = 0; i < lineNumber - 1; i++) {
      startPos += lines[i].length + 1; // +1 for newline
    }

    const endPos = startPos + lineText.length;
    return { startPos, endPos };
  }

  /**
   * 生成唯一ID
   */
  protected generateId(type: string, lineNumber: number): string {
    return `${type}-${lineNumber}-${Date.now()}`;
  }

  /**
   * 清理标题文本
   */
  protected cleanTitle(title: string): string {
    return title.trim().replace(/^[#\s]+/, '');
  }
} 