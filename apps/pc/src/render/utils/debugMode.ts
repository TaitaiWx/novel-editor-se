/**
 * 开发者调试模式（启动时设置环境变量 NOVEL_EDITOR_DEBUG=1，经 preload 暴露）。
 * 原始提示词、JSON、AI 原始返回等内部数据只在调试模式下显示，作者看到的都是可视化摘要
 */
export function isDeveloperDebugMode(): boolean {
  return typeof window !== 'undefined' && window.electron?.debug === true;
}

/** 看起来像原始数据（JSON / 代码块包着的 JSON），而不是给人读的文字 */
export function looksLikeRawData(text: string | null | undefined): boolean {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('```')) return true;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  return (first === '{' && last === '}') || (first === '[' && last === ']');
}

/** 面向作者的文字：原始数据只在调试模式下原样显示，否则用 fallback 代替 */
export function hideRawData(text: string | null | undefined, fallback: string): string {
  if (!text) return fallback;
  return looksLikeRawData(text) && !isDeveloperDebugMode() ? fallback : text;
}
