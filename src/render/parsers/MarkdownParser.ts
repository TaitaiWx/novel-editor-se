import { BaseParser } from './BaseParser';
import type { OutlineItem } from './types';

/**
 * Markdown 文档解析器
 * 支持解析 Markdown 的标题、列表等结构
 */
export class MarkdownParser extends BaseParser {
  getSupportedExtensions(): string[] {
    return ['md', 'markdown', 'mdown'];
  }

  getParserName(): string {
    return 'Markdown';
  }

  parse(content: string): OutlineItem[] {
    const lines = content.split('\n');
    const outline: OutlineItem[] = [];

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      const trimmedLine = line.trim();

      // 解析标题 (# ## ### 等)
      const headingMatch = trimmedLine.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const title = this.cleanTitle(headingMatch[2]);
        const positions = this.calculatePositions(content, lineNumber, line);

        outline.push({
          id: this.generateId('heading', lineNumber),
          title,
          level,
          lineNumber,
          type: 'heading',
          startPos: positions.startPos,
          endPos: positions.endPos,
        });
      }

      // 解析有序列表
      const orderedListMatch = trimmedLine.match(/^(\s*)(\d+)\.\s+(.+)$/);
      if (orderedListMatch) {
        const indentLevel = Math.floor(orderedListMatch[1].length / 2);
        const title = orderedListMatch[3].trim();
        const positions = this.calculatePositions(content, lineNumber, line);

        outline.push({
          id: this.generateId('list', lineNumber),
          title: `${orderedListMatch[2]}. ${title}`,
          level: indentLevel + 1,
          lineNumber,
          type: 'list',
          startPos: positions.startPos,
          endPos: positions.endPos,
        });
      }

      // 解析无序列表
      const unorderedListMatch = trimmedLine.match(/^(\s*)([-*+])\s+(.+)$/);
      if (unorderedListMatch) {
        const indentLevel = Math.floor(unorderedListMatch[1].length / 2);
        const title = unorderedListMatch[3].trim();
        const positions = this.calculatePositions(content, lineNumber, line);

        outline.push({
          id: this.generateId('list', lineNumber),
          title: `${unorderedListMatch[2]} ${title}`,
          level: indentLevel + 1,
          lineNumber,
          type: 'list',
          startPos: positions.startPos,
          endPos: positions.endPos,
        });
      }

      // 解析任务列表
      const taskListMatch = trimmedLine.match(/^(\s*)([-*+])\s+\[([ xX])\]\s+(.+)$/);
      if (taskListMatch) {
        const indentLevel = Math.floor(taskListMatch[1].length / 2);
        const isCompleted = taskListMatch[3].toLowerCase() === 'x';
        const title = taskListMatch[4].trim();
        const positions = this.calculatePositions(content, lineNumber, line);

        outline.push({
          id: this.generateId('list', lineNumber),
          title: `${taskListMatch[2]} [${isCompleted ? 'x' : ' '}] ${title}`,
          level: indentLevel + 1,
          lineNumber,
          type: 'list',
          startPos: positions.startPos,
          endPos: positions.endPos,
        });
      }
    });

    return this.buildHierarchy(outline);
  }
} 