/**
 * 小说格式（Novel Markdown）指令的实时预览：
 * - `:::scene{title=港口 pov=林舟}` 显示为场景条（标题 · 视角 · 地点 · 时间），`:::` 显示为细分隔线
 * - `::video[说明]{src=资料/视频/…mp4}` 就地显示播放器，`::image[说明]{src=…}` 就地显示图片；
 *   都可以「在旁边看」（编辑器右侧的参考窗格）
 * - 不用 Markdown 语法的结构行（「第一章 离港」「第一幕 离乡」「第一场 清晨」）显示为章 / 幕 / 场标题样式
 * 光标所在行显示源码（与其他实时预览一致）；只处理可见范围。
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
  classifyStructureLine,
  imageDirectiveSource,
  parseDirectiveAttributes,
  parseDirectiveLine,
  videoDirectiveSource,
  type DirectiveLine,
} from '@novel-editor/core/novel-format';
import { referenceItemFor, requestOpenReference } from '../../../utils/referencePane';
import { loadDirectiveMedia, mediaPathCandidates } from './media-loader';

/** 视频地址候选（兼容旧名，实现见 media-loader） */
export const videoPathCandidates = mediaPathCandidates;

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

type MediaKind = 'video' | 'image';

/** 媒体指令：就地显示播放器 / 图片 + 说明行（「在旁边看」打开参考窗格）；找不到文件时显示原因 */
class MediaWidget extends WidgetType {
  constructor(
    readonly kind: MediaKind,
    readonly src: string,
    readonly caption: string,
    readonly filePath: string | null
  ) {
    super();
  }
  eq(other: MediaWidget) {
    return (
      other.kind === this.kind &&
      other.src === this.src &&
      other.caption === this.caption &&
      other.filePath === this.filePath
    );
  }
  get estimatedHeight() {
    return this.kind === 'video' ? 320 : 280;
  }
  toDOM(view: EditorView) {
    const label = this.caption || this.src.split(/[\\/]/).pop() || this.src;
    const figure = document.createElement('span');
    figure.className = `cm-lp-media cm-lp-${this.kind} cm-lp-pending`;
    figure.setAttribute('role', 'figure');
    figure.setAttribute('aria-label', `${this.kind === 'video' ? '视频' : '图片'} ${label}`);
    const frame = document.createElement('span');
    frame.className = 'cm-lp-media-frame';
    frame.textContent = '正在加载…';
    const bar = document.createElement('span');
    bar.className = 'cm-lp-media-caption';
    const title = document.createElement('span');
    title.textContent = `${this.kind === 'video' ? '视频' : '图片'} · ${label}`;
    bar.append(title);
    figure.append(frame, bar);

    loadDirectiveMedia(this.filePath, this.src)
      .then(({ path, url }) => {
        frame.textContent = '';
        if (this.kind === 'video') {
          const video = document.createElement('video');
          video.className = 'cm-lp-video-player';
          video.src = url;
          video.controls = true;
          video.preload = 'metadata';
          video.playsInline = true;
          video.addEventListener('loadedmetadata', () => view.requestMeasure(), { once: true });
          frame.append(video);
        } else {
          const img = document.createElement('img');
          img.className = 'cm-lp-image-directive';
          img.src = url;
          img.alt = label;
          img.addEventListener('load', () => view.requestMeasure(), { once: true });
          frame.append(img);
        }
        const beside = document.createElement('button');
        beside.type = 'button';
        beside.className = 'cm-lp-media-beside';
        beside.textContent = '在旁边看';
        beside.setAttribute('aria-label', `在旁边看 ${label}`);
        beside.addEventListener('mousedown', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const item = referenceItemFor(path, label);
          if (item) requestOpenReference({ items: [item] });
        });
        bar.append(beside);
        figure.classList.remove('cm-lp-pending');
        view.requestMeasure();
      })
      .catch(() => {
        figure.classList.remove('cm-lp-pending');
        figure.classList.add('cm-lp-media-missing');
        frame.textContent = `找不到${this.kind === 'video' ? '视频' : '图片'}：${this.src}`;
        figure.title = '路径相对作品目录，例如 资料/视频/…';
        view.requestMeasure();
      });
    return figure;
  }
  ignoreEvent() {
    return true;
  }
}

/** 行内人物指令 `:char[阿舟]{id=林舟}`：显示方括号里的文字（人物色、虚下划线），悬停显示指向的人物 */
class CharacterWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly target: string
  ) {
    super();
  }
  eq(other: CharacterWidget) {
    return other.label === this.label && other.target === this.target;
  }
  toDOM() {
    const element = document.createElement('span');
    element.className = 'cm-lp-char';
    element.textContent = this.label;
    if (this.target && this.target !== this.label) element.title = `人物：${this.target}`;
    return element;
  }
  ignoreEvent() {
    return false;
  }
}

const INLINE_DIRECTIVE = /(^|[^:\w]):([A-Za-z][\w-]*)\[([^\]\n]*)\](\{[^}\n]*\})?/g;

function addInlineDirectives(builder: RangeSetBuilder<Decoration>, from: number, text: string) {
  if (!text.includes(':')) return;
  INLINE_DIRECTIVE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_DIRECTIVE.exec(text))) {
    const start = from + match.index + match[1].length;
    const end = from + match.index + match[0].length;
    if (match[2] !== 'char' || !match[3]) continue;
    const attributes = match[4] ? parseDirectiveAttributes(match[4]) : null;
    const target = attributes?.values.id || attributes?.id || match[3];
    builder.add(start, end, Decoration.replace({ widget: new CharacterWidget(match[3], target) }));
  }
}

const STRUCTURE_LINE = {
  chapter: Decoration.line({ class: 'cm-lp-chapter-title' }),
  act: Decoration.line({ class: 'cm-lp-act-title' }),
  scene: Decoration.line({ class: 'cm-lp-scene-title' }),
};

function buildDecorations(view: EditorView, filePath: string | null): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  const cursorLine = state.doc.lineAt(state.selection.main.head).number;
  for (const { from, to } of view.visibleRanges) {
    let line = state.doc.lineAt(from);
    for (;;) {
      const structure = classifyStructureLine(line.text);
      if (structure) builder.add(line.from, line.from, STRUCTURE_LINE[structure]);
      if (line.number !== cursorLine && line.text.trimStart().startsWith('::')) {
        const directive = parseDirectiveLine(line.text);
        const video = directive ? videoDirectiveSource(line.text) : null;
        const image = directive && !video ? imageDirectiveSource(line.text) : null;
        let widget: WidgetType | null = null;
        if (directive?.kind === 'container-open' && directive.name === 'scene') {
          widget = new SceneWidget(describeSceneDirective(directive), false);
        } else if (directive?.kind === 'container-close') {
          widget = new SceneWidget('', true);
        } else if (video) {
          widget = new MediaWidget('video', video.src, video.caption, filePath);
        } else if (image) {
          widget = new MediaWidget('image', image.src, image.caption, filePath);
        }
        if (widget && line.length > 0) {
          builder.add(line.from, line.to, Decoration.replace({ widget }));
        }
      } else if (line.number !== cursorLine) {
        addInlineDirectives(builder, line.from, line.text);
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
  '.cm-lp-media': {
    display: 'inline-flex',
    flexDirection: 'column',
    gap: '6px',
    width: 'min(100%, 640px)',
    margin: '6px 0',
    verticalAlign: 'top',
  },
  '.cm-lp-media-frame': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '120px',
    overflow: 'hidden',
    borderRadius: '10px',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    background: 'rgba(255, 255, 255, 0.03)',
    color: '#8b8b8b',
    fontSize: '0.85em',
  },
  '.cm-lp-media-frame video, .cm-lp-media-frame img': {
    display: 'block',
    width: '100%',
    maxHeight: '420px',
    objectFit: 'contain',
    background: '#0f0f10',
  },
  '.cm-lp-media-caption': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    fontSize: '0.82em',
    color: '#9a9a9a',
  },
  '.cm-lp-media-beside': {
    padding: '1px 8px',
    border: '1px solid rgba(86, 156, 214, 0.35)',
    borderRadius: '6px',
    background: 'rgba(86, 156, 214, 0.1)',
    color: '#cfe1f3',
    font: 'inherit',
    cursor: 'pointer',
  },
  '.cm-lp-media-missing .cm-lp-media-frame': {
    minHeight: '48px',
    borderStyle: 'dashed',
    borderColor: 'rgba(224, 138, 128, 0.45)',
    color: '#e8a29a',
  },
  '.cm-lp-char': {
    color: '#9cdcfe',
    borderBottom: '1px dashed rgba(156, 220, 254, 0.5)',
  },
  '.cm-lp-chapter-title': {
    fontSize: '1.45em',
    fontWeight: '600',
    letterSpacing: '0.04em',
    color: '#e8e8e8',
    paddingTop: '0.4em',
    paddingBottom: '0.2em',
  },
  '.cm-lp-act-title': {
    fontSize: '1.15em',
    fontWeight: '600',
    color: '#d9c18d',
  },
  '.cm-lp-scene-title': {
    fontWeight: '600',
    color: '#c8b48a',
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
