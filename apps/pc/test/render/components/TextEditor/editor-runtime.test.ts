// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  loadEditorRuntime,
  loadLanguageExtension,
} from '@/render/components/TextEditor/editor-runtime';

describe('TextEditor editor-runtime', () => {
  it('loadEditorRuntime 只加载一次并返回运行时函数', async () => {
    const first = loadEditorRuntime();
    expect(loadEditorRuntime()).toBe(first);
    const runtime = await first;
    expect(typeof runtime.history).toBe('function');
    expect(typeof runtime.highlightSelectionMatches).toBe('function');
    expect(typeof runtime.searchExtensions).toBe('function');
    expect(Array.isArray(runtime.defaultKeymap)).toBe(true);
  });

  it('loadLanguageExtension 按语言缓存，未知语言返回空扩展', async () => {
    const markdown = loadLanguageExtension('markdown');
    expect(loadLanguageExtension('markdown')).toBe(markdown);
    expect(await markdown).toBeTruthy();
    expect(await loadLanguageExtension('text')).toEqual([]);
    expect(await loadLanguageExtension('json')).toBeTruthy();
    expect(await loadLanguageExtension('typescript')).toBeTruthy();
  });
});
