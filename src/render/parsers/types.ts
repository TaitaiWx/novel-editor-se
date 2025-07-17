/**
 * 解析器系统类型定义
 */

// 大纲项接口
export interface OutlineItem {
  id: string;
  title: string;
  level: number;
  lineNumber: number;
  type: 'heading' | 'function' | 'class' | 'comment' | 'chapter' | 'paragraph' | 'list';
  startPos: number;
  endPos: number;
  children?: OutlineItem[];
  metadata?: {
    language?: string;
    parameters?: string[];
    returnType?: string;
    visibility?: 'public' | 'private' | 'protected';
  };
}

// 文档解析器接口
export interface DocumentParser {
  parse(content: string): OutlineItem[];
  getSupportedExtensions(): string[];
  getParserName(): string;
}

// 文档预览器接口
export interface DocumentPreview {
  generatePreview(content: string, item: OutlineItem): string;
  getSupportedExtensions(): string[];
  getPreviewName(): string;
}

// 解析器配置
export interface ParserConfig {
  enabled: boolean;
  priority: number;
  customRules?: Rule[];
}

// 用户自定义规则
export interface Rule {
  pattern: RegExp;
  type: string;
  level: number;
  titleExtractor: (match: RegExpMatchArray) => string;
} 