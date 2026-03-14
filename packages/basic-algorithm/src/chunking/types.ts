/** A single chunk of text with positional metadata */
export interface TextChunk {
  /** Zero-based index of this chunk */
  index: number;
  /** The chunk text content */
  text: string;
  /** Byte offset from start of original text */
  startOffset: number;
  /** Byte offset of the end (exclusive) */
  endOffset: number;
  /** Line number where this chunk starts (1-based) */
  startLine: number;
  /** Line number where this chunk ends (1-based, inclusive) */
  endLine: number;
}

/** Options for fixed-length chunking */
export interface FixedLengthOptions {
  /** Maximum number of characters per chunk (default: 4096) */
  chunkSize?: number;
  /** Number of overlapping characters between consecutive chunks (default: 0) */
  overlap?: number;
}

/** Options for sentence-based chunking */
export interface SentenceChunkOptions {
  /** Maximum number of characters per chunk (default: 4096) */
  maxChunkSize?: number;
  /** Minimum number of characters per chunk before merging with next (default: 100) */
  minChunkSize?: number;
  /** Locale hint for sentence boundary detection (default: 'zh') */
  locale?: string;
}

/** Options for paragraph-based chunking */
export interface ParagraphChunkOptions {
  /** Maximum number of characters per chunk (default: 8192) */
  maxChunkSize?: number;
  /** Minimum number of characters per chunk before merging (default: 200) */
  minChunkSize?: number;
  /** Paragraph separator pattern (default: /\n\s*\n/) */
  separator?: RegExp;
}
