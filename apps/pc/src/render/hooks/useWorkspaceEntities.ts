import React from 'react';
import { loadLoreEntriesByFolder } from '@/render/components/RightPanel/lore-data';
import { mapCharacterRows } from '@/render/components/RightPanel/utils';
import type { WorkspaceState } from './state/useWorkspaceState';
import type { EntitiesState } from './state/useEntitiesState';

export type UseWorkspaceEntitiesContext = Pick<WorkspaceState, 'folderPath'> &
  Pick<
    EntitiesState,
    'setWorkspaceCharacters' | 'setWorkspaceLoreEntries' | 'setWorkspaceProjectName'
  >;

/**
 * 切换项目时加载作品名、人物与设定列表
 */
export function useWorkspaceEntities(ctx: UseWorkspaceEntitiesContext) {
  const { folderPath, setWorkspaceCharacters, setWorkspaceLoreEntries, setWorkspaceProjectName } =
    ctx;

  React.useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc || !folderPath) {
      setWorkspaceCharacters([]);
      setWorkspaceLoreEntries([]);
      setWorkspaceProjectName(null);
      return;
    }
    let cancelled = false;
    const loadWorkspaceEntities = async () => {
      try {
        const novel = (await ipc.invoke('db-novel-get-by-folder', folderPath)) as {
          id: number;
          name?: string | null;
        } | null;
        const [characterRows, loreEntries] = await Promise.all([
          novel
            ? (ipc.invoke('db-character-list', novel.id) as Promise<
                Array<{
                  id: number;
                  name: string;
                  role: string;
                  description: string;
                  attributes: string;
                }>
              >)
            : Promise.resolve([]),
          loadLoreEntriesByFolder(folderPath),
        ]);
        if (cancelled) return;
        setWorkspaceProjectName(novel?.name || folderPath.split('/').pop() || null);
        setWorkspaceCharacters(mapCharacterRows(characterRows));
        setWorkspaceLoreEntries(loreEntries);
      } catch {
        if (cancelled) return;
        setWorkspaceProjectName(folderPath.split('/').pop() || null);
        setWorkspaceCharacters([]);
        setWorkspaceLoreEntries([]);
      }
    };
    void loadWorkspaceEntities();
    return () => {
      cancelled = true;
    };
  }, [folderPath, setWorkspaceCharacters, setWorkspaceLoreEntries, setWorkspaceProjectName]);
}
