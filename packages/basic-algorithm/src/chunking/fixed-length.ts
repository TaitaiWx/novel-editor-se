import type { TextChunk, FixedLengthOptions } from './types';

/**
 * Split text into fixed-length chunks with optional overlap.
 *
 * O(n) time, O(n/chunkSize) output. The simplest and fastest chunking
 * strategy — ideal for editor viewport virtualization where semantic
 * boundaries don't matter.
 *
 * When `overlap > 0`, consecutive chunks share characters at their
 * boundaries so that context is preserved across chunk edges.
 */
export function chunkByFixedLength(text: string, options: FixedLengthOptions = {}): TextChunk[] {
  const { chunkSize = 4096, overlap = 0 } = options;

  if (chunkSize <= 0) throw new RangeError('chunkSize must be positive');
  if (overlap < 0) throw new RangeError('overlap must be non-negative');
  if (overlap >= chunkSize) throw new RangeError('overlap must be less than chunkSize');

  if (text.length === 0) return [];

  const step = chunkSize - overlap;
  const chunks: TextChunk[] = [];

  // Pre-compute cumulative line counts for fast startLine/endLine lookup
  // lineBreaks[i] = number of '\n' in text[0..i)
  let lineCount = 1; // 1-based line numbering
  let pos = 0;

  while (pos < text.length) {
    const end = Math.min(pos + chunkSize, text.length);
    const chunkText = text.slice(pos, end);

    // Count lines up to this chunk's start (on first chunk lineCount is already 1)
    const startLine = lineCount;

    // Count newlines within the chunk to find endLine
    let newlines = 0;
    for (let i = 0; i < chunkText.length; i++) {
      if (chunkText.charCodeAt(i) === 10) newlines++;
    }
    const endLine = startLine + newlines;

    chunks.push({
      index: chunks.length,
      text: chunkText,
      startOffset: pos,
      endOffset: end,
      startLine,
      endLine,
    });

    // Advance line counter: only count newlines in the non-overlapping part
    const stepEnd = Math.min(pos + step, text.length);
    let stepNewlines = 0;
    for (let i = pos; i < stepEnd; i++) {
      if (text.charCodeAt(i) === 10) stepNewlines++;
    }
    lineCount += stepNewlines;

    pos += step;
    if (pos >= text.length) break;
  }

  return chunks;
}
