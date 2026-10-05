import { describe, expect, it } from 'vitest';
import type { Character, LoreEntry } from '@/render/components/RightPanel/types';
import { areCharactersEqual, areLoreEntriesEqual } from '@/render/app/entityEquality';

const character = (patch: Partial<Character> = {}): Character => ({
  id: 1,
  name: '林墨',
  role: '主角',
  category: 'major',
  description: '青云城少年剑客',
  currentState: [],
  aliases: ['墨哥', '小林'],
  ...patch,
});

const lore = (patch: Partial<LoreEntry> = {}): LoreEntry => ({
  id: 1,
  title: '青云城',
  summary: '东境第一剑城',
  category: 'world',
  tags: ['城池', '东境'],
  createdAt: '2026-01-01',
  updatedAt: '2026-01-02',
  ...patch,
});

describe('areCharactersEqual', () => {
  it('同一引用与逐字段相同视为相等', () => {
    const list = [character()];
    expect(areCharactersEqual(list, list)).toBe(true);
    expect(areCharactersEqual([character()], [character()])).toBe(true);
    expect(
      areCharactersEqual([character({ aliases: undefined })], [character({ aliases: [] })])
    ).toBe(true);
  });

  it('长度或任一字段不同视为不等', () => {
    expect(areCharactersEqual([character()], [])).toBe(false);
    expect(areCharactersEqual([character()], [character({ name: '苏晴' })])).toBe(false);
    expect(areCharactersEqual([character()], [character({ aliases: ['墨哥'] })])).toBe(false);
    expect(
      areCharactersEqual([character()], [character({ highlightFirstMentionOnly: true })])
    ).toBe(false);
  });
});

describe('areLoreEntriesEqual', () => {
  it('同一引用与逐字段相同视为相等', () => {
    const list = [lore()];
    expect(areLoreEntriesEqual(list, list)).toBe(true);
    expect(areLoreEntriesEqual([lore()], [lore()])).toBe(true);
  });

  it('长度、字段或标签不同视为不等', () => {
    expect(areLoreEntriesEqual([lore()], [lore(), lore({ id: 2 })])).toBe(false);
    expect(areLoreEntriesEqual([lore()], [lore({ summary: '已毁于战火' })])).toBe(false);
    expect(areLoreEntriesEqual([lore()], [lore({ tags: ['城池'] })])).toBe(false);
    expect(areLoreEntriesEqual([lore()], [lore({ tags: ['城池', '西境'] })])).toBe(false);
  });
});
