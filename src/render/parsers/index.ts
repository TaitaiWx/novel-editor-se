/**
 * 解析器系统入口文件
 * 负责注册和管理所有文档解析器
 */

export { ParserFactory } from './ParserFactory';
export { BaseParser } from './BaseParser';
export { MarkdownParser } from './MarkdownParser';
export { CodeParser } from './CodeParser';
export { TextParser } from './TextParser';
export { PreviewFactory } from './PreviewFactory';
export { BasePreview } from './BasePreview';
export { MarkdownPreview } from './MarkdownPreview';
export { CodePreview } from './CodePreview';
export type { 
  OutlineItem, 
  DocumentParser, 
  DocumentPreview, 
  ParserConfig, 
  Rule 
} from './types';

// 注册所有解析器和预览器
import { ParserFactory } from './ParserFactory';
import { MarkdownParser } from './MarkdownParser';
import { CodeParser } from './CodeParser';
import { TextParser } from './TextParser';
import { PreviewFactory } from './PreviewFactory';
import { MarkdownPreview } from './MarkdownPreview';
import { CodePreview } from './CodePreview';

// 初始化解析器和预览器系统
export function initializeParsers(): void {
  // 注册解析器
  ParserFactory.registerParser(new MarkdownParser());
  ParserFactory.registerParser(new CodeParser());
  ParserFactory.registerParser(new TextParser());
  
  // 注册预览器
  PreviewFactory.registerPreview(new MarkdownPreview());
  PreviewFactory.registerPreview(new CodePreview());
  
  console.log('Document parsers initialized:', ParserFactory.getSupportedTypes());
  console.log('Document previews initialized:', PreviewFactory.getSupportedTypes());
}

// 自动初始化
initializeParsers(); 