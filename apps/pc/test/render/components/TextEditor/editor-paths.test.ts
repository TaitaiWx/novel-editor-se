// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  emitFileSaved,
  getDisplayFileName,
  getLanguageBadge,
  getLanguageFromPath,
  isChangelogPath,
  isPersistablePath,
  isUntitledPath,
  resolveEditorLanguage,
} from '@/render/components/TextEditor/editor-paths';
import { NOVEL_EDITOR_FILE_SAVED_EVENT } from '@/render/utils/editor-events';

describe('TextEditor editor-paths', () => {
  it('识别未命名与更新日志虚拟路径', () => {
    expect(isUntitledPath('__untitled__:新文件.md')).toBe(true);
    expect(isUntitledPath('/a.md')).toBe(false);
    expect(isUntitledPath(null)).toBe(false);
    expect(isChangelogPath('__changelog__:CHANGELOG.md')).toBe(true);
    expect(isChangelogPath(null)).toBe(false);
  });

  it('getLanguageFromPath 按扩展名映射语言', () => {
    expect(getLanguageFromPath('/a/b.md')).toBe('markdown');
    expect(getLanguageFromPath('x.TSX')).toBe('typescript');
    expect(getLanguageFromPath('x.jsx')).toBe('javascript');
    expect(getLanguageFromPath('x.json')).toBe('json');
    expect(getLanguageFromPath('x.docx')).toBe('text');
    expect(getLanguageFromPath('noext')).toBe('text');
  });

  it('resolveEditorLanguage 处理虚拟路径', () => {
    expect(resolveEditorLanguage('__changelog__:notes.txt')).toBe('markdown');
    expect(resolveEditorLanguage('__untitled__:a.json')).toBe('json');
    expect(resolveEditorLanguage('/a/b.ts')).toBe('typescript');
  });

  it('getLanguageBadge 与 getDisplayFileName', () => {
    expect(getLanguageBadge(null)).toBe('text');
    expect(getLanguageBadge('__untitled__:a.md')).toBe('text');
    expect(getLanguageBadge('__changelog__:x')).toBe('markdown');
    expect(getLanguageBadge('/a/b.md')).toBe('markdown');

    expect(getDisplayFileName(null)).toBe('');
    expect(getDisplayFileName('__untitled__:草稿.md')).toBe('草稿.md');
    expect(getDisplayFileName('__changelog__:更新日志')).toBe('更新日志');
    expect(getDisplayFileName('/a/b/第一章.md')).toBe('第一章.md');
  });

  it('isPersistablePath 排除空路径与虚拟路径', () => {
    expect(isPersistablePath('/a.md')).toBe(true);
    expect(isPersistablePath(null)).toBe(false);
    expect(isPersistablePath('')).toBe(false);
    expect(isPersistablePath('__untitled__:a')).toBe(false);
    expect(isPersistablePath('__changelog__:a')).toBe(false);
  });

  it('emitFileSaved 在 document 上派发保存事件', () => {
    const listener = vi.fn();
    document.addEventListener(NOVEL_EDITOR_FILE_SAVED_EVENT, listener);
    emitFileSaved('/a.md', 'manual');
    document.removeEventListener(NOVEL_EDITOR_FILE_SAVED_EVENT, listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      filePath: '/a.md',
      mode: 'manual',
    });
  });
});
