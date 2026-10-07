import React, { useCallback, useEffect } from 'react';
import {
  DEFAULT_SETTINGS_DRAFT,
  SETTINGS_STORAGE_KEY,
  mergeSettingsDraft,
} from '@/render/utils/appSettings';
import {
  WORKSPACE_FILES_CHANGED_EVENT,
  WORKSPACE_REFRESH_DEBOUNCE_MS,
} from '@/render/utils/workspaceFiles';
import type { WorkspaceState } from './state/useWorkspaceState';
import type { TabsState } from './state/useTabsState';
import type { LayoutState } from './state/useLayoutState';
import type { EntitiesState } from './state/useEntitiesState';
import type { SettingsState } from './state/useSettingsState';
import type { UiState } from './state/useUiState';
import type { TabActions } from './useTabActions';

export type UseProjectLoaderContext = Pick<
  WorkspaceState,
  | 'folderPathRef'
  | 'refreshCurrentFolderRef'
  | 'setDbReady'
  | 'applyFolderTree'
  | 'setFolderPath'
  | 'setIsLoading'
  | 'setUnassignedRecords'
> &
  Pick<TabsState, 'setActiveTab' | 'setOpenTabs'> &
  Pick<LayoutState, 'setRightPanelCollapsed'> &
  Pick<EntitiesState, 'setWorkspaceProjectName'> &
  Pick<SettingsState, 'appSettingsRef' | 'setAppSettings'> &
  Pick<UiState, 'toast'> &
  Pick<TabActions, 'openFileInTab'>;

/**
 * 项目加载：启动恢复上次工作区、打开本地文件夹 / 示例数据、刷新文件树
 */
export function useProjectLoader(ctx: UseProjectLoaderContext) {
  const {
    appSettingsRef,
    folderPathRef,
    openFileInTab,
    refreshCurrentFolderRef,
    setActiveTab,
    setAppSettings,
    setDbReady,
    applyFolderTree,
    setFolderPath,
    setIsLoading,
    setOpenTabs,
    setRightPanelCollapsed,
    setUnassignedRecords,
    setWorkspaceProjectName,
    toast,
  } = ctx;

  // 加载代次：每次开始切换工作区时递增，异步返回后只有最新代次才能写入工作区状态，
  // 防止较晚返回的启动恢复覆盖用户期间手动打开的文件夹
  const loadGenerationRef = React.useRef(0);
  const beginLoad = useCallback(() => ++loadGenerationRef.current, []);
  const isLatestLoad = useCallback((gen: number) => gen === loadGenerationRef.current, []);

  const initializeProjectStore = useCallback(
    async (projectFolderPath: string) => {
      if (!window.electron?.ipcRenderer) return;
      const dbDir = `${projectFolderPath}/.novel-editor`;
      // db-init 同时按作品准备数据库记录、迁移旧版项目级数据（见主进程 work-scope.ts）
      const initResult = (await window.electron.ipcRenderer.invoke('db-init', dbDir)) as {
        unassignedRecords?: boolean;
      } | null;
      setUnassignedRecords(initResult?.unassignedRecords === true);
      // 项目根记录：普通文件夹的作品记录；ne 项目中承载版本快照（人物等内容跟随各作品）
      const existing = await window.electron.ipcRenderer.invoke(
        'db-novel-get-by-folder',
        projectFolderPath
      );
      if (!existing) {
        const projectName = projectFolderPath.split('/').pop() || projectFolderPath;
        await window.electron.ipcRenderer.invoke(
          'db-novel-create',
          projectName,
          projectFolderPath,
          ''
        );
      }
    },
    [setUnassignedRecords]
  );

  const refreshCurrentFolder = useCallback(async () => {
    const currentFolderPath = folderPathRef.current;
    if (!currentFolderPath) return;
    setIsLoading(true);
    try {
      if (!window.electron?.ipcRenderer) {
        toast.error('Electron IPC 不可用');
        return;
      }
      const result = await window.electron.ipcRenderer.invoke('refresh-folder', currentFolderPath);
      if (result) {
        applyFolderTree(result);
      }
    } catch (error) {
      console.error('Error refreshing folder:', error);
      toast.error(`刷新文件夹失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsLoading(false);
    }
  }, [applyFolderTree, folderPathRef, setIsLoading, toast]);
  // 同步最新引用，供声明顺序靠前的 effect 通过 ref 访问
  refreshCurrentFolderRef.current = refreshCurrentFolder;

  // 后台写入文件（场景视频的成片 / 样片 / 分镜表等）后静默刷新文件树：不显示加载状态，多次通知合并为一次
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refreshQuietly = async () => {
      const currentFolderPath = folderPathRef.current;
      const ipc = window.electron?.ipcRenderer;
      if (!currentFolderPath || !ipc) return;
      try {
        const result = await ipc.invoke('refresh-folder', currentFolderPath);
        if (result && folderPathRef.current === currentFolderPath) applyFolderTree(result);
      } catch (error) {
        console.warn('静默刷新文件树失败:', error);
      }
    };
    const onChanged = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void refreshQuietly();
      }, WORKSPACE_REFRESH_DEBOUNCE_MS);
    };
    window.addEventListener(WORKSPACE_FILES_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(WORKSPACE_FILES_CHANGED_EVENT, onChanged);
      if (timer) clearTimeout(timer);
    };
  }, [applyFolderTree, folderPathRef]);

  const loadDefaultPath = useCallback(async () => {
    const gen = beginLoad();
    setIsLoading(true);
    try {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) {
        console.warn('Electron IPC not available, skipping default path load');
        return;
      }

      // 启动期先并行初始化默认数据库和上次工作区，减少纯等待时间。
      const [, lastFolder] = await Promise.all([
        ipc.invoke('db-init-default'),
        ipc.invoke('get-last-folder'),
      ]);
      setDbReady(true);

      let startupSettings = DEFAULT_SETTINGS_DRAFT;
      try {
        const rawSettings = (await ipc.invoke('db-settings-get', SETTINGS_STORAGE_KEY)) as
          | string
          | null;
        const nextSettings = mergeSettingsDraft(rawSettings);
        startupSettings = nextSettings;
        appSettingsRef.current = nextSettings;
        setAppSettings(nextSettings);
        setRightPanelCollapsed(nextSettings.general.collapseRightPanelOnStartup);
      } catch {
        appSettingsRef.current = DEFAULT_SETTINGS_DRAFT;
        setAppSettings(DEFAULT_SETTINGS_DRAFT);
        setRightPanelCollapsed(DEFAULT_SETTINGS_DRAFT.general.collapseRightPanelOnStartup);
      }

      if (!isLatestLoad(gen)) {
        // 期间用户已打开其他工作区：跳过恢复上次目录，但仍继续下方的更新检查
      } else if (lastFolder) {
        await initializeProjectStore(lastFolder);
        const result = await ipc.invoke('refresh-folder', lastFolder);
        if (isLatestLoad(gen)) {
          void ipc.invoke('add-recent-folder', lastFolder);
          if (result) {
            setFolderPath(result.path);
            applyFolderTree(result);
          }
        }
      } else {
        // 首次启动 / 上次目录已不存在：与 VS Code 打开欢迎页类似，默认打开示例数据
        const samplePath = await ipc.invoke('open-sample-data');
        await initializeProjectStore(samplePath);
        const result = await ipc.invoke('refresh-folder', samplePath);
        if (isLatestLoad(gen)) {
          void ipc.invoke('add-recent-folder', samplePath);
          setWorkspaceProjectName(null);
          if (result) {
            setFolderPath(result.path);
            applyFolderTree(result);
          } else {
            setFolderPath(null);
            applyFolderTree(null);
          }
        }
      }

      // 更新检查不阻塞首屏渲染。
      void ipc
        .invoke('check-just-updated')
        .then((updateResult) => {
          if (updateResult.updated && startupSettings.general.openChangelogAfterUpdate) {
            openFileInTab('__changelog__:更新日志');
          }
        })
        .catch(() => {
          // 忽略检查失败
        });
    } catch (error) {
      console.error('Error loading default path:', error);
    } finally {
      if (isLatestLoad(gen)) setIsLoading(false);
    }
  }, [
    beginLoad,
    setIsLoading,
    setDbReady,
    isLatestLoad,
    appSettingsRef,
    setAppSettings,
    setRightPanelCollapsed,
    initializeProjectStore,
    setFolderPath,
    applyFolderTree,
    setWorkspaceProjectName,
    openFileInTab,
  ]);

  const handleOpenLocal = useCallback(async () => {
    setIsLoading(true);
    try {
      if (!window.electron?.ipcRenderer) {
        toast.error('Electron IPC 不可用');
        return;
      }
      const result = await window.electron.ipcRenderer.invoke('open-local-folder');
      if (result) {
        // 用户确认选择后才使进行中的其他加载失效（取消对话框不影响启动恢复）
        const gen = beginLoad();
        await initializeProjectStore(result.path);
        await window.electron.ipcRenderer.invoke('add-recent-folder', result.path);
        if (!isLatestLoad(gen)) return;
        setFolderPath(result.path);
        applyFolderTree(result);
        setWorkspaceProjectName(null);
        setOpenTabs([]);
        setActiveTab(null);
      }
    } catch (error) {
      console.error('Error opening folder:', error);
      toast.error(`打开文件夹失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsLoading(false);
    }
  }, [
    setIsLoading,
    toast,
    beginLoad,
    initializeProjectStore,
    isLatestLoad,
    setFolderPath,
    applyFolderTree,
    setWorkspaceProjectName,
    setOpenTabs,
    setActiveTab,
  ]);

  const handleOpenSampleData = useCallback(async () => {
    setIsLoading(true);
    try {
      if (!window.electron?.ipcRenderer) return;
      const gen = beginLoad();
      const samplePath = await window.electron.ipcRenderer.invoke('open-sample-data');
      await initializeProjectStore(samplePath);
      await window.electron.ipcRenderer.invoke('add-recent-folder', samplePath);
      const result = await window.electron.ipcRenderer.invoke('refresh-folder', samplePath);
      if (!isLatestLoad(gen)) return;
      if (result) {
        setFolderPath(result.path);
        applyFolderTree(result);
        setWorkspaceProjectName(null);
        setOpenTabs([]);
        setActiveTab(null);
      }
    } catch (error) {
      console.error('Error opening sample data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [
    setIsLoading,
    beginLoad,
    initializeProjectStore,
    isLatestLoad,
    setFolderPath,
    applyFolderTree,
    setWorkspaceProjectName,
    setOpenTabs,
    setActiveTab,
  ]);

  // 示例作品集升级到新版时提示一次（旧副本已整体备份，保留用户改动）
  React.useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    let cancelled = false;
    // 与启动加载同样延后，挂载后立即卸载（如 StrictMode 双挂载）时不发起请求
    const timer = setTimeout(() => {
      void ipc
        .invoke('sample-data-take-upgrade-notice')
        .then((notice) => {
          if (!cancelled && notice) {
            toast.info(`示例作品集已更新到新版，旧版已备份到：${notice.backupPath}`, 8000);
          }
        })
        .catch(() => {
          // 提示失败不影响启动
        });
    }, 100);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [toast]);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      loadDefaultPath();
    }, 100);

    return () => {
      clearTimeout(timer);
    };
  }, [loadDefaultPath]);

  /**
   * 按路径打开文件夹：应用菜单「打开最近使用」、项目菜单「打开最近使用」、
   * `ne open <path>` 二次启动转发（open-folder-request）共用
   */
  const handleOpenFolderPath = useCallback(
    async (targetPath: string) => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc || !targetPath) return;
      setIsLoading(true);
      const gen = beginLoad();
      try {
        await initializeProjectStore(targetPath);
        const result = await ipc.invoke('refresh-folder', targetPath);
        if (!isLatestLoad(gen)) return;
        if (result) {
          await ipc.invoke('add-recent-folder', result.path);
          setFolderPath(result.path);
          applyFolderTree(result);
          setWorkspaceProjectName(null);
          setOpenTabs([]);
          setActiveTab(null);
        }
      } catch (error) {
        toast.error(`打开文件夹失败: ${error instanceof Error ? error.message : '未知错误'}`);
      } finally {
        setIsLoading(false);
      }
    },
    [
      initializeProjectStore,
      toast,
      beginLoad,
      isLatestLoad,
      setIsLoading,
      setFolderPath,
      applyFolderTree,
      setWorkspaceProjectName,
      setOpenTabs,
      setActiveTab,
    ]
  );

  // 应用已运行时，`ne open <path>` 等二次启动由主进程转发到这里打开对应目录
  React.useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    const dispose = ipc.on('open-folder-request', (_event: unknown, targetPath: string) => {
      void handleOpenFolderPath(targetPath);
    });
    return () => {
      if (typeof dispose === 'function') dispose();
    };
  }, [handleOpenFolderPath]);

  return {
    initializeProjectStore,
    refreshCurrentFolder,
    loadDefaultPath,
    handleOpenLocal,
    handleOpenFolderPath,
    handleOpenSampleData,
  };
}

export type ProjectLoaderApi = ReturnType<typeof useProjectLoader>;
