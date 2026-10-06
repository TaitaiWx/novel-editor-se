import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { writingDecorations, type CharacterHighlightPattern } from '../writing-decorations';
import { inlineDiffField, inlineDiffTheme } from '../inline-diff';
import type { EditorRuntimeModules } from '../editor-runtime';
import { loadLanguageExtension, loadMarkdownLivePreview } from '../editor-runtime';
import { isPersistablePath, resolveEditorLanguage } from '../editor-paths';
import {
  appliedLineMarkerField,
  createActiveLineExtensions,
  createLineNumberExtension,
  createThousandCharMarkerExtension,
  createWordWrapExtension,
  darkTheme,
  focusLineDecorations,
  scrollbarAutoHide,
  transientLineHighlightField,
} from '../editor-extensions';
import type { CursorPosition } from '../types';

interface UseCodeMirrorViewOptions {
  editorContainerRef: React.RefObject<HTMLDivElement>;
  viewRef: React.MutableRefObject<EditorView | null>;
  /** 外部传入的 EditorView ref（可选），与内部 viewRef 同步 */
  editorViewRef?: React.MutableRefObject<EditorView | null>;
  editorRuntime: EditorRuntimeModules | null;
  currentContentRef: React.MutableRefObject<string>;
  currentOriginalContentRef: React.MutableRefObject<string>;
  onContentChangeRef: React.MutableRefObject<((content: string) => void) | undefined>;
  onCursorChangeRef: React.MutableRefObject<((pos: CursorPosition) => void) | undefined>;
  handleManualSaveRef: React.MutableRefObject<() => void>;
  setHasChanges: React.Dispatch<React.SetStateAction<boolean>>;
  scheduleAutoSave: () => void;
  saveViewportSnapshot: (targetPath?: string | null) => void;
  filePath: string | null;
  isUntitled: boolean;
  readOnly: boolean;
  wordWrap: boolean;
  focusMode: boolean;
  showLineNumbers: boolean;
  showThousandCharMarkers: boolean;
  thousandCharMarkerStep: number;
  characterHighlights: CharacterHighlightPattern[];
  /** Markdown 实时预览（仅对 markdown 文件生效） */
  livePreview: boolean;
}

/**
 * 创建 / 销毁 CodeMirror EditorView，并通过 Compartment 动态重配
 * 只读、换行、语言、写作装饰、专注模式、行号与千字标记。
 *
 * 注意：EditorView 只在运行时就绪（或外部 ref / 快照回调变化）时重建，
 * 其余配置均通过 reconfigure 下发，创建时读取的是当次渲染的最新配置。
 */
export function useCodeMirrorView({
  editorContainerRef,
  viewRef,
  editorViewRef,
  editorRuntime,
  currentContentRef,
  currentOriginalContentRef,
  onContentChangeRef,
  onCursorChangeRef,
  handleManualSaveRef,
  setHasChanges,
  scheduleAutoSave,
  saveViewportSnapshot,
  filePath,
  isUntitled,
  readOnly,
  wordWrap,
  focusMode,
  showLineNumbers,
  showThousandCharMarkers,
  thousandCharMarkerStep,
  characterHighlights,
  livePreview,
}: UseCodeMirrorViewOptions) {
  const [editorReady, setEditorReady] = useState(false);

  // Compartments for dynamic reconfiguration
  const readOnlyCompartment = useRef(new Compartment());
  const wordWrapCompartment = useRef(new Compartment());
  const languageCompartment = useRef(new Compartment());
  const writingDecoCompartment = useRef(new Compartment());
  const focusModeCompartment = useRef(new Compartment());
  const lineNumberCompartment = useRef(new Compartment());
  const activeLineCompartment = useRef(new Compartment());
  const thousandCharMarkerCompartment = useRef(new Compartment());
  const livePreviewCompartment = useRef(new Compartment());

  // 创建 EditorView 时使用的初始展示配置：通过最新值 ref 读取，
  // 避免这些配置变化时销毁重建 EditorView（后续变化由下方各 reconfigure effect 下发）
  const initialConfigRef = useRef({
    readOnly,
    wordWrap,
    focusMode,
    showLineNumbers,
    showThousandCharMarkers,
    thousandCharMarkerStep,
    characterHighlights,
  });
  initialConfigRef.current = {
    readOnly,
    wordWrap,
    focusMode,
    showLineNumbers,
    showThousandCharMarkers,
    thousandCharMarkerStep,
    characterHighlights,
  };

  // Create / destroy EditorView
  useEffect(() => {
    if (!editorContainerRef.current || !editorRuntime) return;

    setEditorReady(false);
    const {
      readOnly,
      wordWrap,
      focusMode,
      showLineNumbers,
      showThousandCharMarkers,
      thousandCharMarkerStep,
      characterHighlights,
    } = initialConfigRef.current;

    const view = new EditorView({
      state: EditorState.create({
        doc: '',
        extensions: [
          lineNumberCompartment.current.of(createLineNumberExtension(focusMode, showLineNumbers)),
          appliedLineMarkerField,
          activeLineCompartment.current.of(createActiveLineExtensions(showLineNumbers)),
          thousandCharMarkerCompartment.current.of(
            createThousandCharMarkerExtension(
              showThousandCharMarkers,
              focusMode,
              thousandCharMarkerStep
            )
          ),
          editorRuntime.highlightSelectionMatches(),
          editorRuntime.history(),
          ...editorRuntime.searchExtensions(),
          keymap.of([
            ...editorRuntime.defaultKeymap,
            ...editorRuntime.historyKeymap,
            ...editorRuntime.searchKeymap,
          ]),
          transientLineHighlightField,
          darkTheme,
          scrollbarAutoHide,
          inlineDiffField,
          inlineDiffTheme,
          placeholder('开始输入您的内容...'),
          readOnlyCompartment.current.of(EditorView.editable.of(!readOnly)),
          wordWrapCompartment.current.of(createWordWrapExtension(wordWrap, focusMode)),
          languageCompartment.current.of([]),
          livePreviewCompartment.current.of([]),
          writingDecoCompartment.current.of(writingDecorations(characterHighlights)),
          focusModeCompartment.current.of(focusLineDecorations(focusMode)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const doc = update.state.doc.toString();
              currentContentRef.current = doc;
              const changed = doc !== currentOriginalContentRef.current;
              setHasChanges(changed);
              onContentChangeRef.current?.(doc);
              scheduleAutoSave();
            }
            if (update.selectionSet || update.docChanged) {
              const pos = update.state.selection.main.head;
              const line = update.state.doc.lineAt(pos);
              onCursorChangeRef.current?.({
                line: line.number,
                column: pos - line.from + 1,
              });
            }
            if (update.docChanged || update.selectionSet || update.viewportChanged) {
              saveViewportSnapshot();
            }
          }),
          // Ctrl/Cmd+S keybinding
          keymap.of([
            {
              key: 'Mod-s',
              run: () => {
                handleManualSaveRef.current();
                return true;
              },
            },
          ]),
        ],
      }),
      parent: editorContainerRef.current,
    });

    viewRef.current = view;
    if (editorViewRef) editorViewRef.current = view;
    setEditorReady(true);

    const handleScroll = () => {
      saveViewportSnapshot();
    };
    view.scrollDOM.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      setEditorReady(false);
      saveViewportSnapshot();
      view.scrollDOM.removeEventListener('scroll', handleScroll);
      view.destroy();
      viewRef.current = null;
      if (editorViewRef) editorViewRef.current = null;
    };
    // 除 editorRuntime / editorViewRef / saveViewportSnapshot 外，其余依赖均为稳定引用
    // （ref、useState setter、空依赖 useCallback），不会导致 EditorView 重建
  }, [
    editorRuntime,
    editorViewRef,
    saveViewportSnapshot,
    editorContainerRef,
    viewRef,
    currentContentRef,
    currentOriginalContentRef,
    onContentChangeRef,
    onCursorChangeRef,
    handleManualSaveRef,
    setHasChanges,
    scheduleAutoSave,
  ]);

  // Update readOnly
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure(EditorView.editable.of(!readOnly)),
    });
  }, [readOnly, viewRef]);

  // Update word wrap
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: wordWrapCompartment.current.reconfigure(
        createWordWrapExtension(wordWrap, focusMode)
      ),
    });
  }, [wordWrap, focusMode, viewRef]);

  // Update language extension when filePath changes
  useEffect(() => {
    if (!editorReady || !filePath) return;

    let cancelled = false;

    const applyLanguage = async () => {
      const lang = resolveEditorLanguage(filePath);
      const langExt = await loadLanguageExtension(lang);

      if (cancelled) return;
      const view = viewRef.current;
      if (!view) return;

      view.dispatch({
        effects: languageCompartment.current.reconfigure(langExt),
      });
    };

    applyLanguage().catch((err) => {
      if (cancelled) return;
      console.error('Failed to load language extension:', err);
    });

    return () => {
      cancelled = true;
    };
  }, [editorReady, filePath, isUntitled, viewRef]);

  // Markdown 实时预览：仅 markdown 文件且开关开启时懒加载并启用，否则清空
  useEffect(() => {
    if (!editorReady) return;
    const view = viewRef.current;
    if (!view) return;
    const enabled =
      livePreview && Boolean(filePath) && resolveEditorLanguage(filePath ?? '') === 'markdown';
    if (!enabled) {
      view.dispatch({ effects: livePreviewCompartment.current.reconfigure([]) });
      return;
    }

    let cancelled = false;
    loadMarkdownLivePreview()
      .then((module) => {
        const current = viewRef.current;
        if (cancelled || !current) return;
        current.dispatch({
          effects: livePreviewCompartment.current.reconfigure(
            module.markdownLivePreview({
              filePath: isPersistablePath(filePath) ? filePath : null,
            })
          ),
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) console.error('Failed to load markdown live preview:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [editorReady, filePath, livePreview, viewRef]);

  // Update writing decorations when character highlight rules change
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: writingDecoCompartment.current.reconfigure(writingDecorations(characterHighlights)),
    });
  }, [characterHighlights, viewRef]);

  // 中文说明：这里统一重配与编辑器展示相关的动态扩展，
  // 保证千字标记、行号和专注模式都直接由根配置驱动。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        focusModeCompartment.current.reconfigure(focusLineDecorations(focusMode)),
        lineNumberCompartment.current.reconfigure(
          createLineNumberExtension(focusMode, showLineNumbers)
        ),
        activeLineCompartment.current.reconfigure(createActiveLineExtensions(showLineNumbers)),
        thousandCharMarkerCompartment.current.reconfigure(
          createThousandCharMarkerExtension(
            showThousandCharMarkers,
            focusMode,
            thousandCharMarkerStep
          )
        ),
      ],
    });
  }, [focusMode, showLineNumbers, showThousandCharMarkers, thousandCharMarkerStep, viewRef]);

  return {
    editorReady,
    readOnlyCompartment,
    wordWrapCompartment,
  };
}
