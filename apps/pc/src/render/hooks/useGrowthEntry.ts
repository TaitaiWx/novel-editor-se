import { useCallback, useEffect, useRef, useState } from 'react';
import { createGrowthWorkspaceTab } from '@/render/utils/workspace';
import {
  GROWTH_MEMORY_CHANGED_EVENT,
  summarizeGrowthSnapshot,
  type GrowthIndex,
  type GrowthMemoryChangedDetail,
} from '@/render/utils/growthIndex';
import type { WorkspaceState } from './state/useWorkspaceState';
import type { UiState } from './state/useUiState';
import type { TabActions } from './useTabActions';

export type UseGrowthEntryContext = Pick<WorkspaceState, 'folderPath'> &
  Pick<UiState, 'dialog' | 'toast'> &
  Pick<TabActions, 'openFileInTab'>;

/** 与主进程 assertName 保持一致 */
const MAX_GROWTH_NAME_LENGTH = 100;

/**
 * 成长档案入口：维护文件面板所需的成长卡索引，并提供打开 / 新建成长档案标签的动作。
 *
 * 索引来源：项目切换时读取一次 `growth-load`；GrowthView 写入后广播的快照；窗口重新获得焦点时
 * 再读一次（CLI / AI agent 可能在应用外修改了 资料/记忆/）。
 */
export function useGrowthEntry(ctx: UseGrowthEntryContext) {
  const { dialog, folderPath, openFileInTab, toast } = ctx;
  const [growthIndex, setGrowthIndex] = useState<GrowthIndex | null>(null);
  const folderRef = useRef(folderPath);
  folderRef.current = folderPath;

  const reloadGrowthIndex = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    if (!folderPath || !ipc) {
      setGrowthIndex(null);
      return;
    }
    try {
      const result = await ipc.invoke('growth-load', folderPath);
      if (folderRef.current !== folderPath) return;
      setGrowthIndex(result.ok ? summarizeGrowthSnapshot(result.data) : null);
    } catch {
      if (folderRef.current === folderPath) setGrowthIndex(null);
    }
  }, [folderPath]);

  useEffect(() => {
    void reloadGrowthIndex();
  }, [reloadGrowthIndex]);

  useEffect(() => {
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<GrowthMemoryChangedDetail>).detail;
      if (!detail || detail.folderPath !== folderRef.current) return;
      setGrowthIndex(detail.index);
    };
    const onFocus = () => void reloadGrowthIndex();
    window.addEventListener(GROWTH_MEMORY_CHANGED_EVENT, onChanged);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener(GROWTH_MEMORY_CHANGED_EVENT, onChanged);
      window.removeEventListener('focus', onFocus);
    };
  }, [reloadGrowthIndex]);

  /** 打开成长档案标签：传入角色名打开（必要时新建）该角色的成长卡，否则打开总览 */
  const handleOpenGrowth = useCallback(
    (characterName?: string | null) => {
      openFileInTab(createGrowthWorkspaceTab(characterName));
    },
    [openFileInTab]
  );

  /** 询问角色名后打开该角色的成长档案（成长卡由标签内的 GrowthView 负责创建） */
  const handleCreateGrowthSheet = useCallback(async () => {
    if (!folderRef.current) return;
    // 人物库中的角色会自动带上别名；也可以是只在记忆库里记录的配角
    const input = await dialog.prompt('新建成长档案', '角色名，例如：林舟', '');
    const name = input?.trim();
    if (!name) return;
    if (name.length > MAX_GROWTH_NAME_LENGTH) {
      toast.error(`角色名不能超过 ${MAX_GROWTH_NAME_LENGTH} 个字符`);
      return;
    }
    handleOpenGrowth(name);
  }, [dialog, handleOpenGrowth, toast]);

  return { growthIndex, reloadGrowthIndex, handleOpenGrowth, handleCreateGrowthSheet };
}

export type GrowthEntryApi = ReturnType<typeof useGrowthEntry>;
