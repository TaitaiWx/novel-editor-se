import { NOVEL_EDITOR_FILE_SAVED_EVENT } from '../../utils/editor-events';
import { getPathBasename } from '@/render/utils/path';

/** 超过该体积（字符数）的文件显示"大文件"提示 */
export const LARGE_FILE_THRESHOLD = 500_000; // 500KB

const UNTITLED_PREFIX = '__untitled__:';
const CHANGELOG_PREFIX = '__changelog__:';

export const isUntitledPath = (path: string | null): boolean =>
  path !== null && path.startsWith(UNTITLED_PREFIX);

export const isChangelogPath = (path: string | null): boolean =>
  path !== null && path.startsWith(CHANGELOG_PREFIX);

export const getLanguageFromPath = (path: string): string => {
  const ext = path.split('.').pop()?.toLowerCase();
  const languageMap: Record<string, string> = {
    md: 'markdown',
    markdown: 'markdown',
    txt: 'text',
    json: 'json',
    js: 'javascript',
    ts: 'typescript',
    jsx: 'javascript',
    tsx: 'typescript',
  };
  return languageMap[ext || ''] || 'text';
};

/** 计算用于加载语法扩展的语言：更新日志固定 markdown，未命名文件按其虚拟文件名推断 */
export const resolveEditorLanguage = (filePath: string): string => {
  const langTarget = isUntitledPath(filePath) ? filePath.replace(UNTITLED_PREFIX, '') : filePath;
  return isChangelogPath(filePath) ? 'markdown' : getLanguageFromPath(langTarget);
};

/** 文件头部显示的语言徽标 */
export const getLanguageBadge = (filePath: string | null): string => {
  const isUntitled = isUntitledPath(filePath);
  const isChangelog = isChangelogPath(filePath);
  return filePath && !isUntitled && !isChangelog
    ? getLanguageFromPath(filePath)
    : isChangelog
      ? 'markdown'
      : 'text';
};

/** 文件头部显示的文件名 */
export const getDisplayFileName = (filePath: string | null): string => {
  if (!filePath) return '';
  if (isUntitledPath(filePath)) return filePath.replace(UNTITLED_PREFIX, '');
  if (isChangelogPath(filePath)) return filePath.replace(CHANGELOG_PREFIX, '');
  return getPathBasename(filePath);
};

/** 是否为需要写回磁盘的普通文件（排除未命名与更新日志） */
export const isPersistablePath = (path: string | null): path is string =>
  Boolean(path) && !isUntitledPath(path) && !isChangelogPath(path);

/** 通知其它模块文件已保存 */
export function emitFileSaved(filePath: string, mode: 'auto' | 'manual') {
  document.dispatchEvent(
    new CustomEvent(NOVEL_EDITOR_FILE_SAVED_EVENT, {
      detail: { filePath, mode },
    })
  );
}
