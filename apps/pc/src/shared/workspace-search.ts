/**
 * 文件面板「搜索作品内容」的全文搜索协议（主进程 workspace-search-content ↔ 渲染进程）
 */

/** 关键词最大长度（主进程按此校验） */
export const WORKSPACE_SEARCH_MAX_QUERY_LENGTH = 100;

/** 一次搜索最多返回的文件数 */
export const WORKSPACE_SEARCH_MAX_FILES = 50;

/** 每个文件最多返回的命中行数 */
export const WORKSPACE_SEARCH_MAX_MATCHES_PER_FILE = 3;

export interface WorkspaceContentMatch {
  /** 行号（从 1 开始） */
  line: number;
  /** 截取后的预览文本（可能带前后省略号） */
  preview: string;
  /** 关键词在 preview 中的起始下标与长度（用于高亮） */
  matchStart: number;
  matchLength: number;
}

export interface WorkspaceContentFileResult {
  /** 文件绝对路径 */
  file: string;
  /** 该文件的总命中次数 */
  matchCount: number;
  matches: WorkspaceContentMatch[];
}

export interface WorkspaceContentSearchResult {
  query: string;
  files: WorkspaceContentFileResult[];
  /** 命中过多被截断 */
  truncated: boolean;
}

export type WorkspaceContentSearchResponse =
  | { ok: true; data: WorkspaceContentSearchResult }
  | { ok: false; error: string };
