import { useCallback, useMemo, useRef, useState } from 'react';
import { filterInternalDataTree } from '@novel-editor/core/internal-data';
import type { FileNode, OpenLocalResult, WorkspaceProjectLayout } from '@/render/types';
import { type StoryOrderMap, createStoryOrderStorageKey } from '@/render/utils/workspace';
import { listWorkScopeOptions, resolveWorkScope } from '@/render/utils/workScope';

/**
 * 工作区领域状态：打开的文件夹、文件树、当前作品（作品作用域）、加载/数据库就绪标记、故事排序，
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
  // 当前作品（角色 / 设定 / 成长档案 / 资料跟随作品）：作者选择的作品路径与「未归属」旧数据标记
  const [preferredWorkPath, setPreferredWorkPath] = useState<string | null>(null);
  const [unassignedRecords, setUnassignedRecords] = useState(false);
  const workScopeOptions = useMemo(
    () => listWorkScopeOptions(folderPath, projectLayout, unassignedRecords),
    [folderPath, projectLayout, unassignedRecords]
  );
  const workScope = useMemo(
    () => resolveWorkScope(workScopeOptions, preferredWorkPath),
    [preferredWorkPath, workScopeOptions]
  );
  // 数据库（人物 / 设定 / 大纲）、记忆库、资料目录都以它为键；普通文件夹即 folderPath
  const workScopePath = workScope?.path ?? folderPath;

  // 最新值 ref：供异步回调读取，避免闭包过期
  const folderPathRef = useRef(folderPath);
  folderPathRef.current = folderPath;
  const workScopePathRef = useRef(workScopePath);
  workScopePathRef.current = workScopePath;
  const filesRef = useRef(files);
  filesRef.current = files;
  const storyOrderMapRef = useRef(storyOrderMap);
  storyOrderMapRef.current = storyOrderMap;
  const cleanedGeneratedMaterialFoldersRef = useRef<Set<string>>(new Set());
  // 通过 ref 间接引用 refreshCurrentFolder，避免跨声明顺序依赖（TDZ）
  const refreshCurrentFolderRef = useRef<(() => Promise<void>) | null>(null);

  /**
   * 写入 open-local-folder / refresh-folder 的结果：文件树与项目结构一起更新；null 表示清空。
   * 主进程已去掉内部数据，这里再过滤一次（纵深防御，同时标记场景视频目录）
   */
  const applyFolderTree = useCallback((result: OpenLocalResult | null) => {
    setFiles(result ? filterInternalDataTree(result.files ?? [], result.path) : []);
    setProjectLayout(result?.project ?? null);
  }, []);

  return {
    files,
    setFiles,
    projectLayout,
    applyFolderTree,
    folderPath,
    setFolderPath,
    preferredWorkPath,
    setPreferredWorkPath,
    unassignedRecords,
    setUnassignedRecords,
    workScopeOptions,
    workScope,
    workScopePath,
    workScopePathRef,
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
