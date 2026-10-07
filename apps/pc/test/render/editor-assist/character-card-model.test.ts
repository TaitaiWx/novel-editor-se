import { describe, expect, it, vi } from 'vitest';
import { createDndRuleset, createSheet, totalExpForLevel } from '@novel-editor/core/growth';
import type { Character } from '@/render/components/RightPanel/types';
import {
  buildCharacterCardModel,
  findGrowthSheetForCharacter,
  findLastAppearance,
  formatLastAppearance,
  oneLine,
} from '@/render/components/CharacterHoverCard/model';
import { chapterLabel, workChapters } from '@/render/hooks/useEditorAssist';
import {
  charactersForContext,
  growthForContext,
  outlineForContext,
} from '@/render/utils/writingSources';
import { loadAvatarSource, resolveAvatarPath } from '@/render/utils/characterAvatar';
import type { PersistedOutlineRow } from '@/render/types/electron-api';
import type { GrowthSnapshot } from '@/render/types/growth-api';

const LIN: Character = {
  id: 1,
  name: '林舟',
  role: '主角 · 旅人',
  category: 'major',
  description: '青石镇长大的少年，父亲三十年前追着星图出海未归。跟随老铁匠学过剑术。',
  currentState: [
    { id: 's1', label: '道途', value: '战士之道' },
    { id: 's2', label: '伤势', value: '左臂旧伤未愈' },
    { id: 's3', label: '随身', value: '旧剑「青石」' },
  ],
  aliases: ['阿舟'],
  highlightColor: '#9cdcfe',
};

describe('人物卡片数据', () => {
  const ruleset = createDndRuleset();

  it('成长卡按名字或别名对上；等级与经验条', () => {
    const sheet = createSheet(ruleset, '阿舟');
    sheet.level = 4;
    sheet.exp = totalExpForLevel(ruleset, 4) + 10;
    expect(findGrowthSheetForCharacter([sheet], LIN)).toBe(sheet);
    const model = buildCharacterCardModel({ character: LIN, growth: { sheet, ruleset } });
    expect(model).toMatchObject({
      name: '林舟',
      initial: '林',
      aliases: ['阿舟'],
      tags: ['主要角色', '主角团'],
      role: '主角 · 旅人',
      summary: '青石镇长大的少年，父亲三十年前追着星图出海未归。',
    });
    expect(model.states.map((item) => item.label)).toEqual(['伤势', '随身']);
    expect(model.growth?.level).toBe(4);
    expect(model.growth?.ratio).toBeGreaterThan(0);
    expect(model.growth?.expText).toMatch(/^经验 \d+ \/ \d+$/);
  });

  it('没有成长卡 / 当前状态时自动收缩；状态退回成长卡备注', () => {
    const bare = { ...LIN, currentState: [], aliases: [], description: '' };
    const model = buildCharacterCardModel({ character: bare });
    expect(model.growth).toBeNull();
    expect(model.states).toEqual([]);
    expect(model.summary).toBe('');
    const sheet = createSheet(ruleset, '林舟');
    sheet.notes = ['a', '受伤'];
    expect(buildCharacterCardModel({ character: bare, growth: { sheet, ruleset } }).states).toEqual(
      [
        { label: '状态', value: 'a' },
        { label: '状态', value: '受伤' },
      ]
    );
    expect(findGrowthSheetForCharacter([sheet], { name: '苏晴', aliases: [] })).toBeNull();
  });

  it('oneLine 取第一句并截断', () => {
    expect(oneLine('  第一句。第二句。')).toBe('第一句。');
    expect(oneLine('很'.repeat(60), 10)).toBe(`${'很'.repeat(10)}…`);
  });
});

describe('上次出场', () => {
  const chapters = [
    { path: '/w/卷一/001.md', label: '卷一 · 001' },
    { path: '/w/卷一/002.md', label: '卷一 · 002' },
    { path: '/w/卷一/003.md', label: '卷一 · 003' },
    { path: '/w/卷二/004.md', label: '卷二 · 004' },
  ];
  const texts: Record<string, string> = {
    '/w/卷一/001.md': '林舟出发',
    '/w/卷一/002.md': '阿舟喝水',
    '/w/卷一/003.md': '苏晴采药',
    '/w/卷二/004.md': '林舟回来',
  };

  it('从当前章往前逐章查找（找到即停），别名也算', async () => {
    const read = vi.fn((path: string) => texts[path]);
    const found = await findLastAppearance(chapters, ['林舟', '阿舟'], '/w/卷二/004.md', read);
    expect(found).toEqual({ path: '/w/卷一/002.md', label: '卷一 · 002', chaptersAgo: 2 });
    expect(read.mock.calls.map((call) => call[0])).toEqual(['/w/卷一/003.md', '/w/卷一/002.md']);
    expect(formatLastAppearance(found)).toBe('卷一 · 002（2 章前）');
  });

  it('当前章不在列表中时查全部；没出场 / 单字名返回 null', async () => {
    const read = (path: string) => texts[path];
    expect(await findLastAppearance(chapters, ['林舟'], null, read)).toMatchObject({
      label: '卷二 · 004',
      chaptersAgo: null,
    });
    expect(await findLastAppearance(chapters, ['白鸦'], null, read)).toBeNull();
    expect(await findLastAppearance(chapters, ['舟'], null, read)).toBeNull();
    expect(formatLastAppearance(null)).toBe('此前没有出场');
    expect(formatLastAppearance({ path: '', label: 'x', chaptersAgo: 1 })).toBe('x（上一章）');
  });

  it('章节列表只取当前作品并自然排序，标签相对作品目录', () => {
    const nodes = [
      { path: '/p/novels/甲/第二卷/010-x.md' },
      { path: '/p/novels/甲/第一卷/2-b.md' },
      { path: '/p/novels/甲/第一卷/10-c.md' },
      { path: '/p/novels/乙/001.md' },
    ];
    expect(workChapters(nodes, '/p/novels/甲').map((item) => item.label)).toEqual([
      '第一卷 · 2-b',
      '第一卷 · 10-c',
      '第二卷 · 010-x',
    ]);
    expect(chapterLabel('C:\\p\\甲\\001.md', 'C:\\p\\甲')).toBe('001');
  });
});

describe('续写资料', () => {
  it('人物：定位 + 简介、最近 2 条状态', () => {
    expect(charactersForContext([LIN, { ...LIN, id: 2, name: ' ' }])).toEqual([
      {
        name: '林舟',
        aliases: ['阿舟'],
        summary: `主角 · 旅人；${LIN.description}`,
        status: '伤势：左臂旧伤未愈；随身：旧剑「青石」',
      },
    ]);
    // 人物设计一并带上（续写不跑偏人设）
    const designed = charactersForContext([
      {
        ...LIN,
        design: {
          appearance: '黑发',
          personality: '嘴硬心软',
          background: '',
          speech: '',
          outfit: '',
        },
      },
    ]);
    expect(designed[0].summary).toBe(`主角 · 旅人；${LIN.description}；外貌：黑发；性格：嘴硬心软`);
  });

  it('成长档案与核心规则；未初始化时为空', () => {
    const ruleset = { ...createDndRuleset(), coreRules: [{ id: 'r', text: '等级上限 20' }] };
    const sheet = createSheet(ruleset, '林舟');
    const snapshot = { initialized: true, ruleset, sheets: [sheet] } as unknown as GrowthSnapshot;
    const result = growthForContext(snapshot);
    expect(result.rules).toEqual(['等级上限 20']);
    expect(result.growth[0]).toMatchObject({ name: '林舟', level: 1 });
    expect(growthForContext(null)).toEqual({ growth: [], rules: [] });
  });

  it('章纲按层级与顺序展开为要点', () => {
    const row = (id: number, parent: number | null, order: number, title: string, content = '') =>
      ({ id, parent_id: parent, sort_order: order, title, content }) as PersistedOutlineRow;
    expect(
      outlineForContext([
        row(2, null, 1, '雾林遇狼', '苏晴出手'),
        row(1, null, 0, '离开青石镇'),
        row(3, 2, 0, '狼王现身'),
        row(4, null, 2, ' '),
      ])
    ).toEqual(['离开青石镇', '雾林遇狼：苏晴出手', '  狼王现身']);
  });
});

describe('人物头像', () => {
  it('相对路径解析到作品目录，拒绝越界；data URL 直接使用', async () => {
    expect(resolveAvatarPath('资料/人物头像/林舟-1.png', '/w/甲')).toBe(
      '/w/甲/资料/人物头像/林舟-1.png'
    );
    expect(resolveAvatarPath('../x.png', '/w/甲')).toBeNull();
    expect(resolveAvatarPath('data:image/png;base64,xx', '/w')).toBeNull();
    expect(await loadAvatarSource('data:image/png;base64,xx', null)).toBe(
      'data:image/png;base64,xx'
    );
    const read = vi.fn(async () => ({ base64Content: 'QUJD', mimeType: 'image/png' }));
    const first = await loadAvatarSource('资料/人物头像/a.png', '/w/乙', read);
    const second = await loadAvatarSource('资料/人物头像/a.png', '/w/乙', read);
    expect(first).toBe('data:image/png;base64,QUJD');
    expect(second).toBe(first);
    expect(read).toHaveBeenCalledOnce();
    expect(await loadAvatarSource(undefined, '/w')).toBeNull();
    const notImage = vi.fn(async () => ({ base64Content: 'x', mimeType: 'text/plain' }));
    expect(await loadAvatarSource('资料/人物头像/b.txt', '/w/乙', notImage)).toBeNull();
  });
});
