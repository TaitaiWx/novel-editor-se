/**
 * 拖到参考窗格的文件路径：
 * - 资料树拖出的行：dataTransfer 的 NOVEL_EDITOR_PATH_MIME（每行一个绝对路径）
 * - 系统文件管理器拖入的文件：preload 在 capture 阶段用 webUtils.getPathForFile 取出的路径
 */
import { NOVEL_EDITOR_PATH_MIME } from '../../utils/referencePane';

interface DropLike {
  dataTransfer: {
    types?: ArrayLike<string> | null;
    getData: (format: string) => string;
  };
}

export function readDroppedPaths(event: DropLike): string[] {
  const types = Array.from(event.dataTransfer.types ?? []);
  if (types.includes(NOVEL_EDITOR_PATH_MIME)) {
    return event.dataTransfer
      .getData(NOVEL_EDITOR_PATH_MIME)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  if (types.includes('Files')) return window.electron?.getLastDroppedPaths?.() ?? [];
  return [];
}
