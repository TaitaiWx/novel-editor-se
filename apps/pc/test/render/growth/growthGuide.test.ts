import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDndRuleset, createSheet, type GrowthEvent } from '@novel-editor/core/growth';
import {
  GROWTH_GUIDE_SECTIONS,
  GROWTH_GUIDE_TITLE,
  GROWTH_TIPS,
  GROWTH_TOUR_STEPS,
  renderGrowthGuideMarkdown,
} from '@/render/components/RightPanel/GrowthView/growthGuide';
import {
  countAttention,
  defaultRecordChapter,
  describeRecordResult,
  groupEventsByChapter,
  relevantForgotten,
  sheetFilePaths,
} from '@/render/components/RightPanel/GrowthView/growthText';

const DOC = path.resolve(__dirname, '../../../../../docs/growth-guide.md');

function headings(markdown: string, level: number): string[] {
  const prefix = `${'#'.repeat(level)} `;
  return markdown
    .split('\n')
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim());
}

describe('使用说明与 docs/growth-guide.md 同源', () => {
  const doc = readFileSync(DOC, 'utf-8');

  it('文档的标题与章节和应用内使用说明一致', () => {
    expect(headings(doc, 1)).toEqual([GROWTH_GUIDE_TITLE]);
    expect(headings(doc, 2)).toEqual(GROWTH_GUIDE_SECTIONS.map((section) => section.title));
  });

  it('文档内容与 renderGrowthGuideMarkdown() 完全一致（修改文案后请重新生成）', () => {
    expect(doc).toBe(renderGrowthGuideMarkdown());
  });

  it('覆盖要求的主题，并用同一个例子贯穿', () => {
    const ids = GROWTH_GUIDE_SECTIONS.map((section) => section.id);
    expect(ids).toEqual([
      'intro',
      'level',
      'attributes',
      'skills',
      'choices',
      'record',
      'warnings',
      'simulate',
      'world',
      'data',
      'workflow',
      'faq',
    ]);
    const examples = GROWTH_GUIDE_SECTIONS.flatMap((section) =>
      section.blocks.filter((block) => block.kind === 'example')
    );
    expect(examples.length).toBeGreaterThanOrEqual(8);
    for (const block of examples) expect(JSON.stringify(block)).toContain('林舟');
    const faq = JSON.stringify(GROWTH_GUIDE_SECTIONS.find((section) => section.id === 'faq'));
    for (const topic of ['升级所需的经验', '删错', '多本书']) expect(faq).toContain(topic);
  });

  it('提示文案简短且带例子，引导 3~4 步', () => {
    for (const [key, text] of Object.entries(GROWTH_TIPS)) {
      expect(text.length, key).toBeLessThanOrEqual(80);
    }
    for (const key of ['attributes', 'skills', 'choices', 'timeline', 'warnings', 'exp']) {
      expect(GROWTH_TIPS[key as keyof typeof GROWTH_TIPS]).toContain('例');
    }
    expect(GROWTH_TOUR_STEPS.length).toBeGreaterThanOrEqual(3);
    expect(GROWTH_TOUR_STEPS.length).toBeLessThanOrEqual(4);
  });
});

describe('growthText', () => {
  const ruleset = createDndRuleset();
  const sheet = createSheet(ruleset, '白芷');

  it('记一笔的结果提示', () => {
    const after = { ...sheet, level: 2, exp: 300 };
    expect(
      describeRecordResult({
        name: '白芷',
        ruleset,
        event: { type: 'exp', delta: 300 },
        before: sheet,
        after,
        levelUps: 1,
      })
    ).toBe('白芷 获得 300 经验，升到 Lv.2');
    expect(
      describeRecordResult({
        name: '白芷',
        ruleset,
        event: { type: 'exp', delta: -50 },
        before: sheet,
        after: sheet,
        levelUps: 0,
      })
    ).toBe('白芷 失去 50 经验');
    expect(
      describeRecordResult({
        name: '白芷',
        ruleset,
        event: { type: 'choice', target: 'path', value: 'mage' },
        before: sheet,
        after: sheet,
        levelUps: 0,
      })
    ).toBe('白芷 选择了「法师之道」');
  });

  it('默认章节、成长卡文件路径与提醒计数', () => {
    expect(defaultRecordChapter(12, sheet)).toBe(12);
    expect(defaultRecordChapter(null, sheet)).toBeUndefined();
    expect(sheetFilePaths('/n/资料/记忆/', 'a/b')).toEqual([
      '/n/资料/记忆/角色/a_b.json',
      '/n/资料/记忆/角色/a_b.md',
    ]);
    expect(sheetFilePaths('C:\\n\\资料\\记忆', '林舟')[0]).toBe(
      'C:\\n\\资料\\记忆\\角色\\林舟.json'
    );
    expect(
      countAttention(
        [
          { severity: 'error', code: 'A', message: 'a' },
          { severity: 'info', code: 'B', message: 'b' },
        ],
        []
      )
    ).toEqual({ errors: 1, warnings: 0, forgotten: 0, total: 1 });
  });

  it('时间线按章节分组，最新在上', () => {
    const event = (id: string, chapter?: number): GrowthEvent => ({
      id,
      at: '',
      type: 'note',
      ...(chapter !== undefined ? { chapter } : {}),
    });
    const groups = groupEventsByChapter([event('1', 1), event('2', 2), event('3', 2), event('4')]);
    expect(groups.map((group) => [group.chapter, group.events.map((item) => item.id)])).toEqual([
      [null, ['4']],
      [2, ['3', '2']],
      [1, ['1']],
    ]);
  });

  it('只保留与该角色相关的被遗忘配角', () => {
    const forgotten = [
      { name: '老铁', lastSeenChapter: 1, chaptersAbsent: 40, important: false, parties: ['银月'] },
      { name: '路人', lastSeenChapter: 1, chaptersAbsent: 40, important: false, parties: [] },
    ];
    const party = {
      schemaVersion: 1,
      parties: [{ id: 'p', name: '银月', members: ['白芷', '老铁'] }],
      companions: [],
    };
    expect(relevantForgotten(forgotten, party, '白芷').map((item) => item.name)).toEqual(['老铁']);
    expect(relevantForgotten(forgotten, party, '路人').map((item) => item.name)).toEqual(['路人']);
  });
});
