/**
 * CM6 写作装饰插件
 *
 * 为小说/剧本内容提供视觉标记：
 * - 幕标题高亮 (第X幕)
 * - 场景标题高亮 (第X场)
 * - 章节标题高亮 (第X章, 第X卷, 第X回 等)
 * - 人物名称高亮（可配置）
 */
import {
  EditorView,
  Decoration,
  type DecorationSet,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import type { Extension } from '@codemirror/state';

// ── 正则 ──

/** 中文幕标记 */
const RE_ACT = /^(第[一二三四五六七八九十百千万零〇\d]+幕)\s*(.*)/;
/** 中文场景标记 */
const RE_SCENE = /^(第[一二三四五六七八九十百千万零〇\d]+场)\s*(.*)/;
/** 中文章节/卷/回/节/部/篇/集 */
const RE_CHAPTER = /^(第[一二三四五六七八九十百千万零〇\d]+[章卷回节部篇集])\s*(.*)/;
/** Markdown 标题 */
const RE_HEADING = /^(#{1,6})\s+(.+)/;

// ── Decoration 样式 ──

const actLineDeco = Decoration.line({ class: 'cm-act-line' });
const sceneLineDeco = Decoration.line({ class: 'cm-scene-line' });
const chapterLineDeco = Decoration.line({ class: 'cm-chapter-line' });
const headingLineDeco = Decoration.line({ class: 'cm-heading-line' });

/** 人物名称 mark 装饰 */
const characterMark = Decoration.mark({ class: 'cm-character-name' });

/**
 * 构建可见范围内的装饰集
 * @param charRegex 预编译的人物名称正则（缓存在 ViewPlugin 实例中）
 */
function buildDecorations(view: EditorView, charRegex: RegExp | null): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const text = line.text.trim();

      // 行装饰
      if (RE_ACT.test(text)) {
        builder.add(line.from, line.from, actLineDeco);
      } else if (RE_SCENE.test(text)) {
        builder.add(line.from, line.from, sceneLineDeco);
      } else if (RE_CHAPTER.test(text)) {
        builder.add(line.from, line.from, chapterLineDeco);
      } else if (RE_HEADING.test(text)) {
        builder.add(line.from, line.from, headingLineDeco);
      }

      // 人物名称高亮（行内 mark）
      if (charRegex) {
        charRegex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = charRegex.exec(line.text)) !== null) {
          const start = line.from + match.index;
          const end = start + match[0].length;
          builder.add(start, end, characterMark);
        }
      }

      pos = line.to + 1;
    }
  }

  return builder.finish();
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 从人物名称列表构建正则，结果可缓存 */
function buildCharRegex(names: string[]): RegExp | null {
  if (names.length === 0) return null;
  return new RegExp(`(${names.map(escapeRegExp).join('|')})`, 'g');
}

/**
 * 创建写作装饰扩展
 *
 * @param characterNames 需要高亮的人物名称列表
 */
export function writingDecorations(characterNames: string[] = []): Extension {
  // 预编译正则，整个扩展生命周期内复用
  const cachedRegex = buildCharRegex(characterNames);

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, cachedRegex);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, cachedRegex);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );

  const theme = EditorView.baseTheme({
    // 幕标题行
    '.cm-act-line': {
      backgroundColor: 'rgba(0, 122, 204, 0.12)',
      borderLeft: '3px solid #007acc',
      paddingLeft: '8px',
      fontWeight: 'bold',
    },
    // 场景标题行
    '.cm-scene-line': {
      backgroundColor: 'rgba(78, 201, 176, 0.10)',
      borderLeft: '3px solid #4ec9b0',
      paddingLeft: '8px',
    },
    // 章节标题行
    '.cm-chapter-line': {
      backgroundColor: 'rgba(220, 220, 170, 0.08)',
      borderLeft: '3px solid #dcdcaa',
      paddingLeft: '8px',
      fontWeight: 'bold',
    },
    // Markdown 标题行 (弱标记)
    '.cm-heading-line': {
      backgroundColor: 'rgba(197, 134, 192, 0.06)',
      borderLeft: '2px solid rgba(197, 134, 192, 0.4)',
      paddingLeft: '8px',
    },
    // 人物名称高亮
    '.cm-character-name': {
      color: '#9cdcfe',
      borderBottom: '1px dotted rgba(156, 220, 254, 0.4)',
      borderRadius: '2px',
    },
  });

  return [plugin, theme];
}
