/**
 * 章节分割器 —— 将大文件（160 万字+）按章节标记拆分。
 *
 * 支持的章节标记：
 *   - 中文：第X章、第X节、第X回、第X卷、楔子、引子、序章、尾声
 *   - 英文：Chapter X
 *   - 通用：纯数字行（如 "1"、"01"）
 *
 * 设计原则：
 *   - 纯函数，无副作用，可在 Web Worker 中运行
 *   - O(n) 单遍扫描，不加载全文到内存多次
 *   - 输出标准化的 Chapter 结构，供 contentRetriever 建立索引
 */

export interface Chapter {
  /** 章节在原文中的序号（0-based） */
  index: number;
  /** 章节标题（从标记行提取） */
  title: string;
  /** 章节内容（不含标题行） */
  content: string;
  /** 在原文中的起始字符偏移 */
  offset: number;
  /** 字符数 */
  length: number;
}

/**
 * 匹配常见中文小说章节标题的正则：
 * - 第X章/节/回/卷 + 可选标题
 * - 楔子/引子/序章/序/尾声/番外
 * - Chapter N
 */
const CHAPTER_PATTERN =
  /^(?:第[零〇一二三四五六七八九十百千万\d]+[章节回卷部篇]\s*.*|楔子|引子|序章|序|尾声|番外.*|Chapter\s+\d+.*)$/i;

/**
 * 备选：纯数字行（"1"、"01" 等），仅在无标准章节标记时启用
 */
const NUMERIC_LINE_PATTERN = /^\d{1,4}$/;

export function splitChapters(text: string): Chapter[] {
  const lines = text.split('\n');
  const chapters: Chapter[] = [];

  // 1. 先用标准章节标记尝试
  let chapterStarts = findChapterStarts(lines, CHAPTER_PATTERN);

  // 2. 若标准标记少于 2 个，回退到纯数字行
  if (chapterStarts.length < 2) {
    chapterStarts = findChapterStarts(lines, NUMERIC_LINE_PATTERN);
  }

  // 3. 若仍然少于 2 个，整个文本视为一个章节
  if (chapterStarts.length < 2) {
    return [
      {
        index: 0,
        title: '全文',
        content: text,
        offset: 0,
        length: text.length,
      },
    ];
  }

  // 4. 构建章节列表
  let currentOffset = 0;
  for (let i = 0; i < chapterStarts.length; i++) {
    const startLine = chapterStarts[i];
    const endLine = i + 1 < chapterStarts.length ? chapterStarts[i + 1] : lines.length;
    const title = lines[startLine].trim();
    const contentLines = lines.slice(startLine + 1, endLine);
    const content = contentLines.join('\n').trim();

    // 计算 offset：前面所有行的字符数 + 换行符
    const beforeContent = lines.slice(0, startLine).join('\n');
    const offset = beforeContent.length + (startLine > 0 ? 1 : 0);
    const fullChapterText = lines.slice(startLine, endLine).join('\n');

    chapters.push({
      index: i,
      title,
      content,
      offset,
      length: fullChapterText.length,
    });
  }

  // 如果第一个章节标记不在文件开头，在前面加一个"前言"章节
  if (chapterStarts[0] > 0) {
    const preambleLines = lines.slice(0, chapterStarts[0]);
    const preambleContent = preambleLines.join('\n').trim();
    if (preambleContent.length > 0) {
      chapters.unshift({
        index: -1,
        title: '前言',
        content: preambleContent,
        offset: 0,
        length: preambleContent.length,
      });
      // 重新编号
      chapters.forEach((ch, i) => (ch.index = i));
    }
  }

  return chapters;
}

function findChapterStarts(lines: string[], pattern: RegExp): number[] {
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length > 0 && pattern.test(trimmed)) {
      starts.push(i);
    }
  }
  return starts;
}

/**
 * 快速估算文本是否为"大文件"（>5 万字），决定是否启用分章检索。
 */
export function isLargeText(text: string): boolean {
  return text.length > 50_000;
}
