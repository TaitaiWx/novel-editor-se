import { BaseParser } from './BaseParser';
import type { OutlineItem } from './types';

/**
 * 代码文件解析器
 * 支持解析 JavaScript、TypeScript、Python 等代码文件
 */
export class CodeParser extends BaseParser {
  getSupportedExtensions(): string[] {
    return ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'go', 'rs', 'php', 'rb'];
  }

  getParserName(): string {
    return 'Code';
  }

  parse(content: string): OutlineItem[] {
    const lines = content.split('\n');
    const outline: OutlineItem[] = [];

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      const trimmedLine = line.trim();

      // 解析函数定义
      const functionMatch = this.parseFunction(trimmedLine, lineNumber, line, content);
      if (functionMatch) {
        outline.push(functionMatch);
      }

      // 解析类定义
      const classMatch = this.parseClass(trimmedLine, lineNumber, line, content);
      if (classMatch) {
        outline.push(classMatch);
      }

      // 解析注释块
      const commentMatch = this.parseComment(trimmedLine, lineNumber, line, content);
      if (commentMatch) {
        outline.push(commentMatch);
      }

      // 解析导入语句
      const importMatch = this.parseImport(trimmedLine, lineNumber, line, content);
      if (importMatch) {
        outline.push(importMatch);
      }
    });

    return this.buildHierarchy(outline);
  }

  /**
   * 解析函数定义
   */
  private parseFunction(line: string, lineNumber: number, originalLine: string, content: string): OutlineItem | null {
    // JavaScript/TypeScript 函数
    const jsFunctionMatch = line.match(/^(?:export\s+)?(?:async\s+)?(?:function\s+)?(\w+)\s*\(/);
    if (jsFunctionMatch) {
      const positions = this.calculatePositions(content, lineNumber, originalLine);
      return {
        id: this.generateId('function', lineNumber),
        title: `function ${jsFunctionMatch[1]}`,
        level: 1,
        lineNumber,
        type: 'function',
        startPos: positions.startPos,
        endPos: positions.endPos,
        metadata: {
          language: 'javascript',
          parameters: this.extractParameters(line),
        }
      };
    }

    // Python 函数
    const pyFunctionMatch = line.match(/^def\s+(\w+)\s*\(/);
    if (pyFunctionMatch) {
      const positions = this.calculatePositions(content, lineNumber, originalLine);
      return {
        id: this.generateId('function', lineNumber),
        title: `def ${pyFunctionMatch[1]}`,
        level: 1,
        lineNumber,
        type: 'function',
        startPos: positions.startPos,
        endPos: positions.endPos,
        metadata: {
          language: 'python',
          parameters: this.extractParameters(line),
        }
      };
    }

    return null;
  }

  /**
   * 解析类定义
   */
  private parseClass(line: string, lineNumber: number, originalLine: string, content: string): OutlineItem | null {
    // JavaScript/TypeScript 类
    const jsClassMatch = line.match(/^(?:export\s+)?class\s+(\w+)/);
    if (jsClassMatch) {
      const positions = this.calculatePositions(content, lineNumber, originalLine);
      return {
        id: this.generateId('class', lineNumber),
        title: `class ${jsClassMatch[1]}`,
        level: 1,
        lineNumber,
        type: 'class',
        startPos: positions.startPos,
        endPos: positions.endPos,
        metadata: {
          language: 'javascript',
        }
      };
    }

    // Python 类
    const pyClassMatch = line.match(/^class\s+(\w+)/);
    if (pyClassMatch) {
      const positions = this.calculatePositions(content, lineNumber, originalLine);
      return {
        id: this.generateId('class', lineNumber),
        title: `class ${pyClassMatch[1]}`,
        level: 1,
        lineNumber,
        type: 'class',
        startPos: positions.startPos,
        endPos: positions.endPos,
        metadata: {
          language: 'python',
        }
      };
    }

    return null;
  }

  /**
   * 解析注释块
   */
  private parseComment(line: string, lineNumber: number, originalLine: string, content: string): OutlineItem | null {
    // JSDoc 注释
    const jsDocMatch = line.match(/^\/\*\*?\s*(.+)$/);
    if (jsDocMatch) {
      const positions = this.calculatePositions(content, lineNumber, originalLine);
      return {
        id: this.generateId('comment', lineNumber),
        title: jsDocMatch[1].trim(),
        level: 2,
        lineNumber,
        type: 'comment',
        startPos: positions.startPos,
        endPos: positions.endPos,
        metadata: {
          language: 'javascript',
        }
      };
    }

    // Python docstring
    const pyDocMatch = line.match(/^"""(.*?)"""/);
    if (pyDocMatch) {
      const positions = this.calculatePositions(content, lineNumber, originalLine);
      return {
        id: this.generateId('comment', lineNumber),
        title: pyDocMatch[1].trim() || 'docstring',
        level: 2,
        lineNumber,
        type: 'comment',
        startPos: positions.startPos,
        endPos: positions.endPos,
        metadata: {
          language: 'python',
        }
      };
    }

    return null;
  }

  /**
   * 解析导入语句
   */
  private parseImport(line: string, lineNumber: number, originalLine: string, content: string): OutlineItem | null {
    // JavaScript/TypeScript import
    const jsImportMatch = line.match(/^import\s+(.+?)\s+from\s+['"](.+?)['"]/);
    if (jsImportMatch) {
      const positions = this.calculatePositions(content, lineNumber, originalLine);
      return {
        id: this.generateId('import', lineNumber),
        title: `import ${jsImportMatch[1]} from '${jsImportMatch[2]}'`,
        level: 1,
        lineNumber,
        type: 'comment',
        startPos: positions.startPos,
        endPos: positions.endPos,
        metadata: {
          language: 'javascript',
        }
      };
    }

    // Python import
    const pyImportMatch = line.match(/^import\s+(.+)/);
    if (pyImportMatch) {
      const positions = this.calculatePositions(content, lineNumber, originalLine);
      return {
        id: this.generateId('import', lineNumber),
        title: `import ${pyImportMatch[1]}`,
        level: 1,
        lineNumber,
        type: 'comment',
        startPos: positions.startPos,
        endPos: positions.endPos,
        metadata: {
          language: 'python',
        }
      };
    }

    return null;
  }

  /**
   * 提取函数参数
   */
  private extractParameters(line: string): string[] {
    const paramMatch = line.match(/\(([^)]*)\)/);
    if (!paramMatch) return [];

    return paramMatch[1]
      .split(',')
      .map(param => param.trim())
      .filter(param => param.length > 0);
  }
} 