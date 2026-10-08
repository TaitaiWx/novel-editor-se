import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHARACTER_GUIDE,
  renderCharacterGuideMarkdown,
} from '@/render/components/RightPanel/CharactersView/characterGuide';
import { CHARACTER_DETAIL_TABS } from '@/render/components/RightPanel/CharactersView/CharacterDetailWorkspace';
import { renderGuideMarkdown } from '@/render/utils/guideContent';

const DOC = path.resolve(__dirname, '../../../../../../docs/character-guide.md');

describe('角色使用说明', () => {
  it('docs/character-guide.md 与 renderCharacterGuideMarkdown() 完全一致（修改文案后请重新生成）', () => {
    expect(readFileSync(DOC, 'utf-8')).toBe(renderCharacterGuideMarkdown());
  });

  it('人物详情的每个分页都有对应说明（不能只讲成长档案）', () => {
    const titles = CHARACTER_GUIDE.sections.map((section) => section.title).join('|');
    for (const tab of CHARACTER_DETAIL_TABS) {
      const key = tab.label.split('与')[0];
      expect(titles, tab.label).toContain(key);
    }
    // 成长档案只是其中一节
    const growthSections = CHARACTER_GUIDE.sections.filter((section) =>
      section.title.includes('成长')
    );
    expect(growthSections).toHaveLength(1);
  });

  it('3 步上手简短；除常见问题外每节一句说明 + 一个林舟的例子', () => {
    expect(CHARACTER_GUIDE.quickStart).toHaveLength(3);
    for (const step of CHARACTER_GUIDE.quickStart) expect(step.length).toBeLessThanOrEqual(40);
    for (const section of CHARACTER_GUIDE.sections.filter((item) => item.id !== 'faq')) {
      expect(
        section.blocks.filter((block) => block.kind === 'p'),
        section.id
      ).toHaveLength(1);
      const example = section.blocks.find((block) => block.kind === 'example');
      expect(JSON.stringify(example), section.id).toContain('林舟');
    }
    const ids = CHARACTER_GUIDE.sections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.at(-1)).toBe('faq');
  });
});

describe('renderGuideMarkdown', () => {
  it('渲染标题、来源注释、3 步上手与各类块', () => {
    const markdown = renderGuideMarkdown(
      {
        anchorPrefix: 'demo',
        title: '演示',
        summary: '概述',
        quickStart: ['第一步', '第二步'],
        sections: [
          {
            id: 'a',
            title: '甲',
            blocks: [
              { kind: 'p', text: '段落' },
              { kind: 'list', items: ['x', 'y'] },
              { kind: 'steps', items: ['先', '后'] },
              { kind: 'example', text: '例子' },
              { kind: 'faq', items: [{ q: '问', a: '答' }] },
            ],
          },
        ],
      },
      'src/demo.ts'
    );
    expect(markdown).toBe(
      [
        '# 演示',
        '',
        '<!-- 由 src/demo.ts 生成，请修改源文件后同步 -->',
        '',
        '概述',
        '',
        '## 3 步上手',
        '',
        '1. 第一步',
        '2. 第二步',
        '',
        '## 甲',
        '',
        '段落',
        '',
        '- x\n- y',
        '',
        '1. 先\n2. 后',
        '',
        '> 例：例子',
        '',
        '**问**\n\n答',
        '',
      ].join('\n')
    );
  });
});
