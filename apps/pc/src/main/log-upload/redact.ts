/**
 * 日志脱敏：把用户主目录替换成 `~`，避免日志包里出现系统用户名
 *
 * 同时处理正斜杠、反斜杠，以及 JSON 文本里转义后的双反斜杠（Windows 路径）
 */

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type Redactor = (text: string) => string;

export function createRedactor(
  homeDir: string,
  platform: NodeJS.Platform = process.platform
): Redactor {
  const trimmed = homeDir.replace(/[\\/]+$/, '');
  // 主目录为空或只是根目录时不处理，避免把所有路径都替换掉
  if (trimmed.length < 2) return (text) => text;

  const variants = new Set<string>([
    trimmed,
    trimmed.replace(/\\/g, '/'),
    trimmed.replace(/\//g, '\\'),
    trimmed.replace(/[\\/]/g, '\\\\'),
  ]);
  const pattern = new RegExp(
    [...variants]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join('|'),
    // Windows 路径大小写不敏感
    platform === 'win32' ? 'gi' : 'g'
  );
  return (text) => text.replace(pattern, '~');
}

/** 递归脱敏对象里的所有字符串 */
export function redactValue<T>(value: T, redact: Redactor): T {
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, redact)) as T;
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = redactValue(item, redact);
    }
    return result as T;
  }
  return value;
}
