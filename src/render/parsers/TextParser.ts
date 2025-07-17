import { BaseParser } from './BaseParser';
import type { OutlineItem } from './types';

/**
 * 文本文件解析器
 * 支持解析纯文本文件，识别段落和章节
 */
export class TextParser extends BaseParser {
  getSupportedExtensions(): string[] {
    return ['txt', 'log', 'md', 'rst', 'adoc'];
  }

  getParserName(): string {
    return 'Text';
  }

  parse(content: string): OutlineItem[] {
    const lines = content.split('\n');
    const outline: OutlineItem[] = [];

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      const trimmedLine = line.trim();

      // 跳过空行
      if (!trimmedLine) return;

      // 解析章节标题（大写字母开头的行）
      const chapterMatch = this.parseChapter(trimmedLine, lineNumber, line, content);
      if (chapterMatch) {
        outline.push(chapterMatch);
      }

      // 解析段落标题（以数字开头的行）
      const sectionMatch = this.parseSection(trimmedLine, lineNumber, line, content);
      if (sectionMatch) {
        outline.push(sectionMatch);
      }

      // 解析重要段落（以特殊字符开头的行）
      const paragraphMatch = this.parseParagraph(trimmedLine, lineNumber, line, content);
      if (paragraphMatch) {
        outline.push(paragraphMatch);
      }
    });

    return this.buildHierarchy(outline);
  }

  /**
   * 解析章节标题
   */
  private parseChapter(line: string, lineNumber: number, originalLine: string, content: string): OutlineItem | null {
    // 大写字母开头的行，长度适中
    const chapterMatch = line.match(/^[A-Z][A-Z\s]{3,50}$/);
    if (chapterMatch) {
      const positions = this.calculatePositions(content, lineNumber, originalLine);
      return {
        id: this.generateId('chapter', lineNumber),
        title: line,
        level: 1,
        lineNumber,
        type: 'heading',
        startPos: positions.startPos,
        endPos: positions.endPos,
        metadata: {
          language: 'text',
        }
      };
    }

    return null;
  }

  /**
   * 解析段落标题
   */
  private parseSection(line: string, lineNumber: number, originalLine: string, content: string): OutlineItem | null {
    // 以数字开头的行
    const sectionMatch = line.match(/^\d+\.?\s+(.+)$/);
    if (sectionMatch) {
      const positions = this.calculatePositions(content, lineNumber, originalLine);
      return {
        id: this.generateId('section', lineNumber),
        title: sectionMatch[1],
        level: 2,
        lineNumber,
        type: 'heading',
        startPos: positions.startPos,
        endPos: positions.endPos,
        metadata: {
          language: 'text',
        }
      };
    }

    return null;
  }

  /**
   * 解析重要段落
   */
  private parseParagraph(line: string, lineNumber: number, originalLine: string, content: string): OutlineItem | null {
    // 以特殊字符开头的行
    const paragraphMatch = line.match(/^[•\-*]\s+(.+)$/);
    if (paragraphMatch) {
      const positions = this.calculatePositions(content, lineNumber, originalLine);
      return {
        id: this.generateId('paragraph', lineNumber),
        title: paragraphMatch[1].substring(0, 50) + (paragraphMatch[1].length > 50 ? '...' : ''),
        level: 3,
        lineNumber,
        type: 'paragraph',
        startPos: positions.startPos,
        endPos: positions.endPos,
        metadata: {
          language: 'text',
        }
      };
    }

    // 以大写字母开头的短句
    const shortMatch = line.match(/^[A-Z][a-z\s]{10,30}$/);
    if (shortMatch) {
      const positions = this.calculatePositions(content, lineNumber, originalLine);
      return {
        id: this.generateId('paragraph', lineNumber),
        title: line,
        level: 3,
        lineNumber,
        type: 'paragraph',
        startPos: positions.startPos,
        endPos: positions.endPos,
        metadata: {
          language: 'text',
        }
      };
    }

    return null;
  }
} 