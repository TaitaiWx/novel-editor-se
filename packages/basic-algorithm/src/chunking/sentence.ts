import type { TextChunk, SentenceChunkOptions } from './types';

/**
 * CJK sentence-ending punctuation and common Western sentence endings.
 * We split on these boundaries to preserve sentence integrity.
 */
const SENTENCE_TERMINATORS = /([。！？….!?]+[\s"'」』）)】]*)/;

/**
 * Split text into chunks along sentence boundaries.
 *
 * Respects both CJK (。！？…) and Western (.!?) sentence endings.
 * Sentences are greedily packed into chunks up to `maxChunkSize`.
 * Tiny trailing sentences (< minChunkSize) are merged into the
 * previous chunk to avoid fragmentation.
 *
 * O(n) time with a single pass through the text.
 */
export function chunkBySentence(text: string, options: SentenceChunkOptions = {}): TextChunk[] {
  const { maxChunkSize = 4096, minChunkSize = 100, locale: _locale = 'zh' } = options;

  if (text.length === 0) return [];

  // Split text into sentence fragments: [sentence, terminator, sentence, terminator, ...]
  const parts = text.split(SENTENCE_TERMINATORS);

  // Reassemble into complete sentences (content + terminator)
  const sentences: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const content = parts[i];
    const terminator = parts[i + 1] || '';
    const sentence = content + terminator;
    if (sentence.length > 0) {
      sentences.push(sentence);
    }
  }

  if (sentences.length === 0) return [];

  const chunks: TextChunk[] = [];
  let currentParts: string[] = [];
  let currentLen = 0;
  let offset = 0;
  let lineCount = 1;

  const flush = () => {
    if (currentParts.length === 0) return;
    const chunkText = currentParts.join('');
    const startLine = lineCount;

    // Count newlines in the chunk
    let newlines = 0;
    for (let i = 0; i < chunkText.length; i++) {
      if (chunkText.charCodeAt(i) === 10) newlines++;
    }

    chunks.push({
      index: chunks.length,
      text: chunkText,
      startOffset: offset,
      endOffset: offset + chunkText.length,
      startLine,
      endLine: startLine + newlines,
    });

    offset += chunkText.length;
    lineCount = startLine + newlines;
    currentParts = [];
    currentLen = 0;
  };

  for (const sentence of sentences) {
    // If adding this sentence would exceed max, flush first
    if (currentLen > 0 && currentLen + sentence.length > maxChunkSize) {
      flush();
    }

    currentParts.push(sentence);
    currentLen += sentence.length;

    // If single sentence exceeds max, flush it as its own chunk
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
