import type React from 'react';
import { useEffect, useRef } from 'react';
import type { EditorView } from '@codemirror/view';
import { setInlineDiffEffect, type InlineDiffRange } from '../inline-diff';
import { setAppliedLineMarkerEffect, setTransientLineHighlightEffect } from '../editor-extensions';
import type {
  ReplaceLineRequest,
  ScrollToLineRequest,
  TransientHighlightLineRequest,
} from '../types';

/** 临时高亮持续时间（毫秒） */
export const TRANSIENT_HIGHLIGHT_DURATION = 1500;
/** "已应用"行标记持续时间（毫秒） */
export const APPLIED_MARKER_DURATION = 3000;

interface UseEditorRequestsOptions {
  viewRef: React.MutableRefObject<EditorView | null>;
  scrollToLine?: ScrollToLineRequest | null;
  transientHighlightLine?: TransientHighlightLineRequest | null;
  inlineDiff?: InlineDiffRange | null;
  replaceLineRequest?: ReplaceLineRequest | null;
  onScrollProcessed?: () => void;
  onTransientHighlightProcessed?: () => void;
  /** 由组件持有，卸载时统一清理 */
  transientHighlightTimerRef: React.MutableRefObject<number | null>;
  appliedLineMarkerTimerRef: React.MutableRefObject<number | null>;
}

/**
 * 处理外部发来的一次性编辑器请求：跳转到行、临时高亮行、内联 diff、行尾追加文本。
 * 每类请求通过 id 去重，避免重复渲染时重复执行。
 */
export function useEditorRequests({
  viewRef,
  scrollToLine,
  transientHighlightLine,
  inlineDiff,
  replaceLineRequest,
  onScrollProcessed,
  onTransientHighlightProcessed,
  transientHighlightTimerRef,
  appliedLineMarkerTimerRef,
}: UseEditorRequestsOptions) {
  const lastScrollIdRef = useRef('');
  const lastTransientHighlightIdRef = useRef('');
  const lastReplaceIdRef = useRef(0);

  // Scroll to line
  useEffect(() => {
    const view = viewRef.current;
    if (!scrollToLine || !view) return;
    if (scrollToLine.id === lastScrollIdRef.current) return;
    lastScrollIdRef.current = scrollToLine.id;

    const lineInfo = view.state.doc.line(Math.min(scrollToLine.line, view.state.doc.lines));
    view.dispatch({
      selection: { anchor: lineInfo.from },
      scrollIntoView: true,
    });
    view.focus();
    onScrollProcessed?.();
  }, [scrollToLine]);

  // Transient highlight line (flash once for 1.5s)
  useEffect(() => {
    const view = viewRef.current;
    if (!transientHighlightLine || !view) return;
    if (transientHighlightLine.id === lastTransientHighlightIdRef.current) return;
    lastTransientHighlightIdRef.current = transientHighlightLine.id;
    onTransientHighlightProcessed?.();

    const lineNum = Math.min(Math.max(1, transientHighlightLine.line), view.state.doc.lines);
    const lineInfo = view.state.doc.line(lineNum);

    // 新请求到来时，清理上一轮 transient + gutter 标记
    if (appliedLineMarkerTimerRef.current) {
      window.clearTimeout(appliedLineMarkerTimerRef.current);
      appliedLineMarkerTimerRef.current = null;
    }
    view.dispatch({
      effects: [
        setTransientLineHighlightEffect.of(null),
        setAppliedLineMarkerEffect.of(null),
        setTransientLineHighlightEffect.of(lineInfo.from),
      ],
    });

    if (transientHighlightTimerRef.current) {
      window.clearTimeout(transientHighlightTimerRef.current);
    }
    transientHighlightTimerRef.current = window.setTimeout(() => {
      const activeView = viewRef.current;
      if (!activeView) return;
      activeView.dispatch({
        effects: [
          setTransientLineHighlightEffect.of(null),
          setAppliedLineMarkerEffect.of(lineInfo.from),
        ],
      });
      transientHighlightTimerRef.current = null;

      appliedLineMarkerTimerRef.current = window.setTimeout(() => {
        const v = viewRef.current;
        if (!v) return;
        v.dispatch({ effects: setAppliedLineMarkerEffect.of(null) });
        appliedLineMarkerTimerRef.current = null;
      }, APPLIED_MARKER_DURATION);
    }, TRANSIENT_HIGHLIGHT_DURATION);
  }, [transientHighlightLine]);

  // Inline diff decoration
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (inlineDiff) {
      // Scroll to the diff area first
      const line = view.state.doc.lineAt(Math.min(inlineDiff.from, view.state.doc.length));
      view.dispatch({
        effects: setInlineDiffEffect.of(inlineDiff),
        selection: { anchor: line.from },
        scrollIntoView: true,
      });
    } else {
      view.dispatch({ effects: setInlineDiffEffect.of(null) });
    }
  }, [inlineDiff]);

  // Replace line text (append AI title etc.)
  useEffect(() => {
    const view = viewRef.current;
    if (!replaceLineRequest || !view) return;
    if (replaceLineRequest.id <= lastReplaceIdRef.current) return;
    lastReplaceIdRef.current = replaceLineRequest.id;

    const lineNum = Math.min(replaceLineRequest.line, view.state.doc.lines);
    const lineInfo = view.state.doc.line(lineNum);
    view.dispatch({
      changes: { from: lineInfo.to, insert: ` ${replaceLineRequest.text}` },
      scrollIntoView: true,
    });
    view.focus();
  }, [replaceLineRequest]);
}
