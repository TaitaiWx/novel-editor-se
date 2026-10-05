import { useMemo, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import type { CursorPosition } from '@/render/app/types';
import type { EditorViewportSnapshot } from '@/render/components/TextEditor';
import { buildEditorSessionStorageKey } from '@/render/app/editorSession';

/**
 * 编辑器领域状态：正文内容、光标、编码、行定位/替换/高亮请求、重载令牌，
 * 以及编辑器会话（视口快照、持久化）相关 ref（只声明，不含副作用）
 *
 * @param folderPath 当前工作区路径，用于派生编辑器会话存储 key
 */
export function useEditorState(folderPath: string | null) {
  const [editorContent, setEditorContent] = useState('');
  const [cursorPosition, setCursorPosition] = useState<CursorPosition>({ line: 1, column: 1 });
  const [encoding, setEncoding] = useState('UTF-8');
  const [scrollToLine, setScrollToLine] = useState<{ line: number; id: string } | null>(null);
  const [replaceLineRequest, setReplaceLineRequest] = useState<{
    line: number;
    text: string;
    id: number;
  } | null>(null);
  const [transientHighlightLine, setTransientHighlightLine] = useState<{
    line: number;
    id: string;
  } | null>(null);
  const [editorReloadToken, setEditorReloadToken] = useState(0);
  const [initialViewportSnapshots, setInitialViewportSnapshots] = useState<
    Record<string, EditorViewportSnapshot>
  >({});

  // 编辑器 EditorView ref（用于精确事务替换）
  const editorViewRef = useRef<EditorView | null>(null);
  const editorSessionKey = useMemo(() => buildEditorSessionStorageKey(folderPath), [folderPath]);
  const editorContentRef = useRef(editorContent);
  editorContentRef.current = editorContent;
  const editorViewportSnapshotsRef = useRef<Record<string, EditorViewportSnapshot>>({});
  const restoredEditorSessionKeyRef = useRef<string | null>(null);
  const editorSessionHydratedRef = useRef(false);
  const persistEditorSessionTimerRef = useRef<number | null>(null);

  return {
    editorContent,
    setEditorContent,
    cursorPosition,
    setCursorPosition,
    encoding,
    setEncoding,
    scrollToLine,
    setScrollToLine,
    replaceLineRequest,
    setReplaceLineRequest,
    transientHighlightLine,
    setTransientHighlightLine,
    editorReloadToken,
    setEditorReloadToken,
    initialViewportSnapshots,
    setInitialViewportSnapshots,
    editorViewRef,
    editorSessionKey,
    editorContentRef,
    editorViewportSnapshotsRef,
    restoredEditorSessionKeyRef,
    editorSessionHydratedRef,
    persistEditorSessionTimerRef,
  };
}

export type EditorState = ReturnType<typeof useEditorState>;
