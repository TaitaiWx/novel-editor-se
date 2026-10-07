import { describe, expect, it } from 'vitest';
import {
  allocateChapters,
  applyVolumePlanOverlay,
  buildTemplatePlan,
  buildVolumePlanPrompt,
  charactersInChapter,
  computeChapterTension,
  computeCharacterLanes,
  deriveVolumeOutline,
  describeTensionCurve,
  findForeshadowing,
  firstSentence,
  nextStructure,
  parseVolumePlanResponse,
  pickStructureByChapterCount,
  type VolumeChapterSource,
} from './index';

const chapter = (
  file: string,
  title: string,
  content: string,
  outline?: string[]
): VolumeChapterSource => ({ path: `/w/卷一/${file}`, title, content, outline });

const MARKED: VolumeChapterSource[] = [
  chapter(
    '001-启程.md',
    '启程',
    [
      '# 启程',
      '',
      '林舟背起行囊，走出了小镇。',
      '',
      '第一幕 离乡',
      '',
      '第一场 清晨的青石镇',
      '石板路还湿着。林舟回头看了一眼。',
      '第二场 铁匠铺的夜',
      '前一晚，炉火映得秦伯满脸通红。',
    ].join('\n')
  ),
  chapter(
    '002-迷雾森林.md',
    '迷雾森林',
    ['# 迷雾森林', '第二幕 迷雾', '第一场 入林', '雾很浓。苏晴出现了。'].join('\n')
  ),
  chapter('003-过渡.md', '过渡', ['# 过渡', '林舟在林中走了三天。'].join('\n')),
];

describe('deriveVolumeOutline', () => {
  it('按正文的幕 / 场标记推导 幕 → 章 → 节拍', () => {
    const outline = deriveVolumeOutline(MARKED);
    expect(outline.structure).toBe('markers');
    expect(outline.hasMarkers).toBe(true);
    // 001 有场景标记，幕标记之前的开篇句不单独成段
    expect(outline.acts.map((act) => act.title)).toEqual(['第一幕 离乡', '第二幕 迷雾']);
    const act1 = outline.acts[0];
    expect(act1.line).toBe(5);
    expect(act1.chapters).toHaveLength(1);
    expect(act1.chapters[0].continued).toBe(false);
    expect(act1.chapters[0].beats.map((beat) => [beat.title, beat.text])).toEqual([
      ['第一场 清晨的青石镇', '石板路还湿着。'],
      ['第二场 铁匠铺的夜', '前一晚，炉火映得秦伯满脸通红。'],
    ]);
    expect(act1.chapters[0].beats[0].line).toBe(7);
    // 没有幕标记的 003 延续第二幕，用开篇句兜底
    const act2 = outline.acts[1];
    expect(act2.chapters.map((item) => item.title)).toEqual(['迷雾森林', '过渡']);
    expect(act2.chapters[1].beats[0]).toMatchObject({
      source: 'opening',
      text: '林舟在林中走了三天。',
    });
  });

  it('第一个幕标记之前的章节归入「开篇」；一章内跨幕时拆成两段', () => {
    const outline = deriveVolumeOutline([
      MARKED[2],
      chapter('x.md', 'X', '第一场 前情\n铺垫。\n第二幕 风暴\n第一场 来袭\n风来了。'),
    ]);
    expect(outline.acts.map((act) => act.title)).toEqual(['开篇', '第二幕 风暴']);
    expect(outline.acts[0].chapters.map((c) => [c.title, c.continued])).toEqual([
      ['过渡', false],
      ['X', false],
    ]);
    expect(outline.acts[1].chapters[0]).toMatchObject({ title: 'X', continued: true });
    expect(outline.acts[1].chapters[0].beats[0].text).toBe('风来了。');
  });

  it('幕标记之前没有内容时不生成空的开篇段', () => {
    const outline = deriveVolumeOutline([MARKED[1]]);
    expect(outline.acts.map((act) => act.title)).toEqual(['第二幕 迷雾']);
    expect(outline.acts[0].chapters[0].continued).toBe(false);
  });

  it('没有幕标记时按章数自动选结构模板，并按比例分章', () => {
    const plain = Array.from({ length: 4 }, (_, i) =>
      chapter(`00${i + 1}.md`, `第${i + 1}章`, `正文${i + 1}。`)
    );
    const outline = deriveVolumeOutline(plain);
    expect(outline.structure).toBe('kishotenketsu');
    expect(outline.structureLabel).toBe('起承转合');
    expect(outline.acts.map((act) => [act.title, act.chapters.length])).toEqual([
      ['起', 1],
      ['承', 1],
      ['转', 1],
      ['合', 1],
    ]);
    expect(outline.acts[0].hint).toContain('人物登场');
  });

  it('可以强制指定结构；指定 markers 但没有标记时回退到模板', () => {
    expect(deriveVolumeOutline(MARKED, { structure: 'three-act' }).acts).toHaveLength(3);
    const plain = [chapter('a.md', 'A', '内容')];
    expect(deriveVolumeOutline(plain, { structure: 'markers' }).structure).toBe('three-act');
  });

  it('空卷仍给出各段结构提示', () => {
    const outline = deriveVolumeOutline([]);
    expect(outline.acts.map((act) => act.title)).toEqual([
      '第一幕 · 建置',
      '第二幕 · 对抗',
      '第三幕 · 解决',
    ]);
    expect(outline.acts.every((act) => act.chapters.length === 0)).toBe(true);
  });

  it('没有场景标记时依次用 章纲 → 小标题 → 开篇句 作为节拍', () => {
    const withOutline = chapter('a.md', 'A', '## 小标题\n正文', ['相遇', '争执']);
    const withHeading = chapter('b.md', 'B', '# B\n## 雨夜\n正文\n## 第3章 不算\n### 黎明');
    const outline = deriveVolumeOutline([withOutline, withHeading], { structure: 'three-act' });
    const beats = outline.acts.flatMap((act) => act.chapters.flatMap((c) => c.beats));
    expect(beats.map((beat) => [beat.source, beat.text])).toEqual([
      ['outline', '相遇'],
      ['outline', '争执'],
      ['heading', '雨夜'],
      ['heading', '黎明'],
    ]);
  });

  it('同名场景生成不重复的 key', () => {
    const outline = deriveVolumeOutline([
      chapter('a.md', 'A', '第一幕 甲\n第一场 夜\n一\n第二幕 乙\n第一场 夜\n二'),
    ]);
    const keys = outline.acts.flatMap((act) =>
      act.chapters.flatMap((c) => c.beats.map((b) => b.key))
    );
    expect(new Set(keys).size).toBe(2);
  });
});

describe('structures', () => {
  it('按章数自动挑选模板', () => {
    expect(pickStructureByChapterCount(0)).toBe('three-act');
    expect(pickStructureByChapterCount(3)).toBe('three-act');
    expect(pickStructureByChapterCount(4)).toBe('kishotenketsu');
    expect(pickStructureByChapterCount(8)).toBe('kishotenketsu');
    expect(pickStructureByChapterCount(9)).toBe('hero-journey');
    expect(pickStructureByChapterCount(120)).toBe('hero-journey');
  });

  it('分章：总数守恒、每段至少一章、章数不足时保留首末段', () => {
    expect(allocateChapters(12, [0.25, 0.5, 0.25])).toEqual([3, 6, 3]);
    expect(allocateChapters(3, [0.25, 0.5, 0.25])).toEqual([1, 1, 1]);
    expect(allocateChapters(2, [0.25, 0.5, 0.25])).toEqual([1, 0, 1]);
    expect(allocateChapters(1, [0.25, 0.5, 0.25])).toEqual([1, 0, 0]);
    expect(allocateChapters(0, [0.5, 0.5])).toEqual([0, 0]);
    const sizes = allocateChapters(10, [0.15, 0.15, 0.3, 0.25, 0.15]);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(10);
    expect(sizes.every((size) => size >= 1)).toBe(true);
  });

  it('换一种结构：没有幕标记时跳过 markers 循环', () => {
    expect(nextStructure('markers', true)).toBe('three-act');
    expect(nextStructure('hero-journey', true)).toBe('markers');
    expect(nextStructure('hero-journey', false)).toBe('three-act');
  });

  it('firstSentence 取首句并截断', () => {
    expect(firstSentence('他来了。然后走了。')).toBe('他来了。');
    expect(firstSentence('“你一定要回来。”小石头说')).toBe('“你一定要回来。”');
    expect(firstSentence('字'.repeat(60))).toHaveLength(49);
  });
});

describe('applyVolumePlanOverlay', () => {
  it('叠加就地改写、建议、排序与幕说明，不修改原对象', () => {
    const outline = deriveVolumeOutline(MARKED);
    const [first, second] = outline.acts[0].chapters[0].beats;
    const path = MARKED[0].path;
    const next = applyVolumePlanOverlay(outline, {
      beatEdits: { [first.key]: '  改写后的节拍 ', [second.key]: '   ' },
      beatOrder: { [path]: [second.key, first.key] },
      suggestions: { [path]: ['新的建议', '石板路还湿着。', ''] },
      actNotes: { [outline.acts[0].key]: '离开家乡' },
    });
    const beats = next.acts[0].chapters[0].beats;
    expect(beats.map((beat) => beat.text)).toEqual([
      '前一晚，炉火映得秦伯满脸通红。',
      '改写后的节拍',
      '新的建议',
    ]);
    expect(beats[2].source).toBe('suggestion');
    expect(next.acts[0].hint).toBe('离开家乡');
    expect(outline.acts[0].chapters[0].beats[0].text).toBe('石板路还湿着。');
  });
});

describe('computeChapterTension', () => {
  it('冲突越多张力越高，映射到卷内 1-5', () => {
    const calm = chapter('a.md', '日常', '阳光很好。他们慢慢地喝茶，聊起了往事和远方的朋友。');
    const fight = chapter('b.md', '狼王之夜', '狼嚎！血！他拔剑砍去，狼扑上来撕咬！快逃！危险！');
    const empty = chapter('c.md', '空', '');
    const [low, high, none] = computeChapterTension([calm, fight, empty]);
    expect(high.level).toBe(5);
    expect(low.level).toBeLessThan(high.level);
    expect(none.level).toBe(1);
    expect(high.signals.join(' ')).toContain('冲突词');
    expect(high.signals).toContain('标题含转折');
  });

  it('全部相同时为 3；描述曲线给出提示', () => {
    const same = [1, 2, 3].map((i) => chapter(`${i}.md`, `${i}`, '平静的一天。'));
    const tension = computeChapterTension(same);
    expect(tension.map((item) => item.level)).toEqual([3, 3, 3]);
    expect(describeTensionCurve(tension)[0]).toContain('连续 3 章');
    expect(describeTensionCurve(tension.slice(0, 1))).toEqual([]);
    const falling = [5, 2, 1].map((level, i) => ({ ...tension[i], level }));
    const notes = describeTensionCurve(falling);
    expect(notes.some((note) => note.includes('卷首'))).toBe(true);
    expect(notes.some((note) => note.includes('卷末'))).toBe(true);
  });
});

describe('computeCharacterLanes', () => {
  it('按名字与别名统计每章出场，按总数排序并过滤未出场人物', () => {
    const lanes = computeCharacterLanes(MARKED, [
      { name: '苏晴' },
      { name: '林舟', aliases: ['舟哥', '林舟', '林'] },
      { name: '白鸦' },
      { name: '林舟' },
    ]);
    expect(lanes.map((lane) => lane.name)).toEqual(['林舟', '苏晴']);
    expect(lanes[0].counts).toEqual([2, 0, 1]);
    expect(lanes[0]).toMatchObject({ first: 0, last: 2, total: 3 });
    expect(lanes[1]).toMatchObject({ first: 1, last: 1 });
    expect(charactersInChapter(lanes, 1)).toEqual(['苏晴']);
    expect(computeCharacterLanes(MARKED, [{ name: '林舟' }, { name: '苏晴' }], 1)).toHaveLength(1);
  });
});

describe('findForeshadowing', () => {
  it('找出埋线句子，后文出现相同片段时标记为已呼应', () => {
    const items = findForeshadowing([
      chapter('a.md', '启程', '秦伯给了他一块星图碎片。这是你爹留下的秘密。', ['与小石头的约定']),
      chapter('b.md', '星港', '他摸出星图碎片，对着灯光看。'),
    ]);
    // 后文再次提到「星图碎片」是呼应，不算新的伏笔
    expect(items.filter((item) => item.keyword === '碎片')).toHaveLength(1);
    const shard = items.find((item) => item.keyword === '碎片');
    expect(shard).toMatchObject({ echoed: true, echoedIn: '星港', line: 1 });
    const secret = items.find((item) => item.keyword === '秘密');
    expect(secret?.echoed).toBe(false);
    expect(items.find((item) => item.keyword === '约定')?.line).toBe(0);
    // 未呼应的排在前面
    expect(items[items.length - 1].echoed).toBe(true);
  });
});

describe('generate', () => {
  const outline = deriveVolumeOutline(MARKED);

  it('确定性生成：意图写进首末段，只给缺少节拍的章节补建议', () => {
    const plan = buildTemplatePlan(outline, '林舟离开小镇');
    expect(plan.actNotes[outline.acts[0].key]).toMatch(/^起点：林舟离开小镇。/);
    expect(plan.actNotes[outline.acts[1].key]).toMatch(/^落点：回应「林舟离开小镇」/);
    expect(plan.suggestions[MARKED[2].path]).toHaveLength(1);
    expect(plan.suggestions[MARKED[0].path]).toBeUndefined();
    const noIntent = buildTemplatePlan(outline, '');
    expect(noIntent.actNotes[outline.acts[0].key]).not.toContain('起点');
  });

  it('AI 提示词包含意图、幕 key 与章节文件名', () => {
    const prompt = buildVolumePlanPrompt(outline, '林舟离开小镇', ['林舟']);
    expect(prompt.prompt).toContain('林舟离开小镇');
    expect(prompt.context).toContain(outline.acts[0].key);
    expect(prompt.context).toContain('001-启程.md');
    expect(prompt.context).toContain('主要人物：林舟');
    expect(buildVolumePlanPrompt(deriveVolumeOutline([]), '').context).toContain('还没有章节');
  });

  it('解析 AI 返回的 JSON（含代码块），按 key / 标题 / 文件名匹配', () => {
    const text = [
      '```json',
      JSON.stringify({
        acts: [
          { key: outline.acts[0].key, note: '离开家乡' },
          { title: '第二幕 迷雾', note: '初入险境' },
          { key: 'nope', note: '忽略' },
        ],
        chapters: [
          { file: '003-过渡.md', beats: ['遇到岔路', 1, ''] },
          { file: '迷雾森林', beats: ['迷路'] },
          { file: 'x.md', beats: ['忽略'] },
        ],
      }),
      '```',
    ].join('\n');
    const plan = parseVolumePlanResponse(text, outline);
    expect(plan?.actNotes).toEqual({
      [outline.acts[0].key]: '离开家乡',
      [outline.acts[1].key]: '初入险境',
    });
    expect(plan?.suggestions).toEqual({
      [MARKED[2].path]: ['遇到岔路'],
      [MARKED[1].path]: ['迷路'],
    });
    expect(parseVolumePlanResponse('不是 JSON', outline)).toBeNull();
    expect(parseVolumePlanResponse('{"acts": []}', outline)).toBeNull();
    expect(parseVolumePlanResponse('{bad json}', outline)).toBeNull();
  });
});
