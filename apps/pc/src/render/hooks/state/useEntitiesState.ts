import { useReducer, useState } from 'react';
import type { Character, LoreEntry } from '@/render/components/RightPanel/types';

/**
 * 工作区实体领域状态：项目名、人物、设定（含版本号）、章节关联资料与资料引用表
 * （只声明，不含副作用）
 */
export function useEntitiesState() {
  const [workspaceCharacters, setWorkspaceCharacters] = useState<Character[]>([]);
  const [workspaceLoreEntries, setWorkspaceLoreEntries] = useState<LoreEntry[]>([]);
  const [workspaceProjectName, setWorkspaceProjectName] = useState<string | null>(null);
  // 当前人物 / 设定列表属于哪个作品目录：切换作品时列表异步重载，期间图片路径要按旧作品解析
  const [workspaceEntitiesPath, setWorkspaceEntitiesPath] = useState<string | null>(null);
  const [workspaceCharactersVersion, bumpWorkspaceCharactersVersion] = useReducer(
    (count: number) => count + 1,
    0
  );
  const [workspaceLoreVersion, bumpWorkspaceLoreVersion] = useReducer(
    (count: number) => count + 1,
    0
  );
  const [chapterMaterialPaths, setChapterMaterialPaths] = useState<string[]>([]);
  const [materialUsageMap, setMaterialUsageMap] = useState<Record<string, string>>({});

  return {
    workspaceCharacters,
    setWorkspaceCharacters,
    workspaceLoreEntries,
    setWorkspaceLoreEntries,
    workspaceProjectName,
    setWorkspaceProjectName,
    workspaceEntitiesPath,
    setWorkspaceEntitiesPath,
    workspaceCharactersVersion,
    bumpWorkspaceCharactersVersion,
    workspaceLoreVersion,
    bumpWorkspaceLoreVersion,
    chapterMaterialPaths,
    setChapterMaterialPaths,
    materialUsageMap,
    setMaterialUsageMap,
  };
}

export type EntitiesState = ReturnType<typeof useEntitiesState>;
