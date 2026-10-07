import { useEffect, useState } from 'react';
import {
  WORKSPACE_SEARCH_MAX_QUERY_LENGTH,
  type WorkspaceContentFileResult,
} from '../../../../shared/workspace-search';

/** 停止输入多久后发起全文搜索（毫秒） */
export const CONTENT_SEARCH_DEBOUNCE_MS = 250;

export interface WorkspaceContentSearchState {
  /** 命中的文件；null 表示还没有结果（未搜索 / 搜索中） */
  files: WorkspaceContentFileResult[] | null;
  searching: boolean;
  truncated: boolean;
  error: string | null;
}

const IDLE: WorkspaceContentSearchState = {
  files: null,
  searching: false,
  truncated: false,
  error: null,
};

/**
 * 文件面板全文搜索：关键词变化后防抖调用主进程 `workspace-search-content`，
 * 只采用最后一次请求的结果（旧请求晚到时丢弃）
 */
export function useWorkspaceContentSearch(
  rootPath: string | null,
  query: string
): WorkspaceContentSearchState {
  const [state, setState] = useState<WorkspaceContentSearchState>(IDLE);
  const keyword = query.trim();

  useEffect(() => {
    const ipc = typeof window !== 'undefined' ? window.electron?.ipcRenderer : undefined;
    if (!rootPath || !keyword || keyword.length > WORKSPACE_SEARCH_MAX_QUERY_LENGTH || !ipc) {
      setState(IDLE);
      return;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, searching: true, error: null }));
    const timer = window.setTimeout(() => {
      ipc
        .invoke('workspace-search-content', rootPath, keyword)
        .then((response) => {
          if (cancelled) return;
          if (response.ok) {
            setState({
              files: response.data.files,
              searching: false,
              truncated: response.data.truncated,
              error: null,
            });
          } else {
            setState({ files: [], searching: false, truncated: false, error: response.error });
          }
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setState({
            files: [],
            searching: false,
            truncated: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }, CONTENT_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [rootPath, keyword]);

  return state;
}
