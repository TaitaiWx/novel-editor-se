import { useCallback, useMemo, useRef, useState } from 'react';
import type { FileNode, OpenLocalResult, WorkspaceProjectLayout } from '@/render/types';
import { type StoryOrderMap, createStoryOrderStorageKey } from '@/render/utils/workspace';

/**
 * 工作区领域状态：打开的文件夹、文件树、加载/数据库就绪标记、故事排序，
 * 以及刷新文件夹、生成资料清理等跨 hook 共享的 ref（只声明，不含副作用）
 */
export function useWorkspaceState() {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [folderPath, setFolderPath] = useState<string | null>(null);
  // `ne init` 项目结构（作品根目录与作品列表）；普通文件夹为 null
  const [projectLayout, setProjectLayout] = useState<WorkspaceProjectLayout | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [dbReady, setDbReady] = useState(false);
  const [storyOrderMap, setStoryOrderMap] = useState<StoryOrderMap>({});
  const storyOrderStorageKey = useMemo(() => createStoryOrderStorageKey(folderPath), [folderPath]);

  // 最新值 ref：供异步回调读取，避免闭包过期
  const folderPathRef = useRef(folderPath);
  folderPathRef.current = folderPath;
  const filesRef = useRef(files);
  filesRef.current = files;
  const storyOrderMapRef = useRef(storyOrderMap);
  storyOrderMapRef.current = storyOrderMap;
  const cleanedGeneratedMaterialFoldersRef = useRef<Set<string>>(new Set());
  // 通过 ref 间接引用 refreshCurrentFolder，避免跨声明顺序依赖（TDZ）
  const refreshCurrentFolderRef = useRef<(() => Promise<void>) | null>(null);

  /** 写入 open-local-folder / refresh-folder 的结果：文件树与项目结构一起更新；null 表示清空 */
  const applyFolderTree = useCallback((result: OpenLocalResult | null) => {
    setFiles(result?.files ?? []);
    setProjectLayout(result?.project ?? null);
  }, []);

  return {
    files,
    setFiles,
    projectLayout,
    applyFolderTree,
    folderPath,
    setFolderPath,
    isLoading,
    setIsLoading,
    dbReady,
    setDbReady,
    storyOrderMap,
    setStoryOrderMap,
    storyOrderStorageKey,
    folderPathRef,
    filesRef,
    storyOrderMapRef,
    cleanedGeneratedMaterialFoldersRef,
    refreshCurrentFolderRef,
  };
}

export type WorkspaceState = ReturnType<typeof useWorkspaceState>;
