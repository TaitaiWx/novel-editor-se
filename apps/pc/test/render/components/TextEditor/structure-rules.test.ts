// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { novelDirectivePreview } from '@/render/components/TextEditor/live-preview/novel-directives';
import { writingDecorations } from '@/render/components/TextEditor/writing-decorations';
import { structureRulesField } from '@/render/components/TextEditor/structure-rules';
import { getStructureRules, setStructureConfig } from '@/render/utils/structureRules';

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
  setStructureConfig(null);
});

function mount(doc: string, extensions = [novelDirectivePreview(null)]) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  view = new EditorView({ state: EditorState.create({ doc, extensions }), parent });
  return view;
}

const lineClasses = (target: EditorView) =>
  Array.from(target.dom.querySelectorAll('.cm-line')).map((line) => line.className);

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('编辑器按正文结构规则识别结构行', () => {
  it('默认规则：中文与 English 章 / 幕 / 场都带标题样式', () => {
    const target = mount('Chapter 1: The Harbor\nAct II\nScene 3 - Dawn\nShe said chapter one.');
    const classes = lineClasses(target);
    expect(classes[0]).toContain('cm-lp-chapter-title');
    expect(classes[1]).toContain('cm-lp-act-title');
    expect(classes[2]).toContain('cm-lp-scene-title');
    expect(classes[3]).not.toMatch(/cm-lp-(chapter|act|scene)-title/);
  });

  it('修改规则后已打开的编辑器立即刷新（不用重新打开文件）', async () => {
    const target = mount('=== Dawn ===\nChapter 1\n第一章 离港');
    expect(lineClasses(target)[0]).not.toContain('cm-lp-scene-title');

    await act(async () => {
      setStructureConfig({
        presets: ['zh'],
        custom: [{ id: 'sep', kind: 'scene', pattern: '^=== (.+) ===$' }],
      });
    });
    await flush();
    expect(target.state.field(structureRulesField)).toBe(getStructureRules());
    const classes = lineClasses(target);
    expect(classes[0]).toContain('cm-lp-scene-title');
    // 关闭 English 后「Chapter 1」不再是标题
    expect(classes[1]).not.toContain('cm-lp-chapter-title');
    expect(classes[2]).toContain('cm-lp-chapter-title');
  });

  it('创建视图前规则已变化时直接使用新规则', () => {
    setStructureConfig({ presets: [], custom: [{ id: 'x', kind: 'act', pattern: '^ACT:' }] });
    const target = mount('ACT: one\n第一章');
    const classes = lineClasses(target);
    expect(classes[0]).toContain('cm-lp-act-title');
    expect(classes[1]).not.toContain('cm-lp-chapter-title');
  });

  it('写作装饰（所有文件类型）同样按规则刷新', async () => {
    const target = mount('Episode 4\nbody', [writingDecorations([])]);
    expect(lineClasses(target)[0]).not.toContain('cm-chapter-line');
    await act(async () => {
      setStructureConfig({
        presets: ['zh', 'en'],
        custom: [{ id: 'ep', kind: 'chapter', pattern: '^episode \\d+$', flags: 'i' }],
      });
    });
    await flush();
    expect(lineClasses(target)[0]).toContain('cm-chapter-line');
  });

  it('两个扩展同时使用时共享同一个规则字段', () => {
    const target = mount('Act I', [novelDirectivePreview(null), writingDecorations([])]);
    const classes = lineClasses(target)[0];
    expect(classes).toContain('cm-lp-act-title');
    expect(classes).toContain('cm-act-line');
  });
});
