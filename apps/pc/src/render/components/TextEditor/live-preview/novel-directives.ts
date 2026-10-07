/**
 * 小说格式（Novel Markdown）指令的实时预览：
 * - `:::scene{title=港口 pov=林舟}` 显示为场景条（标题 · 视角 · 地点 · 时间），`:::` 显示为细分隔线
 * - `::video[说明]{src=资料/视频/…mp4}` 就地显示播放器，`::image[说明]{src=…}` 就地显示图片，
 *   `::audio[说明]{src=资料/音乐/…m4a loop volume=0.6}` 就地显示音频播放条（播放器的音频界面）；
 *   都可以「在旁边看 / 听」（编辑器右侧的参考窗格）
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
  audioDirectiveSource,
  imageDirectiveSource,
  parseDirectiveAttributes,
  parseDirectiveLine,
  videoDirectiveSource,
  type DirectiveLine,
} from '@novel-editor/core/novel-format';
import { loadDirectiveMedia, mediaPathCandidates } from './media-loader';
import { mountMediaFigure } from './media-figure';
import {
  classifyLineInState,
  structureRulesChanged,
  structureRulesExtension,
} from '../structure-rules';

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

type MediaKind = 'video' | 'image' | 'audio';

const MEDIA_KIND_NAMES: Record<MediaKind, string> = { video: '视频', image: '图片', audio: '音频' };

/** 音频指令的播放选项（循环 / 初始音量） */
export interface AudioOptions {
  loop: boolean;
  volume?: number;
}

/** widget DOM → 挂载状态（destroy 时卸载 React root；加载完成前被销毁则不再挂载） */
const mountedMedia = new WeakMap<HTMLElement, { disposed: boolean; unmount?: () => void }>();

/** 媒体指令：就地显示播放器 / 图片（悬停右上角「在旁边看」打开参考窗格）；找不到文件时显示原因 */
class MediaWidget extends WidgetType {
  constructor(
    readonly kind: MediaKind,
    readonly src: string,
    readonly caption: string,
    readonly filePath: string | null,
    readonly audio: AudioOptions | null = null
  ) {
    super();
  }
  eq(other: MediaWidget) {
    return (
      other.kind === this.kind &&
      other.src === this.src &&
      other.caption === this.caption &&
      other.filePath === this.filePath &&
      other.audio?.loop === this.audio?.loop &&
      other.audio?.volume === this.audio?.volume
    );
  }
  get estimatedHeight() {
    if (this.kind === 'audio') return 96;
    return this.kind === 'video' ? 320 : 280;
  }
  toDOM(view: EditorView) {
    const label = this.caption || this.src.split(/[\\/]/).pop() || this.src;
    const kindName = MEDIA_KIND_NAMES[this.kind];
    const figure = document.createElement('span');
    figure.className = `cm-lp-media cm-lp-${this.kind} cm-lp-pending`;
    figure.setAttribute('role', 'figure');
    figure.setAttribute('aria-label', `${kindName} ${label}`);
    const placeholder = document.createElement('span');
    placeholder.className = 'cm-lp-media-frame';
    placeholder.textContent = `${kindName} · ${label} · 正在加载…`;
    figure.append(placeholder);
    const handle: { disposed: boolean; unmount?: () => void } = { disposed: false };
    mountedMedia.set(figure, handle);

    loadDirectiveMedia(this.filePath, this.src)
      .then(({ path, url }) => {
        if (handle.disposed) return;
        placeholder.remove();
        const host = document.createElement('span');
        host.className = 'cm-lp-media-host';
        figure.append(host);
        figure.classList.remove('cm-lp-pending');
        handle.unmount = mountMediaFigure(host, {
          kind: this.kind,
          path,
          url,
          label,
          ...(this.audio ? { loop: this.audio.loop, volume: this.audio.volume } : {}),
          onLayoutChange: () => view.requestMeasure(),
        });
        view.requestMeasure();
      })
      .catch(() => {
        if (handle.disposed) return;
        figure.classList.remove('cm-lp-pending');
        figure.classList.add('cm-lp-media-missing');
        placeholder.textContent = `找不到${kindName}：${this.src}`;
        figure.title = '路径相对作品目录，例如 资料/视频/…';
        view.requestMeasure();
      });
    return figure;
  }
  destroy(dom: HTMLElement) {
    const handle = mountedMedia.get(dom);
    if (!handle) return;
    handle.disposed = true;
    handle.unmount?.();
    mountedMedia.delete(dom);
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
      const structure = classifyLineInState(state, line.text);
      if (structure) builder.add(line.from, line.from, STRUCTURE_LINE[structure]);
      if (line.number !== cursorLine && line.text.trimStart().startsWith('::')) {
        const directive = parseDirectiveLine(line.text);
        const video = directive ? videoDirectiveSource(line.text) : null;
        const image = directive && !video ? imageDirectiveSource(line.text) : null;
        const audio = directive && !video && !image ? audioDirectiveSource(line.text) : null;
        let widget: WidgetType | null = null;
        if (directive?.kind === 'container-open' && directive.name === 'scene') {
          widget = new SceneWidget(describeSceneDirective(directive), false);
        } else if (directive?.kind === 'container-close') {
          widget = new SceneWidget('', true);
        } else if (video) {
          widget = new MediaWidget('video', video.src, video.caption, filePath);
        } else if (image) {
          widget = new MediaWidget('image', image.src, image.caption, filePath);
        } else if (audio) {
          widget = new MediaWidget('audio', audio.src, audio.caption, filePath, {
            loop: audio.loop,
            volume: audio.volume,
          });
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
    display: 'inline-block',
    width: '100%',
    margin: '6px 0',
    verticalAlign: 'top',
    lineHeight: 'normal',
  },
  '.cm-lp-media-host': {
    display: 'block',
  },
  // 加载中 / 找不到：一条细的提示条，不占大块空白
  '.cm-lp-media-frame': {
    display: 'flex',
    alignItems: 'center',
    width: 'min(100%, 640px)',
    minHeight: '40px',
    padding: '0 12px',
    boxSizing: 'border-box',
    borderRadius: '10px',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    background: 'rgba(255, 255, 255, 0.03)',
    color: '#8b8b8b',
    fontSize: '0.85em',
  },
  '.cm-lp-audio .cm-lp-media-frame': {
    width: 'min(100%, 520px)',
  },
  '.cm-lp-video .cm-lp-media-frame': {
    aspectRatio: '16 / 9',
    justifyContent: 'center',
  },
  '.cm-lp-media-missing .cm-lp-media-frame': {
    aspectRatio: 'auto',
    justifyContent: 'flex-start',
    borderStyle: 'dashed',
    borderColor: 'rgba(224, 138, 128, 0.45)',
    color: '#e8a29a',
  },
  // 图片：边框贴合图片比例，没有大块空框
  '.cm-lp-image-frame': {
    position: 'relative',
    display: 'inline-block',
    maxWidth: 'min(100%, 640px)',
    overflow: 'hidden',
    borderRadius: '10px',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    background: 'rgba(255, 255, 255, 0.03)',
    verticalAlign: 'top',
  },
  '.cm-lp-image-directive': {
    display: 'block',
    maxWidth: '100%',
    maxHeight: '420px',
    width: 'auto',
    height: 'auto',
  },
  '.cm-lp-media-actions': {
    position: 'absolute',
    top: '8px',
    right: '8px',
    display: 'flex',
    gap: '4px',
    opacity: '0',
    transition: 'opacity 0.18s ease',
  },
  '.cm-lp-image-frame:hover .cm-lp-media-actions, .cm-lp-image-frame:focus-within .cm-lp-media-actions':
    {
      opacity: '1',
    },
  '.cm-lp-media-beside': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    padding: '0',
    border: '1px solid rgba(255, 255, 255, 0.14)',
    borderRadius: '7px',
    background: 'rgba(20, 20, 22, 0.55)',
    backdropFilter: 'blur(6px)',
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: '15px',
    cursor: 'pointer',
  },
  '.cm-lp-media-beside:hover': {
    background: 'rgba(20, 20, 22, 0.75)',
    color: '#fff',
  },
  '@media (prefers-reduced-motion: reduce)': {
    '.cm-lp-media-actions': { transition: 'none' },
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
    // 结构行（章 / 幕 / 场）按项目的正文结构规则识别，规则变化时立即重建
    structureRulesExtension,
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = buildDecorations(view, filePath);
        }
        update(update: ViewUpdate) {
          if (
            update.docChanged ||
            update.viewportChanged ||
            update.selectionSet ||
            structureRulesChanged(update)
          ) {
            this.decorations = buildDecorations(update.view, filePath);
          }
        }
      },
      { decorations: (plugin) => plugin.decorations }
    ),
  ];
}
