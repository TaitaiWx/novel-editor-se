import { describe, expect, it } from 'vitest';
import type { StoryIdeaCardRow } from '@/render/types/electron-api';
import { createEmptyStoryIdeaTermPool } from '@/render/components/RightPanel/story-idea';
import {
  BUILTIN_INSPIRATION_POOLS,
  INSPIRATION_SLOTS,
  buildInspirationExpandPrompt,
  buildInspirationPools,
  buildStoryIdeaCreatePayload,
  drawInspiration,
  formatInspiration,
  inspirationToStoryIdeaDraft,
  rerollInspirationSlot,
  storyIdeaCardToInspiration,
} from '@/render/components/InspirationDialog/inspiration';

const DRAW = { person: '落榜的书生', place: '雨夜的渡口', conflict: '一封信送错了人' };

function poolWith(theme: string[], conflict: string[], twist: string[]) {
  const toEntries = (terms: string[]) =>
    terms.map((term) => ({ term, sources: ['manual' as const] }));
  return {
    ...createEmptyStoryIdeaTermPool(),
    theme: toEntries(theme),
    conflict: toEntries(conflict),
    twist: toEntries(twist),
  };
}

describe('灵感词池', () => {
  it('内置词库每一签都有足够的候选，且不超过签词长度上限', () => {
    INSPIRATION_SLOTS.forEach((slot) => {
      expect(BUILTIN_INSPIRATION_POOLS[slot].length).toBeGreaterThanOrEqual(12);
      BUILTIN_INSPIRATION_POOLS[slot].forEach((term) =>
        expect(term.length).toBeLessThanOrEqual(16)
      );
    });
  });

  it('按词源合成：内置 / 混合 / 只用我的（为空时退回内置）', () => {
    const mine = poolWith(['老船夫'], ['债主上门'], []);
    expect(buildInspirationPools('builtin', mine).person).not.toContain('老船夫');
    const mixed = buildInspirationPools('mixed', mine);
    expect(mixed.person).toContain('老船夫');
    expect(mixed.person).toContain(BUILTIN_INSPIRATION_POOLS.person[0]);
    expect(mixed.person.length).toBe(BUILTIN_INSPIRATION_POOLS.person.length + 1);
    const onlyMine = buildInspirationPools('mine', mine);
    expect(onlyMine.person).toEqual(['老船夫']);
    expect(onlyMine.conflict).toEqual(['债主上门']);
    expect(onlyMine.place).toEqual([...BUILTIN_INSPIRATION_POOLS.place]);
  });
});

describe('抽签', () => {
  it('无需任何输入即可抽出三张签', () => {
    const pools = buildInspirationPools('builtin', createEmptyStoryIdeaTermPool());
    const draw = drawInspiration(pools, () => 0);
    expect(draw).toEqual({
      person: BUILTIN_INSPIRATION_POOLS.person[0],
      place: BUILTIN_INSPIRATION_POOLS.place[0],
      conflict: BUILTIN_INSPIRATION_POOLS.conflict[0],
    });
  });

  it('换一签只改这一张，且不与当前相同', () => {
    const pools = buildInspirationPools('builtin', createEmptyStoryIdeaTermPool());
    const draw = drawInspiration(pools, () => 0);
    const next = rerollInspirationSlot(draw, 'place', pools, () => 0);
    expect(next.person).toBe(draw.person);
    expect(next.conflict).toBe(draw.conflict);
    expect(next.place).not.toBe(draw.place);
    // 只有一个候选时保持不变
    const single = { person: ['甲'], place: ['乙'], conflict: ['丙'] };
    expect(
      rerollInspirationSlot({ person: '甲', place: '乙', conflict: '丙' }, 'person', single)
    ).toEqual({ person: '甲', place: '乙', conflict: '丙' });
  });

  it('格式化与 AI 扩写提示词', () => {
    expect(formatInspiration(DRAW)).toBe(
      '人物：落榜的书生｜地点：雨夜的渡口｜冲突：一封信送错了人'
    );
    const anchored = buildInspirationExpandPrompt(DRAW, '前文'.repeat(10), 'anchored');
    expect(anchored).toContain('人物：落榜的书生');
    expect(anchored).toContain('当前正文结尾');
    expect(buildInspirationExpandPrompt(DRAW, '前文', 'free')).not.toContain('当前正文结尾');
  });
});

describe('历史（复用三签卡）', () => {
  it('抽签 ↔ 三签卡 往返', () => {
    const draft = inspirationToStoryIdeaDraft(DRAW, new Date(2026, 9, 7, 9, 5));
    expect(draft.title).toBe('灵感 10/7 09:05');
    expect(draft.tags).toEqual(['灵感']);
    const payload = buildStoryIdeaCreatePayload(draft);
    expect(payload).toMatchObject({
      title: '灵感 10/7 09:05',
      themeSeed: '落榜的书生',
      twistSeed: '雨夜的渡口',
      conflictSeed: '一封信送错了人',
    });
    const card = {
      id: 1,
      title: payload.title,
      premise: payload.premise,
      tags_json: payload.tagsJson,
      theme_seed: payload.themeSeed,
      conflict_seed: payload.conflictSeed,
      twist_seed: payload.twistSeed,
    } as unknown as StoryIdeaCardRow;
    expect(storyIdeaCardToInspiration(card)).toEqual(DRAW);
    expect(
      storyIdeaCardToInspiration({ ...card, theme_seed: '', conflict_seed: '', twist_seed: '' })
    ).toBeNull();
  });
});
