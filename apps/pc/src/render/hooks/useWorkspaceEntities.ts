import React from 'react';
import { loadLoreEntriesByFolder } from '@/render/components/RightPanel/lore-data';
import { mapCharacterRows } from '@/render/components/RightPanel/utils';
import type { WorkspaceState } from './state/useWorkspaceState';
import type { EntitiesState } from './state/useEntitiesState';

export type UseWorkspaceEntitiesContext = Pick<
  WorkspaceState,
  'folderPath' | 'projectLayout' | 'workScope' | 'workScopePath'
> &
  Pick<
    EntitiesState,
    'setWorkspaceCharacters' | 'setWorkspaceLoreEntries' | 'setWorkspaceProjectName'
  >;

type CharacterRow = {
  id: number;
  name: string;
  role: string;
  description: string;
  attributes: string;
};

/**
 * 切换项目 / 当前作品时加载项目名、人物与设定列表。
 * 人物与设定跟随作品：按当前作品路径（普通文件夹为文件夹本身）读取对应的作品记录，
 * 作品还没有记录（例如刚新建的作品）时先创建，后续新建人物 / 设定才有归属。
 */
export function useWorkspaceEntities(ctx: UseWorkspaceEntitiesContext) {
  const {
    folderPath,
    projectLayout,
    setWorkspaceCharacters,
    setWorkspaceLoreEntries,
    setWorkspaceProjectName,
    workScope,
  } = ctx;
  const workScopePath = ctx.workScopePath ?? folderPath;
  const scopeName = workScope?.name ?? null;
  const projectTitle = projectLayout?.name ?? null;

  React.useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc || !folderPath || !workScopePath) {
      setWorkspaceCharacters([]);
      setWorkspaceLoreEntries([]);
      setWorkspaceProjectName(null);
      return;
    }
    let cancelled = false;
    const fallbackName = folderPath.split('/').pop() || null;
    const loadWorkspaceEntities = async () => {
      try {
        let novel = (await ipc.invoke('db-novel-get-by-folder', workScopePath)) as {
          id: number;
          name?: string | null;
        } | null;
        if (!novel && workScopePath !== folderPath) {
          await ipc.invoke('db-novel-create', scopeName || fallbackName, workScopePath, '');
          novel = (await ipc.invoke('db-novel-get-by-folder', workScopePath)) as typeof novel;
        }
        const [characterRows, loreEntries] = await Promise.all([
          novel
            ? (ipc.invoke('db-character-list', novel.id) as Promise<CharacterRow[]>)
            : Promise.resolve([]),
          loadLoreEntriesByFolder(workScopePath),
        ]);
        if (cancelled) return;
        // ne 项目显示项目配置中的作品集名；普通文件夹显示作品记录名（可重命名）
        if (projectTitle) {
          setWorkspaceProjectName(projectTitle);
        } else {
          const root = (await ipc.invoke('db-novel-get-by-folder', folderPath)) as {
            name?: string | null;
          } | null;
          if (cancelled) return;
          setWorkspaceProjectName(root?.name || novel?.name || fallbackName);
        }
        setWorkspaceCharacters(mapCharacterRows(characterRows));
        setWorkspaceLoreEntries(loreEntries);
      } catch {
        if (cancelled) return;
        setWorkspaceProjectName(projectTitle || fallbackName);
        setWorkspaceCharacters([]);
        setWorkspaceLoreEntries([]);
      }
    };
    void loadWorkspaceEntities();
    return () => {
      cancelled = true;
    };
  }, [
    folderPath,
    projectTitle,
    scopeName,
    setWorkspaceCharacters,
    setWorkspaceLoreEntries,
    setWorkspaceProjectName,
    workScopePath,
  ]);
}
