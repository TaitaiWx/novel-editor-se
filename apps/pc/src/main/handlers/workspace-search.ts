/**
 * 文件面板全文搜索 IPC：workspace-search-content
 *
 * 复用 core `searchContent`（与 CLI `ne file search` 同一实现），只搜索正文 / 文档类文本文件
 * （.md / .markdown / .txt，跳过隐藏目录如 .novel-editor/），按文件分组并截取预览。
 * 软件内部数据（core internal-data）不出现在结果里；派生的只读摘要（记忆库 README 等）照常可搜。
 * 搜索根目录必须是存在的绝对目录，且位于该窗口已上报的工作区内。
 */
import { ipcMain } from 'electron';
import { classifyWorkspacePath, searchContent, type SearchMatch } from '@novel-editor/core';
import {
  WORKSPACE_SEARCH_MAX_FILES,
  WORKSPACE_SEARCH_MAX_MATCHES_PER_FILE,
  WORKSPACE_SEARCH_MAX_QUERY_LENGTH,
  type WorkspaceContentFileResult,
  type WorkspaceContentMatch,
  type WorkspaceContentSearchResponse,
  type WorkspaceContentSearchResult,
} from '../../shared/workspace-search';
import { assertWorkDir } from './character-avatar';
import { getWorkspaceRootForSender } from './session';

/** 参与全文搜索的文件（按文件名匹配） */
const SEARCHABLE_GLOB = '*.{md,markdown,txt,MD,TXT}';
/** core 层最多收集的命中数（超过即截断） */
const MAX_RAW_MATCHES = 500;
/** 预览中关键词前后保留的字符数 */
const PREVIEW_BEFORE = 20;
const PREVIEW_AFTER = 60;

/** 截取命中行的预览：关键词前后各保留一段，被截断处加省略号 */
export function buildMatchPreview(
  text: string,
  column: number,
  matchLength: number
): Omit<WorkspaceContentMatch, 'line'> {
  const index = Math.max(0, column - 1);
  // 去掉行首缩进，避免预览前面一片空白
  const leading = text.length - text.trimStart().length;
  const from = Math.max(leading, index - PREVIEW_BEFORE);
  const to = Math.min(text.length, index + matchLength + PREVIEW_AFTER);
  const prefix = from > leading ? '…' : '';
  const suffix = to < text.trimEnd().length ? '…' : '';
  const body = text.slice(from, to).trimEnd();
  return {
    preview: `${prefix}${body}${suffix}`,
    matchStart: prefix.length + (index - from),
    matchLength,
  };
}

/** 把 core 的逐条命中按文件分组（保持文件遍历顺序） */
export function groupSearchMatches(
  matches: SearchMatch[],
  maxFiles = WORKSPACE_SEARCH_MAX_FILES,
  maxPerFile = WORKSPACE_SEARCH_MAX_MATCHES_PER_FILE
): { files: WorkspaceContentFileResult[]; truncated: boolean } {
  const byFile = new Map<string, WorkspaceContentFileResult>();
  let truncated = false;
  for (const match of matches) {
    let entry = byFile.get(match.file);
    if (!entry) {
      if (byFile.size >= maxFiles) {
        truncated = true;
        continue;
      }
      entry = { file: match.file, matchCount: 0, matches: [] };
      byFile.set(match.file, entry);
    }
    entry.matchCount += 1;
    // 同一行多次命中只展示一次
    const sameLine = entry.matches.some((item) => item.line === match.line);
    if (!sameLine && entry.matches.length < maxPerFile) {
      entry.matches.push({
        line: match.line,
        ...buildMatchPreview(match.text, match.column, match.match.length),
      });
    }
  }
  return { files: Array.from(byFile.values()), truncated };
}

/** 校验参数并执行全文搜索（导出供测试） */
export async function searchWorkspaceContent(
  rootPath: unknown,
  query: unknown,
  workspaceRoot: string | null
): Promise<WorkspaceContentSearchResult> {
  if (typeof query !== 'string') throw new Error('无效的搜索关键词');
  const keyword = query.trim();
  if (!keyword) throw new Error('搜索关键词不能为空');
  if (keyword.length > WORKSPACE_SEARCH_MAX_QUERY_LENGTH) throw new Error('搜索关键词过长');
  const root = await assertWorkDir(rootPath, workspaceRoot);
  // 按字面量匹配（不允许渲染进程传正则），忽略大小写
  const result = await searchContent(keyword, root, {
    glob: SEARCHABLE_GLOB,
    ignoreCase: true,
    maxResults: MAX_RAW_MATCHES,
  });
  const visible = result.matches.filter(
    (match) => classifyWorkspacePath(match.file, root).kind !== 'internal'
  );
  const grouped = groupSearchMatches(visible);
  return {
    query: keyword,
    files: grouped.files,
    truncated: result.truncated || grouped.truncated,
  };
}

export function registerWorkspaceSearchHandlers(): void {
  ipcMain.handle(
    'workspace-search-content',
    async (event, rootPath: unknown, query: unknown): Promise<WorkspaceContentSearchResponse> => {
      try {
        const workspaceRoot = getWorkspaceRootForSender(event.sender.id);
        return { ok: true, data: await searchWorkspaceContent(rootPath, query, workspaceRoot) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );
}
