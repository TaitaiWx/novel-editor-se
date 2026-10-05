import { describe, expect, it } from 'vitest';
import {
  formatMaterialUsageLabel,
  getAIGenerationScopeLabel,
  parseAssistantScopedCharacters,
  parseAssistantScopedLore,
  parseAssistantScopedMaterials,
  parseLoreGenerationResult,
  parseMaterialGenerationResult,
  selectChunksForAiAnalysis,
} from '@/render/app/aiGeneration';
import type { AIGenerationScope } from '@/render/app/types';

describe('getAIGenerationScopeLabel', () => {
  it('返回对应中文标签，未知值回退', () => {
    expect(getAIGenerationScopeLabel('current-content')).toBe('当前内容');
    expect(getAIGenerationScopeLabel('current-chapter')).toBe('当前章节');
    expect(getAIGenerationScopeLabel('whole-project')).toBe('整部作品');
    expect(getAIGenerationScopeLabel('unknown' as AIGenerationScope)).toBe('当前内容');
  });
});

describe('parseLoreGenerationResult', () => {
  it('解析 json 代码块，规范分类与标签并过滤无标题项', () => {
    const raw = [
      '以下是设定：',
      '```json',
      JSON.stringify({
        entries: [
          { category: 'faction', title: ' 血煞宗 ', summary: ' 魔道第一宗 ', tags: [' 魔道 ', 1] },
          { category: 'magic', title: '御剑术', tags: 'x' },
          { title: '   ' },
        ],
      }),
      '```',
    ].join('\n');
    expect(parseLoreGenerationResult(raw)).toEqual([
      { category: 'faction', title: '血煞宗', summary: '魔道第一宗', tags: ['魔道'] },
      { category: 'world', title: '御剑术', summary: '', tags: [] },
    ]);
  });

  it('无 JSON、非法 JSON 或缺少 entries 时返回空数组', () => {
    expect(parseLoreGenerationResult('没有结构化内容')).toEqual([]);
    expect(parseLoreGenerationResult('{ entries: [ }')).toEqual([]);
    expect(parseLoreGenerationResult('{"other":1}')).toEqual([]);
  });
});

describe('parseMaterialGenerationResult', () => {
  it('解析素材并过滤缺少标题或摘要的项', () => {
    const raw = JSON.stringify({
      materials: [
        {
          title: '渡口',
          summary: '江边渡口，众人离别之地',
          kind: 'scene',
          relatedChapter: ' 第四章 ',
          keywords: [' 江水 ', '', 2],
        },
        { title: '古籍', summary: '记载御剑术', kind: 'book' },
        { title: '无摘要' },
      ],
    });
    expect(parseMaterialGenerationResult(`结果：${raw}`)).toEqual([
      {
        title: '渡口',
        summary: '江边渡口，众人离别之地',
        kind: 'scene',
        relatedChapter: '第四章',
        keywords: ['江水'],
      },
      { title: '古籍', summary: '记载御剑术', kind: 'reference', relatedChapter: '', keywords: [] },
    ]);
  });

  it('异常输入返回空数组', () => {
    expect(parseMaterialGenerationResult('')).toEqual([]);
    expect(parseMaterialGenerationResult('{bad json}')).toEqual([]);
    expect(parseMaterialGenerationResult('{}')).toEqual([]);
  });
});

describe('selectChunksForAiAnalysis', () => {
  const chunks = Array.from({ length: 20 }, (_, i) => `第${i + 1}段`);

  it('数量不超过上限时原样返回', () => {
    expect(selectChunksForAiAnalysis(chunks.slice(0, 5), 12)).toHaveLength(5);
  });

  it('均匀采样头部并保留尾部 4 段', () => {
    const selected = selectChunksForAiAnalysis(chunks, 8);
    expect(selected).toHaveLength(8);
    expect(selected[0]).toBe('第1段');
    expect(selected.slice(-4)).toEqual(['第17段', '第18段', '第19段', '第20段']);
  });

  it('头部只取 1 段时取第一段', () => {
    expect(selectChunksForAiAnalysis(chunks, 5)).toEqual([
      '第1段',
      '第17段',
      '第18段',
      '第19段',
      '第20段',
    ]);
  });

  it('上限不超过 4 时只保留尾部', () => {
    expect(selectChunksForAiAnalysis(chunks, 3)).toEqual(['第18段', '第19段', '第20段']);
  });
});

describe('parseAssistantScoped*', () => {
  it('人物：过滤无名项并裁剪字段', () => {
    const raw = JSON.stringify([
      { name: ' 林墨 ', role: ' 主角 ', description: ' 剑客 ' },
      { name: '苏晴' },
      { name: '' },
      null,
    ]);
    expect(parseAssistantScopedCharacters(raw)).toEqual([
      { name: '林墨', role: '主角', description: '剑客' },
      { name: '苏晴', role: '', description: '' },
    ]);
    expect(parseAssistantScopedCharacters(null)).toEqual([]);
    expect(parseAssistantScopedCharacters('{}')).toEqual([]);
    expect(parseAssistantScopedCharacters('[')).toEqual([]);
  });

  it('设定：规范分类', () => {
    const raw = JSON.stringify([
      { category: 'system', title: '境界', summary: ' 炼气、筑基 ' },
      { category: 'bad', title: '青云城' },
      { title: 1 },
    ]);
    expect(parseAssistantScopedLore(raw)).toEqual([
      { category: 'system', title: '境界', summary: '炼气、筑基' },
      { category: 'world', title: '青云城', summary: '' },
    ]);
    expect(parseAssistantScopedLore(null)).toEqual([]);
    expect(parseAssistantScopedLore('"x"')).toEqual([]);
    expect(parseAssistantScopedLore('{')).toEqual([]);
  });

  it('素材：规范类型', () => {
    const raw = JSON.stringify([
      { title: '药王谷', summary: '苏晴师门', kind: 'setting', relatedChapter: '第三章' },
      { title: '旧地图', kind: 'map' },
      { summary: '无标题' },
    ]);
    expect(parseAssistantScopedMaterials(raw)).toEqual([
      { title: '药王谷', summary: '苏晴师门', kind: 'setting', relatedChapter: '第三章' },
      { title: '旧地图', summary: '', kind: 'reference', relatedChapter: '' },
    ]);
    expect(parseAssistantScopedMaterials(null)).toEqual([]);
    expect(parseAssistantScopedMaterials('1')).toEqual([]);
    expect(parseAssistantScopedMaterials('[')).toEqual([]);
  });

  it('字段类型异常时只影响单个条目，不会丢弃整个列表', () => {
    const characters = JSON.stringify([
      { name: '林墨', role: 1, description: { text: '剑客' } },
      { name: '苏晴', role: '医者', description: null },
      { name: ['数组'] },
      'not-an-object',
    ]);
    expect(parseAssistantScopedCharacters(characters)).toEqual([
      { name: '林墨', role: '', description: '' },
      { name: '苏晴', role: '医者', description: '' },
    ]);

    const lore = JSON.stringify([
      { category: 'faction', title: '血煞宗', summary: 42 },
      { category: 'term', title: '真元', summary: ' 修炼能量 ' },
    ]);
    expect(parseAssistantScopedLore(lore)).toEqual([
      { category: 'faction', title: '血煞宗', summary: '' },
      { category: 'term', title: '真元', summary: '修炼能量' },
    ]);

    const materials = JSON.stringify([
      { title: '药王谷', summary: ['x'], kind: 'setting', relatedChapter: 3 },
      { title: '渡口', summary: '离别之地', kind: 'scene', relatedChapter: '第四章' },
    ]);
    expect(parseAssistantScopedMaterials(materials)).toEqual([
      { title: '药王谷', summary: '', kind: 'setting', relatedChapter: '' },
      { title: '渡口', summary: '离别之地', kind: 'scene', relatedChapter: '第四章' },
    ]);
  });
});

describe('formatMaterialUsageLabel', () => {
  it('去重并按数量格式化', () => {
    expect(formatMaterialUsageLabel([])).toBe('');
    expect(formatMaterialUsageLabel(['', ''])).toBe('');
    expect(formatMaterialUsageLabel(['第一章', '第一章', '第二章'])).toBe('用于 第一章、第二章');
    expect(formatMaterialUsageLabel(['第一章', '第二章', '第三章'])).toBe(
      '用于 第一章、第二章 等 3 章'
    );
  });
});
