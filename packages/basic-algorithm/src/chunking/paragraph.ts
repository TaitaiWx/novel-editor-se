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

  // Split into paragraphs preserving the separators
  const rawParts = text.split(separator);

  // Rebuild paragraphs with their trailing separators by tracking offsets
  const paragraphs: { text: string; offset: number }[] = [];
  let searchFrom = 0;

  for (let i = 0; i < rawParts.length; i++) {
    const part = rawParts[i];
    const offset = searchFrom;

    if (i < rawParts.length - 1) {
      // Find the separator between this part and the next
      const nextPartStart = text.indexOf(rawParts[i + 1], offset + part.length);
      const separatorText = text.slice(offset + part.length, nextPartStart);
      const fullText = part + separatorText;
      if (fullText.length > 0) {
        paragraphs.push({ text: fullText, offset });
      }
      searchFrom = nextPartStart;
    } else {
      // Last part, no trailing separator
      if (part.length > 0) {
        paragraphs.push({ text: part, offset });
      }
    }
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
