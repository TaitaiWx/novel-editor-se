/**
 * Inline Diff Decoration — CodeMirror 6 编辑器内联差异展示
 *
 * 在编辑器内部渲染局部 diff 标注（删除行红色 + 新增行绿色 widget），
 * 不替换编辑器，不影响正常编辑。
 *
 * 样式与 InlineDiffView 完全统一：
 * - 相同的颜色体系（rgba(244,108,108) / rgba(78,172,107)）
 * - 字符级 diff 高亮（Myers 算法 via @novel-editor/basic-algorithm）
 * - +/- gutter 前缀标记
 *
 * 使用方式：
 * 1. 将 inlineDiffField + inlineDiffTheme 注册到 EditorState extensions
 * 2. 通过 setInlineDiffEffect 发送 diff 数据或 null 清除
 */
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { StateEffect, StateField, Range } from '@codemirror/state';
import { computeLineDiff, buildCharDiffMap } from '@novel-editor/basic-algorithm';

// ─── Diff 数据结构 ────────────────────────────────────────────────────────
export interface InlineDiffRange {
  /** 原文在 document 中的起始位置 (from) */
  from: number;
  /** 原文在 document 中的结束位置 (to) */
  to: number;
  /** 删除的原文文本 */
  oldText: string;
  /** 新增的替换文本 */
  newText: string;
}

// ─── Widget：在删除区域下方渲染新增文本（带字符级 diff + gutter） ─────────
class AddedTextWidget extends WidgetType {
  constructor(
    readonly oldText: string,
    readonly newText: string
  ) {
    super();
  }

  toDOM(_view: EditorView): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-inline-diff-added-block';

    // 使用 Myers line diff + char diff 对比 oldText → newText
    const oldLines = this.oldText.split('\n');
    const newLines = this.newText.split('\n');
    const diffLines = computeLineDiff(oldLines, newLines);
    const charDiffMap = buildCharDiffMap(diffLines);

    for (let i = 0; i < diffLines.length; i++) {
      const dl = diffLines[i];
      // 只显示新增行（删除行已在编辑器原位标注）
      if (dl.type !== 'add') continue;

      const lineEl = document.createElement('div');
      lineEl.className = 'cm-inline-diff-added-line';

      // Gutter 前缀 "+"
      const gutterEl = document.createElement('span');
      gutterEl.className = 'cm-inline-diff-gutter';
      gutterEl.textContent = '+';
      lineEl.appendChild(gutterEl);

      // 文本区域（带字符级 diff 高亮）
      const textEl = document.createElement('span');
      textEl.className = 'cm-inline-diff-line-text';

      const charSegs = charDiffMap.get(i);
      if (charSegs) {
        // 有字符级 diff → 渲染 keep/add 段
        for (const seg of charSegs) {
          if (seg.type === 'del') continue; // 已在编辑器原位标注
          const span = document.createElement('span');
          if (seg.type === 'add') {
            span.className = 'cm-inline-diff-char-add';
          }
          span.textContent = seg.text;
          textEl.appendChild(span);
        }
      } else {
        textEl.textContent = dl.text || '\u200B';
      }

      lineEl.appendChild(textEl);
      wrapper.appendChild(lineEl);
    }

    // 如果没有任何 add 行（纯删除），不显示空块
    if (wrapper.childElementCount === 0) {
      wrapper.style.display = 'none';
    }

    return wrapper;
  }

  eq(other: AddedTextWidget): boolean {
    return this.oldText === other.oldText && this.newText === other.newText;
  }

  get estimatedHeight(): number {
    return this.newText.split('\n').length * 22;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

// ─── StateEffect：设置 / 清除 inline diff ──────────────────────────────
export const setInlineDiffEffect = StateEffect.define<InlineDiffRange | null>();

// ─── StateField：管理 decorations ────────────────────────────────────────
export const inlineDiffField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setInlineDiffEffect)) {
        if (effect.value === null) {
          return Decoration.none;
        }
        const { from, to, oldText, newText } = effect.value;
        const decorations: Range<Decoration>[] = [];

        // 标注即将被替换的行（删除样式）
        const doc = tr.state.doc;
        let pos = from;
        while (pos <= to && pos <= doc.length) {
          const line = doc.lineAt(pos);
          if (line.from >= from || line.to <= to) {
            decorations.push(
              Decoration.line({ class: 'cm-inline-diff-del-line' }).range(line.from)
            );
          }
          if (line.to >= to) break;
          pos = line.to + 1;
        }

        // 字符级 diff：在删除区域内标注具体变更字符
        const oldLines = oldText.split('\n');
        const newLines = newText.split('\n');
        const diffLines = computeLineDiff(oldLines, newLines);
        const charDiffMap = buildCharDiffMap(diffLines);

        // 遍历 diffLines 中的 del 行，找到对应的编辑器行并标注 charDel
        let editorPos = from;
        for (let i = 0; i < diffLines.length; i++) {
          const dl = diffLines[i];
          if (dl.type !== 'del') continue;

          // 找到编辑器中对应的行
          if (editorPos > doc.length) break;
          const editorLine = doc.lineAt(editorPos);

          const charSegs = charDiffMap.get(i);
          if (charSegs) {
            // 有字符级差异 → 标注每个 del 段
            let charPos = editorLine.from;
            for (const seg of charSegs) {
              if (seg.type === 'add') continue; // 新增文本不在此行
              const byteLen = seg.text.length;
              if (seg.type === 'del' && byteLen > 0) {
                const segTo = Math.min(charPos + byteLen, doc.length);
                decorations.push(
                  Decoration.mark({ class: 'cm-inline-diff-char-del' }).range(charPos, segTo)
                );
              }
              charPos += byteLen;
            }
          } else {
            // 无字符级差异 → 整行标注删除
            if (editorLine.from < editorLine.to) {
              decorations.push(
                Decoration.mark({ class: 'cm-inline-diff-del-text' }).range(
                  editorLine.from,
                  editorLine.to
                )
              );
            }
          }

          editorPos = editorLine.to + 1;
        }

        // 在删除区域末尾行之后插入 widget 展示新增文本
        const endLine = doc.lineAt(Math.min(to, doc.length));
        decorations.push(
          Decoration.widget({
            widget: new AddedTextWidget(oldText, newText),
            block: true,
            side: 1,
          }).range(endLine.to)
        );

        // 按 from 排序
        decorations.sort((a, b) => a.from - b.from);
        return Decoration.set(decorations);
      }
    }
    // 文档变更时清除 diff（位置已无效）
    if (tr.docChanged) {
      return Decoration.none;
    }
    return deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// ─── 主题：与 InlineDiffView 完全统一的颜色体系 ────────────────────────────
export const inlineDiffTheme = EditorView.theme(
  {
    // 删除行 — 整行背景
    '.cm-inline-diff-del-line': {
      backgroundColor: 'rgba(244, 108, 108, 0.08)',
    },
    // 删除行 — 整行文本（无字符级 diff 时）
    '.cm-inline-diff-del-text': {
      backgroundColor: 'rgba(244, 108, 108, 0.08)',
      color: 'rgba(244, 108, 108, 0.7)',
      textDecoration: 'line-through',
      textDecorationColor: 'rgba(244, 108, 108, 0.35)',
    },
    // 删除行 — 字符级变更标注
    '.cm-inline-diff-char-del': {
      backgroundColor: 'rgba(244, 108, 108, 0.28)',
      borderRadius: '2px',
      padding: '0 1px',
      textDecoration: 'line-through',
      textDecorationColor: 'rgba(244, 108, 108, 0.35)',
    },
    // 新增块 — 容器（动态 paddingLeft 由 widget 设置）
    '.cm-inline-diff-added-block': {
      padding: '0',
    },
    // 新增行
    '.cm-inline-diff-added-line': {
      display: 'flex',
      alignItems: 'flex-start',
      backgroundColor: 'rgba(78, 172, 107, 0.1)',
      color: 'rgba(78, 172, 107, 0.95)',
      minHeight: '22px',
      lineHeight: '1.6',
    },
    // 新增行 — +/- 前缀 gutter
    '.cm-inline-diff-gutter': {
      flexShrink: '0',
      width: '20px',
      textAlign: 'center',
      fontWeight: '600',
      opacity: '0.6',
      userSelect: 'none',
    },
    // 新增行 — 文本区
    '.cm-inline-diff-line-text': {
      flex: '1',
      padding: '0 8px 0 2px',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    },
    // 新增行 — 字符级新增高亮
    '.cm-inline-diff-char-add': {
      backgroundColor: 'rgba(78, 172, 107, 0.32)',
      borderRadius: '2px',
      padding: '0 1px',
    },
  },
  { dark: true }
);
