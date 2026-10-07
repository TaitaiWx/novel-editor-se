import type React from 'react';
import { useEffect, useRef } from 'react';
import { StateEffect } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { loadEditorAssist } from '../editor-runtime';
import type { EditorAssistConfig, EditorAssistContext } from '../assist/types';

interface UseEditorAssistExtensionOptions {
  viewRef: React.MutableRefObject<EditorView | null>;
  editorReady: boolean;
  assist: EditorAssistConfig | null | undefined;
  filePath: string | null;
  readOnly: boolean;
}

/** 已安装辅助扩展的 EditorView（同一个 view 只安装一次） */
const installedViews = new WeakSet<EditorView>();

/**
 * 编辑器辅助（人物悬停卡片 / 行内续写）：首次提供配置时懒加载并追加到 EditorView。
 * 扩展通过 ref 读取最新的配置、文件路径与只读状态，配置变化无需重配扩展。
 */
export function useEditorAssistExtension({
  viewRef,
  editorReady,
  assist,
  filePath,
  readOnly,
}: UseEditorAssistExtensionOptions) {
  const contextRef = useRef<EditorAssistContext>({ config: assist ?? null, filePath, readOnly });
  contextRef.current = { config: assist ?? null, filePath, readOnly };
  const enabled = Boolean(assist);

  useEffect(() => {
    if (!editorReady || !enabled) return;
    let cancelled = false;
    loadEditorAssist()
      .then((module) => {
        const view = viewRef.current;
        if (cancelled || !view || installedViews.has(view)) return;
        installedViews.add(view);
        view.dispatch({
          effects: StateEffect.appendConfig.of(
            module.editorAssistExtension(() => contextRef.current)
          ),
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) console.error('Failed to load editor assist:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [editorReady, enabled, viewRef]);
}
