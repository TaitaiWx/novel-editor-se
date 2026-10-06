import { useCallback, useEffect, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import {
  OPEN_INSPIRATION_EVENT,
  type OpenInspirationDetail,
} from '@/render/components/InspirationDialog/inspiration';
import type { EditorState } from './state/useEditorState';

export type UseInspirationDialogContext = Pick<EditorState, 'editorViewRef'>;

/** 在编辑器光标处插入文本（替换选区）；没有可写的编辑器时返回 false */
export function insertTextAtCursor(view: EditorView | null, text: string): boolean {
  if (!view || view.state.readOnly || !text) return false;
  view.dispatch(view.state.replaceSelection(text), { scrollIntoView: true });
  view.focus();
  return true;
}

/**
 * 灵感抽签弹窗：响应工具栏按钮 / 快捷键 / 大纲版本「回到来源」的打开请求，
 * 并把抽到的灵感插入到主编辑器光标处。
 */
export function useInspirationDialog(ctx: UseInspirationDialogContext) {
  const { editorViewRef } = ctx;
  const [visible, setVisible] = useState(false);
  const [cardId, setCardId] = useState<number | null>(null);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenInspirationDetail | undefined>).detail;
      setCardId(typeof detail?.cardId === 'number' ? detail.cardId : null);
      setVisible(true);
    };
    window.addEventListener(OPEN_INSPIRATION_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_INSPIRATION_EVENT, onOpen);
  }, []);

  const closeInspiration = useCallback(() => setVisible(false), []);

  const handleInsertInspiration = useCallback(
    (text: string) => insertTextAtCursor(editorViewRef.current, text),
    [editorViewRef]
  );

  return {
    inspirationVisible: visible,
    inspirationCardId: cardId,
    closeInspiration,
    handleInsertInspiration,
  };
}

export type InspirationDialogApi = ReturnType<typeof useInspirationDialog>;
