/**
 * TextEditor 使用的 CodeMirror 静态扩展：主题、专注模式、行号、
 * 临时高亮行、"已应用"行标记、千字标记等。
 * 这些扩展均为模块级单例或纯工厂函数，不持有任何 React 状态。
 */
import {
  type EditorState,
  type Extension,
  Range,
  RangeSet,
  StateEffect,
  StateField,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
  gutter,
  highlightActiveLineGutter,
  lineNumbers,
  highlightActiveLine,
} from '@codemirror/view';
import { buildThousandCharMarkers } from '../../utils/contentStats';

const FOCUS_VISIBLE_RADIUS = 0;

/** 专注模式：淡化当前行以外的行 */
export const focusLineDecorations = (enabled: boolean) => {
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

/** Dark theme matching the existing editor style */
export const darkTheme = EditorView.theme(
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

export const setTransientLineHighlightEffect = StateEffect.define<number | null>();
export const setAppliedLineMarkerEffect = StateEffect.define<number | null>();

export const transientLineHighlightField = StateField.define<DecorationSet>({
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

export class ThousandCharMarkerWidget extends WidgetType {
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

export function buildThousandCharDecorationSet(
  state: EditorState,
  milestoneStep: number
): DecorationSet {
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

export function createThousandCharMarkerExtension(
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

export const appliedLineMarkerField = StateField.define<RangeSet<GutterMarker>>({
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

export const createLineNumberExtension = (focusMode: boolean, showLineNumbers: boolean) =>
  focusMode ? [] : showLineNumbers ? [lineNumbers(), appliedLineGutter] : [];

export const createActiveLineExtensions = (showLineNumbers: boolean) => [
  highlightActiveLine(),
  ...(showLineNumbers ? [highlightActiveLineGutter()] : []),
];

/** 自动换行扩展：专注模式下强制换行 */
export const createWordWrapExtension = (wordWrap: boolean, focusMode: boolean) =>
  wordWrap || focusMode ? EditorView.lineWrapping : [];
