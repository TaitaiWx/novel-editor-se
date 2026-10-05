import type { OutlineEntry } from '../types';

/**
 * FNV-1a 32-bit hash — fast, synchronous, zero-dependency.
 * Returns a compact 8-char hex string suitable for cache keys.
 */
export function fnv1a32(input: string): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Content-addressable cache key — independent of line number so cache
 * survives line shifts after edits in other chapters.
 * Uses FNV-1a hash for compact, O(1) lookup in Map and SQLite.
 */
export function buildOutlineEntryCacheKey(entry: OutlineEntry): string {
  return entry.cacheKey || fnv1a32(entry.originalText || entry.text);
}

export function buildOutlineCacheKeyFromTitle(title: string): string {
  return fnv1a32(title.trim());
}

/** Check whether a DB cache_key is already in the new hash format */
const HASH_KEY_RE = /^[0-9a-f]{8}$/;

/**
 * Migrate a legacy DB cache_key (raw title or "title|fingerprint") to
 * the new FNV-1a hash format. Returns `null` if already migrated.
 */
export function migrateCacheKey(oldKey: string): string | null {
  if (HASH_KEY_RE.test(oldKey)) return null; // already new format
  const title = oldKey.includes('|') ? oldKey.slice(0, oldKey.indexOf('|')) : oldKey;
  return fnv1a32(title);
}

export function sanitizeAiSummary(raw: string): string {
  // 先 trim 再剥引号：否则首尾空白会挡住引号，'  ""  ' 这类结果无法被识别为空
  return raw
    .trim()
    .replace(/^['"“”‘’「」『』]+|['"“”‘’「」『』]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
