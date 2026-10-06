import type { StoryIdeaCardRow, StoryIdeaOutputRow } from '@/render/types/electron-api';
import {
  STORY_IDEA_GENERATION_SCOPE_LABELS,
  STORY_IDEA_OUTPUT_LABELS,
  STORY_IDEA_SOURCE_LABELS,
  STORY_IDEA_STATUS_LABELS,
  STORY_IDEA_TERM_POOL_SOURCE_LABELS,
  STORY_IDEA_TERM_SECTION_LABELS,
  buildStoryIdeaSearchText,
  buildStoryIdeaSnapshot,
  buildStoryIdeaTermPoolFromCards,
  buildStoryIdeaTermSummary,
  buildStoryIdeaVersionName,
  createEmptyStoryIdeaDraft,
  createEmptyStoryIdeaTermPool,
  draftToStoryIdeaUpdatePayload,
  getIdeaTermPoolValues,
  getStoryIdeaTermsBySection,
  mergeStoryIdeaTermPool,
  normalizeIdeaTags,
  normalizeIdeaTermPool,
  normalizeIdeaTerms,
  parseStoryIdeaSnapshot,
  parseStoryIdeaTermPool,
  pickRandomStoryIdeaTerms,
  pickSelectedOutput,
  replaceStoryIdeaTermRandomly,
  serializeStoryIdeaDraft,
  serializeStoryIdeaTermPool,
  setStoryIdeaTermsBySection,
  toStoryIdeaDraft,
} from '@/render/components/RightPanel/story-idea';
import type {
  StoryIdeaCardDraft,
  StoryIdeaTermPoolEntry,
} from '@/render/components/RightPanel/story-idea';

function makeDraft(overrides: Partial<StoryIdeaCardDraft> = {}): StoryIdeaCardDraft {
  return {
    ...createEmptyStoryIdeaDraft(),
    title: '雪夜剑客',
    premise: '一个失忆剑客在雪夜里追查自己的过去',
    tags: ['武侠', '悬疑'],
    themeTerms: ['雪夜', '断剑'],
    conflictTerms: ['师门背叛'],
    twistTerms: ['仇人是自己'],
    ...overrides,
  };
}

function makeRow(overrides: Partial<StoryIdeaCardRow> = {}): StoryIdeaCardRow {
  return {
    id: 1,
    novel_id: 1,
    title: '雪夜剑客',
    premise: '失忆剑客追查过去',
    tags_json: '["武侠","悬疑"]',
    source: 'ai',
    status: 'exploring',
    theme_seed: '雪夜 / 断剑',
    conflict_seed: '师门背叛',
    twist_seed: '仇人是自己',
    protagonist_wish: '',
    core_obstacle: '',
    irony_or_gap: '',
    escalation_path: '',
    payoff_hint: '',
    selected_logline: '他追杀的人是他自己',
    selected_direction: '倒叙',
    note: '多用意象',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  };
}

function makeOutput(overrides: Partial<StoryIdeaOutputRow> = {}): StoryIdeaOutputRow {
  return {
    id: 10,
    idea_card_id: 1,
    novel_id: 1,
    type: 'outline_direction',
    content: '复仇线：林远一路北上',
    meta_json: '{}',
    sort_order: 0,
    is_selected: 0,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('labels', () => {
  it('expose Chinese labels', () => {
    expect(STORY_IDEA_STATUS_LABELS.promoted_to_outline).toBe('已转大纲');
    expect(STORY_IDEA_SOURCE_LABELS.ai).toBe('AI');
    expect(STORY_IDEA_OUTPUT_LABELS.scene_hook).toBe('场景钩子');
    expect(STORY_IDEA_TERM_SECTION_LABELS.twist).toBe('变形签');
    expect(STORY_IDEA_TERM_POOL_SOURCE_LABELS.history).toBe('历史');
    expect(STORY_IDEA_GENERATION_SCOPE_LABELS.anchored).toBe('尽量贴近当前正文');
  });
});

describe('normalizers', () => {
  it('normalizeIdeaTags splits, trims, dedups, caps length and count', () => {
    expect(normalizeIdeaTags('武侠，悬疑,  复仇、武侠,,')).toEqual(['武侠', '悬疑', '复仇']);
    expect(normalizeIdeaTags(['一'.repeat(30)])).toEqual(['一'.repeat(20)]);
    expect(normalizeIdeaTags(Array.from({ length: 12 }, (_, i) => `标签${i}`))).toHaveLength(8);
  });

  it('normalizeIdeaTerms splits on many separators and caps at 6', () => {
    expect(normalizeIdeaTerms('雪夜/断剑|孤城｜旧誓\n血书，雪夜、风铃,残灯')).toEqual([
      '雪夜',
      '断剑',
      '孤城',
      '旧誓',
      '血书',
      '风铃',
    ]);
    expect(normalizeIdeaTerms(['  长 夜  '])).toEqual(['长 夜']);
    expect(normalizeIdeaTerms(['字'.repeat(20)])[0]).toHaveLength(16);
  });

  it('normalizeIdeaTermPool caps at 24', () => {
    const terms = Array.from({ length: 30 }, (_, i) => `词${i}`);
    expect(normalizeIdeaTermPool(terms)).toHaveLength(24);
    expect(normalizeIdeaTermPool('a/a/b')).toEqual(['a', 'b']);
  });
});

describe('term pool', () => {
  it('createEmptyStoryIdeaTermPool is empty', () => {
    expect(createEmptyStoryIdeaTermPool()).toEqual({ theme: [], conflict: [], twist: [] });
  });

  it('mergeStoryIdeaTermPool merges sources and filters invalid', () => {
    const merged = mergeStoryIdeaTermPool(
      { theme: [{ term: '雪夜', sources: ['history'] }] },
      null,
      undefined,
      {
        theme: [
          { term: ' 雪夜 ', sources: ['ai', 'ai', 'bogus' as unknown as 'ai'] },
          { term: '断剑', sources: [] },
          { term: '   ', sources: ['ai'] },
        ],
        twist: [{ term: '镜像', sources: ['manual'] }],
      }
    );
    expect(merged.theme).toEqual([
      { term: '雪夜', sources: ['history', 'ai'] },
      { term: '断剑', sources: ['manual'] },
    ]);
    expect(merged.conflict).toEqual([]);
    expect(merged.twist).toEqual([{ term: '镜像', sources: ['manual'] }]);
    expect(getIdeaTermPoolValues(merged.theme)).toEqual(['雪夜', '断剑']);
  });

  it('buildStoryIdeaTermPoolFromCards collects history terms', () => {
    const pool = buildStoryIdeaTermPoolFromCards([
      makeRow(),
      makeRow({ theme_seed: '雪夜 / 孤城', conflict_seed: '', twist_seed: '' }),
    ]);
    expect(pool.theme).toEqual([
      { term: '雪夜', sources: ['history'] },
      { term: '断剑', sources: ['history'] },
      { term: '孤城', sources: ['history'] },
    ]);
    expect(pool.conflict).toEqual([{ term: '师门背叛', sources: ['history'] }]);
  });

  it('parse/serialize round-trip and legacy string arrays', () => {
    const pool = parseStoryIdeaTermPool(
      JSON.stringify({ theme: ['雪夜', '断剑'], conflict: [{ term: '背叛', sources: ['ai'] }] })
    );
    expect(pool.theme).toEqual([
      { term: '雪夜', sources: ['manual'] },
      { term: '断剑', sources: ['manual'] },
    ]);
    expect(pool.conflict).toEqual([{ term: '背叛', sources: ['ai'] }]);
    expect(pool.twist).toEqual([]);
    expect(parseStoryIdeaTermPool(serializeStoryIdeaTermPool(pool))).toEqual(pool);
  });

  it('parseStoryIdeaTermPool tolerates empty/malformed input', () => {
    expect(parseStoryIdeaTermPool(null)).toEqual(createEmptyStoryIdeaTermPool());
    expect(parseStoryIdeaTermPool('')).toEqual(createEmptyStoryIdeaTermPool());
    expect(parseStoryIdeaTermPool('{oops')).toEqual(createEmptyStoryIdeaTermPool());
  });
});

describe('term summary and random picking', () => {
  it('buildStoryIdeaTermSummary splits visible/hidden', () => {
    expect(buildStoryIdeaTermSummary(['a', 'b', 'c', 'd', 'e'])).toEqual({
      visibleTerms: ['a', 'b', 'c'],
      hiddenCount: 2,
    });
    expect(buildStoryIdeaTermSummary(['a'], 2)).toEqual({ visibleTerms: ['a'], hiddenCount: 0 });
  });

  const pool: StoryIdeaTermPoolEntry[] = ['雪夜', '断剑', '孤城', '旧誓'].map((term) => ({
    term,
    sources: ['history'],
  }));

  it('pickRandomStoryIdeaTerms excludes terms and is deterministic with mocked random', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(pickRandomStoryIdeaTerms(pool, 2, ['断剑'])).toEqual(['雪夜', '孤城']);
    expect(pickRandomStoryIdeaTerms(pool, 10)).toEqual(['雪夜', '断剑', '孤城', '旧誓']);
    expect(pickRandomStoryIdeaTerms(pool, 3, ['雪夜', '断剑', '孤城', '旧誓'])).toEqual([]);
    expect(pickRandomStoryIdeaTerms([], 3)).toEqual([]);
  });

  it('pickRandomStoryIdeaTerms shuffles with Fisher-Yates', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    expect(pickRandomStoryIdeaTerms(pool, 1)).toEqual(['旧誓']);
  });

  it('replaceStoryIdeaTermRandomly replaces an existing term', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const draft = makeDraft({ themeTerms: ['雪夜', '断剑'] });
    const next = replaceStoryIdeaTermRandomly(draft, 'theme', pool);
    expect(next?.themeTerms).toEqual(['孤城', '断剑']);
  });

  it('replaceStoryIdeaTermRandomly appends when section is empty', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const draft = makeDraft({ twistTerms: [] });
    expect(replaceStoryIdeaTermRandomly(draft, 'twist', pool)?.twistTerms).toEqual(['雪夜']);
  });

  it('replaceStoryIdeaTermRandomly returns null when nothing is available', () => {
    const draft = makeDraft({ conflictTerms: ['雪夜'] });
    expect(replaceStoryIdeaTermRandomly(draft, 'conflict', pool.slice(0, 1))).toBeNull();
  });
});

describe('section accessors', () => {
  it('get/set by section', () => {
    const draft = makeDraft();
    expect(getStoryIdeaTermsBySection(draft, 'theme')).toEqual(['雪夜', '断剑']);
    expect(getStoryIdeaTermsBySection(draft, 'conflict')).toEqual(['师门背叛']);
    expect(getStoryIdeaTermsBySection(draft, 'twist')).toEqual(['仇人是自己']);
    expect(setStoryIdeaTermsBySection(draft, 'theme', ['a', 'a', 'b']).themeTerms).toEqual([
      'a',
      'b',
    ]);
    expect(setStoryIdeaTermsBySection(draft, 'conflict', ['c']).conflictTerms).toEqual(['c']);
    const twisted = setStoryIdeaTermsBySection(draft, 'twist', ['d']);
    expect(twisted.twistTerms).toEqual(['d']);
    expect(draft.twistTerms).toEqual(['仇人是自己']);
  });
});

describe('snapshot', () => {
  it('buildStoryIdeaSnapshot normalizes the draft and prefers output content', () => {
    const snapshot = buildStoryIdeaSnapshot(
      makeDraft({ title: '  ', selectedLogline: ' 一句话 ', selectedDirection: '旧方向' }),
      makeOutput({ id: 42, content: ' 新方向 ' })
    );
    expect(snapshot).toMatchObject({
      title: '未命名创意卡',
      selectedLogline: '一句话',
      selectedDirection: '新方向',
      createdFromOutputId: 42,
    });
    expect(
      buildStoryIdeaSnapshot(makeDraft({ selectedDirection: '旧方向' })).selectedDirection
    ).toBe('旧方向');
  });

  it('parseStoryIdeaSnapshot round-trips and clamps fields', () => {
    const raw = JSON.stringify({
      ...buildStoryIdeaSnapshot(makeDraft(), makeOutput({ id: 3 })),
      title: '题'.repeat(50),
    });
    const parsed = parseStoryIdeaSnapshot(raw);
    expect(parsed?.title).toHaveLength(32);
    expect(parsed?.themeTerms).toEqual(['雪夜', '断剑']);
    expect(parsed?.createdFromOutputId).toBe(3);
  });

  it('parseStoryIdeaSnapshot handles empty/malformed/partial', () => {
    expect(parseStoryIdeaSnapshot(null)).toBeNull();
    expect(parseStoryIdeaSnapshot('')).toBeNull();
    expect(parseStoryIdeaSnapshot('{bad')).toBeNull();
    expect(parseStoryIdeaSnapshot('{"createdFromOutputId":"9"}')).toEqual({
      title: '',
      premise: '',
      tags: [],
      themeTerms: [],
      conflictTerms: [],
      twistTerms: [],
      selectedLogline: '',
      selectedDirection: '',
      createdFromOutputId: undefined,
    });
  });
});

describe('draft <-> row', () => {
  it('toStoryIdeaDraft returns empty draft for null', () => {
    expect(toStoryIdeaDraft(null)).toEqual(createEmptyStoryIdeaDraft());
    expect(toStoryIdeaDraft(undefined).title).toBe('未命名创意卡');
  });

  it('toStoryIdeaDraft parses seeds and tags', () => {
    expect(toStoryIdeaDraft(makeRow())).toEqual({
      title: '雪夜剑客',
      premise: '失忆剑客追查过去',
      tags: ['武侠', '悬疑'],
      source: 'ai',
      status: 'exploring',
      themeTerms: ['雪夜', '断剑'],
      conflictTerms: ['师门背叛'],
      twistTerms: ['仇人是自己'],
      selectedLogline: '他追杀的人是他自己',
      selectedDirection: '倒叙',
      note: '多用意象',
    });
  });

  it('toStoryIdeaDraft tolerates empty/malformed fields', () => {
    const draft = toStoryIdeaDraft(
      makeRow({
        title: '',
        premise: '',
        tags_json: '{not json',
        theme_seed: '',
        selected_logline: '',
        selected_direction: '',
        note: '',
      })
    );
    expect(draft.title).toBe('未命名创意卡');
    expect(draft.tags).toEqual([]);
    expect(draft.themeTerms).toEqual([]);
    expect(toStoryIdeaDraft(makeRow({ tags_json: '{"a":1}' })).tags).toEqual([]);
    expect(toStoryIdeaDraft(makeRow({ tags_json: '' })).tags).toEqual([]);
  });

  it('draftToStoryIdeaUpdatePayload serializes and round-trips through toStoryIdeaDraft', () => {
    const draft = makeDraft({ title: '  ', note: ' 备注 ', tags: ['武侠', '武侠'] });
    const payload = draftToStoryIdeaUpdatePayload(draft);
    expect(payload).toMatchObject({
      title: '未命名创意卡',
      tags_json: '["武侠"]',
      theme_seed: '雪夜 / 断剑',
      note: '备注',
      protagonist_wish: '',
    });
    expect(JSON.parse(serializeStoryIdeaDraft(draft))).toEqual(payload);
    const back = toStoryIdeaDraft(makeRow(payload));
    expect(back.themeTerms).toEqual(draft.themeTerms);
  });
});

describe('misc', () => {
  it('buildStoryIdeaVersionName formats date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 5, 9, 7));
    expect(buildStoryIdeaVersionName(makeDraft())).toBe('三签草案 雪夜剑客 03-05 09:07');
    expect(buildStoryIdeaVersionName(makeDraft({ title: ' ' }))).toBe(
      '三签草案 三签草案 03-05 09:07'
    );
  });

  it('buildStoryIdeaSearchText lowercases all fields', () => {
    const text = buildStoryIdeaSearchText(makeDraft({ title: 'Snow Night', note: 'NOTE' }));
    expect(text).toContain('snow night');
    expect(text).toContain('note');
    expect(text).toContain('雪夜 断剑');
    expect(text).toContain('武侠 悬疑');
  });

  it('pickSelectedOutput finds the selected output of a type', () => {
    const outputs = [
      makeOutput({ id: 1, type: 'logline', is_selected: 0 }),
      makeOutput({ id: 2, type: 'logline', is_selected: 1 }),
      makeOutput({ id: 3, type: 'scene_hook', is_selected: 1 }),
    ];
    expect(pickSelectedOutput(outputs, 'logline')?.id).toBe(2);
    expect(pickSelectedOutput(outputs, 'outline_direction')).toBeNull();
  });
});
