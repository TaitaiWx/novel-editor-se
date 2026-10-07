import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import type { ContinuationDirection, ContinuationLength } from '@novel-editor/ai/prompts';
import type { AIProviderInfo } from '@/shared/ai';
import { loadEditorAssist } from '../TextEditor/editor-runtime';
import type { ContinuationState } from '../TextEditor/assist';
import { IDLE_CONTINUATION } from '../TextEditor/assist/continuation-state';
import { resolveContinuationProvider } from '../../utils/continuationService';

export type DirectionChoice = ContinuationDirection | 'custom';

export interface ContinuationPanelForm {
  length: ContinuationLength;
  direction: DirectionChoice;
  customDirection: string;
  followOutline: boolean;
  /** 空字符串表示自动选择 */
  providerId: string;
}

export const DEFAULT_PANEL_FORM: ContinuationPanelForm = {
  length: 'paragraph',
  direction: 'continue',
  customDirection: '',
  followOutline: true,
  providerId: '',
};

/** 面板选择 → 续写参数（自由输入优先于预设方向） */
export function toContinuationOptions(form: ContinuationPanelForm) {
  const custom = form.customDirection.trim();
  return {
    length: form.length,
    direction: form.direction === 'custom' || custom ? custom || 'continue' : form.direction,
    followOutline: form.followOutline,
    ...(form.providerId ? { providerId: form.providerId } : {}),
  };
}

export type AssistModule = Awaited<ReturnType<typeof loadEditorAssist>>;

/**
 * 续写面板：读取可用的文本服务、订阅当前编辑器的续写状态、发起 / 采纳 / 放弃。
 * 编辑器辅助模块懒加载，面板打开时才加载。
 */
export function useContinuationPanel(
  open: boolean,
  editorViewRef: React.MutableRefObject<EditorView | null> | undefined
) {
  const [providers, setProviders] = useState<AIProviderInfo[] | null>(null);
  const [state, setState] = useState<ContinuationState>(IDLE_CONTINUATION);
  const [assist, setAssist] = useState<AssistModule | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** 当前订阅的编辑器（面板打开或发起续写时取最新的 EditorView） */
  const [view, setView] = useState<EditorView | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setNotice(null);
    setView(editorViewRef?.current ?? null);
    void window.electron.ipcRenderer
      .invoke('ai-providers-list')
      .then((result) => {
        if (!cancelled) setProviders(result.ok ? result.data.filter((p) => p.kind === 'text') : []);
      })
      .catch(() => {
        if (!cancelled) setProviders([]);
      });
    void loadEditorAssist().then((module) => {
      if (!cancelled) setAssist(module);
    });
    return () => {
      cancelled = true;
    };
  }, [editorViewRef, open]);

  // 订阅当前编辑器的续写状态（建议模式的进度、上下文、错误）
  useEffect(() => {
    if (!open || !assist || !view) return;
    setState(assist.getContinuationState(view.state));
    return assist.subscribeContinuation(view, setState);
  }, [assist, open, view]);

  const withView = useCallback(
    (run: (module: AssistModule, target: EditorView) => boolean) => {
      const target = editorViewRef?.current;
      if (!assist || !target) {
        setNotice('请先打开一个章节');
        return false;
      }
      setNotice(null);
      return run(assist, target);
    },
    [assist, editorViewRef]
  );

  const generate = useCallback(
    (form: ContinuationPanelForm) =>
      withView((module, target) => {
        // 编辑器可能在面板打开后重建：改为订阅最新的 EditorView
        setView(target);
        const started = module.requestContinuation(target, {
          mode: 'suggestion',
          options: toContinuationOptions(form),
        });
        if (!started) setNotice('当前文件是只读的，不能插入续写');
        return started;
      }),
    [withView]
  );

  const accept = useCallback(
    () => withView((module, target) => module.acceptContinuation(target)),
    [withView]
  );
  const discard = useCallback(
    () => withView((module, target) => module.dismissContinuation(target)),
    [withView]
  );
  const next = useCallback(
    () => withView((module, target) => module.nextContinuation(target)),
    [withView]
  );
  const retry = useCallback(
    () => withView((module, target) => module.retryContinuation(target)),
    [withView]
  );

  const resolved = providers ? resolveContinuationProvider(providers) : null;

  return {
    providers,
    /** 自动选择时实际会用的服务；null 表示都没有配置 */
    resolvedProvider: resolved,
    configured: providers === null ? null : Boolean(resolved),
    state,
    notice,
    generate,
    accept,
    discard,
    next,
    retry,
  };
}
