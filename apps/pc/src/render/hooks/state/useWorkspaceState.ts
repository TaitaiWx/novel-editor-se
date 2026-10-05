import { useMemo, useRef, useState } from 'react';
import type { FileNode } from '@/render/types';
import { type StoryOrderMap, createStoryOrderStorageKey } from '@/render/utils/workspace';

/**
 * 工作区领域状态：打开的文件夹、文件树、加载/数据库就绪标记、故事排序，
 * 以及刷新文件夹、生成资料清理等跨 hook 共享的 ref（只声明，不含副作用）
 */
export function useWorkspaceState() {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [folderPath, setFolderPath] = useState<string | null>(null);
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

  return {
    files,
    setFiles,
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
