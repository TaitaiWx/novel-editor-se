import { describe, it, expect } from 'vitest';
import { chunkByFixedLength, chunkBySentence, chunkByParagraph } from '../src';
import type { TextChunk } from '../src';

/** 计算 offset 所在的 1-based 行号 */
function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** 通用不变式：偏移量与原文一致、行号可由偏移推导、index 连续 */
function expectConsistent(text: string, chunks: TextChunk[]): void {
  chunks.forEach((c, i) => {
    expect(c.index).toBe(i);
    expect(text.slice(c.startOffset, c.endOffset)).toBe(c.text);
    expect(c.startLine).toBe(lineAt(text, c.startOffset));
    expect(c.endLine).toBe(lineAt(text, c.endOffset));
  });
}

const NOVEL = [
  '第一章 青州夜雨',
  '',
  '林远推开客栈的门，雨水顺着斗笠往下淌。',
  '',
  '“掌柜的，还有房吗？”他问。',
  '',
  '苏晴坐在角落里，「你来晚了。」她说。',
  '',
  '* * *',
  '',
  '三年后，青州城破。林远站在城头！苏晴呢？没有人知道……',
].join('\n');

describe('chunkByFixedLength', () => {
  it('默认 chunkSize=4096，短文本只有一个块', () => {
    const result = chunkByFixedLength(NOVEL);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      index: 0,
      text: NOVEL,
      startOffset: 0,
      endOffset: NOVEL.length,
      startLine: 1,
      endLine: 11,
    });
  });

  it('无重叠时块首尾相接，拼接后还原原文', () => {
    const result = chunkByFixedLength(NOVEL, { chunkSize: 7 });
    expect(result.map((c) => c.text).join('')).toBe(NOVEL);
    expect(result.length).toBe(Math.ceil(NOVEL.length / 7));
    result.slice(0, -1).forEach((c) => expect(c.text).toHaveLength(7));
    for (let i = 1; i < result.length; i++) {
      expect(result[i].startOffset).toBe(result[i - 1].endOffset);
    }
    expectConsistent(NOVEL, result);
  });

  it('长度恰好是 chunkSize 的整数倍时不产生空尾块', () => {
    const result = chunkByFixedLength('林远苏晴林远苏晴', { chunkSize: 4 });
    expect(result.map((c) => c.text)).toEqual(['林远苏晴', '林远苏晴']);
  });

  it('有重叠时相邻块共享 overlap 个字符，行号仍然正确', () => {
    const text = '林远\n苏晴\n青州\n夜雨\n';
    const result = chunkByFixedLength(text, { chunkSize: 5, overlap: 2 });
    for (let i = 1; i < result.length; i++) {
      const prev = result[i - 1];
      expect(result[i].startOffset).toBe(prev.startOffset + 3);
      if (prev.endOffset - prev.startOffset === 5) {
        expect(result[i].text.startsWith(prev.text.slice(-2))).toBe(true);
      }
    }
    expect(result[result.length - 1].endOffset).toBe(text.length);
    expectConsistent(text, result);
  });

  it('重叠时末块恰好对齐结尾则不再多产生块', () => {
    // step=4: [0,6) [4,8) 后 pos=8 >= 8 停止
    const result = chunkByFixedLength('0123456789AB', { chunkSize: 6, overlap: 2 });
    expect(result.map((c) => c.text)).toEqual(['012345', '456789', '89AB']);
  });

  it('重叠时已覆盖到文本结尾后不应再产生被完全包含的冗余尾块', () => {
    // 期望：step=3 时 [0,5) [3,8) [6,10) 已覆盖全文，结果为 3 块
    // 实际：fixed-length.ts:60-61 只在 pos >= text.length 时停止，
    //       pos=9 时又产生了完全落在上一块内的 "9"，共 4 块（对检索/嵌入是重复数据）
    const result = chunkByFixedLength('0123456789', { chunkSize: 5, overlap: 2 });
    expect(result.map((c) => c.text)).toEqual(['01234', '34567', '6789']);
  });

  it('多行长文本的行号与偏移一致', () => {
    const big = Array.from({ length: 200 }, (_, i) => `第${i + 1}行：林远对苏晴说了一句话。`).join(
      '\n'
    );
    expectConsistent(big, chunkByFixedLength(big, { chunkSize: 97, overlap: 13 }));
  });

  it('按 UTF-16 码元切分：emoji 代理对可能被切开（记录当前行为）', () => {
    const result = chunkByFixedLength('😀😀', { chunkSize: 1 });
    expect(result).toHaveLength(4);
  });

  it('参数校验', () => {
    expect(() => chunkByFixedLength('林远', { chunkSize: -1 })).toThrow(RangeError);
    expect(() => chunkByFixedLength('林远', { chunkSize: 4, overlap: -1 })).toThrow(
      'overlap must be non-negative'
    );
    expect(() => chunkByFixedLength('林远', { chunkSize: 4, overlap: 6 })).toThrow(
      'overlap must be less than chunkSize'
    );
    // 空文本也会先校验参数
    expect(() => chunkByFixedLength('', { chunkSize: 0 })).toThrow('chunkSize must be positive');
  });
});

describe('chunkBySentence', () => {
  it('中文句末标点切句并贪心打包，块内不拆句', () => {
    const text = '林远到了。苏晴走了！谁来了？风停了……';
    const result = chunkBySentence(text, { maxChunkSize: 10, minChunkSize: 0 });
    expect(result.map((c) => c.text)).toEqual(['林远到了。苏晴走了！', '谁来了？风停了……']);
    expectConsistent(text, result);
  });

  it('英文 .!? 与后随空白属于同一句', () => {
    const text = 'Lin Yuan ran. Su Qing waited! Why? ';
    const result = chunkBySentence(text, { maxChunkSize: 15, minChunkSize: 0 });
    expect(result.map((c) => c.text)).toEqual(['Lin Yuan ran. ', 'Su Qing waited! ', 'Why? ']);
  });

  it('句末的「」』）等闭合符号跟随上一句', () => {
    const text = '林远道：「走吧。」苏晴点头。';
    const result = chunkBySentence(text, { maxChunkSize: 9, minChunkSize: 0 });
    expect(result[0].text).toBe('林远道：「走吧。」');
    expect(result[1].text).toBe('苏晴点头。');
  });

  it('中文弯引号 ” 应作为闭合符号跟随上一句', () => {
    // 期望：与「」一致，“走吧。”的右引号属于第一句
    // 实际：sentence.ts:7 的 SENTENCE_TERMINATORS 只包含 ASCII 引号 "'，
    //       导致下一块以孤立的 ” 开头
    const text = '林远道：“走吧。”苏晴点头。';
    const result = chunkBySentence(text, { maxChunkSize: 9, minChunkSize: 0 });
    expect(result[0].text).toBe('林远道：“走吧。”');
  });

  it('单句超过 maxChunkSize 时独占一块，不截断', () => {
    const longSentence = '林'.repeat(30) + '。';
    const text = `短句。${longSentence}尾巴。`;
    const result = chunkBySentence(text, { maxChunkSize: 10, minChunkSize: 0 });
    expect(result.map((c) => c.text)).toEqual(['短句。', longSentence, '尾巴。']);
  });

  it('尾部小块（< minChunkSize）并入上一块，可能超过 maxChunkSize', () => {
    const text = '林远拔剑而起。苏晴按住他的手。好。';
    const result = chunkBySentence(text, { maxChunkSize: 8, minChunkSize: 5 });
    expect(result.map((c) => c.text)).toEqual(['林远拔剑而起。', '苏晴按住他的手。好。']);
    expectConsistent(text, result);
  });

  it('只有一个小块时不会被丢弃', () => {
    expect(chunkBySentence('好。').map((c) => c.text)).toEqual(['好。']);
  });

  it('没有句末标点的文本整体作为一句', () => {
    const result = chunkBySentence('林远一言不发', { maxChunkSize: 3 });
    expect(result.map((c) => c.text)).toEqual(['林远一言不发']);
  });

  it('跨行文本的偏移与行号一致，拼接还原原文', () => {
    const result = chunkBySentence(NOVEL, { maxChunkSize: 30, minChunkSize: 10 });
    expect(result.map((c) => c.text).join('')).toBe(NOVEL);
    expect(result[0].startLine).toBe(1);
    expect(result[result.length - 1].endLine).toBe(11);
    expectConsistent(NOVEL, result);
  });
});

describe('chunkByParagraph', () => {
  it('按空行切段并保留分隔符，拼接还原原文', () => {
    const text = '林远到了。\n\n苏晴走了。\n\n风停了。';
    const result = chunkByParagraph(text, { maxChunkSize: 8, minChunkSize: 0 });
    expect(result.map((c) => c.text)).toEqual(['林远到了。\n\n', '苏晴走了。\n\n', '风停了。']);
    expect(result.map((c) => [c.startLine, c.endLine])).toEqual([
      [1, 3],
      [3, 5],
      [5, 5],
    ]);
    expectConsistent(text, result);
  });

  it('多个段落贪心打包直到 maxChunkSize', () => {
    const text = '甲\n\n乙\n\n丙\n\n丁';
    const result = chunkByParagraph(text, { maxChunkSize: 6, minChunkSize: 0 });
    expect(result.map((c) => c.text)).toEqual(['甲\n\n乙\n\n', '丙\n\n丁']);
    expectConsistent(text, result);
  });

  it('带空白字符的空行（\\n  \\n）也视为段落分隔', () => {
    const text = '林远\n   \n苏晴';
    const result = chunkByParagraph(text, { maxChunkSize: 4, minChunkSize: 0 });
    expect(result.map((c) => c.text)).toEqual(['林远\n   \n', '苏晴']);
  });

  it('段内单换行不拆分', () => {
    const text = '“走吧。”\n林远说。\n\n苏晴没动。';
    const result = chunkByParagraph(text, { maxChunkSize: 5, minChunkSize: 0 });
    expect(result[0].text).toBe('“走吧。”\n林远说。\n\n');
  });

  it('尾部小段并入上一块并修正 endLine/endOffset', () => {
    const text = '林'.repeat(10) + '\n\n' + '苏'.repeat(10) + '\n\n尾';
    const result = chunkByParagraph(text, { maxChunkSize: 12, minChunkSize: 3 });
    expect(result).toHaveLength(2);
    expect(result[1].text).toBe('苏'.repeat(10) + '\n\n尾');
    expectConsistent(text, result);
  });

  it('默认参数下整篇小说为一块', () => {
    const result = chunkByParagraph(NOVEL);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe(NOVEL);
    expectConsistent(NOVEL, result);
  });

  it('文本以空行开头时首段为分隔符本身', () => {
    const text = '\n\n林远';
    const result = chunkByParagraph(text, { maxChunkSize: 2, minChunkSize: 0 });
    expect(result.map((c) => c.text)).toEqual(['\n\n', '林远']);
    expectConsistent(text, result);
  });

  it('支持自定义分隔符（场景分隔 ***）', () => {
    const text = '林远离开。\n***\n三年后。\n***\n苏晴归来。';
    const result = chunkByParagraph(text, {
      separator: /\n\*{3}\n/,
      maxChunkSize: 10,
      minChunkSize: 0,
    });
    expect(result.map((c) => c.text)).toEqual([
      '林远离开。\n***\n',
      '三年后。\n***\n',
      '苏晴归来。',
    ]);
    expectConsistent(text, result);
  });

  it('文本以段落分隔符结尾时，尾部分隔符不应丢失', () => {
    // 期望：块拼接后等于原文，最后一块 endOffset === text.length
    // 实际：paragraph.ts:35 用 text.indexOf(rawParts[i + 1], ...) 定位分隔符，
    //       当最后一段为空串时 indexOf('') 直接返回搜索起点，分隔符长度被算成 0，
    //       结尾的 "\n\n" 被丢弃
    const text = '林远到了。\n\n苏晴走了。\n\n';
    const result = chunkByParagraph(text, { maxChunkSize: 100, minChunkSize: 0 });
    expect(result.map((c) => c.text).join('')).toBe(text);
  });
});
