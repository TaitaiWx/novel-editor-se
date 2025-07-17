import type { DocumentParser } from './types';

/**
 * 解析器工厂类
 * 负责管理和选择适合的文档解析器
 */
export class ParserFactory {
  private static parsers: Map<string, DocumentParser> = new Map();

  /**
   * 注册解析器
   */
  static registerParser(parser: DocumentParser): void {
    parser.getSupportedExtensions().forEach(ext => {
      this.parsers.set(ext, parser);
    });
  }

  /**
   * 根据文件路径获取解析器
   */
  static getParser(filePath: string): DocumentParser {
    const ext = this.getFileExtension(filePath);
    const parser = this.parsers.get(ext);
    
    if (!parser) {
      // 如果没有找到对应的解析器，返回文本解析器作为默认
      return this.parsers.get('txt') || this.getDefaultParser();
    }
    
    return parser;
  }

  /**
   * 获取支持的文件类型列表
   */
  static getSupportedTypes(): string[] {
    return Array.from(this.parsers.keys());
  }

  /**
   * 检查文件类型是否被支持
   */
  static isSupported(filePath: string): boolean {
    const ext = this.getFileExtension(filePath);
    return this.parsers.has(ext);
  }

  /**
   * 获取所有注册的解析器
   */
  static getAllParsers(): DocumentParser[] {
    const uniqueParsers = new Set<DocumentParser>();
    this.parsers.forEach(parser => uniqueParsers.add(parser));
    return Array.from(uniqueParsers);
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
   * 获取默认解析器（文本解析器）
   */
  private static getDefaultParser(): DocumentParser {
    // 返回一个简单的文本解析器作为默认
    return {
      parse: () => [],
      getSupportedExtensions: () => ['txt'],
      getParserName: () => 'Text'
    };
  }
} 