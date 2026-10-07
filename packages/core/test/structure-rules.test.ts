import { describe, expect, it } from 'vitest';
import {
  classifyStructureLine,
  compileStructureRules,
  DEFAULT_STRUCTURE_CONFIG,
  DEFAULT_STRUCTURE_RULES,
  hasNestedQuantifier,
  matchStructureLine,
  nextCustomRuleId,
  normalizeStructureConfig,
  validateCustomStructureRule,
} from '../src/structure-rules';
import { extractNovelScenes, lintNovelMarkup } from '../src/novel-format';

const only = (presets: string[], custom: unknown[] = []) =>
  compileStructureRules({ presets, custom });

describe('预设：中文', () => {
  const rules = only(['zh']);
  it.each([
    ['第一章 离港', 'chapter'],
    ['第12章', 'chapter'],
    ['第三回 夜宴', 'chapter'],
    ['第二卷 星海', 'chapter'],
    ['第一章离港', 'chapter'],
    ['楔子', 'chapter'],
    ['番外：雪夜', 'chapter'],
    ['第一幕 离乡', 'act'],
    ['第一幕', 'act'],
    ['第二场 清晨', 'scene'],
    ['第3场：码头', 'scene'],
  ])('%s → %s', (line, kind) => {
    expect(classifyStructureLine(line, rules)).toBe(kind);
  });
  it.each([
    '他说第三章说过的话。',
    '第一场雨下了一整夜',
    '第一幕后他走了，',
    '楔子里写过',
    '清晨，林舟背起行囊。',
    'Chapter 1',
    `第一章 ${'长'.repeat(50)}`,
  ])('不是结构行：%s', (line) => {
    expect(classifyStructureLine(line, rules)).toBeNull();
  });
});

describe('预设：English', () => {
  const rules = only(['en']);
  it.each([
    ['Chapter 1', 'chapter'],
    ['Chapter 1: The Harbor', 'chapter'],
    ['CHAPTER 12 - Storm', 'chapter'],
    ['chapter xii', 'chapter'],
    ['Chapter XII', 'chapter'],
    ['Chapter Twelve', 'chapter'],
    ['Chapter Twenty-One: Return', 'chapter'],
    ['Chapter One The Harbor', 'chapter'],
    ['Ch. 3', 'chapter'],
    ['Ch.3 Dawn', 'chapter'],
    ['Part 2', 'chapter'],
    ['Part II — The Sea', 'chapter'],
    ['Book 1', 'chapter'],
    ['Prologue', 'chapter'],
    ['Epilogue: After the Storm', 'chapter'],
    ['Interlude', 'chapter'],
    ['  Chapter 4  ', 'chapter'],
    ['Act 1', 'act'],
    ['Act I', 'act'],
    ['ACT III: Fall', 'act'],
    ['Scene 1', 'scene'],
    ['Scene 3 - Dawn', 'scene'],
    ['scene twenty', 'scene'],
  ])('%s → %s', (line, kind) => {
    expect(classifyStructureLine(line, rules)).toBe(kind);
  });
  it.each([
    'Chapter one was the hardest to write.',
    'Part two of the plan was simple',
    'Book I loved most as a child',
    'Act now or lose everything',
    'Scene of the crime',
    'Chapter Civil War',
    'Chapters 1 to 3',
    'The chapter 1 notes',
    'Prologues are overrated',
    'Prologue is where it starts',
    'Chapter',
    'Act IIII',
    `Chapter 1: ${'Long title '.repeat(8)}`,
    'Is this Chapter 1?',
    '第一章 离港',
  ])('不是结构行：%s', (line) => {
    expect(classifyStructureLine(line, rules)).toBeNull();
  });
});

describe('预设：数字序号（默认关闭）', () => {
  const rules = only(['numbered']);
  it.each(['1. 离港', '12、归来', '001', '7', '003 The Harbor'])('%s → chapter', (line) => {
    expect(classifyStructureLine(line, rules)).toBe('chapter');
  });
  it.each(['2024 was a good year', '1.5 倍速度。', '12345', '1. 他走了，'])(
    '不是结构行：%s',
    (line) => {
      expect(classifyStructureLine(line, rules)).toBeNull();
    }
  );
  it('默认规则不包含数字序号', () => {
    expect(DEFAULT_STRUCTURE_CONFIG.presets).toEqual(['zh', 'en']);
    expect(classifyStructureLine('1. 离港')).toBeNull();
  });
});

describe('默认规则与旧签名', () => {
  it('不传规则时 = 中文 + English', () => {
    expect(classifyStructureLine('第一章 离港')).toBe('chapter');
    expect(classifyStructureLine('Chapter 1: The Harbor')).toBe('chapter');
    expect(classifyStructureLine('Act II')).toBe('act');
    expect(DEFAULT_STRUCTURE_RULES.rules.length).toBeGreaterThan(0);
  });
  it('matchStructureLine 返回识别出的规则', () => {
    expect(matchStructureLine('Scene 2')).toEqual({
      kind: 'scene',
      ruleId: 'en-scene',
      source: 'en',
    });
    expect(matchStructureLine('   ')).toBeNull();
  });
  it('关闭全部预设后没有结构行', () => {
    expect(classifyStructureLine('第一章 离港', only([]))).toBeNull();
  });
});

describe('自定义规则', () => {
  it('自定义规则优先于预设，可不区分大小写', () => {
    const rules = only(
      ['zh', 'en'],
      [
        { id: 'sep', kind: 'scene', pattern: '^=== (.+) ===$' },
        { id: 'ep', kind: 'chapter', pattern: '^episode \\d+', flags: 'i' },
        { id: 'act-as-scene', kind: 'scene', pattern: '^Act \\d+$' },
      ]
    );
    expect(matchStructureLine('=== Dawn ===', rules)?.ruleId).toBe('sep');
    expect(classifyStructureLine('EPISODE 4', rules)).toBe('chapter');
    expect(classifyStructureLine('Act 1', rules)).toBe('scene');
    expect(classifyStructureLine('Act I', rules)).toBe('act');
  });

  it('校验：id、类型、标志、长度、语法、空匹配、嵌套量词', () => {
    const ok = validateCustomStructureRule({ id: 'a', kind: 'act', pattern: '^Movement \\d+$' });
    expect(ok.ok).toBe(true);
    const bad = (rule: Record<string, unknown>) => {
      const result = validateCustomStructureRule({ id: 'x', kind: 'scene', pattern: 'x', ...rule });
      return result.ok ? '' : result.error;
    };
    expect(bad({ id: 'has space' })).toMatch(/id/);
    expect(bad({ kind: 'volume' })).toMatch(/chapter/);
    expect(bad({ flags: 'g' })).toMatch(/i/);
    expect(bad({ pattern: '' })).toMatch(/不能为空/);
    expect(bad({ pattern: 'a'.repeat(201) })).toMatch(/过长/);
    expect(bad({ pattern: '([a-z' })).toMatch(/无法解析/);
    expect(bad({ pattern: '.*' })).toMatch(/空行/);
    expect(bad({ pattern: '^(a+)+$' })).toMatch(/嵌套量词/);
    expect(bad({ pattern: '^(?:\\w*\\s)*$' })).toMatch(/嵌套量词/);
    expect(validateCustomStructureRule(null).ok).toBe(false);
  });

  it('嵌套量词启发式', () => {
    expect(hasNestedQuantifier('(a+)+')).toBe(true);
    expect(hasNestedQuantifier('((ab)*c)*')).toBe(true);
    expect(hasNestedQuantifier('(a+){2,}')).toBe(true);
    expect(hasNestedQuantifier('^=== (.+) ===$')).toBe(false);
    expect(hasNestedQuantifier('(a|b)+')).toBe(false);
    expect(hasNestedQuantifier('\\(a+\\)+')).toBe(false);
    expect(hasNestedQuantifier('([+*])+')).toBe(false);
    expect(hasNestedQuantifier('(a+)?')).toBe(false);
  });

  it('超长的行不交给自定义正则', () => {
    const rules = only([], [{ id: 'any', kind: 'scene', pattern: '^S' }]);
    expect(classifyStructureLine('S'.repeat(120), rules)).toBe('scene');
    expect(classifyStructureLine('S'.repeat(121), rules)).toBeNull();
  });

  it('nextCustomRuleId 不重复', () => {
    expect(nextCustomRuleId([])).toBe('custom-1');
    expect(
      nextCustomRuleId([
        { id: 'custom-2', kind: 'scene', pattern: 'x' },
        { id: 'custom-3', kind: 'scene', pattern: 'y' },
      ])
    ).toBe('custom-4');
  });
});

describe('normalizeStructureConfig', () => {
  it('缺失 → 默认；无效项丢弃并给出提示', () => {
    expect(normalizeStructureConfig(undefined)).toEqual({
      config: { presets: ['zh', 'en'], custom: [] },
      warnings: [],
    });
    const result = normalizeStructureConfig({
      presets: ['numbered', 'zh', 'klingon', 'zh'],
      custom: [
        { id: 'ok', kind: 'scene', pattern: '^#=' },
        { id: 'bad', kind: 'scene', pattern: '(a+)+' },
        { id: 'ok', kind: 'act', pattern: '^x' },
      ],
    });
    expect(result.config).toEqual({
      presets: ['zh', 'numbered'],
      custom: [{ id: 'ok', kind: 'scene', pattern: '^#=' }],
    });
    expect(result.warnings).toHaveLength(3);
    expect(normalizeStructureConfig('oops').warnings).toHaveLength(1);
    expect(normalizeStructureConfig({ custom: [] }).config.presets).toEqual(['zh', 'en']);
  });

  it('签名稳定：预设顺序不影响', () => {
    expect(compileStructureRules({ presets: ['en', 'zh'], custom: [] }).signature).toBe(
      DEFAULT_STRUCTURE_RULES.signature
    );
  });
});

describe('extractNovelScenes / lintNovelMarkup 使用规则', () => {
  const text = [':::scene{title=港口}', '雨夜。', '=== Part B ===', '后文'].join('\n');
  it('自定义的章规则会结束未闭合的场景', () => {
    expect(extractNovelScenes(text)[0].endLine).toBe(4);
    const rules = only(['zh'], [{ id: 'part', kind: 'chapter', pattern: '^=== .+ ===$' }]);
    const [scene] = extractNovelScenes(text, rules);
    expect(scene.endLine).toBe(2);
    expect(scene.unclosed).toBe(true);
    expect(lintNovelMarkup(text, rules)).toHaveLength(1);
  });
  it('English 章标题同样结束场景', () => {
    const english = [':::scene{title=Dock}', 'Rain.', 'Chapter 2: Sea', 'More'].join('\n');
    expect(extractNovelScenes(english)[0].endLine).toBe(2);
    expect(extractNovelScenes(english, only(['zh']))[0].endLine).toBe(4);
  });
});
