import { describe, expect, it } from 'vitest';
import {
  assembleWritingContext,
  buildContinuationPrompt,
  buildStoryboardPrompt,
  cleanContinuationOutput,
  countMentions,
  estimateTokens,
  extractJson,
  parseStoryboardResponse,
  truncateToTokens,
  TRUNCATION_MARK,
  type WritingContextInput,
} from '../src';

const paragraph = '林舟握紧长剑，望向雾林深处。苏晴在他身后低声说：“别冲动。”';
const longChapter = Array.from({ length: 200 }, (_, i) => `第${i}段。${paragraph}`).join('\n');

describe('token 估算与截断', () => {
  it('中文按字、英文按 4 字符', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('你好世界')).toBe(4);
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('你好，abcd')).toBe(4);
    expect(estimateTokens('😀')).toBe(1);
  });

  it('未超出预算时原样返回', () => {
    expect(truncateToTokens('短句。', 100)).toEqual({
      text: '短句。',
      tokens: 3,
      truncated: false,
    });
  });

  it('head 保留开头、tail 保留结尾，并在句子边界处截断', () => {
    const text = '第一句话写在这里。第二句话写在这里。第三句话写在这里。';
    const head = truncateToTokens(text, 16, 'head');
    expect(head.truncated).toBe(true);
    expect(head.text.startsWith('第一句话写在这里。')).toBe(true);
    expect(head.text.endsWith(TRUNCATION_MARK)).toBe(true);
    expect(head.tokens).toBeLessThanOrEqual(16);
    expect(truncateToTokens('甲乙丙丁戊己庚辛壬。子丑寅卯辰', 13, 'head').text).toBe(
      `甲乙丙丁戊己庚辛壬。${TRUNCATION_MARK}`
    );
    const tail = truncateToTokens(text, 13, 'tail');
    expect(tail.text).toBe(`${TRUNCATION_MARK}第三句话写在这里。`);
    expect(tail.tokens).toBeLessThanOrEqual(13);
  });

  it('预算小于截断标记时返回空', () => {
    expect(truncateToTokens('很长很长的句子', 1)).toEqual({ text: '', tokens: 0, truncated: true });
  });
});

describe('assembleWritingContext', () => {
  const base: WritingContextInput = {
    chapterText: longChapter,
    chapterTitle: '第三章 雾林',
    outline: ['林舟进入雾林', '与狼王对峙'],
    characters: [
      { name: '路人甲', summary: '酒馆老板' },
      { name: '苏晴', aliases: ['晴儿'], summary: '医师', status: '左臂受伤' },
      { name: '林舟', summary: '主角，剑士' },
    ],
    growth: [
      { name: '林舟', level: 5, summary: '力量 14，技能：破风剑 Lv2' },
      { name: '路人甲', level: 1, summary: '无' },
    ],
    rules: ['林舟在第十章前不得超过 10 级', '魔法需要消耗精神力'],
    lore: [{ title: '雾林', content: '终年大雾，\n有狼群出没' }],
    budget: 2000,
  };

  it.each([50, 120, 300, 800, 2000, 5000, 100_000])('任何预算 %i 下都不超出', (budget) => {
    const result = assembleWritingContext({ ...base, budget });
    expect(result.usedTokens).toBeLessThanOrEqual(budget);
    expect(result.budget).toBe(budget);
  });

  it('确定性：相同输入相同输出', () => {
    expect(assembleWritingContext(base)).toEqual(assembleWritingContext(base));
  });

  it('前文保留光标前的结尾，规则与章纲排在前面', () => {
    const result = assembleWritingContext(base);
    const keys = result.sections.map((section) => section.key);
    expect(keys).toEqual(['rules', 'outline', 'characters', 'growth', 'lore', 'preceding']);
    const preceding = result.sections.find((section) => section.key === 'preceding');
    expect(preceding?.truncated).toBe(true);
    expect(preceding?.text.endsWith(longChapter.slice(-20))).toBe(true);
    expect(result.text).toContain('【前文（第三章 雾林）】');
    expect(result.text.indexOf('【核心规则】')).toBe(0);
    expect(result.precedingText).toBe(longChapter);
  });

  it('人物按提及次数排序，未提及的成长档案被过滤', () => {
    const result = assembleWritingContext(base);
    const characters = result.sections.find((section) => section.key === 'characters')?.text ?? '';
    expect(characters.indexOf('林舟')).toBeLessThan(characters.indexOf('苏晴'));
    expect(characters.indexOf('苏晴')).toBeLessThan(characters.indexOf('路人甲'));
    expect(characters).toContain('苏晴（又名 晴儿）：医师；当前：左臂受伤');
    const growth = result.sections.find((section) => section.key === 'growth')?.text ?? '';
    expect(growth).toContain('林舟 Lv.5');
    expect(growth).not.toContain('路人甲');
    expect(countMentions('晴儿和苏晴，苏晴', { name: '苏晴', aliases: ['晴儿', ''] })).toBe(3);
  });

  it('预算紧张时整条丢弃排在后面的人物，并记录数量', () => {
    const characters = Array.from({ length: 30 }, (_, i) => ({
      name: `角色${i}`,
      summary: '一段很长的人物介绍'.repeat(5),
    }));
    const result = assembleWritingContext({ chapterText: '正文', characters, budget: 400 });
    const section = result.sections.find((item) => item.key === 'characters');
    expect(section?.omittedItems).toBeGreaterThan(0);
    expect(section?.truncated).toBe(true);
    expect(result.usedTokens).toBeLessThanOrEqual(400);
  });

  it('前文很短时，剩余预算回填给被截断的分区', () => {
    const outline = '章纲要点。'.repeat(200);
    const short = assembleWritingContext({ chapterText: '开头。', outline, budget: 800 });
    const outlineSection = short.sections.find((section) => section.key === 'outline');
    // 上限 15% = 120 token，回填后应明显多于上限
    expect(outlineSection?.tokens).toBeGreaterThan(400);
    expect(short.usedTokens).toBeLessThanOrEqual(800);
  });

  it('光标在中间：后文排在前文之后；includeFollowing=false 时不带后文', () => {
    const chapterText = '前面的内容。光标后面的内容。';
    const cursor = chapterText.indexOf('光标');
    const result = assembleWritingContext({ chapterText, cursor, budget: 500 });
    expect(result.sections.map((section) => section.key)).toEqual(['preceding', 'following']);
    expect(result.precedingText).toBe('前面的内容。');
    const without = assembleWritingContext({
      chapterText,
      cursor,
      budget: 500,
      includeFollowing: false,
    });
    expect(without.sections.map((section) => section.key)).toEqual(['preceding']);
  });

  it('没有前文时可选分区可以用满预算；空输入返回空上下文', () => {
    const result = assembleWritingContext({
      chapterText: '',
      outline: '要点。'.repeat(50),
      budget: 1000,
    });
    expect(result.sections.map((s) => s.key)).toEqual(['outline']);
    expect(result.sections[0].truncated).toBe(false);
    expect(assembleWritingContext({ chapterText: '', budget: 100 })).toMatchObject({
      text: '',
      usedTokens: 0,
    });
    expect(assembleWritingContext({ chapterText: 'abc', budget: 0 }).usedTokens).toBe(0);
  });
});

describe('续写提示词', () => {
  const context = assembleWritingContext({
    chapterText: paragraph,
    outline: '与狼王对峙',
    rules: ['不得超过 10 级'],
    budget: 1000,
  });

  it('默认一段，遵循章纲', () => {
    const prompt = buildContinuationPrompt({ context });
    expect(prompt.messages[0]).toEqual({ role: 'system', content: prompt.systemPrompt });
    expect(prompt.prompt).toContain('续写一个自然段');
    expect(prompt.prompt).toContain('与【本章章纲】保持一致');
    expect(prompt.targetChars).toBe(250);
    expect(prompt.maxTokens).toBe(375);
    expect(prompt.temperature).toBe(0.85);
  });

  it('自定义字数、方向与不遵循章纲', () => {
    const prompt = buildContinuationPrompt({
      context,
      chars: 500,
      direction: 'conflict',
      followOutline: false,
    });
    expect(prompt.prompt).toContain('续写约 500 字');
    expect(prompt.prompt).toContain('制造新的冲突');
    expect(prompt.prompt).toContain('章纲仅供参考');
    expect(prompt.temperature).toBe(1);
    const free = buildContinuationPrompt({
      context,
      direction: '让苏晴先开口',
      length: 'sentence',
    });
    expect(free.prompt).toContain('按作者的要求续写：让苏晴先开口');
    expect(free.prompt).toContain('只续写一到两句话');
  });

  it('没有前文时提示这是开头', () => {
    const empty = assembleWritingContext({ chapterText: '', budget: 100 });
    expect(buildContinuationPrompt({ context: empty }).prompt).toContain('这是本章的开头');
  });

  it('清理输出：代码块、前缀、整体引号、复述的前文', () => {
    expect(cleanContinuationOutput('```\n他拔剑。\n```')).toBe('他拔剑。');
    expect(cleanContinuationOutput('续写：他拔剑。  ')).toBe('他拔剑。');
    expect(cleanContinuationOutput('“他拔剑。”')).toBe('他拔剑。');
    expect(cleanContinuationOutput('“你好，”他说，“走吧。”')).toBe('“你好，”他说，“走吧。”');
    expect(cleanContinuationOutput('低声说：“别冲动。”林舟点头。', paragraph)).toBe('林舟点头。');
    expect(cleanContinuationOutput('\n新的一段。', paragraph)).toBe('\n新的一段。');
  });
});

describe('分镜提示词与解析', () => {
  it('提示词包含场景、人物、地点、比例与 schema', () => {
    const prompt = buildStoryboardPrompt({
      sceneText: paragraph,
      sceneTitle: '第一幕 / 第一场',
      characters: [{ name: '林舟', appearance: '黑衣长剑' }, { name: '' }],
      location: '雾林',
      style: '水墨',
      aspectRatio: '9:16',
    });
    expect(prompt.prompt).toContain('【场景：第一幕 / 第一场】');
    expect(prompt.prompt).toContain('- 林舟：黑衣长剑');
    expect(prompt.prompt).toContain('【地点】雾林');
    expect(prompt.prompt).toContain('画面比例 9:16，画面风格：水墨');
    expect(prompt.prompt).toContain('"shotSize"');
    expect(prompt.schema).toHaveProperty('required', ['shots']);
    expect(prompt.maxTokens).toBe(3600);
  });

  it('解析代码块中的 JSON 并补全默认值', () => {
    const text =
      '好的，分镜如下：\n```json\n{"shots":[{"shotSize":"远景","durationSec":6,"description":"月夜雪原"},{"size":"close-up","duration":"4秒","prompt":"狼王的眼睛",}]}\n```';
    const parsed = parseStoryboardResponse(text, {
      aspectRatio: '1:1',
      style: '国漫',
      title: '雾林',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.storyboard).toMatchObject({ aspectRatio: '1:1', style: '国漫', title: '雾林' });
    expect(parsed.storyboard.shots.map((shot) => [shot.shotSize, shot.durationSec])).toEqual([
      ['远景', 6],
      ['特写', 4],
    ]);
  });

  it('无效 JSON 或结构错误时返回错误列表', () => {
    expect(parseStoryboardResponse('抱歉，我无法完成')).toEqual({
      ok: false,
      errors: ['AI 返回的内容不是有效的 JSON'],
    });
    expect(parseStoryboardResponse('')).toEqual({ ok: false, errors: ['AI 没有返回内容'] });
    const invalid = parseStoryboardResponse('{"shots":[]}');
    expect(invalid.ok).toBe(false);
  });

  it('extractJson 跳过字符串内的括号、选择第一个可解析片段', () => {
    expect(extractJson('前言 {"a":"}{"} 后记')).toEqual({ ok: true, value: { a: '}{' } });
    expect(extractJson('[1,2,]')).toEqual({ ok: true, value: [1, 2] });
    expect(extractJson('{bad} {"ok":true}')).toEqual({ ok: true, value: { ok: true } });
    expect(extractJson('{"unclosed": ')).toMatchObject({ ok: false });
  });
});
