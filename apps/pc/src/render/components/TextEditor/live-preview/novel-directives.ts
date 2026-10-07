/**
 * 小说格式（Novel Markdown）指令的实时预览：
 * - `:::scene{title=港口 pov=林舟}` 显示为场景条（标题 · 视角 · 地点 · 时间），`:::` 显示为细分隔线
 * - `::video[说明]{src=资料/视频/…mp4}` 显示为视频卡片，单击在编辑器旁边的参考窗格里播放
 * 光标所在行显示源码（与其他实时预览一致）；只处理可见范围，单行替换不影响行高计算。
 */
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import {
  parseDirectiveLine,
  videoDirectiveSource,
  type DirectiveLine,
} from '@novel-editor/core/novel-format';
import { referenceItemFor, requestOpenReference } from '../../../utils/referencePane';

/** 视频地址候选：相对作品目录（推荐写法），先试章节所在目录，再逐级向上（最多 4 级） */
export function videoPathCandidates(filePath: string | null, src: string): string[] {
  const value = src.trim();
  if (!value) return [];
  if (/^([a-zA-Z]:[\\/]|\/)/.test(value)) return [value];
  if (!filePath) return [];
  const separator = filePath.includes('\\') && !filePath.includes('/') ? '\\' : '/';
  const parts = filePath.split(/[\\/]/);
  parts.pop();
  const candidates: string[] = [];
  for (let depth = 0; depth < 5 && parts.length > 0; depth += 1) {
    candidates.push([...parts, ...value.split(/[\\/]+/).filter(Boolean)].join(separator));
    parts.pop();
  }
  return candidates;
}

async function openVideo(filePath: string | null, src: string, caption: string): Promise<boolean> {
  const ipc = typeof window !== 'undefined' ? window.electron?.ipcRenderer : undefined;
  if (!ipc) return false;
  for (const candidate of videoPathCandidates(filePath, src)) {
    const exists = await ipc
      .invoke('get-file-info', candidate)
      .then(() => true)
      .catch(() => false);
    if (!exists) continue;
    const item = referenceItemFor(candidate, caption || undefined);
    if (item) {
      requestOpenReference({ items: [item] });
      return true;
    }
  }
  return false;
}

/** 场景条上的说明：标题 · 视角 · 地点 · 时间 */
export function describeSceneDirective(directive: DirectiveLine): string {
  const values = directive.attributes.values;
  const title = values.title || directive.label || directive.attributes.id || '未命名场景';
  return [title, values.pov && `视角 ${values.pov}`, values.location, values.time]
    .filter(Boolean)
    .join(' · ');
}

class SceneWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly closing: boolean
  ) {
    super();
  }
  eq(other: SceneWidget) {
    return other.text === this.text && other.closing === this.closing;
  }
  toDOM() {
    const element = document.createElement('span');
    element.className = this.closing ? 'cm-lp-scene-end' : 'cm-lp-scene';
    element.textContent = this.closing ? '场景结束' : `场景 · ${this.text}`;
    return element;
  }
  ignoreEvent() {
    return false;
  }
}

class VideoWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly caption: string,
    readonly filePath: string | null
  ) {
    super();
  }
  eq(other: VideoWidget) {
    return (
      other.src === this.src && other.caption === this.caption && other.filePath === this.filePath
    );
  }
  toDOM() {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'cm-lp-video';
    element.title = `${this.src}\n单击在编辑器旁边播放`;
    element.setAttribute('aria-label', `播放视频 ${this.caption || this.src}`);
    element.textContent = `▶ 视频 · ${this.caption || this.src.split(/[\\/]/).pop()}`;
    element.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void openVideo(this.filePath, this.src, this.caption).then((opened) => {
        if (!opened) element.classList.add('cm-lp-video-missing');
      });
    });
    return element;
  }
  ignoreEvent() {
    return true;
  }
}

function buildDecorations(view: EditorView, filePath: string | null): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  const cursorLine = state.doc.lineAt(state.selection.main.head).number;
  for (const { from, to } of view.visibleRanges) {
    let line = state.doc.lineAt(from);
    for (;;) {
      if (line.number !== cursorLine && line.text.trimStart().startsWith('::')) {
        const directive = parseDirectiveLine(line.text);
        const video = directive ? videoDirectiveSource(line.text) : null;
        let widget: WidgetType | null = null;
        if (directive?.kind === 'container-open' && directive.name === 'scene') {
          widget = new SceneWidget(describeSceneDirective(directive), false);
        } else if (directive?.kind === 'container-close') {
          widget = new SceneWidget('', true);
        } else if (video) {
          widget = new VideoWidget(video.src, video.caption, filePath);
        }
        if (widget && line.length > 0) {
          builder.add(line.from, line.to, Decoration.replace({ widget }));
        }
      }
      if (line.to >= to || line.number >= state.doc.lines) break;
      line = state.doc.line(line.number + 1);
    }
  }
  return builder.finish();
}

const theme = EditorView.baseTheme({
  '.cm-lp-scene': {
    display: 'inline-block',
    padding: '1px 10px',
    borderRadius: '999px',
    fontSize: '0.85em',
    color: '#d9c18d',
    background: 'rgba(215, 186, 125, 0.12)',
  },
  '.cm-lp-scene-end': {
    display: 'inline-block',
    width: '100%',
    height: '0',
    borderTop: '1px dashed rgba(215, 186, 125, 0.3)',
    fontSize: '0',
    verticalAlign: 'middle',
  },
  '.cm-lp-video': {
    padding: '4px 12px',
    border: '1px solid rgba(86, 156, 214, 0.4)',
    borderRadius: '8px',
    background: 'rgba(86, 156, 214, 0.12)',
    color: '#cfe1f3',
    font: 'inherit',
    fontSize: '0.9em',
    cursor: 'pointer',
  },
  '.cm-lp-video-missing': {
    borderColor: 'rgba(224, 138, 128, 0.5)',
    color: '#e8a29a',
  },
});

/** 指令实时预览扩展（只在 .md 实时预览里启用） */
export function novelDirectivePreview(filePath: string | null): Extension {
  return [
    theme,
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = buildDecorations(view, filePath);
        }
        update(update: ViewUpdate) {
          if (update.docChanged || update.viewportChanged || update.selectionSet) {
            this.decorations = buildDecorations(update.view, filePath);
          }
        }
      },
      { decorations: (plugin) => plugin.decorations }
    ),
  ];
}
