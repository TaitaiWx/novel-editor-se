import { BasePreview } from './BasePreview';
import type { OutlineItem } from './types';

/**
 * 代码文件预览器
 * 提供代码文件的预览功能
 */
export class CodePreview extends BasePreview {
  getSupportedExtensions(): string[] {
    return ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'go', 'rs', 'php', 'rb'];
  }

  getPreviewName(): string {
    return 'Code';
  }

  generatePreview(content: string, item: OutlineItem): string {
    // 获取上下文内容
    let preview = this.getPreviewContext(content, item, 3);
    
    // 高亮目标行
    preview = this.highlightTargetLine(preview, item);
    
    // 清理内容
    preview = this.cleanPreviewContent(preview);
    
    // 格式化代码预览
    preview = this.formatCodePreview(preview, item);
    
    // 截断过长内容
    preview = this.truncatePreview(preview, 600);
    
    return preview;
  }

  /**
   * 格式化代码预览内容
   */
  private formatCodePreview(content: string, item: OutlineItem): string {
    const lines = content.split('\n');
    const formattedLines = lines.map((line, index) => {
      const lineNumber = index + 1;
      const isTargetLine = line.includes('>>>') && line.includes('<<<');
      
      // 移除高亮标记并添加行号
      const cleanLine = line.replace(/^>>>\s*/, '').replace(/\s*<<<$/, '');
      
      if (isTargetLine) {
        return `\x1b[1;36m${lineNumber.toString().padStart(3)}: ${cleanLine}\x1b[0m`;
      } else {
        return `${lineNumber.toString().padStart(3)}: ${cleanLine}`;
      }
    });
    
    return formattedLines.join('\n');
  }

  /**
   * 获取函数或类的完整定义
   */
  private getCompleteDefinition(content: string, item: OutlineItem): string {
    const lines = content.split('\n');
    const startLine = item.lineNumber - 1;
    
    // 查找函数或类的结束位置
    let endLine = startLine;
    let braceCount = 0;
    let inString = false;
    let stringChar = '';
    
    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        
        // 处理字符串
        if ((char === '"' || char === "'") && !inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar && inString) {
          inString = false;
          stringChar = '';
        }
        
        // 只在不在字符串内时计算括号
        if (!inString) {
          if (char === '{') {
            braceCount++;
          } else if (char === '}') {
            braceCount--;
            if (braceCount === 0) {
              endLine = i;
              break;
            }
          }
        }
      }
      
      if (braceCount === 0 && i > startLine) {
        break;
      }
    }
    
    // 返回完整的定义
    return lines.slice(startLine, endLine + 1).join('\n');
  }
} 