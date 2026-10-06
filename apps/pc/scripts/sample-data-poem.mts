/**
 * 示例作品集的第二部作品《剑与诗》：自己的规则之书、成长卡与人物 / 设定 / 大纲种子，
 * 演示「资料、成长档案、人物与设定跟随作品」。由 generate-sample-data.mts 统一写入。
 */
import {
  applyGrowthEvent,
  createBlankRuleset,
  createSheet,
  GROWTH_SCHEMA_VERSION,
  type GrowthEventInput,
  type GrowthRuleset,
  type GrowthSheet,
  type MemoryBundle,
} from '@novel-editor/core';

/** 作品目录（相对项目根） */
export const POEM_WORK_DIR = 'novels/剑与诗';

/** 固定时间戳函数（第 N 章、第 M 分钟），由生成脚本传入，保证每次生成一致 */
export type Timestamp = (chapter: number, minute?: number) => string;

type CharacterAttributes = (
  category: 'major' | 'secondary',
  aliases: string[],
  currentState: Array<[string, string]>
) => string;

export function buildPoemRuleset(): GrowthRuleset {
  const ruleset = createBlankRuleset();
  return {
    ...ruleset,
    name: '剑与诗 · 规则之书',
    description: '武侠短篇的轻量规则：只记等级与「听雨」心法，不设属性。',
    skills: [
      {
        id: 'listen-rain',
        name: '听雨',
        description: '诗人教的第一课：听清每一滴雨落在哪里',
        maxLevel: 3,
        costPerLevel: [0, 200, 400],
      },
    ],
    coreRules: [{ id: 'rule-1', text: '沈砚学会「听雨」之前不出真剑' }],
  };
}

export function buildPoemSheets(ruleset: GrowthRuleset, at: Timestamp): GrowthSheet[] {
  let sheet = createSheet(ruleset, '沈砚', { now: at(1) });
  const events: GrowthEventInput[] = [
    { type: 'exp', delta: 60, chapter: 1, note: '在雨巷等了说书人三天' },
    { type: 'exp', delta: 80, chapter: 2, note: '浑身湿透爬上听雨楼七层' },
    { type: 'note', chapter: 2, note: '诗人要他先学会听雨' },
  ];
  events.forEach((event, index) => {
    sheet = applyGrowthEvent(
      ruleset,
      sheet,
      { ...event, source: 'manual' },
      { now: at(event.chapter ?? 1, index + 1) }
    ).sheet;
  });
  return [{ ...sheet, notes: ['随身木剑一把，诗人的信揣在怀里'] }];
}

export function buildPoemMemory(at: Timestamp): MemoryBundle {
  const ruleset = buildPoemRuleset();
  return {
    ruleset,
    sheets: buildPoemSheets(ruleset, at),
    party: { schemaVersion: GROWTH_SCHEMA_VERSION, parties: [], companions: [] },
    atlas: { schemaVersion: GROWTH_SCHEMA_VERSION, locations: [] },
  };
}

/** 《剑与诗》的种子行（novel_id 由生成脚本统一补上） */
export function buildPoemSeedParts(characterAttributes: CharacterAttributes) {
  // 自己的人物：与星河旅人互不可见
  const characters = [
    {
      name: '沈砚',
      role: '主角 · 学剑少年',
      description: '江南少年，想学剑，却被一位不会武功的诗人要求先学会听雨。',
      attributes: characterAttributes('major', [], [['所学', '听雨（入门）']]),
    },
    {
      name: '听雨楼诗人',
      role: '师父 · 不会武功的诗人',
      description: '住在听雨楼七层，只用一封信、一句诗就把沈砚引上了楼。',
      attributes: characterAttributes('secondary', ['诗人'], [['所在', '听雨楼七层']]),
    },
  ];
  const lore: Array<[string, string, string, string[]]> = [
    ['world', '听雨楼', '城西七层木楼，楼上住着不会武功的诗人。雨天整座楼都在响。', ['地点']],
    ['term', '剑在匣中鸣', '诗人信中唯一的一句诗，也是沈砚学剑的第一道题。', ['伏笔']],
  ];
  // 作品大纲（打开《剑与诗》后右侧「作品大纲」可见）
  const outlines = [
    {
      id: 101,
      scope_kind: 'project',
      scope_path: '',
      title: '001 少年',
      content: '雨巷苦等说书人，等来一封只有一句诗的信。',
      anchor_text: '少年握紧了手中的木剑',
      parent_id: null,
      sort_order: 0,
    },
    {
      id: 102,
      scope_kind: 'project',
      scope_path: '',
      title: '002 听雨楼',
      content: '登楼拜师，诗人要他先学会听雨。',
      anchor_text: '听雨楼在城西',
      parent_id: null,
      sort_order: 1,
    },
  ];
  return { characters, lore, outlines };
}
