import type { TextChunk, ParagraphChunkOptions } from './types';

const DEFAULT_SEPARATOR = /\n\s*\n/;

/**
 * Split text into chunks along paragraph boundaries.
 *
 * Paragraphs are detected by blank-line separators (configurable).
 * Adjacent paragraphs are packed greedily into chunks up to
 * `maxChunkSize`. Small trailing paragraphs are merged to avoid
 * fragmentation.
 *
 * This is the recommended strategy for novel/screenplay content where
 * paragraph breaks carry structural meaning (scene breaks, dialogue
 * boundaries, etc.).
 *
 * O(n) time.
 */
export function chunkByParagraph(text: string, options: ParagraphChunkOptions = {}): TextChunk[] {
  const { maxChunkSize = 8192, minChunkSize = 200, separator = DEFAULT_SEPARATOR } = options;

  if (text.length === 0) return [];

  // 用全局正则逐个定位分隔符，段落文本附带其后的分隔符，保证所有段落拼接后与原文完全一致
  // （包括末尾的空行），偏移量也不依赖 indexOf 猜测
  const globalSeparator = new RegExp(
    separator.source,
    separator.flags.includes('g') ? separator.flags : `${separator.flags}g`
  );
  const paragraphs: { text: string; offset: number }[] = [];
  let paragraphStart = 0;
  let match: RegExpExecArray | null;

  while ((match = globalSeparator.exec(text)) !== null) {
    if (match[0].length === 0) {
      // 防御零宽匹配导致死循环
      globalSeparator.lastIndex += 1;
      continue;
    }
    const separatorEnd = match.index + match[0].length;
    paragraphs.push({ text: text.slice(paragraphStart, separatorEnd), offset: paragraphStart });
    paragraphStart = separatorEnd;
  }
  if (paragraphStart < text.length) {
    paragraphs.push({ text: text.slice(paragraphStart), offset: paragraphStart });
  }

  if (paragraphs.length === 0) return [];

  const chunks: TextChunk[] = [];
  let currentParts: string[] = [];
  let currentLen = 0;
  let chunkStartOffset = paragraphs[0].offset;
  let lineCount = 1;

  const flush = () => {
    if (currentParts.length === 0) return;
    const chunkText = currentParts.join('');
    const startLine = lineCount;

    let newlines = 0;
    for (let i = 0; i < chunkText.length; i++) {
      if (chunkText.charCodeAt(i) === 10) newlines++;
    }

    chunks.push({
      index: chunks.length,
      text: chunkText,
      startOffset: chunkStartOffset,
      endOffset: chunkStartOffset + chunkText.length,
      startLine,
      endLine: startLine + newlines,
    });

    lineCount = startLine + newlines;
    chunkStartOffset += chunkText.length;
    currentParts = [];
    currentLen = 0;
  };

  for (const para of paragraphs) {
    if (currentLen > 0 && currentLen + para.text.length > maxChunkSize) {
      flush();
    }

    currentParts.push(para.text);
    currentLen += para.text.length;

    if (currentLen >= maxChunkSize) {
      flush();
    }
  }

  // Merge tiny trailing chunk into previous
  if (currentLen > 0 && currentLen < minChunkSize && chunks.length > 0) {
    const last = chunks[chunks.length - 1];
    const extra = currentParts.join('');
    let newlines = 0;
    for (let i = 0; i < extra.length; i++) {
      if (extra.charCodeAt(i) === 10) newlines++;
    }
    last.text += extra;
    last.endOffset += extra.length;
    last.endLine += newlines;
  } else {
    flush();
  }

  return chunks;
}
