/** NumberInput 的纯函数：输入过滤、解析、夹取与步进 */

/** 输入过程中允许的中间态：可选负号、数字、最多一个小数点（例如 "-"、"1."、".5"） */
export function isNumericDraft(
  text: string,
  allowNegative: boolean,
  allowDecimal: boolean
): boolean {
  const sign = allowNegative ? '-?' : '';
  const pattern = allowDecimal ? `^${sign}\\d*(\\.\\d*)?$` : `^${sign}\\d*$`;
  return new RegExp(pattern).test(text);
}

/** 解析输入文本；空白或不完整（"-"、"."）返回 null */
export function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed === '-' || trimmed === '.' || trimmed === '-.') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** 按小数位数取整；未指定时按 step 的小数位数，避免 0.1 + 0.2 之类的浮点尾巴 */
export function roundTo(value: number, precision: number): number {
  const factor = 10 ** Math.max(0, precision);
  return Math.round(value * factor) / factor;
}

export function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

export function clampNumber(value: number, min?: number, max?: number): number {
  let next = value;
  if (typeof min === 'number') next = Math.max(min, next);
  if (typeof max === 'number') next = Math.min(max, next);
  return next;
}

export function normalizeNumber(
  value: number,
  options: { min?: number; max?: number; precision: number }
): number {
  return clampNumber(roundTo(value, options.precision), options.min, options.max);
}

export function formatNumber(value: number | null | '' | undefined, precision?: number): string {
  if (value === null || value === '' || value === undefined || !Number.isFinite(value)) return '';
  return typeof precision === 'number' ? String(roundTo(value, precision)) : String(value);
}
