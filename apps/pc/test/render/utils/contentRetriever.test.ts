import { describe, expect, it } from 'vitest';
import {
  buildContentIndex,
  getOrBuildIndex,
  hybridRetrieve,
} from '@/render/utils/contentRetriever';

const NOVEL = [
  '第一章 青云城',
  '林墨在青云城外的山道上练剑，师父玄机子站在松树下观看。林墨的剑法日益精进。',
  '第二章 魔教来袭',
  '血煞宗的长老夜袭青云城，城中火光冲天。血煞宗长老狞笑着挥动骨杖。',
  '第三章 苏晴',
  '苏晴是药王谷的弟子，她背着药篓穿过竹林，遇到了受伤的林墨。苏晴替他包扎伤口。',
  '第四章 离别',
  '天亮之后，众人在渡口分别，江水滔滔向东流去。',
].join('\n');

describe('buildContentIndex', () => {
  it('拆分章节并建立关键词与标题的倒排索引', () => {
    const index = buildContentIndex(NOVEL);
    expect(index.chapters).toHaveLength(4);
    expect(index.summaries[0].title).toBe('第一章 青云城');
    expect(index.summaries[0].tail).toBe('');
    // 标题词也进入索引
    expect(index.invertedIndex.get('青云城')).toContain(0);
    expect(index.invertedIndex.get('魔教来袭')).toEqual([1]);
    expect(typeof index.contentHash).toBe('string');
  });

  it('长章节会生成尾部摘要', () => {
    const longBody = '江湖风雨'.repeat(80);
    const index = buildContentIndex(`第一章 长\n${longBody}\n第二章 短\n短句。`);
    expect(index.summaries[0].head).toHaveLength(200);
    expect(index.summaries[0].tail).toHaveLength(200);
  });
});

describe('hybridRetrieve', () => {
  it('单章节文本直接截取返回', () => {
    const index = buildContentIndex('没有章节标记的短篇。');
    expect(hybridRetrieve(index, '任意', 5, 4)).toEqual({
      context: '没有章节',
      matchedChapters: [0],
      totalChapters: 1,
    });
  });

  it('根据关键词命中相关章节并附带目录', () => {
    const index = buildContentIndex(NOVEL);
    // 中文正则按 2-6 字连续切分，标点分隔的“苏晴”才能命中标题词
    const result = hybridRetrieve(index, '苏晴，后来呢', 2, 8000);
    expect(result.matchedChapters).toEqual([2]);
    expect(result.totalChapters).toBe(4);
    expect(result.context).toContain('[全书共 4 章]');
    expect(result.context).toContain('【第三章 苏晴】');
  });

  it('连续汉字的自然语言提问也能命中其中的人名', () => {
    const index = buildContentIndex(NOVEL);
    const result = hybridRetrieve(index, '苏晴后来怎么样了', 2, 8000);
    expect(result.matchedChapters).toEqual([2]);
  });

  it('正文中反复出现的人名即使不在标题里也能被检索到', () => {
    const text = [
      '第一章 出山',
      '林墨下山，一路向东。',
      '第二章 夜雨',
      '雨夜里，玄机子独自饮酒。玄机子想起旧事，玄机子叹了口气。',
      '第三章 渡口',
      '众人在渡口分别。',
    ].join('\n');
    const index = buildContentIndex(text);
    const result = hybridRetrieve(index, '玄机子最近在做什么', 1, 8000);
    expect(result.matchedChapters).toEqual([1]);
  });

  it('关键词完全无命中时回退到首、中、尾章节', () => {
    const index = buildContentIndex(NOVEL);
    const result = hybridRetrieve(index, 'hello world');
    expect(result.matchedChapters).toEqual([0, 2, 3]);
  });

  it('只有两章时回退索引去重', () => {
    const index = buildContentIndex('第一章\n甲\n第二章\n乙');
    expect(hybridRetrieve(index, 'zzz').matchedChapters).toEqual([0, 1]);
  });

  it('maxChars 较小时省略目录并截断正文', () => {
    const index = buildContentIndex(NOVEL);
    const result = hybridRetrieve(index, '魔教来袭', 5, 30);
    expect(result.context.startsWith('\n【第二章 魔教来袭】\n')).toBe(true);
    expect(result.context).not.toContain('全书共');
    expect(result.context.length).toBeLessThanOrEqual(30);
  });

  // 回归：buildContext 中 `remaining - header.length` 曾可能为负数，
  // `content.slice(0, 负数)` 会从尾部截取，返回大段正文，导致上下文超过 maxChars。
  it('返回的上下文长度不应超过 maxChars', () => {
    const text = ['第一章 苏晴', '甲。', '第二章 苏晴', '在山中修行，日复一日。'.repeat(20)].join(
      '\n'
    );
    const index = buildContentIndex(text);
    const maxChars = 15;
    const result = hybridRetrieve(index, '苏晴', 5, maxChars);
    expect(result.context.length).toBeLessThanOrEqual(maxChars);
  });
});

describe('getOrBuildIndex', () => {
  it('相同内容复用缓存，不同内容重建', () => {
    const first = getOrBuildIndex(NOVEL);
    expect(getOrBuildIndex(NOVEL)).toBe(first);
    const other = getOrBuildIndex(NOVEL.replace('第一章', '楔子章'));
    expect(other).not.toBe(first);
  });

  // 回归：simpleHash 曾只采样每 128 个字符中的 1 个且不含长度，
  // 修改未被采样位置的字符（如第 2 个字）会命中旧缓存，返回过期索引。
  it('内容中间被修改后应返回新索引', () => {
    const before = '第一章 风起\n林墨出山。\n第二章 夜雨\n雨夜。';
    const after = '第一章 云涌\n林墨出山。\n第二章 夜雨\n雨夜。';
    const first = getOrBuildIndex(before);
    const second = getOrBuildIndex(after);
    expect(second).not.toBe(first);
    expect(second.chapters[0].title).toBe('第一章 云涌');
  });
});
