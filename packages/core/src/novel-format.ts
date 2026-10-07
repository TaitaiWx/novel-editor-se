/**
 * 小说文档格式（Novel Markdown）第一期：front-matter + 指令（纯函数，GUI / CLI 共用）
 *
 * 设计与调研见 docs/novel-format.md、docs/novel-format-research.md。仍是 .md：
 * - front-matter：文件开头 `---` … `---` 之间的 `key: value`（只支持本章元数据需要的最小 YAML 子集）
 * - 叶子指令（独占一行）：`::video[说明]{src="资料/视频/…mp4" poster=…}`、`::image[说明]{src=…}`、
 *   `::audio[说明]{src="资料/音乐/…m4a" loop volume=0.6}`（纯音频：配乐 / 环境音 / 音效 / 对白）
 * - 容器指令（场景）：`:::scene{#s-1-1 title=港口 pov=林舟}` … `:::`，平铺、不嵌套；
 *   未闭合时在下一个 `:::scene` 或 ≤2 级标题处结束，绝不吞掉后文
 * - 行内指令：`:char[阿舟]{id=linzhou}`（统计字数时保留方括号里的文字）
 *
 * 防误判：指令名必须是 ASCII 字母开头（中文正文里的「12:30」「3:2」不会被当成指令）。
 * 结构行（章 / 幕 / 场）的识别规则见 ./structure-rules（可在项目配置里开关预设、添加自定义规则）。
 */

import {
  classifyStructureLine,
  DEFAULT_STRUCTURE_RULES,
  type StructureRuleSet,
} from './structure-rules';

export {
  classifyStructureLine,
  type StructureLineKind,
  type StructureRuleSet,
} from './structure-rules';

export type FrontMatterValue = string | number | boolean | string[];

export interface FrontMatter {
  data: Record<string, FrontMatterValue>;
  /** front-matter 占用的行数（含两条 ---），没有时为 0 */
  lineCount: number;
  /** 去掉 front-matter 后的正文 */
  body: string;
}

function parseScalar(raw: string): FrontMatterValue {
  const value = raw.replace(/\s+#.*$/, '').trim();
  if (/^\[.*\]$/.test(value)) {
    return value
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value === 'true' || value === 'false') return value === 'true';
  return value.replace(/^["']|["']$/g, '');
}

/** 解析文件开头的 front-matter；格式不对（没有闭合的 ---）时当作没有 */
export function parseFrontMatter(text: string): FrontMatter {
  const normalized = text.replace(/^\uFEFF/, '');
  const lines = normalized.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { data: {}, lineCount: 0, body: text };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) return { data: {}, lineCount: 0, body: text };
  const data: Record<string, FrontMatterValue> = {};
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (match) data[match[1]] = parseScalar(match[2]);
  }
  return { data, lineCount: end + 1, body: lines.slice(end + 1).join('\n') };
}

export interface DirectiveAttributes {
  id?: string;
  classes: string[];
  values: Record<string, string>;
}

/** `{#id .class key=value key="带 空格"}` → 属性 */
export function parseDirectiveAttributes(raw: string): DirectiveAttributes {
  const result: DirectiveAttributes = { classes: [], values: {} };
  const body = raw.trim().replace(/^\{|\}$/g, '');
  const pattern = /#([^\s}#.]+)|\.([^\s}#.]+)|([A-Za-z_][\w-]*)=(?:"([^"]*)"|'([^']*)'|([^\s}]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body))) {
    if (match[1]) result.id = match[1];
    else if (match[2]) result.classes.push(match[2]);
    else if (match[3]) result.values[match[3]] = match[4] ?? match[5] ?? match[6] ?? '';
  }
  return result;
}

export type DirectiveLineKind = 'leaf' | 'container-open' | 'container-close';

export interface DirectiveLine {
  kind: DirectiveLineKind;
  /** 指令名（容器闭合行为空） */
  name: string;
  /** 方括号里的文字（说明 / 标签） */
  label: string;
  attributes: DirectiveAttributes;
}

const CONTAINER_CLOSE_RE = /^:::\s*$/;
const CONTAINER_OPEN_RE = /^:::([A-Za-z][\w-]*)(?:\[([^\]\n]*)\])?(\{[^}\n]*\})?\s*$/;
const LEAF_RE = /^::([A-Za-z][\w-]*)(?:\[([^\]\n]*)\])?(\{[^}\n]*\})?\s*$/;

/** 解析一行指令；不是指令时返回 null */
export function parseDirectiveLine(line: string): DirectiveLine | null {
  const text = line.trim();
  if (!text.startsWith('::')) return null;
  if (CONTAINER_CLOSE_RE.test(text)) {
    return {
      kind: 'container-close',
      name: '',
      label: '',
      attributes: { classes: [], values: {} },
    };
  }
  const container = CONTAINER_OPEN_RE.exec(text);
  if (container) {
    return {
      kind: 'container-open',
      name: container[1],
      label: container[2] ?? '',
      attributes: parseDirectiveAttributes(container[3] ?? ''),
    };
  }
  const leaf = LEAF_RE.exec(text);
  if (leaf) {
    return {
      kind: 'leaf',
      name: leaf[1],
      label: leaf[2] ?? '',
      attributes: parseDirectiveAttributes(leaf[3] ?? ''),
    };
  }
  return null;
}

/** 行内指令 `:name[文字]{属性}`：名字必须 ASCII 字母开头、紧跟 [ */
const INLINE_DIRECTIVE_RE = /(^|[^:\w]):([A-Za-z][\w-]*)\[([^\]\n]*)\](\{[^}\n]*\})?/g;

/** 是否可能含有 Novel Markdown 标记（快速判断，避免对普通文本做额外处理） */
export function hasNovelMarkup(text: string): boolean {
  return (
    /^\uFEFF?---\r?\n/.test(text) || /(^|\n)\s*::/.test(text) || /:[A-Za-z][\w-]*\[/.test(text)
  );
}

/**
 * 统计字数用的纯文本：去掉 front-matter 与指令行（场景容器、视频等），
 * 行内指令只保留方括号里的文字；行数不变（被去掉的行替换为空行），便于与编辑器行号对应
 */
export function stripNovelMarkup(text: string): string {
  if (!hasNovelMarkup(text)) return text;
  const { lineCount } = parseFrontMatter(text);
  const lines = text.split('\n');
  return lines
    .map((line, index) => {
      if (index < lineCount) return '';
      if (parseDirectiveLine(line)) return '';
      return line.replace(
        INLINE_DIRECTIVE_RE,
        (_whole, prefix: string, _name, label: string) => `${prefix}${label}`
      );
    })
    .join('\n');
}

export interface NovelScene {
  id?: string;
  title: string;
  attributes: DirectiveAttributes;
  /** 开始行 / 结束行（1-based，含指令行） */
  startLine: number;
  endLine: number;
  /** 没有找到闭合的 `:::`（在下一个场景或标题处结束） */
  unclosed: boolean;
}

const HEADING_RE = /^#{1,2}\s/;

/** 按 `:::scene` 容器切出场景；未闭合的在下一个场景开始、≤2 级标题或章 / 幕标题行前结束 */
export function extractNovelScenes(
  text: string,
  rules: StructureRuleSet = DEFAULT_STRUCTURE_RULES
): NovelScene[] {
  const lines = text.split(/\r?\n/);
  const scenes: NovelScene[] = [];
  let current: NovelScene | null = null;
  const finish = (endLine: number, unclosed: boolean) => {
    if (!current) return;
    current.endLine = Math.max(current.startLine, endLine);
    current.unclosed = unclosed;
    scenes.push(current);
    current = null;
  };
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const directive = parseDirectiveLine(line);
    if (directive?.kind === 'container-open' && directive.name === 'scene') {
      if (current) finish(lineNumber - 1, true);
      current = {
        ...(directive.attributes.id ? { id: directive.attributes.id } : {}),
        title: directive.attributes.values.title || directive.label || '',
        attributes: directive.attributes,
        startLine: lineNumber,
        endLine: lineNumber,
        unclosed: false,
      };
      return;
    }
    if (directive?.kind === 'container-close' && current) {
      finish(lineNumber, false);
      return;
    }
    if (current && (HEADING_RE.test(line) || isChapterOrActLine(line, rules))) {
      finish(lineNumber - 1, true);
    }
  });
  if (current) finish(lines.length, true);
  return scenes;
}

function isChapterOrActLine(line: string, rules: StructureRuleSet): boolean {
  const kind = classifyStructureLine(line, rules);
  return kind === 'chapter' || kind === 'act';
}

/** `::image[说明]{src=…}` 的图片地址；不是图片指令时为 null */
export function imageDirectiveSource(line: string): { src: string; caption: string } | null {
  return mediaDirectiveSource(line, 'image');
}

/** 媒体指令名（就地显示的图片 / 视频 / 音频） */
export const MEDIA_DIRECTIVE_NAMES = ['image', 'video', 'audio'] as const;
export type MediaDirectiveName = (typeof MEDIA_DIRECTIVE_NAMES)[number];

function mediaDirectiveSource(
  line: string,
  name: MediaDirectiveName
): { src: string; caption: string } | null {
  const directive = parseDirectiveLine(line);
  if (directive?.kind !== 'leaf' || directive.name !== name) return null;
  const src = directive.attributes.values.src?.trim();
  return src ? { src, caption: directive.label } : null;
}

export interface AudioDirective {
  src: string;
  caption: string;
  /** 循环播放（写 `loop`、`.loop`、`loop=true` 都算） */
  loop: boolean;
  /** 初始音量 0–1（写成 60 视为 60%）；没写或无效时省略 */
  volume?: number;
}

/** 不带值的布尔属性（`{src=a.m4a loop}`）：parseDirectiveAttributes 不收裸词，这里单独识别 */
function hasBareFlag(line: string, flag: string): boolean {
  const body = /\{([^}\n]*)\}\s*$/.exec(line.trim())?.[1] ?? '';
  // 先去掉引号里的值，避免把 src="loop.m4a" 里的字样当成标记
  const unquoted = body.replace(/"[^"]*"|'[^']*'/g, '');
  return unquoted.split(/\s+/).some((token) => token === flag);
}

/** `::audio[说明]{src=… loop volume=0.6}` 的音频地址（相对作品目录）；不是音频指令时为 null */
export function audioDirectiveSource(line: string): AudioDirective | null {
  const base = mediaDirectiveSource(line, 'audio');
  if (!base) return null;
  const directive = parseDirectiveLine(line) as DirectiveLine;
  const { values, classes } = directive.attributes;
  const loopValue = values.loop?.trim().toLowerCase();
  const loop =
    classes.includes('loop') ||
    (loopValue !== undefined
      ? loopValue !== 'false' && loopValue !== '0'
      : hasBareFlag(line, 'loop'));
  const result: AudioDirective = { ...base, loop };
  const raw = Number(values.volume);
  if (values.volume !== undefined && Number.isFinite(raw) && raw >= 0) {
    const ratio = raw > 1 ? raw / 100 : raw;
    result.volume = Math.min(1, Math.max(0, Math.round(ratio * 100) / 100));
  }
  return result;
}

export interface NovelMarkupIssue {
  line: number;
  message: string;
}

/** 结构检查（ne lint / 编辑器错误标记）：未闭合的场景、多余的 `:::`、重复的场景 id、媒体指令缺少 src */
export function lintNovelMarkup(
  text: string,
  rules: StructureRuleSet = DEFAULT_STRUCTURE_RULES
): NovelMarkupIssue[] {
  const issues: NovelMarkupIssue[] = [];
  const scenes = extractNovelScenes(text, rules);
  const seen = new Map<string, number>();
  for (const scene of scenes) {
    if (scene.unclosed) {
      issues.push({
        line: scene.startLine,
        message: `场景「${scene.title || scene.id || '未命名'}」没有用 ::: 结束`,
      });
    }
    if (scene.id) {
      const first = seen.get(scene.id);
      if (first !== undefined) {
        issues.push({
          line: scene.startLine,
          message: `场景 id「${scene.id}」与第 ${first} 行重复`,
        });
      } else {
        seen.set(scene.id, scene.startLine);
      }
    }
  }
  const covered = new Set<number>();
  for (const scene of scenes) {
    if (!scene.unclosed) covered.add(scene.endLine);
  }
  text.split(/\r?\n/).forEach((line, index) => {
    const directive = parseDirectiveLine(line);
    if (directive?.kind === 'container-close' && !covered.has(index + 1)) {
      issues.push({ line: index + 1, message: '多余的 :::（前面没有对应的场景开始）' });
    }
    if (
      directive?.kind === 'leaf' &&
      (MEDIA_DIRECTIVE_NAMES as readonly string[]).includes(directive.name) &&
      !directive.attributes.values.src?.trim()
    ) {
      issues.push({
        line: index + 1,
        message: `::${directive.name} 缺少 src（例如 {src="资料/…"}）`,
      });
    }
  });
  return issues.sort((a, b) => a.line - b.line);
}

/** `::video[说明]{src=…}` 的视频地址（相对作品目录）；不是视频指令时为 null */
export function videoDirectiveSource(line: string): { src: string; caption: string } | null {
  return mediaDirectiveSource(line, 'video');
}
