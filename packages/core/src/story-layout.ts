/**
 * 作品 / 卷 / 章的命名与排序约定（纯函数，不依赖 Node API，GUI 渲染进程与 CLI 共用）
 *
 * - 章节文件：「三位序号-标题.扩展名」，序号决定顺序；也识别「第十二章」「Chapter 3」
 * - 卷目录：「第一卷」「第12卷」「卷3」「Volume 2」，支持中文数字
 * - 项目文档：项目根目录下的说明类文档（欢迎使用.md、README.md 等），不属于任何作品，不算章节
 */

/** 与 fs-ops 的 naturalCollator 相同的自然排序规则（数字按数值比较） */
export const storyCollator = new Intl.Collator('zh-Hans-CN', {
  numeric: true,
  sensitivity: 'base',
});

const CHAPTER_PREFIX = /^(\d+)[-_.\s]\s*(.*)$/;

function baseName(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] ?? filePath;
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

/** 解析章节文件名：「001-启程.md」→ { order: 1, title: '启程' } */
export function parseChapterFileName(fileName: string): { order: number | null; title: string } {
  const base = stripExtension(baseName(fileName));
  const matched = CHAPTER_PREFIX.exec(base);
  if (matched) return { order: Number(matched[1]), title: matched[2] || base };
  return { order: null, title: base };
}

/**
 * 拆出名称中的数字序号前缀，用于界面上把序号弱化显示：
 * 「001-启程」→ { prefix: '001-', rest: '启程' }；没有前缀时 prefix 为空串
 */
export function splitNumericPrefix(name: string): { prefix: string; rest: string } {
  const matched = /^(\d+[-_.\s]\s*)(.+)$/.exec(name);
  return matched ? { prefix: matched[1], rest: matched[2] } : { prefix: '', rest: name };
}

const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
const CHINESE_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/** 解析不超过万位的中文数字（一、十二、一百零三）；无法解析时返回 null */
export function parseSmallChineseNumber(raw: string): number | null {
  if (!raw) return null;
  let total = 0;
  let digit: number | null = null;
  for (const char of raw) {
    if (char in CHINESE_DIGITS) {
      digit = CHINESE_DIGITS[char];
    } else if (char in CHINESE_UNITS) {
      total += (digit ?? 1) * CHINESE_UNITS[char];
      digit = null;
    } else {
      return null;
    }
  }
  return total + (digit ?? 0);
}

function parseOrderNumber(raw: string): number | null {
  return /^\d+$/.test(raw) ? Number(raw) : parseSmallChineseNumber(raw);
}

/** 卷目录的序号：「第一卷」「第12卷」「卷3」「Volume 2」；无序号返回 null */
export function parseVolumeOrder(dirName: string): number | null {
  const matched =
    /^\u7b2c([\d\u96f6\u3007\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343]+)[\u5377\u90e8]/.exec(
      dirName
    ) ?? /^(?:\u5377|volume|vol\.?|part)[\s_-]*(\d+)/i.exec(dirName);
  if (!matched) return null;
  return parseOrderNumber(matched[1]);
}

/** 章节序号：数字前缀（001-）优先，其次「第十二章」「Chapter 3」；无序号返回 null */
export function parseChapterOrder(fileName: string): number | null {
  const { order } = parseChapterFileName(fileName);
  if (order !== null) return order;
  const base = stripExtension(baseName(fileName)).trim();
  const matched =
    /^\u7b2c([\d\u96f6\u3007\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343]+)[\u7ae0\u8282\u56de\u5e55\u7bc7\u96c6]/.exec(
      base
    ) ?? /^(?:chapter|scene)\s*(\d+)/i.exec(base);
  return matched ? parseOrderNumber(matched[1]) : null;
}

/** 名称是否像章节（有数字前缀、「第X章」或「Chapter N」） */
export function isChapterLikeFileName(fileName: string): boolean {
  return parseChapterOrder(fileName) !== null;
}

/** 章节文件排序：有序号的按序号，其余按自然顺序排在后面 */
export function compareChapterFileNames(a: string, b: string): number {
  const oa = parseChapterOrder(a);
  const ob = parseChapterOrder(b);
  if (oa !== null && ob !== null && oa !== ob) return oa - ob;
  if (oa !== null && ob === null) return -1;
  if (oa === null && ob !== null) return 1;
  return storyCollator.compare(a, b);
}

/** 卷目录排序：有序号的按序号（支持中文数字），其余按自然顺序排在后面 */
export function compareVolumeDirNames(a: string, b: string): number {
  const oa = parseVolumeOrder(a);
  const ob = parseVolumeOrder(b);
  if (oa !== null && ob !== null && oa !== ob) return oa - ob;
  if (oa !== null && ob === null) return -1;
  if (oa === null && ob !== null) return 1;
  return storyCollator.compare(a, b);
}

/** 常见的项目说明文档名（不含扩展名，小写比较） */
const PROJECT_DOCUMENT_NAMES = new Set([
  'readme',
  'changelog',
  'license',
  'contributing',
  'todo',
  '欢迎使用',
  '使用说明',
  '项目说明',
  '说明',
  '更新日志',
]);

/** 文件名是否为常见的项目说明文档（README、欢迎使用 等），与所在位置无关 */
export function isProjectDocumentName(fileName: string): boolean {
  return PROJECT_DOCUMENT_NAMES.has(stripExtension(baseName(fileName)).trim().toLowerCase());
}

function normalizeDir(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** 文件是否直接位于项目根目录（不在任何子目录中） */
export function isProjectRootFile(filePath: string, projectRoot: string): boolean {
  const target = normalizeDir(filePath);
  const root = normalizeDir(projectRoot);
  if (!root || !target.startsWith(`${root}/`)) return false;
  return !target.slice(root.length + 1).includes('/');
}

/**
 * 是否为项目文档（不是章节）：直接位于项目根目录，且
 * - 项目有 `.novel-editor/config.json`（configured）：根目录下的所有文档都是项目文档，正文只在作品目录中
 * - 普通文件夹：只有 README / 欢迎使用 这类常见说明文档名才算，其余保持原样（可能就是章节）
 */
export function isProjectDocumentPath(
  filePath: string,
  projectRoot: string,
  options: { configured: boolean }
): boolean {
  if (!isProjectRootFile(filePath, projectRoot)) return false;
  return options.configured || isProjectDocumentName(filePath);
}
