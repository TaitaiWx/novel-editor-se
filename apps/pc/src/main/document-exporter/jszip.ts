import type JSZip from 'jszip';

/** 兼容 jszip 的 CJS/ESM 两种导出形态，返回 JSZip 构造器 */
export async function loadJSZip(): Promise<typeof JSZip> {
  const mod = (await import('jszip')) as typeof JSZip | { default: typeof JSZip };
  return 'default' in mod && mod.default ? mod.default : (mod as typeof JSZip);
}
