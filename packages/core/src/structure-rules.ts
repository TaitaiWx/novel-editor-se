/**
 * 正文结构规则（纯函数，GUI 渲染进程 / 主进程 / CLI 共用，不依赖 Node）
 *
 * 不用 Markdown 语法的结构行（「第一章 离港」「Chapter 1: The Harbor」「第一幕」「Act I」……）
 * 由一组规则识别为 章 / 幕 / 场：
 * - 内置预设：`zh`（中文：第N章/回/卷/部/篇/集/节、序章/楔子/尾声/番外…、第N幕、第N场）、
 *   `en`（不区分大小写：Chapter 12 / Chapter XII / Chapter Twelve / Ch. 3 / Part 2 / Book 1、
 *   Prologue / Epilogue / Interlude、Act 1 / Act I、Scene 1，可带 `:` / `-` / 空格后的标题）、
 *   `numbered`（`1.` / `1、` / `001` 这类序号行，默认关闭）
 * - 自定义规则：作者写的正则（只允许 `i` 标志），保存前做安全校验（长度、嵌套量词、空匹配）
 *
 * 判断逻辑里不直接写汉字：中文一律用 \u 转义（见 packages/core/test/no-cjk-regex.test.ts）。
 * 配置的读写（.novel-editor/config.json 的 `structure` 字段）见 ./structure-config（仅 Node）。
 */

export type StructureLineKind = 'chapter' | 'act' | 'scene';

export const STRUCTURE_LINE_KINDS: readonly StructureLineKind[] = ['chapter', 'act', 'scene'];

export type StructurePresetId = 'zh' | 'en' | 'numbered';

export const STRUCTURE_PRESET_IDS: readonly StructurePresetId[] = ['zh', 'en', 'numbered'];

export interface CustomStructureRule {
  /** 规则 id（ASCII 字母、数字、`_`、`-`） */
  id: string;
  kind: StructureLineKind;
  /** 正则源码（不含两侧的 `/`） */
  pattern: string;
  /** 只允许 `i`（不区分大小写） */
  flags?: 'i';
}

export interface StructureConfig {
  presets: StructurePresetId[];
  custom: CustomStructureRule[];
}

export const DEFAULT_STRUCTURE_CONFIG: StructureConfig = Object.freeze({
  presets: ['zh', 'en'],
  custom: [],
}) as StructureConfig;

/** 预设说明（GUI 设置与 CLI `ne structure list` 共用） */
export const STRUCTURE_PRESET_INFO: Record<
  StructurePresetId,
  { label: string; description: string; examples: string[] }
> = {
  zh: {
    label: '中文',
    description: '第N章 / 回 / 卷 / 部 / 篇 / 集 / 节、序章 / 楔子 / 尾声 / 番外，第N幕、第N场',
    examples: [
      '\u7b2c\u4e00\u7ae0 \u79bb\u6e2f',
      '\u7b2c\u4e00\u5e55 \u79bb\u4e61',
      '\u7b2c\u4e8c\u573a \u6e05\u6668',
      '\u6954\u5b50',
    ],
  },
  en: {
    label: 'English',
    description:
      'Chapter 12 / Chapter XII / Chapter Twelve / Ch. 3 / Part 2 / Book 1、Prologue / Epilogue / Interlude，Act 1 / Act I，Scene 1（不区分大小写）',
    examples: ['Chapter 1: The Harbor', 'Chapter XII', 'Prologue', 'Act II', 'Scene 3 - Dawn'],
  },
  numbered: {
    label: '数字序号',
    description: '「1.」「1、」「001」这类以序号开头的短行当作章标题（列表多的文稿慎用）',
    examples: ['1. \u79bb\u6e2f', '12\u3001\u5f52\u6765', '001'],
  },
};

/** 编译后的一条规则 */
export interface CompiledStructureRule {
  id: string;
  kind: StructureLineKind;
  source: StructurePresetId | 'custom';
  /** 去掉首尾空白后的一行是否匹配（长度 / 句读等保护已包含在内） */
  test(text: string): boolean;
}

export interface StructureRuleSet {
  config: StructureConfig;
  rules: CompiledStructureRule[];
  /** 配置签名：相同签名的规则集识别结果相同（用于缓存 / 判断是否需要刷新） */
  signature: string;
}

export interface StructureLineMatch {
  kind: StructureLineKind;
  ruleId: string;
  source: StructurePresetId | 'custom';
}

// ─── 共用保护 ──────────────────────────────────────────────────────────────

/** 以句读结尾的行是正文，不是标题：。！？，；” 以及 ASCII 的 ! ? , ; " 和句点 */
const TRAILING_SENTENCE_PUNCT_ZH = /[\u3002\uff01\uff1f!?\uff0c,\uff1b;\u201d"]$/;
const TRAILING_SENTENCE_PUNCT_EN = /[\u3002\uff01\uff1f!?\uff0c,\uff1b;\u201d".]$/;

function guarded(maxLength: number, trailing: RegExp | null, test: (text: string) => boolean) {
  return (text: string): boolean => {
    if (!text || text.length > maxLength || text.includes('\n')) return false;
    if (trailing && trailing.test(text)) return false;
    return test(text);
  };
}

// ─── 中文预设 ──────────────────────────────────────────────────────────────

// 中文数字（一二三……万、零〇两）或阿拉伯数字
const CN_NUMBER =
  '[\\u4e00\\u4e8c\\u4e09\\u56db\\u4e94\\u516d\\u4e03\\u516b\\u4e5d\\u5341\\u767e\\u5343\\u4e07\\u96f6\\u3007\\u4e24\\d]+';
// \u7b2c 第；\u7ae0 章 \u56de 回 \u5377 卷 \u90e8 部 \u7bc7 篇 \u96c6 集 \u8282 节；\u5e55 幕；\u573a 场
// 章标题允许紧跟标题（「第一章离港」）；幕 / 场要求分隔，避免「第一场雨……」误判
const ZH_CHAPTER_RE = new RegExp(
  `^\\u7b2c${CN_NUMBER}[\\u7ae0\\u56de\\u5377\\u90e8\\u7bc7\\u96c6\\u8282]`
);
// 序章 序幕 楔子 引子 尾声 终章 后记 番外
const ZH_SPECIAL_CHAPTER_RE =
  /^(?:\u5e8f\u7ae0|\u5e8f\u5e55|\u6954\u5b50|\u5f15\u5b50|\u5c3e\u58f0|\u7ec8\u7ae0|\u540e\u8bb0|\u756a\u5916)(?:[\s:\uff1a\u00b7\u3001\-\u2014]|$)/;
const ZH_ACT_RE = new RegExp(
  `^\\u7b2c${CN_NUMBER}\\u5e55(?:[\\s:\\uff1a\\u00b7\\u3001.\\-\\u2014]|$)`
);
const ZH_SCENE_RE = new RegExp(
  `^\\u7b2c${CN_NUMBER}\\u573a(?:[\\s:\\uff1a\\u00b7\\u3001.\\-\\u2014]|$)`
);

const ZH_MAX = 40;

function zhRules(): CompiledStructureRule[] {
  return [
    {
      id: 'zh-chapter',
      kind: 'chapter',
      source: 'zh',
      test: guarded(
        ZH_MAX,
        TRAILING_SENTENCE_PUNCT_ZH,
        (text) => ZH_CHAPTER_RE.test(text) || ZH_SPECIAL_CHAPTER_RE.test(text)
      ),
    },
    {
      id: 'zh-act',
      kind: 'act',
      source: 'zh',
      test: guarded(ZH_MAX, TRAILING_SENTENCE_PUNCT_ZH, (text) => ZH_ACT_RE.test(text)),
    },
    {
      id: 'zh-scene',
      kind: 'scene',
      source: 'zh',
      test: guarded(ZH_MAX, TRAILING_SENTENCE_PUNCT_ZH, (text) => ZH_SCENE_RE.test(text)),
    },
  ];
}

// ─── English 预设 ──────────────────────────────────────────────────────────

const UNITS = 'one|two|three|four|five|six|seven|eight|nine';
const TEENS =
  'ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty';
const TENS = 'twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety';
// 数字：阿拉伯数字 / 罗马数字 / 英文数词（one … ninety-nine、hundred）
const EN_NUMBER = `(?:\\d{1,4}|[ivxlcdm]{1,8}|(?:${TENS})(?:[- ](?:${UNITS}))?|${TEENS}|${UNITS}|(?:one )?hundred)`;
// 标题分隔：`:` / `.` / `-` / en dash / em dash，或空格
const EN_TAIL = '(?:(\\s*[:.\\-\\u2013\\u2014]\\s*|\\s+)(\\S.*))?';

const EN_CHAPTER_RE = new RegExp(
  `^(?:chapter\\s+|ch\\.\\s*|part\\s+|book\\s+)(${EN_NUMBER})${EN_TAIL}$`,
  'i'
);
const EN_SPECIAL_RE = new RegExp(
  `^(?:prologue|epilogue|interlude|foreword|afterword)()${EN_TAIL}$`,
  'i'
);
const EN_ACT_RE = new RegExp(`^act\\s+(${EN_NUMBER})${EN_TAIL}$`, 'i');
const EN_SCENE_RE = new RegExp(`^scene\\s+(${EN_NUMBER})${EN_TAIL}$`, 'i');
const ROMAN_RE = /^m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/i;
const ROMAN_LETTERS_RE = /^[ivxlcdm]+$/i;
const LOWERCASE_START_RE = /^[a-z]/;

const EN_MAX = 60;

/**
 * 英文结构行：关键字 + 数字 + 可选标题。
 * 只用空格分隔的标题必须不以小写字母开头（「Part two of the plan」「Book I loved」是正文）。
 */
function matchEnglish(re: RegExp, text: string): boolean {
  const match = re.exec(text);
  if (!match) return false;
  const number = match[1] ?? '';
  if (number && ROMAN_LETTERS_RE.test(number) && !ROMAN_RE.test(number)) return false;
  const separator = match[2];
  const title = match[3];
  if (title !== undefined && separator !== undefined && !separator.trim()) {
    if (LOWERCASE_START_RE.test(title)) return false;
  }
  return true;
}

function enRules(): CompiledStructureRule[] {
  return [
    {
      id: 'en-chapter',
      kind: 'chapter',
      source: 'en',
      test: guarded(
        EN_MAX,
        TRAILING_SENTENCE_PUNCT_EN,
        (text) => matchEnglish(EN_CHAPTER_RE, text) || matchEnglish(EN_SPECIAL_RE, text)
      ),
    },
    {
      id: 'en-act',
      kind: 'act',
      source: 'en',
      test: guarded(EN_MAX, TRAILING_SENTENCE_PUNCT_EN, (text) => matchEnglish(EN_ACT_RE, text)),
    },
    {
      id: 'en-scene',
      kind: 'scene',
      source: 'en',
      test: guarded(EN_MAX, TRAILING_SENTENCE_PUNCT_EN, (text) => matchEnglish(EN_SCENE_RE, text)),
    },
  ];
}

// ─── 数字序号预设 ──────────────────────────────────────────────────────────

// `1.` `1、`（\u3001）后可跟标题；`001` 这类带前导零的编号可跟空格 + 标题；纯数字一行
const NUMBERED_RE = /^(?:\d{1,4}[.\u3001](?:\s*\S.*)?|0\d{1,3}(?:\s+\S.*)?|\d{1,4})$/;

function numberedRules(): CompiledStructureRule[] {
  return [
    {
      id: 'numbered-chapter',
      kind: 'chapter',
      source: 'numbered',
      test: guarded(ZH_MAX, TRAILING_SENTENCE_PUNCT_ZH, (text) => NUMBERED_RE.test(text)),
    },
  ];
}

// ─── 自定义规则 ────────────────────────────────────────────────────────────

export const CUSTOM_PATTERN_MAX_LENGTH = 200;
/** 自定义规则只看不超过这么长的行（标题不会更长，也限制了正则的输入规模） */
export const CUSTOM_LINE_MAX_LENGTH = 120;
export const CUSTOM_RULE_LIMIT = 30;
const RULE_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * 嵌套量词启发式：一个分组里有 + / * / {n,}，分组后面又跟 + / * / {n,}，
 * 例如 `(a+)+`、`(\w*)*`、`(?:x+y)+` —— 这类写法可能导致灾难性回溯，直接拒绝。
 */
export function hasNestedQuantifier(pattern: string): boolean {
  // 先去掉转义字符与字符类，避免 `\(` `[+*]` 干扰
  const stripped = pattern.replace(/\\./g, 'x').replace(/\[(?:[^\]\\]|\\.)*\]/g, 'x');
  const stack: boolean[] = [];
  for (let index = 0; index < stripped.length; index += 1) {
    const char = stripped[index];
    if (char === '(') {
      stack.push(false);
      continue;
    }
    const quantifier = isUnboundedQuantifierAt(stripped, index);
    if (char === ')') {
      const innerQuantified = stack.pop() ?? false;
      if (innerQuantified && isUnboundedQuantifierAt(stripped, index + 1)) return true;
      // 内层有量词也会传递给外层分组
      if (innerQuantified && stack.length) stack[stack.length - 1] = true;
      continue;
    }
    if (quantifier && stack.length) stack[stack.length - 1] = true;
  }
  return false;
}

function isUnboundedQuantifierAt(text: string, index: number): boolean {
  const char = text[index];
  if (char === '+' || char === '*') return true;
  if (char === '{')
    return /^\{\d*,\}/.test(text.slice(index)) || /^\{\d+,\d{3,}\}/.test(text.slice(index));
  return false;
}

export type CustomRuleValidation =
  | { ok: true; rule: CustomStructureRule; regex: RegExp }
  | { ok: false; error: string };

/** 校验一条自定义规则（GUI 保存、CLI add、读取配置时都会调用） */
export function validateCustomStructureRule(raw: unknown): CustomRuleValidation {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: '规则格式不正确' };
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  if (!RULE_ID_RE.test(id)) return { ok: false, error: '规则 id 只能包含字母、数字、_ 和 -' };
  const kind = value.kind;
  if (typeof kind !== 'string' || !(STRUCTURE_LINE_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: '类型必须是 chapter / act / scene' };
  }
  const pattern = typeof value.pattern === 'string' ? value.pattern : '';
  if (!pattern.trim()) return { ok: false, error: '正则不能为空' };
  if (pattern.length > CUSTOM_PATTERN_MAX_LENGTH) {
    return { ok: false, error: `正则过长（最多 ${CUSTOM_PATTERN_MAX_LENGTH} 个字符）` };
  }
  if (pattern.includes('\n')) return { ok: false, error: '正则不能包含换行' };
  const flags = value.flags === undefined || value.flags === '' ? '' : value.flags;
  if (flags !== '' && flags !== 'i') return { ok: false, error: '只支持 i（不区分大小写）标志' };
  if (hasNestedQuantifier(pattern)) {
    return { ok: false, error: '正则含有嵌套量词（如 (a+)+），可能导致卡顿，请改写' };
  }
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch (error) {
    return {
      ok: false,
      error: `正则无法解析：${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (regex.test('')) return { ok: false, error: '正则会匹配空行，请写得更具体' };
  return {
    ok: true,
    rule: { id, kind: kind as StructureLineKind, pattern, ...(flags ? { flags: 'i' } : {}) },
    regex,
  };
}

/** 为新规则生成不重复的 id（custom-1、custom-2……） */
export function nextCustomRuleId(existing: CustomStructureRule[]): string {
  const used = new Set(existing.map((rule) => rule.id));
  let n = existing.length + 1;
  while (used.has(`custom-${n}`)) n += 1;
  return `custom-${n}`;
}

// ─── 配置规范化 / 编译 ─────────────────────────────────────────────────────

export interface NormalizedStructureConfig {
  config: StructureConfig;
  /** 被丢弃的内容（未知预设、无效规则）说明 */
  warnings: string[];
}

/** 读取到的 `structure` 字段 → 合法配置；缺失时为默认配置，无效项丢弃并给出提示 */
export function normalizeStructureConfig(raw: unknown): NormalizedStructureConfig {
  if (raw === undefined || raw === null) {
    return { config: cloneStructureConfig(DEFAULT_STRUCTURE_CONFIG), warnings: [] };
  }
  const warnings: string[] = [];
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      config: cloneStructureConfig(DEFAULT_STRUCTURE_CONFIG),
      warnings: ['structure 不是对象，已使用默认规则'],
    };
  }
  const value = raw as Record<string, unknown>;
  const presets: StructurePresetId[] = [];
  if (Array.isArray(value.presets)) {
    for (const item of value.presets) {
      if (typeof item === 'string' && (STRUCTURE_PRESET_IDS as readonly string[]).includes(item)) {
        if (!presets.includes(item as StructurePresetId)) presets.push(item as StructurePresetId);
      } else {
        warnings.push(`忽略未知的预设：${String(item)}`);
      }
    }
  } else if (value.presets !== undefined) {
    warnings.push('presets 不是数组，已使用默认预设');
    presets.push(...DEFAULT_STRUCTURE_CONFIG.presets);
  } else {
    presets.push(...DEFAULT_STRUCTURE_CONFIG.presets);
  }
  const custom: CustomStructureRule[] = [];
  if (Array.isArray(value.custom)) {
    for (const item of value.custom.slice(0, CUSTOM_RULE_LIMIT)) {
      const result = validateCustomStructureRule(item);
      if (!result.ok) {
        const id = (item as { id?: unknown } | null)?.id;
        warnings.push(`忽略自定义规则 ${typeof id === 'string' ? id : '?'}：${result.error}`);
      } else if (custom.some((rule) => rule.id === result.rule.id)) {
        warnings.push(`忽略重复的自定义规则 id：${result.rule.id}`);
      } else {
        custom.push(result.rule);
      }
    }
    if (value.custom.length > CUSTOM_RULE_LIMIT) {
      warnings.push(`自定义规则最多 ${CUSTOM_RULE_LIMIT} 条，多余的已忽略`);
    }
  } else if (value.custom !== undefined) {
    warnings.push('custom 不是数组，已忽略');
  }
  // 预设按固定顺序排列，保证签名稳定
  presets.sort((a, b) => STRUCTURE_PRESET_IDS.indexOf(a) - STRUCTURE_PRESET_IDS.indexOf(b));
  return { config: { presets, custom }, warnings };
}

export function cloneStructureConfig(config: StructureConfig): StructureConfig {
  return { presets: [...config.presets], custom: config.custom.map((rule) => ({ ...rule })) };
}

export function structureConfigSignature(config: StructureConfig): string {
  return JSON.stringify({
    presets: config.presets,
    custom: config.custom.map((rule) => [rule.id, rule.kind, rule.pattern, rule.flags ?? '']),
  });
}

/** 编译规则集：自定义规则优先（作者明确写的），然后按 中文 → English → 数字序号 */
export function compileStructureRules(raw: unknown = DEFAULT_STRUCTURE_CONFIG): StructureRuleSet {
  const { config } = normalizeStructureConfig(raw);
  const rules: CompiledStructureRule[] = [];
  for (const rule of config.custom) {
    const result = validateCustomStructureRule(rule);
    if (!result.ok) continue;
    const regex = result.regex;
    rules.push({
      id: rule.id,
      kind: rule.kind,
      source: 'custom',
      test: guarded(CUSTOM_LINE_MAX_LENGTH, null, (text) => regex.test(text)),
    });
  }
  if (config.presets.includes('zh')) rules.push(...zhRules());
  if (config.presets.includes('en')) rules.push(...enRules());
  if (config.presets.includes('numbered')) rules.push(...numberedRules());
  return { config, rules, signature: structureConfigSignature(config) };
}

export const DEFAULT_STRUCTURE_RULES: StructureRuleSet =
  compileStructureRules(DEFAULT_STRUCTURE_CONFIG);

/** 一行是哪条规则识别出的结构（GUI 测试框 / `ne structure test` 用）；不是结构行时为 null */
export function matchStructureLine(
  line: string,
  rules: StructureRuleSet = DEFAULT_STRUCTURE_RULES
): StructureLineMatch | null {
  const text = line.trim();
  if (!text) return null;
  for (const rule of rules.rules) {
    if (rule.test(text)) return { kind: rule.kind, ruleId: rule.id, source: rule.source };
  }
  return null;
}

/**
 * 不用 Markdown 语法的结构行（「第一章 离港」「Chapter 1: The Harbor」「第一幕」「Act I」）：
 * 独占一行、长度有限、不以句读结尾（避免把正文里的「第三章说过……。」当成标题）
 */
export function classifyStructureLine(
  line: string,
  rules: StructureRuleSet = DEFAULT_STRUCTURE_RULES
): StructureLineKind | null {
  return matchStructureLine(line, rules)?.kind ?? null;
}
