import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Compartment,
  EditorState,
  EditorSelection,
  type Extension,
  Range,
  RangeSet,
  StateEffect,
  StateField,
} from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  GutterMarker,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  gutter,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  highlightActiveLine,
  placeholder,
} from '@codemirror/view';
import { VscSave } from 'react-icons/vsc';
import LoadingSpinner from '../LoadingSpinner';
import ErrorState from '../ErrorState';
import EmptyState from '../EmptyState';
import Tooltip from '../Tooltip';
import { useToast } from '../Toast';
import { writingDecorations } from './writing-decorations';
import type { CharacterHighlightPattern } from './writing-decorations';
import { inlineDiffField, inlineDiffTheme, setInlineDiffEffect } from './inline-diff';
import type { InlineDiffRange } from './inline-diff';
import { buildThousandCharMarkers } from '../../utils/contentStats';
import styles from './styles.module.scss';

/** Threshold: files larger than this show a performance warning */
const LARGE_FILE_THRESHOLD = 500_000; // 500KB
const DEFAULT_SHOW_LINE_NUMBERS = false;

interface CursorPosition {
  line: number;
  column: number;
}

interface ScrollToLineRequest {
  line: number;
  id: string;
}

interface ReplaceLineRequest {
  line: number;
  text: string;
  id: number;
}

interface TransientHighlightLineRequest {
  line: number;
  id: string;
}

export interface EditorViewportSnapshot {
  anchor: number;
  head: number;
  scrollTop: number;
  scrollLeft: number;
}

interface TextEditorProps {
  filePath: string | null;
  reloadToken?: number;
  focusMode?: boolean;
  wordWrap?: boolean;
  showLineNumbers?: boolean;
  showThousandCharMarkers?: boolean;
  thousandCharMarkerStep?: number;
  readOnly?: boolean;
  hideHeader?: boolean;
  virtualContent?: string | null;
  encoding?: string;
  characterHighlights?: CharacterHighlightPattern[];
  scrollToLine?: ScrollToLineRequest | null;
  transientHighlightLine?: TransientHighlightLineRequest | null;
  replaceLineRequest?: ReplaceLineRequest | null;
  /** 内联 diff 数据（显示在编辑器内部的局部对比） */
  inlineDiff?: InlineDiffRange | null;
  /** 暴露 EditorView ref 供外部直接操作（精确事务替换等） */
  editorViewRef?: React.MutableRefObject<EditorView | null>;
  viewportSnapshots?: Record<string, EditorViewportSnapshot>;
  onViewportSnapshotChange?: (filePath: string, snapshot: EditorViewportSnapshot) => void;
  onContentChange?: (content: string) => void;
  onCursorChange?: (pos: CursorPosition) => void;
  onSaveUntitled?: (untitledPath: string, content: string) => void;
  onScrollProcessed?: () => void;
  onTransientHighlightProcessed?: () => void;
  settingsComponent?: React.ReactNode;
}

export type { InlineDiffRange };
export type { CharacterHighlightPattern };

const FOCUS_VISIBLE_RADIUS = 0;

const focusLineDecorations = (enabled: boolean) => {
  if (!enabled) return [];
  return ViewPlugin.fromClass(
    class {
      decorations;

      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = this.build(update.view);
        }
      }

      build(view: EditorView) {
        const ranges: Range<Decoration>[] = [];
        const mainLine = view.state.doc.lineAt(view.state.selection.main.head).number;
        const minLine = Math.max(1, mainLine - FOCUS_VISIBLE_RADIUS);
        const maxLine = Math.min(view.state.doc.lines, mainLine + FOCUS_VISIBLE_RADIUS);

        for (const vp of view.visibleRanges) {
          let from = vp.from;
          while (from <= vp.to) {
            const line = view.state.doc.lineAt(from);
            if (line.number < minLine || line.number > maxLine) {
              ranges.push(Decoration.line({ class: 'cm-focus-fade' }).range(line.from));
            } else if (line.number === mainLine) {
              ranges.push(Decoration.line({ class: 'cm-focus-main' }).range(line.from));
            }
            if (line.to >= vp.to) break;
            from = line.to + 1;
          }
        }

        return Decoration.set(ranges, true);
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
};

const isUntitledPath = (path: string | null): boolean =>
  path !== null && path.startsWith('__untitled__:');

const isChangelogPath = (path: string | null): boolean =>
  path !== null && path.startsWith('__changelog__:');

const getLanguageFromPath = (path: string): string => {
  const ext = path.split('.').pop()?.toLowerCase();
  const languageMap: Record<string, string> = {
    md: 'markdown',
    txt: 'text',
    json: 'json',
    js: 'javascript',
    ts: 'typescript',
    jsx: 'javascript',
    tsx: 'typescript',
  };
  return languageMap[ext || ''] || 'text';
};

interface EditorRuntimeModules {
  history: typeof import('@codemirror/commands').history;
  defaultKeymap: typeof import('@codemirror/commands').defaultKeymap;
  historyKeymap: typeof import('@codemirror/commands').historyKeymap;
  searchKeymap: typeof import('@codemirror/search').searchKeymap;
  highlightSelectionMatches: typeof import('@codemirror/search').highlightSelectionMatches;
  searchExtensions: typeof import('./search-panel').searchExtensions;
}

let editorRuntimePromise: Promise<EditorRuntimeModules> | null = null;
const languageExtensionCache = new Map<string, Promise<Extension>>();

const loadEditorRuntime = () => {
  if (!editorRuntimePromise) {
    editorRuntimePromise = Promise.all([
      import('@codemirror/commands'),
      import('@codemirror/search'),
      import('./search-panel'),
    ]).then(([commands, search, searchPanel]) => ({
      history: commands.history,
      defaultKeymap: commands.defaultKeymap,
      historyKeymap: commands.historyKeymap,
      searchKeymap: search.searchKeymap,
      highlightSelectionMatches: search.highlightSelectionMatches,
      searchExtensions: searchPanel.searchExtensions,
    }));
  }

  return editorRuntimePromise;
};

const loadLanguageExtension = (lang: string): Promise<Extension> => {
  const cached = languageExtensionCache.get(lang);
  if (cached) return cached;

  const promise = (async () => {
    switch (lang) {
      case 'markdown': {
        const module = await import('@codemirror/lang-markdown');
        return module.markdown();
      }
      case 'json': {
        const module = await import('@codemirror/lang-json');
        return module.json();
      }
      case 'javascript':
      case 'typescript': {
        const module = await import('@codemirror/lang-javascript');
        return module.javascript({ typescript: lang === 'typescript' });
      }
      default:
        return [];
    }
  })();

  languageExtensionCache.set(lang, promise);
  return promise;
};

const createLineNumberExtension = (focusMode: boolean, showLineNumbers: boolean) =>
  focusMode ? [] : showLineNumbers ? [lineNumbers(), appliedLineGutter] : [];

const createActiveLineExtensions = (showLineNumbers: boolean) => [
  highlightActiveLine(),
  ...(showLineNumbers ? [highlightActiveLineGutter()] : []),
];

/** Dark theme matching the existing editor style */
const darkTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: '#1e1e1e',
      color: '#d4d4d4',
      height: '100%',
      fontSize: '14px',
    },
    '.cm-content': {
      fontFamily: "'Fira Code', 'Monaco', 'Menlo', 'Ubuntu Mono', monospace",
      caretColor: '#d4d4d4',
      padding: '12px 0',
      lineHeight: '1.6',
    },
    '.cm-cursor': {
      borderLeftColor: '#d4d4d4',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'rgba(0, 122, 204, 0.3) !important',
    },
    '.cm-activeLine': {
      background:
        'linear-gradient(90deg, rgba(140, 100, 220, 0.08) 0%, rgba(140, 100, 220, 0.05) 60%, rgba(140, 100, 220, 0.02) 100%)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'rgba(140, 100, 220, 0.06)',
      color: '#c8b8e8',
    },
    '.cm-line': {
      transition: 'filter 0.16s ease, opacity 0.16s ease',
    },
    '.cm-line.cm-focus-fade': {
      filter: 'blur(1.8px)',
      opacity: '0.28',
    },
    '.cm-line.cm-focus-main': {
      filter: 'none',
      opacity: '1',
    },
    '.cm-gutters': {
      backgroundColor: '#1e1e1e',
      color: '#555',
      border: 'none',
      borderRight: '1px solid #2d2d2d',
      minWidth: '48px',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 12px 0 8px',
      minWidth: '32px',
    },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: "'Fira Code', 'Monaco', 'Menlo', 'Ubuntu Mono', monospace",
    },
    '&.cm-focused': {
      outline: 'none',
    },
    // Scrollbar styling
    '.cm-scroller::-webkit-scrollbar': {
      width: '8px',
      height: '8px',
    },
    '.cm-scroller::-webkit-scrollbar-track': {
      background: 'transparent',
    },
    '.cm-scroller::-webkit-scrollbar-thumb': {
      background: '#424242',
      borderRadius: '4px',
    },
    '.cm-scroller::-webkit-scrollbar-thumb:hover': {
      background: '#555',
    },
    '.cm-scroller::-webkit-scrollbar-corner': {
      background: 'transparent',
    },
    // ── Panel host (search, etc.) ──
    '.cm-panels': {
      backgroundColor: '#252526',
      color: '#d4d4d4',
    },
    '.cm-panels.cm-panels-top': {
      borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
    },
    '.cm-panels.cm-panels-bottom': {
      borderTop: '1px solid rgba(255, 255, 255, 0.06)',
      boxShadow: '0 -2px 8px rgba(0, 0, 0, 0.25)',
    },
  },
  { dark: true }
);

const setTransientLineHighlightEffect = StateEffect.define<number | null>();
const setAppliedLineMarkerEffect = StateEffect.define<number | null>();

const transientLineHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (deco, tr) => {
    let next = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setTransientLineHighlightEffect)) {
        if (effect.value === null) {
          next = Decoration.none;
        } else {
          next = Decoration.set([
            Decoration.line({ class: 'cm-transient-highlight' }).range(effect.value),
          ]);
        }
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

class AppliedLineMarker extends GutterMarker {
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-applied-gutter-marker';
    span.textContent = '已应用';
    return span;
  }
}

const appliedLineMarker = new AppliedLineMarker();

class ThousandCharMarkerWidget extends WidgetType {
  constructor(private readonly charCount: number) {
    super();
  }

  eq(other: ThousandCharMarkerWidget) {
    return other.charCount === this.charCount;
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-thousand-char-marker-inline';
    span.textContent = `${this.charCount}字`;
    span.setAttribute('aria-hidden', 'true');
    return span;
  }

  ignoreEvent() {
    return true;
  }
}

function buildThousandCharDecorationSet(state: EditorState, milestoneStep: number): DecorationSet {
  const markers = buildThousandCharMarkers(state.doc.toString(), milestoneStep);
  if (markers.length === 0) return Decoration.none;

  return Decoration.set(
    markers.map((item) => {
      const line = state.doc.line(Math.min(item.lineNumber, state.doc.lines));
      return Decoration.widget({
        widget: new ThousandCharMarkerWidget(item.charCount),
        side: -1,
      }).range(line.from);
    }),
    true
  );
}

function createThousandCharMarkerExtension(
  enabled: boolean,
  focusMode: boolean,
  milestoneStep: number
): Extension {
  if (!enabled || focusMode) return [];

  return StateField.define<DecorationSet>({
    create: (state) => buildThousandCharDecorationSet(state, milestoneStep),
    update: (deco, tr) =>
      tr.docChanged
        ? buildThousandCharDecorationSet(tr.state, milestoneStep)
        : deco.map(tr.changes),
    provide: (field) => EditorView.decorations.from(field),
  });
}

const appliedLineMarkerField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update: (set, tr) => {
    let next = set.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setAppliedLineMarkerEffect)) {
        if (effect.value === null) {
          next = RangeSet.empty;
        } else {
          next = RangeSet.of([appliedLineMarker.range(effect.value)]);
        }
      }
    }
    return next;
  },
});

const appliedLineGutter = gutter({
  class: 'cm-applied-gutter',
  markers: (view) => view.state.field(appliedLineMarkerField),
  initialSpacer: () => appliedLineMarker,
});

const TextEditor: React.FC<TextEditorProps> = ({
  filePath,
  reloadToken,
  focusMode = false,
  wordWrap = true,
  showLineNumbers = DEFAULT_SHOW_LINE_NUMBERS,
  showThousandCharMarkers = true,
  thousandCharMarkerStep = 1000,
  readOnly = false,
  hideHeader = false,
  virtualContent,
  encoding = 'UTF-8',
  characterHighlights = [],
  scrollToLine,
  transientHighlightLine,
  replaceLineRequest,
  inlineDiff,
  editorViewRef,
  viewportSnapshots,
  onViewportSnapshotChange,
  onContentChange,
  onCursorChange,
  onSaveUntitled,
  onScrollProcessed,
  onTransientHighlightProcessed,
  settingsComponent,
}) => {
  const isUntitled = isUntitledPath(filePath);
  const isChangelog = isChangelogPath(filePath);
  const toast = useToast();
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [editorRuntime, setEditorRuntime] = useState<EditorRuntimeModules | null>(null);
  const [editorInitError, setEditorInitError] = useState<string | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [autoSaving, setAutoSaving] = useState<boolean>(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isLargeFile, setIsLargeFile] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const editorContainerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Compartments for dynamic reconfiguration
  const readOnlyCompartment = useRef(new Compartment());
  const wordWrapCompartment = useRef(new Compartment());
  const languageCompartment = useRef(new Compartment());
  const writingDecoCompartment = useRef(new Compartment());
  const focusModeCompartment = useRef(new Compartment());
  const lineNumberCompartment = useRef(new Compartment());
  const activeLineCompartment = useRef(new Compartment());
  const thousandCharMarkerCompartment = useRef(new Compartment());

  const currentFilePathRef = useRef<string | null>(null);
  const currentContentRef = useRef<string>('');
  const currentOriginalContentRef = useRef<string>('');
  const viewportSnapshotsRef = useRef<Map<string, EditorViewportSnapshot>>(new Map());
  const lastScrollIdRef = useRef('');
  const lastTransientHighlightIdRef = useRef('');
  const transientHighlightTimerRef = useRef<number | null>(null);
  const appliedLineMarkerTimerRef = useRef<number | null>(null);

  // Stable refs for callbacks to avoid re-creating EditorView
  const onContentChangeRef = useRef(onContentChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const onSaveUntitledRef = useRef(onSaveUntitled);
  const onViewportSnapshotChangeRef = useRef(onViewportSnapshotChange);
  const readOnlyRef = useRef(readOnly);
  const filePathRef = useRef(filePath);
  const isUntitledRef = useRef(isUntitled);
  const handleManualSaveRef = useRef<() => void>(() => {});

  useEffect(() => {
    onContentChangeRef.current = onContentChange;
  }, [onContentChange]);
  useEffect(() => {
    onCursorChangeRef.current = onCursorChange;
  }, [onCursorChange]);
  useEffect(() => {
    onSaveUntitledRef.current = onSaveUntitled;
  }, [onSaveUntitled]);
  useEffect(() => {
    onViewportSnapshotChangeRef.current = onViewportSnapshotChange;
  }, [onViewportSnapshotChange]);
  useEffect(() => {
    readOnlyRef.current = readOnly;
  }, [readOnly]);
  useEffect(() => {
    filePathRef.current = filePath;
    isUntitledRef.current = isUntitledPath(filePath);
  }, [filePath]);
  useEffect(() => {
    viewportSnapshotsRef.current = new Map(Object.entries(viewportSnapshots || {}));
  }, [viewportSnapshots]);

  useEffect(() => {
    let cancelled = false;

    loadEditorRuntime()
      .then((runtime) => {
        if (cancelled) return;
        setEditorRuntime(runtime);
        setEditorInitError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setEditorInitError(err instanceof Error ? err.message : '编辑器初始化失败');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const saveViewportSnapshot = useCallback((targetPath?: string | null) => {
    const view = viewRef.current;
    const snapshotPath = targetPath ?? currentFilePathRef.current;
    if (!view || !snapshotPath) return;

    const snapshot = {
      anchor: view.state.selection.main.anchor,
      head: view.state.selection.main.head,
      scrollTop: view.scrollDOM.scrollTop,
      scrollLeft: view.scrollDOM.scrollLeft,
    };
    viewportSnapshotsRef.current.set(snapshotPath, snapshot);
    onViewportSnapshotChangeRef.current?.(snapshotPath, snapshot);
  }, []);

  const restoreViewportSnapshot = useCallback((targetPath: string, contentLength: number) => {
    const view = viewRef.current;
    if (!view) return;

    const snapshot = viewportSnapshotsRef.current.get(targetPath);
    if (!snapshot) {
      view.dispatch({ selection: EditorSelection.cursor(0) });
      view.scrollDOM.scrollTop = 0;
      view.scrollDOM.scrollLeft = 0;
      return;
    }

    const anchor = Math.min(snapshot.anchor, contentLength);
    const head = Math.min(snapshot.head, contentLength);
    view.dispatch({ selection: EditorSelection.range(anchor, head) });
    window.requestAnimationFrame(() => {
      const activeView = viewRef.current;
      if (!activeView) return;
      activeView.scrollDOM.scrollTop = snapshot.scrollTop;
      activeView.scrollDOM.scrollLeft = snapshot.scrollLeft;
    });
  }, []);

  const emitCursorPosition = useCallback((view: EditorView | null) => {
    if (!view) return;
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    onCursorChangeRef.current?.({
      line: line.number,
      column: pos - line.from + 1,
    });
  }, []);

  const autoSaveFile = useCallback(async () => {
    const targetPath = currentFilePathRef.current;
    const targetContent = currentContentRef.current;

    if (!targetPath || readOnlyRef.current || targetContent === currentOriginalContentRef.current)
      return;
    if (isUntitledPath(targetPath) || isChangelogPath(targetPath)) return;

    setAutoSaving(true);
    try {
      await window.electron.ipcRenderer.invoke('write-file', targetPath, targetContent);
      if (targetPath === filePathRef.current) {
        currentOriginalContentRef.current = targetContent;
        setHasChanges(false);
        setLastSaved(new Date());
      }
    } catch (err) {
      console.error('Auto-save failed:', err);
    } finally {
      setAutoSaving(false);
    }
  }, []);

  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    if (!readOnlyRef.current) {
      autoSaveTimeoutRef.current = setTimeout(() => {
        autoSaveFile();
      }, 2000);
    }
  }, [autoSaveFile]);

  const handleManualSave = useCallback(async () => {
    const targetPath = currentFilePathRef.current;
    if (!targetPath || readOnlyRef.current) return;

    if (isUntitledPath(targetPath)) {
      if (onSaveUntitledRef.current) {
        onSaveUntitledRef.current(targetPath, currentContentRef.current);
      }
      return;
    }
    if (isChangelogPath(targetPath)) return;

    if (currentContentRef.current === currentOriginalContentRef.current) {
      toast.success('文件已是最新状态');
      return;
    }

    setAutoSaving(true);
    try {
      await window.electron.ipcRenderer.invoke('write-file', targetPath, currentContentRef.current);
      if (targetPath === filePathRef.current) {
        currentOriginalContentRef.current = currentContentRef.current;
        setHasChanges(false);
        setLastSaved(new Date());
      }
      toast.success('保存成功');
    } catch (err) {
      console.error('Manual save failed:', err);
      toast.error('保存失败');
    } finally {
      setAutoSaving(false);
    }
  }, [toast]);

  useEffect(() => {
    handleManualSaveRef.current = handleManualSave;
  }, [handleManualSave]);

  // Create / destroy EditorView
  useEffect(() => {
    if (!editorContainerRef.current || !editorRuntime) return;

    setEditorReady(false);

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
          inlineDiffField,
          inlineDiffTheme,
          placeholder('开始输入您的内容...'),
          readOnlyCompartment.current.of(EditorView.editable.of(!readOnly)),
          wordWrapCompartment.current.of(wordWrap || focusMode ? EditorView.lineWrapping : []),
          languageCompartment.current.of([]),
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
  }, [editorRuntime, editorViewRef, saveViewportSnapshot]);

  // Update readOnly
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure(EditorView.editable.of(!readOnly)),
    });
  }, [readOnly]);

  // Update word wrap
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: wordWrapCompartment.current.reconfigure(
        wordWrap || focusMode ? EditorView.lineWrapping : []
      ),
    });
  }, [wordWrap, focusMode]);

  // Update language extension when filePath changes
  useEffect(() => {
    if (!editorReady || !filePath) return;

    let cancelled = false;

    const applyLanguage = async () => {
      const langTarget = isUntitledPath(filePath)
        ? filePath.replace('__untitled__:', '')
        : filePath;
      const lang = isChangelogPath(filePath) ? 'markdown' : getLanguageFromPath(langTarget);
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
  }, [editorReady, filePath, isUntitled]);

  // Update writing decorations when character highlight rules change
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: writingDecoCompartment.current.reconfigure(writingDecorations(characterHighlights)),
    });
  }, [characterHighlights]);

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
  }, [focusMode, showLineNumbers, showThousandCharMarkers, thousandCharMarkerStep]);

  // Save on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
      if (transientHighlightTimerRef.current) {
        window.clearTimeout(transientHighlightTimerRef.current);
      }
      if (appliedLineMarkerTimerRef.current) {
        window.clearTimeout(appliedLineMarkerTimerRef.current);
      }
      if (
        currentFilePathRef.current &&
        !isUntitledPath(currentFilePathRef.current) &&
        !isChangelogPath(currentFilePathRef.current) &&
        currentContentRef.current !== currentOriginalContentRef.current &&
        !readOnlyRef.current
      ) {
        window.electron.ipcRenderer
          .invoke('write-file', currentFilePathRef.current, currentContentRef.current)
          .catch((err) => {
            console.error('Failed to save on unmount:', err);
          });
      }
    };
  }, []);

  // Load file content
  useEffect(() => {
    if (!editorReady) return;

    const loadContent = async () => {
      const view = viewRef.current;

      // Save previous file before switching
      if (
        currentFilePathRef.current &&
        filePath !== currentFilePathRef.current &&
        !isUntitledPath(currentFilePathRef.current) &&
        !isChangelogPath(currentFilePathRef.current) &&
        currentContentRef.current !== currentOriginalContentRef.current &&
        !readOnlyRef.current
      ) {
        try {
          await window.electron.ipcRenderer.invoke(
            'write-file',
            currentFilePathRef.current,
            currentContentRef.current
          );
        } catch (err) {
          console.error('Failed to save previous file:', err);
        }
      }

      if (currentFilePathRef.current && filePath !== currentFilePathRef.current) {
        saveViewportSnapshot(currentFilePathRef.current);
      }

      if (!filePath) {
        currentFilePathRef.current = null;
        currentContentRef.current = '';
        currentOriginalContentRef.current = '';
        setError(null);
        setIsLargeFile(false);
        setHasChanges(false);
        if (view) {
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: '' },
          });
        }
        onContentChange?.('');
        onCursorChange?.({ line: 1, column: 1 });
        return;
      }

      if (virtualContent !== undefined) {
        const nextContent = virtualContent ?? '';
        currentFilePathRef.current = filePath;
        currentContentRef.current = nextContent;
        currentOriginalContentRef.current = nextContent;
        setError(null);
        setLoading(false);
        setLastSaved(null);
        setIsLargeFile(nextContent.length > LARGE_FILE_THRESHOLD);
        setHasChanges(false);
        if (view) {
          if (view.state.doc.toString() !== nextContent) {
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: nextContent },
              effects: [
                readOnlyCompartment.current.reconfigure(EditorView.editable.of(!readOnly)),
                wordWrapCompartment.current.reconfigure(
                  wordWrap || focusMode ? EditorView.lineWrapping : []
                ),
              ],
            });
          }
          restoreViewportSnapshot(filePath, nextContent.length);
          emitCursorPosition(view);
        }
        onContentChange?.(nextContent);
        return;
      }

      if (isUntitledPath(filePath)) {
        currentFilePathRef.current = filePath;
        currentContentRef.current = '';
        currentOriginalContentRef.current = '';
        setError(null);
        setLoading(false);
        setLastSaved(null);
        setIsLargeFile(false);
        setHasChanges(false);
        if (view) {
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: '' },
          });
          restoreViewportSnapshot(filePath, 0);
          emitCursorPosition(view);
        }
        onContentChange?.('');
        return;
      }

      if (isChangelogPath(filePath)) {
        setLoading(true);
        try {
          const content = await window.electron.ipcRenderer.invoke('get-changelog');
          currentFilePathRef.current = filePath;
          currentContentRef.current = content;
          currentOriginalContentRef.current = content;
          setError(null);
          setIsLargeFile(false);
          setHasChanges(false);
          if (view) {
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: content },
              effects: [
                readOnlyCompartment.current.reconfigure(EditorView.editable.of(false)),
                wordWrapCompartment.current.reconfigure(EditorView.lineWrapping),
              ],
            });
            restoreViewportSnapshot(filePath, content.length);
            emitCursorPosition(view);
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : '加载更新日志失败');
        } finally {
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const fileContent = await window.electron.ipcRenderer.invoke(
          'read-file',
          filePath,
          encoding
        );

        currentFilePathRef.current = filePath;
        currentContentRef.current = fileContent;
        currentOriginalContentRef.current = fileContent;

        if (view) {
          // Replace document content and reconfigure compartments
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: fileContent },
            effects: [
              readOnlyCompartment.current.reconfigure(EditorView.editable.of(!readOnly)),
              wordWrapCompartment.current.reconfigure(wordWrap ? EditorView.lineWrapping : []),
            ],
          });
          restoreViewportSnapshot(filePath, fileContent.length);
          emitCursorPosition(view);
        }

        setIsLargeFile(fileContent.length > LARGE_FILE_THRESHOLD);
        setLastSaved(null);
        setHasChanges(false);
        setLoading(false);

        onContentChange?.(fileContent);
      } catch (err) {
        console.error('Error reading file:', err);
        setError(`无法读取文件: ${filePath}`);
        currentContentRef.current = '';
        currentOriginalContentRef.current = '';
        setLoading(false);
      }
    };

    loadContent();
  }, [
    editorReady,
    filePath,
    encoding,
    reloadToken,
    virtualContent,
    readOnly,
    wordWrap,
    emitCursorPosition,
    restoreViewportSnapshot,
    saveViewportSnapshot,
    onContentChange,
    onCursorChange,
  ]);

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
      }, 3000);
    }, 1500);
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
  const lastReplaceIdRef = useRef(0);
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

  const language =
    filePath && !isUntitled && !isChangelog
      ? getLanguageFromPath(filePath)
      : isChangelog
        ? 'markdown'
        : 'text';
  const fileName = filePath
    ? isUntitled
      ? filePath.replace('__untitled__:', '')
      : isChangelog
        ? filePath.replace('__changelog__:', '')
        : filePath.split('/').pop() || filePath.split('\\').pop() || ''
    : '';

  const resolvedError = editorInitError ?? error;

  // Determine which overlay to show (if any)
  const showEmpty = !filePath;
  const showLoading = !!filePath && !resolvedError && (!editorReady || loading);
  const showError = !!filePath && !showLoading && !!resolvedError;
  const showEditor = !!filePath && editorReady && !loading && !resolvedError;

  return (
    <div className={`${styles.textEditor} ${focusMode ? styles.focusModeEditor : ''}`}>
      {/* File header — only visible when a file is active */}
      {showEditor && !focusMode && !hideHeader && (
        <div className={styles.fileHeader}>
          <div className={styles.fileInfo}>
            <span className={styles.fileName}>
              {fileName}
              {hasChanges && <span className={styles.unsavedIndicator}>*</span>}
            </span>
            <span className={styles.languageBadge}>{language}</span>
            {isLargeFile && <span className={styles.largeFileBadge}>大文件</span>}
            {!readOnly && (
              <span className={styles.autoSaveStatus}>
                {autoSaving
                  ? '保存中...'
                  : hasChanges
                    ? '未保存'
                    : lastSaved
                      ? `${lastSaved.toLocaleTimeString()}`
                      : '已保存'}
              </span>
            )}
          </div>
          <div className={styles.fileActions}>
            {!readOnly && !isChangelog && (
              <Tooltip content="保存 (Cmd/Ctrl+S)" position="bottom">
                <button
                  className={styles.saveButton}
                  onClick={handleManualSave}
                  disabled={autoSaving}
                  aria-label="保存"
                >
                  <VscSave />
                </button>
              </Tooltip>
            )}
            {settingsComponent}
          </div>
        </div>
      )}

      {/* Editor container — ALWAYS rendered so the EditorView DOM node is never removed */}
      <div className={styles.editorContainer} style={{ display: showEditor ? undefined : 'none' }}>
        <div ref={editorContainerRef} className={styles.cmHost} />
      </div>

      {/* Overlay states */}
      {showEmpty && (
        <div className={styles.overlay}>
          <EmptyState
            title="选择文件开始编辑"
            description="从左侧文件树中选择一个文件来开始编辑"
            variant="file"
          />
        </div>
      )}
      {showLoading && (
        <div className={styles.overlay}>
          <LoadingSpinner message="正在加载文件内容..." size="medium" />
        </div>
      )}
      {showError && (
        <div className={styles.overlay}>
          <ErrorState
            title="文件加载失败"
            message={resolvedError!}
            size="medium"
            onRetry={() => {
              if (editorInitError) {
                window.location.reload();
                return;
              }
              setError(null);
              setLoading(false);
              if (filePath) {
                const retryLoad = async () => {
                  setLoading(true);
                  try {
                    const fileContent = await window.electron.ipcRenderer.invoke(
                      'read-file',
                      filePath
                    );
                    const view = viewRef.current;
                    if (view) {
                      view.dispatch({
                        changes: {
                          from: 0,
                          to: view.state.doc.length,
                          insert: fileContent,
                        },
                      });
                    }
                    currentContentRef.current = fileContent;
                    currentOriginalContentRef.current = fileContent;
                    setHasChanges(false);
                  } catch (err) {
                    console.error('Error reading file:', err);
                    setError(`无法读取文件: ${filePath}`);
                  } finally {
                    setLoading(false);
                  }
                };
                retryLoad();
              }
            }}
          />
        </div>
      )}
    </div>
  );
};

export default TextEditor;
