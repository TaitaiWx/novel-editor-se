/** 压缩空白并按最大长度截断 */
export function cleanText(value: string | undefined, maxLength = 200): string {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength).trim();
}
