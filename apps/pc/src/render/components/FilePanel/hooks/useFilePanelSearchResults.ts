import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FileNode } from '../../../types';
import type { Character, LoreEntry } from '../../RightPanel/types';
import type { GrowthSheetSummary } from '../../../utils/growthIndex';
import type { StoryDisplayNode } from '../../../utils/storyStructure';
import { buildSearchGroups, flattenSearchGroups, type FileSearchItem } from '../search';
import { useWorkspaceContentSearch } from './useWorkspaceContentSearch';

/** 搜索结果列表的键盘操作 */
export type SearchNavigateAction = 'next' | 'prev' | 'open';

interface UseFilePanelSearchResultsOptions {
  query: string;
  rootPath: string | null;
  projectDocs: FileNode[];
  storyNodes: StoryDisplayNode[];
  materialNodes: FileNode[];
  characters: Character[];
  loreEntries: LoreEntry[];
  growthSheets: GrowthSheetSummary[];
  onOpenFile: (path: string) => void;
  onOpenCharacter: (id: number) => void;
  onOpenLore: (id: number) => void;
  onOpenGrowth?: (name: string) => void;
  /** 打开结果后关闭搜索 */
  closeSearch: () => void;
}

/**
 * 文件面板搜索结果：名称匹配（同步）+ 全文搜索（主进程，防抖），
 * 维护键盘选中项（↑ / ↓ 移动、Enter 打开），打开后关闭搜索
 */
export function useFilePanelSearchResults({
  query,
  rootPath,
  projectDocs,
  storyNodes,
  materialNodes,
  characters,
  loreEntries,
  growthSheets,
  onOpenFile,
  onOpenCharacter,
  onOpenLore,
  onOpenGrowth,
  closeSearch,
}: UseFilePanelSearchResultsOptions) {
  const content = useWorkspaceContentSearch(rootPath, query);
  const groups = useMemo(
    () =>
      buildSearchGroups({
        query,
        rootPath,
        projectDocs,
        storyNodes,
        materialNodes,
        characters,
        loreEntries,
        growthSheets: onOpenGrowth ? growthSheets : [],
        contentFiles: content.files,
      }),
    [
      query,
      rootPath,
      projectDocs,
      storyNodes,
      materialNodes,
      characters,
      loreEntries,
      growthSheets,
      onOpenGrowth,
      content.files,
    ]
  );
  const items = useMemo(() => flattenSearchGroups(groups), [groups]);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // 结果变化时：保留仍存在的选中项，否则选中第一项
  useEffect(() => {
    setActiveKey((current) =>
      current && items.some((item) => item.key === current) ? current : (items[0]?.key ?? null)
    );
  }, [items]);

  const openItem = useCallback(
    (item: FileSearchItem) => {
      closeSearch();
      switch (item.kind) {
        case 'file':
        case 'content':
          onOpenFile(item.path);
          break;
        case 'character':
          onOpenCharacter(item.id);
          break;
        case 'lore':
          onOpenLore(item.id);
          break;
        case 'growth':
          onOpenGrowth?.(item.name);
          break;
      }
    },
    [closeSearch, onOpenCharacter, onOpenFile, onOpenGrowth, onOpenLore]
  );

  const navigate = useCallback(
    (action: SearchNavigateAction) => {
      if (items.length === 0) return;
      const index = items.findIndex((item) => item.key === activeKey);
      if (action === 'open') {
        openItem(items[index === -1 ? 0 : index]);
        return;
      }
      const delta = action === 'next' ? 1 : -1;
      const next = index === -1 ? 0 : (index + delta + items.length) % items.length;
      setActiveKey(items[next].key);
    },
    [activeKey, items, openItem]
  );

  return {
    groups,
    activeKey,
    setActiveKey,
    navigate,
    openItem,
    contentSearching: content.searching,
    contentTruncated: content.truncated,
    contentError: content.error,
  };
}
