import { withWorkspaceLease } from './workspace-lock';
/**
 * 内容搜索与批量查找替换
 *
 * - pattern 默认按字面量匹配；传入 regex: true 时按正则表达式匹配
 * - glob 用于过滤参与搜索的文件（相对于搜索根目录）
 * - 自动跳过二进制文件和超大文件
 */
import { readFile, stat, writeFile } from 'node:fs/promises';
import { CoreError } from './errors';
import { walkFiles } from './fs-ops';
import { analyzeContentStats } from './text-stats';

/** 超过该大小的文件不参与搜索（20MB） */
const MAX_SEARCH_FILE_SIZE = 20 * 1024 * 1024;

export interface MatchOptions {
  regex?: boolean;
  ignoreCase?: boolean;
}

export interface SearchOptions extends MatchOptions {
  glob?: string;
  includeHidden?: boolean;
  /** 最大匹配条数，默认 1000 */
  maxResults?: number;
}

export interface SearchMatch {
  file: string;
  line: number;
  column: number;
  match: string;
  text: string;
}

export interface SearchResult {
  pattern: string;
  filesScanned: number;
  matches: SearchMatch[];
  truncated: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildMatcher(pattern: string, options: MatchOptions = {}): RegExp {
  if (!pattern) throw new CoreError('INVALID_ARGUMENT', '搜索模式不能为空');
  const flags = `g${options.ignoreCase ? 'i' : ''}`;
  try {
    return new RegExp(options.regex ? pattern : escapeRegExp(pattern), flags);
  } catch (error) {
    throw new CoreError(
      'INVALID_ARGUMENT',
      `无效的正则表达式: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/** 读取文本文件，跳过二进制或超大文件（返回 null） */
async function readSearchableText(filePath: string): Promise<string | null> {
  const info = await stat(filePath);
  if (info.size > MAX_SEARCH_FILE_SIZE) return null;
  const buffer = await readFile(filePath);
  const probe = buffer.subarray(0, Math.min(buffer.length, 8000));
  if (probe.includes(0)) return null;
  return buffer.toString('utf-8');
}

export async function searchContent(
  pattern: string,
  target: string,
  options: SearchOptions = {}
): Promise<SearchResult> {
  const matcher = buildMatcher(pattern, options);
  const maxResults = options.maxResults ?? 1000;
  const files = await walkFiles(target, {
    glob: options.glob,
    includeHidden: options.includeHidden,
  });
  const matches: SearchMatch[] = [];
  let filesScanned = 0;
  let truncated = false;

  outer: for (const file of files) {
    const content = await readSearchableText(file);
    if (content === null) continue;
    filesScanned += 1;
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const lineText = lines[index];
      matcher.lastIndex = 0;
      let found: RegExpExecArray | null;
      while ((found = matcher.exec(lineText)) !== null) {
        if (matches.length >= maxResults) {
          truncated = true;
          break outer;
        }
        matches.push({
          file,
          line: index + 1,
          column: found.index + 1,
          match: found[0],
          text: lineText,
        });
        // 避免零宽匹配导致死循环
        if (found[0].length === 0) matcher.lastIndex += 1;
      }
    }
  }

  return { pattern, filesScanned, matches, truncated };
}

export interface FindReplaceOptions extends MatchOptions {
  glob?: string;
  includeHidden?: boolean;
  /** 只预览，不写入 */
  dryRun?: boolean;
}

export interface FindReplaceFileResult {
  path: string;
  replacements: number;
  previousChars: number;
  chars: number;
}

export interface FindReplaceResult {
  pattern: string;
  replacement: string;
  dryRun: boolean;
  filesScanned: number;
  filesChanged: number;
  totalReplacements: number;
  files: FindReplaceFileResult[];
}

/** 对字符串执行替换并返回替换次数 */
export function replaceInText(
  content: string,
  pattern: string,
  replacement: string,
  options: MatchOptions = {}
): { content: string; count: number } {
  const matcher = buildMatcher(pattern, options);
  let count = 0;
  const next = content.replace(matcher, (...args: unknown[]) => {
    count += 1;
    if (!options.regex) return replacement;
    // 正则模式下支持 $1 / $& 等反向引用
    // 回调参数为 (match, p1..pn, offset, input[, namedGroups])，offset 是第一个数字参数
    const offsetIndex = args.findIndex((item) => typeof item === 'number');
    const groups = args.slice(0, offsetIndex).map((item) => (typeof item === 'string' ? item : ''));
    const matched = groups[0] ?? '';
    return replacement.replace(/\$(\d+|&)/g, (_all, ref: string) => {
      if (ref === '&') return matched;
      return groups[Number(ref)] ?? '';
    });
  });
  return { content: next, count };
}

export async function findReplace(
  pattern: string,
  replacement: string,
  target: string,
  options: FindReplaceOptions = {}
): Promise<FindReplaceResult> {
  return withWorkspaceLease(
    async () => {
      buildMatcher(pattern, options);
      const files = await walkFiles(target, {
        glob: options.glob,
        includeHidden: options.includeHidden,
      });
      const changed: FindReplaceFileResult[] = [];
      let filesScanned = 0;
      let totalReplacements = 0;

      for (const file of files) {
        const content = await readSearchableText(file);
        if (content === null) continue;
        filesScanned += 1;
        const result = replaceInText(content, pattern, replacement, options);
        if (result.count === 0) continue;
        totalReplacements += result.count;
        if (!options.dryRun) await writeFile(file, result.content, 'utf-8');
        changed.push({
          path: file,
          replacements: result.count,
          previousChars: analyzeContentStats(content).charCount,
          chars: analyzeContentStats(result.content).charCount,
        });
      }

      return {
        pattern,
        replacement,
        dryRun: Boolean(options.dryRun),
        filesScanned,
        filesChanged: changed.length,
        totalReplacements,
        files: changed,
      };
    },
    { resources: [target] }
  );
}
