/**
 * 生成示例作品集（apps/pc/sample-data）中由程序维护的数据：
 *
 * - 资料/记忆/：成长档案（规则之书、林舟 / 苏晴 的成长卡、队伍、地图，以及派生的 Markdown），
 *   全部通过 @novel-editor/core 的成长记录器 API 计算，保证与 GUI / CLI 写入的格式完全一致
 * - .novel-editor/seed.json：人物、设定、大纲种子（首次打开示例时写入该项目的 SQLite）
 *
 * 修改故事章节后同步调整这里的事件，然后运行：
 *   pnpm exec tsx apps/pc/scripts/generate-sample-data.mts
 * 单测（apps/pc/test/main/sample-data.test.ts）会重新生成并与仓库中的文件逐字节比对。
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addLocation,
  addParty,
  applyGrowthEvent,
  createDndRuleset,
  createSheet,
  endParty,
  markCompanionSeen,
  recordVisit,
  saveAtlas,
  saveParty,
  saveRuleset,
  saveSheet,
  GROWTH_SCHEMA_VERSION,
  type Atlas,
  type GrowthEventInput,
  type GrowthRuleset,
  type GrowthSheet,
  type MemoryBundle,
  type PartyBook,
} from '@novel-editor/core';
import type { ProjectSeedData } from '@novel-editor/store';

export const SAMPLE_DATA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../sample-data'
);

/** 固定时间戳：保证每次生成的文件完全一致 */
function at(chapter: number, minute = 0): string {
  return new Date(Date.UTC(2026, 0, chapter, 12, minute)).toISOString();
}

export function buildSampleRuleset(): GrowthRuleset {
  const ruleset = createDndRuleset();
  return {
    ...ruleset,
    name: '星河旅人 · 规则之书',
    description:
      '基于 DND 模板：六维属性（每升一级全属性 +1，单级合理成长上限 +2）、20 级经验表；3 级时在三条道途中选择其一。',
    coreRules: [
      ...ruleset.coreRules,
      {
        id: 'rule-3',
        text: '林舟走战士之道，整部作品都不学元素法术',
        appliesTo: ['林舟'],
        check: { kind: 'forbid-skill', skillId: 'fireball' },
      },
      {
        id: 'rule-4',
        text: '苏晴的治愈真言在第二卷结束前不超过 3 级',
        appliesTo: ['苏晴'],
        check: { kind: 'max-skill-level', skillId: 'healing-word', value: 3 },
      },
      {
        id: 'rule-5',
        text: '主角团必须在 4 级前完成道途抉择',
        check: { kind: 'require-choice-by-level', groupId: 'path', level: 4 },
      },
    ],
    // 示例只有 6 章：把「被遗忘的配角」阈值调小，打开就能看到秦伯的提醒
    limits: { ...ruleset.limits, forgottenAfterChapters: 4 },
  };
}

interface SheetPlan {
  name: string;
  aliases: string[];
  createdChapter: number;
  events: GrowthEventInput[];
  notes: string[];
}

const SHEET_PLANS: SheetPlan[] = [
  {
    name: '林舟',
    aliases: ['阿舟'],
    createdChapter: 1,
    events: [
      { type: 'exp', delta: 100, chapter: 1, note: '帮秦伯送完最后一批铁器，离开青石镇' },
      { type: 'exp', delta: 250, chapter: 2, note: '在迷雾森林击退雾狼' },
      { type: 'exp', delta: 600, chapter: 3, note: '斩杀独眼狼王' },
      {
        type: 'choice',
        target: 'path',
        value: 'warrior',
        chapter: 3,
        note: '狼王扑来的那一刻，选择像秦伯一样硬扛',
      },
      { type: 'exp', delta: 300, chapter: 4, note: '赢下港口擂台赛第一场' },
      {
        type: 'skill-exp',
        target: 'second-wind',
        delta: 200,
        chapter: 5,
        note: '风暴中反复调息，回气终于用熟',
      },
      { type: 'exp', delta: 800, chapter: 5, note: '穿过风暴航线' },
      { type: 'exp', delta: 700, chapter: 6, note: '击败灯塔石像守卫' },
      { type: 'note', chapter: 6, note: '点亮星辉灯塔，决定沿着光走' },
    ],
    notes: ['左臂被雾狼抓伤，尚未痊愈', '佩剑「青石」：秦伯打造，剑身有裂纹'],
  },
  {
    name: '苏晴',
    aliases: [],
    createdChapter: 2,
    events: [
      { type: 'exp', delta: 150, chapter: 2, note: '为林舟解毒，结伴穿过雾林' },
      { type: 'exp', delta: 450, chapter: 3, note: '点燃驱狼草逼退狼群' },
      { type: 'exp', delta: 400, chapter: 4, note: '在星港城救治病人' },
      {
        type: 'choice',
        target: 'path',
        value: 'priest',
        chapter: 4,
        note: '领悟守护的意义，选择牧师之道',
      },
      {
        type: 'skill-exp',
        target: 'healing-word',
        delta: 300,
        chapter: 5,
        note: '风暴中救回落水的水手',
      },
      { type: 'exp', delta: 300, chapter: 6, note: '在灯塔之战中为林舟止血' },
    ],
    notes: ['药篓里常备驱狼草与止血草'],
  },
];

export function buildSampleSheets(ruleset: GrowthRuleset): GrowthSheet[] {
  return SHEET_PLANS.map((plan) => {
    let sheet = createSheet(ruleset, plan.name, {
      aliases: plan.aliases,
      now: at(plan.createdChapter),
    });
    plan.events.forEach((event, index) => {
      sheet = applyGrowthEvent(
        ruleset,
        sheet,
        { ...event, source: 'manual' },
        { now: at(event.chapter ?? plan.createdChapter, index + 1) }
      ).sheet;
    });
    return { ...sheet, notes: plan.notes };
  });
}

export function buildSampleParty(): PartyBook {
  let book: PartyBook = { schemaVersion: GROWTH_SCHEMA_VERSION, parties: [], companions: [] };
  // 曾经同队的配角会出现在角色成长卡的「需要留意」里：秦伯与小石头已经 5 章没出场
  book = addParty(book, {
    name: '青石镇的日子',
    members: ['林舟', '秦伯', '小石头'],
    fromChapter: 1,
    toChapter: 1,
    notes: '跟着秦伯学打铁的那些年',
  });
  book = markCompanionSeen(book, '秦伯', 1, {
    important: true,
    note: '读者很喜欢的老铁匠。第二卷还没让他出场，记得安排回归',
  });
  book = markCompanionSeen(book, '小石头', 1, { note: '青石镇的孩子，说要等林舟回来' });
  book = addParty(book, {
    name: '雾林同行',
    members: ['林舟', '苏晴'],
    fromChapter: 2,
    notes: '穿越迷雾森林时临时结伴',
  });
  book = endParty(book, '雾林同行', 3);
  book = addParty(book, {
    name: '星河小队',
    members: ['林舟', '苏晴', '白鸦'],
    fromChapter: 4,
    notes: '在星港城的小酒馆里组建，苏晴起的名字',
  });
  for (const name of ['林舟', '苏晴', '白鸦']) book = markCompanionSeen(book, name, 6);
  return book;
}

export function buildSampleAtlas(): Atlas {
  let atlas: Atlas = { schemaVersion: GROWTH_SCHEMA_VERSION, locations: [] };
  atlas = addLocation(atlas, {
    name: '青石镇',
    region: '东境',
    description: '东境最西边的铁匠镇，林舟的家乡',
    firstChapter: 1,
  });
  atlas = addLocation(atlas, {
    name: '秦伯的铁匠铺',
    region: '东境',
    parent: '青石镇',
    description: '镇口老槐树旁，炉火常年不熄',
    firstChapter: 1,
  });
  atlas = addLocation(atlas, {
    name: '迷雾森林',
    region: '东境',
    description: '终年大雾，雾狼出没',
    firstChapter: 2,
  });
  atlas = addLocation(atlas, {
    name: '狼王谷',
    region: '东境',
    parent: '迷雾森林',
    description: '三面环山，只有一条出路',
    firstChapter: 3,
  });
  atlas = addLocation(atlas, {
    name: '星港城',
    region: '西境',
    description: '西境最大的港口',
    firstChapter: 4,
  });
  atlas = addLocation(atlas, {
    name: '风暴航线',
    region: '星海',
    description: '通往星辉灯塔的必经之路',
    firstChapter: 5,
  });
  atlas = addLocation(atlas, {
    name: '星辉灯塔',
    region: '星海',
    description: '孤礁上的古老灯塔，塔顶有残缺的星盘',
    firstChapter: 6,
  });
  const visits: Array<[string, string, number, string?]> = [
    ['青石镇', '林舟', 1, '清晨离开'],
    ['秦伯的铁匠铺', '林舟', 1, '得到青石与星图碎片'],
    ['迷雾森林', '林舟', 2],
    ['迷雾森林', '苏晴', 2, '采药时遇见林舟'],
    ['狼王谷', '林舟', 3, '斩杀狼王'],
    ['狼王谷', '苏晴', 3],
    ['星港城', '林舟', 4],
    ['星港城', '苏晴', 4],
    ['星港城', '白鸦', 4, '黑帆船停在港口尽头'],
    ['风暴航线', '林舟', 5],
    ['风暴航线', '苏晴', 5],
    ['风暴航线', '白鸦', 5],
    ['星辉灯塔', '林舟', 6, '点亮灯塔'],
    ['星辉灯塔', '苏晴', 6],
    ['星辉灯塔', '白鸦', 6],
  ];
  for (const [location, character, chapter, note] of visits) {
    atlas = recordVisit(atlas, location, character, chapter, note);
  }
  return atlas;
}

export function buildSampleMemory(): MemoryBundle {
  const ruleset = buildSampleRuleset();
  return {
    ruleset,
    sheets: buildSampleSheets(ruleset),
    party: buildSampleParty(),
    atlas: buildSampleAtlas(),
  };
}

// ─── 人物 / 设定 / 大纲种子 ─────────────────────────────────────────────────

function characterAttributes(
  category: 'major' | 'secondary',
  aliases: string[],
  currentState: Array<[string, string]>
): string {
  return JSON.stringify({
    aliases,
    category,
    highlightColor: '#9cdcfe',
    highlightFirstMentionOnly: true,
    currentState: currentState.map(([label, value], index) => ({
      id: `state-${index + 1}`,
      label,
      value,
    })),
  });
}

const VOLUME_ONE = 'novels/星河旅人/第一卷-离乡';
const VOLUME_TWO = 'novels/星河旅人/第二卷-星海';

export function buildSampleSeed(): ProjectSeedData {
  const characters = [
    {
      name: '林舟',
      role: '主角 · 旅人',
      description:
        '青石镇长大的少年，父亲三十年前追着星图出海未归。跟随老铁匠秦伯学过几年打铁和剑术，性子倔，认准的事不回头。',
      attributes: characterAttributes(
        'major',
        ['阿舟'],
        [
          ['道途', '战士之道'],
          ['伤势', '左臂旧伤未愈'],
          ['随身', '旧剑「青石」、星图碎片'],
        ]
      ),
    },
    {
      name: '苏晴',
      role: '女主 · 雾林药师',
      description:
        '迷雾森林边缘长大的草药师，嘴硬心软。第三卷之后会揭开雾林药师与灯塔守望者的渊源。',
      attributes: characterAttributes(
        'major',
        [],
        [
          ['道途', '牧师之道'],
          ['随身', '药篓（驱狼草、止血草）'],
        ]
      ),
    },
    {
      name: '白鸦',
      role: '领航员',
      description: '黑帆船的主人，左耳挂着银色罗盘耳坠。父亲曾为林舟的父亲领航。',
      attributes: characterAttributes('secondary', [], [['立场', '暂时同行，目的不明']]),
    },
    {
      name: '秦伯',
      role: '老铁匠 · 林舟的师父',
      description: '青石镇的老铁匠，嗜酒，手艺极好。把佩剑青石与星图碎片交给林舟。',
      attributes: characterAttributes('secondary', ['老铁匠'], [['所在', '青石镇']]),
    },
    {
      name: '小石头',
      role: '青石镇的孩子',
      description: '总跟在林舟身后的小孩，答应替他看好铁匠铺。',
      attributes: characterAttributes('secondary', [], []),
    },
    {
      name: '沈砚',
      role: '主角 ·《剑与诗》',
      description: '江南少年，想学剑，却被一位不会武功的诗人要求先学会听雨。',
      attributes: characterAttributes('major', [], []),
    },
  ];

  const lore: Array<[string, string, string, string[]]> = [
    [
      'world',
      '星河大陆',
      '分为东西两境：东境山多雾重，西境临海、商贸发达。西境以外是星海。',
      ['地理'],
    ],
    [
      'world',
      '星辉灯塔',
      '星海孤礁上的古老灯塔。嵌入完整星图后会点亮，在海面铺出通往「星河」的航路。',
      ['地点', '主线'],
    ],
    ['faction', '星港城商会', '掌控西境大半航线的商人联盟，第二卷之后成为主要对手。', ['反派']],
    ['faction', '雾林药师', '散居在迷雾森林边缘的草药师，世代以采药、驱狼为生。', ['苏晴']],
    [
      'system',
      '道途抉择（三选一）',
      '3 级时在战士 / 法师 / 牧师三条道途中选择其一，选定后不可更改。具体数值见 资料/记忆/规则.json。',
      ['成长'],
    ],
    ['term', '星图碎片', '刻有星线的碎片，靠近星辉灯塔时发热、发光。', ['道具']],
    ['term', '青石', '秦伯打造的旧剑，剑身有一道裂纹。「它不快，但不会背叛你。」', ['道具']],
  ];

  const outlines: Array<Record<string, unknown>> = [];
  let nextId = 1;
  const addOutline = (
    title: string,
    content: string,
    options: { parent?: number; scope?: [string, string]; anchor?: string } = {}
  ): number => {
    const id = nextId++;
    const siblings = outlines.filter(
      (row) =>
        row.parent_id === (options.parent ?? null) &&
        row.scope_kind === (options.scope?.[0] ?? 'project')
    ).length;
    outlines.push({
      id,
      scope_kind: options.scope?.[0] ?? 'project',
      scope_path: options.scope?.[1] ?? '',
      title,
      content,
      anchor_text: options.anchor ?? '',
      parent_id: options.parent ?? null,
      sort_order: siblings,
    });
    return id;
  };

  const volumeOne = addOutline(
    '第一卷 离乡',
    '林舟离开青石镇，穿越迷雾森林，在狼王之夜选择战士之道。'
  );
  addOutline('001 启程', '秦伯赠剑与星图碎片；小石头送别。', {
    parent: volumeOne,
    anchor: '林舟背起行囊',
  });
  addOutline('002 迷雾森林', '雾狼来袭，林舟受伤；遇见药师苏晴，结伴同行。', {
    parent: volumeOne,
    anchor: '森林里的雾气',
  });
  addOutline('003 狼王之夜', '狼王谷决战；三选一的道途抉择；黎明望见灯塔。', {
    parent: volumeOne,
    anchor: '月亮升起来的时候',
  });
  const volumeTwo = addOutline('第二卷 星海', '在星港城组建星河小队，穿过风暴航线，点亮星辉灯塔。');
  addOutline('004 星港城', '结识领航员白鸦，组建星河小队。', {
    parent: volumeTwo,
    anchor: '星港城比林舟想象的大',
  });
  addOutline('005 风暴航线', '风暴中林舟用熟回气，苏晴救回落水水手。', {
    parent: volumeTwo,
    anchor: '出海的第七天',
  });
  addOutline('006 灯塔', '击败石像守卫，星图归位，灯塔点亮。伏笔：秦伯与小石头。', {
    parent: volumeTwo,
    anchor: '星辉灯塔立在一座孤礁上',
  });

  // 章纲示例：001 启程（打开该章，右侧「本章大纲」可见）
  const chapterScope: [string, string] = ['chapter', `${VOLUME_ONE}/001-启程.md`];
  addOutline('第一场 清晨的青石镇', '离开小镇；小石头送饼，约定回来。', {
    scope: chapterScope,
    anchor: '第一场 清晨的青石镇',
  });
  addOutline('第二场 铁匠铺的夜', '倒叙：秦伯赠剑「青石」与星图碎片，指明西行之路。', {
    scope: chapterScope,
    anchor: '第二场 铁匠铺的夜',
  });
  // 卷纲示例：第二卷
  addOutline('第二卷节奏', '起：星港组队 → 承：风暴考验 → 转：灯塔点亮 → 合：沿光远航（第三卷）', {
    scope: ['volume', VOLUME_TWO],
  });

  return {
    version: '1.0.0',
    novels: [{ id: 1, name: '示例作品集', description: '小说编辑器内置示例：星河旅人 / 剑与诗' }],
    characters: characters.map((row, index) => ({ ...row, novel_id: 1, sort_order: index })),
    world_settings: lore.map(([category, title, content, tags]) => ({
      novel_id: 1,
      category,
      title,
      content,
      tags: JSON.stringify(tags),
    })),
    outlines: outlines.map((row) => ({ ...row, novel_id: 1 })),
  };
}

// ─── 写入 ───────────────────────────────────────────────────────────────────

/** 把生成的数据写到 root（默认 apps/pc/sample-data），会先清空 资料/记忆/ */
export async function writeSampleData(root: string = SAMPLE_DATA_DIR): Promise<void> {
  const memory = buildSampleMemory();
  await rm(path.join(root, '资料', '记忆'), { recursive: true, force: true });
  // 走 core 的保存函数：JSON 规范化 + 原子写入 + 重新生成 README.md / 角色/*.md
  await saveRuleset(root, memory.ruleset);
  await saveParty(root, memory.party);
  await saveAtlas(root, memory.atlas);
  for (const sheet of memory.sheets) await saveSheet(root, sheet);

  const seedFile = path.join(root, '.novel-editor', 'seed.json');
  await mkdir(path.dirname(seedFile), { recursive: true });
  await writeFile(seedFile, `${JSON.stringify(buildSampleSeed(), null, 2)}\n`, 'utf-8');
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  writeSampleData(process.argv[2] ? path.resolve(process.argv[2]) : SAMPLE_DATA_DIR)
    .then(() => console.log('示例数据已生成'))
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
