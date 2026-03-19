import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Compartment, EditorState, Range } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  keymap,
  lineNumbers,
  highlightActiveLine,
  placeholder,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';
import { javascript } from '@codemirror/lang-javascript';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { VscSave } from 'react-icons/vsc';
import LoadingSpinner from '../LoadingSpinner';
import ErrorState from '../ErrorState';
import EmptyState from '../EmptyState';
import { useToast } from '../Toast';
import { writingDecorations } from './writing-decorations';
import styles from './styles.module.scss';

/** Threshold: files larger than this show a performance warning */
const LARGE_FILE_THRESHOLD = 500_000; // 500KB

interface CursorPosition {
  line: number;
  column: number;
}

interface ScrollToLineRequest {
  line: number;
  id: number;
}

interface ReplaceLineRequest {
  line: number;
  text: string;
  id: number;
}

interface TextEditorProps {
  filePath: string | null;
  reloadToken?: number;
  focusMode?: boolean;
  wordWrap?: boolean;
  readOnly?: boolean;
  encoding?: string;
  characterNames?: string[];
  scrollToLine?: ScrollToLineRequest | null;
  replaceLineRequest?: ReplaceLineRequest | null;
  onContentChange?: (content: string) => void;
  onCursorChange?: (pos: CursorPosition) => void;
  onSaveUntitled?: (untitledPath: string, content: string) => void;
  settingsComponent?: React.ReactNode;
}

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

const getLanguageExtension = (lang: string) => {
  switch (lang) {
    case 'markdown':
      return markdown();
    case 'json':
      return json();
    case 'javascript':
    case 'typescript':
      return javascript({ typescript: lang === 'typescript' });
    default:
      return [];
  }
};

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
    // ── Search panel ──
    '.cm-panels': {
      backgroundColor: '#252526',
      color: '#d4d4d4',
      fontFamily:
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    },
    '.cm-panels.cm-panels-top': {
      borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
    },
    '.cm-panels.cm-panels-bottom': {
      borderTop: '1px solid rgba(255, 255, 255, 0.06)',
      boxShadow: '0 -2px 8px rgba(0, 0, 0, 0.25)',
    },
    // Search form — full width row layout
    '.cm-search': {
      width: '100%',
      boxSizing: 'border-box',
      padding: '8px 12px',
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: '4px 6px',
      fontSize: '13px',
    },
    // Text input fields (Find / Replace)
    '.cm-search input[type="text"], .cm-search input[main-field], .cm-search input[name="search"], .cm-search input[name="replace"]':
      {
        flex: '1 1 180px',
        minWidth: '0',
      },
    '.cm-search input, .cm-search select': {
      backgroundColor: '#1e1e1e',
      color: '#d4d4d4',
      border: '1px solid #383838',
      borderRadius: '5px',
      padding: '5px 10px',
      height: '28px',
      boxSizing: 'border-box',
      fontSize: '13px',
      outline: 'none',
      fontFamily: "'Fira Code', 'Monaco', 'Menlo', monospace",
      transition: 'border-color 0.15s, box-shadow 0.15s',
    },
    '.cm-search input::placeholder': {
      color: '#555',
    },
    '.cm-search input:focus': {
      borderColor: '#007acc',
      boxShadow: '0 0 0 1px rgba(0, 122, 204, 0.2)',
    },
    // Action buttons — pill shape, subtle
    '.cm-search button': {
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
      color: '#ccc',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      borderRadius: '5px',
      padding: '4px 10px',
      height: '28px',
      boxSizing: 'border-box',
      fontSize: '12px',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      transition: 'all 0.15s ease',
      lineHeight: '1',
    },
    '.cm-search button:hover': {
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
      borderColor: 'rgba(255, 255, 255, 0.15)',
      color: '#fff',
    },
    '.cm-search button:active': {
      backgroundColor: 'rgba(255, 255, 255, 0.14)',
      transform: 'scale(0.97)',
    },
    // Close button — icon-only, right-aligned
    '.cm-search button[name="close"]': {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '28px',
      height: '28px',
      padding: '0',
      marginLeft: 'auto',
      flexShrink: '0',
      fontSize: '16px',
      color: '#666',
      backgroundColor: 'transparent',
      border: 'none',
      borderRadius: '6px',
      transition: 'all 0.15s ease',
    },
    '.cm-search button[name="close"]:hover': {
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
      color: '#d4d4d4',
    },
    '.cm-search button[name="close"]:active': {
      backgroundColor: 'rgba(255, 255, 255, 0.15)',
      transform: 'scale(0.92)',
    },
    // Checkbox labels — compact, inline
    '.cm-search label': {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '3px',
      fontSize: '12px',
      color: '#999',
      cursor: 'pointer',
      padding: '2px 4px',
      borderRadius: '4px',
      transition: 'color 0.15s ease',
      userSelect: 'none',
      whiteSpace: 'nowrap',
    },
    '.cm-search label:hover': {
      color: '#d4d4d4',
    },
    '.cm-search label input[type="checkbox"]': {
      accentColor: '#007acc',
      margin: '0',
      width: '13px',
      height: '13px',
      flex: 'none',
    },
    '.cm-search .cm-button': {
      backgroundImage: 'none',
    },
    // br = flex line break (preserves CM6 row structure)
    '.cm-search br': {
      display: 'block',
      width: '100%',
      height: '0',
      flexBasis: '100%',
      content: "''",
    },
    // Replace buttons — subtle blue accent
    '.cm-search button[name="replace"], .cm-search button[name="replaceAll"]': {
      backgroundColor: 'rgba(0, 122, 204, 0.12)',
      color: '#569cd6',
      borderColor: 'rgba(0, 122, 204, 0.15)',
    },
    '.cm-search button[name="replace"]:hover, .cm-search button[name="replaceAll"]:hover': {
      backgroundColor: 'rgba(0, 122, 204, 0.22)',
      borderColor: 'rgba(0, 122, 204, 0.3)',
      color: '#7bb8e8',
    },
    '.cm-search button[name="replace"]:active, .cm-search button[name="replaceAll"]:active': {
      backgroundColor: 'rgba(0, 122, 204, 0.3)',
    },
    // Search match highlights
    '.cm-searchMatch': {
      backgroundColor: 'rgba(255, 200, 0, 0.15)',
      outline: '1px solid rgba(255, 200, 0, 0.3)',
      borderRadius: '2px',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'rgba(255, 150, 0, 0.28)',
      outline: '1px solid rgba(255, 150, 0, 0.5)',
    },
  },
  { dark: true }
);

/** Chinese localization for CM6 search panel */
const chinesePhrases = EditorState.phrases.of({
  Find: '查找',
  Replace: '替换',
  next: '下一个',
  previous: '上一个',
  all: '全部',
  'match case': '区分大小写',
  'by word': '全字匹配',
  regexp: '正则表达式',
  replace: '替换',
  'replace all': '全部替换',
  close: '✕',
  'current match': '当前匹配',
  'on line': '在第',
  'replaced $ matches': '已替换 $ 处匹配',
  'replaced match on line $': '已替换第 $ 行的匹配',
  'Go to line': '跳转到行',
  go: '跳转',
});

const TextEditor: React.FC<TextEditorProps> = ({
  filePath,
  reloadToken,
  focusMode = false,
  wordWrap = false,
  readOnly = false,
  encoding = 'UTF-8',
  characterNames = [],
  scrollToLine,
  replaceLineRequest,
  onContentChange,
  onCursorChange,
  onSaveUntitled,
  settingsComponent,
}) => {
  const isUntitled = isUntitledPath(filePath);
  const isChangelog = isChangelogPath(filePath);
  const toast = useToast();
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
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

  const currentFilePathRef = useRef<string | null>(null);
  const currentContentRef = useRef<string>('');
  const currentOriginalContentRef = useRef<string>('');
  const lastScrollIdRef = useRef(0);

  // Stable refs for callbacks to avoid re-creating EditorView
  const onContentChangeRef = useRef(onContentChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const onSaveUntitledRef = useRef(onSaveUntitled);
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
    readOnlyRef.current = readOnly;
  }, [readOnly]);
  useEffect(() => {
    filePathRef.current = filePath;
    isUntitledRef.current = isUntitledPath(filePath);
  }, [filePath]);

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

    if (isUntitledPath(targetPath) && onSaveUntitledRef.current) {
      onSaveUntitledRef.current(targetPath, currentContentRef.current);
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
    if (!editorContainerRef.current) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: '',
        extensions: [
          lineNumberCompartment.current.of(focusMode ? [] : lineNumbers()),
          highlightActiveLine(),
          highlightSelectionMatches(),
          history(),
          search({ top: true }),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          darkTheme,
          chinesePhrases,
          placeholder('开始输入您的内容...'),
          readOnlyCompartment.current.of(EditorView.editable.of(!readOnly)),
          wordWrapCompartment.current.of(wordWrap || focusMode ? EditorView.lineWrapping : []),
          languageCompartment.current.of([]),
          writingDecoCompartment.current.of(writingDecorations(characterNames)),
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

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

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
    const view = viewRef.current;
    if (!view || !filePath) return;
    const lang = isUntitled ? 'text' : getLanguageFromPath(filePath);
    const langExt = getLanguageExtension(lang);
    view.dispatch({
      effects: languageCompartment.current.reconfigure(langExt),
    });
  }, [filePath, isUntitled]);

  // Update writing decorations when character names change
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: writingDecoCompartment.current.reconfigure(writingDecorations(characterNames)),
    });
  }, [characterNames]);

  // Update focus mode line-fading extension
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        focusModeCompartment.current.reconfigure(focusLineDecorations(focusMode)),
        lineNumberCompartment.current.reconfigure(focusMode ? [] : lineNumbers()),
      ],
    });
  }, [focusMode]);

  // Save on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
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
        }
        onContentChange?.('');
        onCursorChange?.({ line: 1, column: 1 });
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
            const langExt = getLanguageExtension('markdown');
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: content },
              effects: [
                languageCompartment.current.reconfigure(langExt),
                readOnlyCompartment.current.reconfigure(EditorView.editable.of(false)),
                wordWrapCompartment.current.reconfigure(EditorView.lineWrapping),
              ],
            });
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
          const lang = getLanguageFromPath(filePath);
          const langExt = getLanguageExtension(lang);

          // Replace document content and reconfigure compartments
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: fileContent },
            effects: [
              languageCompartment.current.reconfigure(langExt),
              readOnlyCompartment.current.reconfigure(EditorView.editable.of(!readOnly)),
              wordWrapCompartment.current.reconfigure(wordWrap ? EditorView.lineWrapping : []),
            ],
          });
        }

        setIsLargeFile(fileContent.length > LARGE_FILE_THRESHOLD);
        setLastSaved(null);
        setHasChanges(false);
        setLoading(false);

        onContentChange?.(fileContent);
        onCursorChange?.({ line: 1, column: 1 });
      } catch (err) {
        console.error('Error reading file:', err);
        setError(`无法读取文件: ${filePath}`);
        currentContentRef.current = '';
        currentOriginalContentRef.current = '';
        setLoading(false);
      }
    };

    loadContent();
  }, [filePath, encoding, reloadToken]);

  // Scroll to line
  useEffect(() => {
    const view = viewRef.current;
    if (!scrollToLine || !view) return;
    if (scrollToLine.id <= lastScrollIdRef.current) return;
    lastScrollIdRef.current = scrollToLine.id;

    const lineInfo = view.state.doc.line(Math.min(scrollToLine.line, view.state.doc.lines));
    view.dispatch({
      selection: { anchor: lineInfo.from },
      scrollIntoView: true,
    });
    view.focus();
  }, [scrollToLine]);

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

  // Determine which overlay to show (if any)
  const showEmpty = !filePath;
  const showLoading = !!filePath && loading;
  const showError = !!filePath && !loading && !!error;
  const showEditor = !!filePath && !loading && !error;

  return (
    <div className={`${styles.textEditor} ${focusMode ? styles.focusModeEditor : ''}`}>
      {/* File header — only visible when a file is active */}
      {showEditor && !focusMode && (
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
              <button
                className={styles.saveButton}
                onClick={handleManualSave}
                disabled={autoSaving}
                title="保存 (⌘S)"
              >
                <VscSave />
              </button>
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
            message={error!}
            size="medium"
            onRetry={() => {
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
