/**
 * 小说文档格式（Novel Markdown）第一期：front-matter + 指令（纯函数，GUI / CLI 共用）
 *
 * 设计与调研见 docs/novel-format.md、docs/novel-format-research.md。仍是 .md：
 * - front-matter：文件开头 `---` … `---` 之间的 `key: value`（只支持本章元数据需要的最小 YAML 子集）
 * - 叶子指令（独占一行）：`::video[说明]{src="资料/视频/…mp4" poster=…}`
 * - 容器指令（场景）：`:::scene{#s-1-1 title=港口 pov=林舟}` … `:::`，平铺、不嵌套；
 *   未闭合时在下一个 `:::scene` 或 ≤2 级标题处结束，绝不吞掉后文
 * - 行内指令：`:char[阿舟]{id=linzhou}`（统计字数时保留方括号里的文字）
 *
 * 防误判：指令名必须是 ASCII 字母开头（中文正文里的「12:30」「3:2」不会被当成指令）。
 */

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

export type StructureLineKind = 'chapter' | 'act' | 'scene';

// 中文数字（一二三……万、零〇两）或阿拉伯数字
const CN_NUMBER =
  '[\\u4e00\\u4e8c\\u4e09\\u56db\\u4e94\\u516d\\u4e03\\u516b\\u4e5d\\u5341\\u767e\\u5343\\u4e07\\u96f6\\u3007\\u4e24\\d]+';
// 汉字一律写成 \u 转义（不在判断逻辑里直接写汉字）：
// \u7b2c 第；\u7ae0 章 \u56de 回 \u5377 卷 \u90e8 部 \u7bc7 篇 \u96c6 集 \u8282 节；\u5e55 幕；\u573a 场
// 章标题允许紧跟标题（「第一章离港」）；幕 / 场要求分隔，避免「第一场雨……」误判
const CHAPTER_LINE_RE = new RegExp(
  `^\\u7b2c${CN_NUMBER}[\\u7ae0\\u56de\\u5377\\u90e8\\u7bc7\\u96c6\\u8282]`
);
const SPECIAL_CHAPTER_RE =
  /^(?:\u5e8f\u7ae0|\u5e8f\u5e55|\u6954\u5b50|\u5f15\u5b50|\u5c3e\u58f0|\u7ec8\u7ae0|\u540e\u8bb0|\u756a\u5916)(?:[\s:\uff1a\u00b7\u3001\-\u2014]|$)/;
const ACT_LINE_RE = new RegExp(
  `^\\u7b2c${CN_NUMBER}\\u5e55(?:[\\s:\\uff1a\\u00b7\\u3001.\\-\\u2014]|$)`
);
const SCENE_LINE_RE = new RegExp(
  `^\\u7b2c${CN_NUMBER}\\u573a(?:[\\s:\\uff1a\\u00b7\\u3001.\\-\\u2014]|$)`
);

/**
 * 不用 Markdown 语法的结构行（很多作者直接写「第一章 离港」「第一幕 离乡」「第一场 清晨」）：
 * 独占一行、不超过 40 字、不以句读结尾（避免把正文里的「第三章说过……。」当成标题）
 */
export function classifyStructureLine(line: string): StructureLineKind | null {
  const text = line.trim();
  if (!text || text.length > 40 || /[\u3002\uff01\uff1f!?\uff0c,\uff1b;\u201d"]$/.test(text))
    return null;
  if (CHAPTER_LINE_RE.test(text) || SPECIAL_CHAPTER_RE.test(text)) return 'chapter';
  if (ACT_LINE_RE.test(text)) return 'act';
  if (SCENE_LINE_RE.test(text)) return 'scene';
  return null;
}

/** 按 `:::scene` 容器切出场景；未闭合的在下一个场景开始、≤2 级标题或章 / 幕标题行前结束 */
export function extractNovelScenes(text: string): NovelScene[] {
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
    if (current && (HEADING_RE.test(line) || isChapterOrActLine(line))) {
      finish(lineNumber - 1, true);
    }
  });
  if (current) finish(lines.length, true);
  return scenes;
}

function isChapterOrActLine(line: string): boolean {
  const kind = classifyStructureLine(line);
  return kind === 'chapter' || kind === 'act';
}

/** `::image[说明]{src=…}` 的图片地址；不是图片指令时为 null */
export function imageDirectiveSource(line: string): { src: string; caption: string } | null {
  const directive = parseDirectiveLine(line);
  if (directive?.kind !== 'leaf' || directive.name !== 'image') return null;
  const src = directive.attributes.values.src?.trim();
  return src ? { src, caption: directive.label } : null;
}

export interface NovelMarkupIssue {
  line: number;
  message: string;
}

/** 结构检查（ne lint / 编辑器错误标记）：未闭合的场景、多余的 `:::`、重复的场景 id */
export function lintNovelMarkup(text: string): NovelMarkupIssue[] {
  const issues: NovelMarkupIssue[] = [];
  const scenes = extractNovelScenes(text);
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
    if (parseDirectiveLine(line)?.kind === 'container-close' && !covered.has(index + 1)) {
      issues.push({ line: index + 1, message: '多余的 :::（前面没有对应的场景开始）' });
    }
  });
  return issues.sort((a, b) => a.line - b.line);
}

/** `::video[说明]{src=…}` 的视频地址（相对作品目录）；不是视频指令时为 null */
export function videoDirectiveSource(line: string): { src: string; caption: string } | null {
  const directive = parseDirectiveLine(line);
  if (directive?.kind !== 'leaf' || directive.name !== 'video') return null;
  const src = directive.attributes.values.src?.trim();
  return src ? { src, caption: directive.label } : null;
}
