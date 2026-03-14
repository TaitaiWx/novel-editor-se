/**
 * 格式化数字，每 3 位添加千位分隔符（逗号）
 *
 * @example
 * formatNumber(1234567)  // "1,234,567"
 * formatNumber(123)      // "123"
 * formatNumber(0)        // "0"
 */
export function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}
