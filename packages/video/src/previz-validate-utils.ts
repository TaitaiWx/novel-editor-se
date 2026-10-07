/**
 * 预演脚本校验的通用读取工具（宽松解析：字段别名、字符串数字）。
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const match = value.match(/-?\d+(?:\.\d+)?/);
    if (match) return Number(match[0]);
  }
  return undefined;
}

export function asText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1) return true;
  if (value === 'false' || value === 0) return false;
  return undefined;
}

export function pick(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

/** 枚举 id 规范化：小写、空格 / 下划线换成连字符 */
export function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const TIME_KEYS = ['t', 'time', 'at', 'sec', 'seconds', 'timeSec'];
export const X_KEYS = ['x', 'posX', 'positionX'];
export const Z_KEYS = ['z', 'posZ', 'positionZ', 'depth'];
export const FACING_KEYS = ['facing', 'rotation', 'heading', 'direction', 'dir', 'rotY', 'face'];

/** 位置：x / z，或 position: { x, z } / [x, z] */
export function readPoint(record: Record<string, unknown>): { x?: number; z?: number } {
  let x = asNumber(pick(record, X_KEYS));
  let z = asNumber(pick(record, Z_KEYS));
  const nested = pick(record, ['position', 'pos', 'at', 'location']);
  if (isRecord(nested)) {
    x ??= asNumber(nested.x);
    z ??= asNumber(nested.z ?? nested.y);
  } else if (Array.isArray(nested) && nested.length >= 2) {
    x ??= asNumber(nested[0]);
    z ??= asNumber(nested[nested.length === 3 ? 2 : 1]);
  }
  return { x, z };
}
