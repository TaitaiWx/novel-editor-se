import React, { useCallback } from 'react';
import {
  DEFAULT_SETTINGS_DRAFT,
  SETTINGS_STORAGE_KEY,
  mergeSettingsDraft,
} from '@/render/utils/appSettings';
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
  | 'setFiles'
  | 'setFolderPath'
  | 'setIsLoading'
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
    setFiles,
    setFolderPath,
    setIsLoading,
    setOpenTabs,
    setRightPanelCollapsed,
    setWorkspaceProjectName,
    toast,
  } = ctx;

  // 加载代次：每次开始切换工作区时递增，异步返回后只有最新代次才能写入工作区状态，
  // 防止较晚返回的启动恢复覆盖用户期间手动打开的文件夹
  const loadGenerationRef = React.useRef(0);
  const beginLoad = useCallback(() => ++loadGenerationRef.current, []);
  const isLatestLoad = useCallback((gen: number) => gen === loadGenerationRef.current, []);

  const initializeProjectStore = useCallback(async (projectFolderPath: string) => {
    if (!window.electron?.ipcRenderer) return;
    const dbDir = `${projectFolderPath}/.novel-editor`;
    await window.electron.ipcRenderer.invoke('db-init', dbDir);
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
  }, []);

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
        setFiles(result.files);
      }
    } catch (error) {
      console.error('Error refreshing folder:', error);
      toast.error(`刷新文件夹失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsLoading(false);
    }
  }, [folderPathRef, setFiles, setIsLoading, toast]);
  // 同步最新引用，供声明顺序靠前的 effect 通过 ref 访问
  refreshCurrentFolderRef.current = refreshCurrentFolder;

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
            setFiles(result.files);
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
            setFiles(result.files);
          } else {
            setFolderPath(null);
            setFiles([]);
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
    setFiles,
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
        setFiles(result.files);
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
    setFiles,
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
        setFiles(result.files);
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
    setFiles,
    setWorkspaceProjectName,
    setOpenTabs,
    setActiveTab,
  ]);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      loadDefaultPath();
    }, 100);

    return () => {
      clearTimeout(timer);
    };
  }, [loadDefaultPath]);

  // 应用已运行时，`ne open <path>` 等二次启动由主进程转发到这里打开对应目录
  React.useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    const dispose = ipc.on('open-folder-request', async (_event: unknown, targetPath: string) => {
      setIsLoading(true);
      const gen = beginLoad();
      try {
        await initializeProjectStore(targetPath);
        const result = await ipc.invoke('refresh-folder', targetPath);
        if (!isLatestLoad(gen)) return;
        if (result) {
          setFolderPath(result.path);
          setFiles(result.files);
          setWorkspaceProjectName(null);
          setOpenTabs([]);
          setActiveTab(null);
        }
      } catch (error) {
        toast.error(`打开文件夹失败: ${error instanceof Error ? error.message : '未知错误'}`);
      } finally {
        setIsLoading(false);
      }
    });
    return () => {
      if (typeof dispose === 'function') dispose();
    };
  }, [
    initializeProjectStore,
    toast,
    beginLoad,
    isLatestLoad,
    setIsLoading,
    setFolderPath,
    setFiles,
    setWorkspaceProjectName,
    setOpenTabs,
    setActiveTab,
  ]);

  return {
    initializeProjectStore,
    refreshCurrentFolder,
    loadDefaultPath,
    handleOpenLocal,
    handleOpenSampleData,
  };
}

export type ProjectLoaderApi = ReturnType<typeof useProjectLoader>;
