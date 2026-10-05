import type React from 'react';
import type { FileNode } from '../../types';
import type { Character, CharacterCategory, LoreEntry } from '../RightPanel/types';
import { isChapterLikeStoryName, isDraftLikeStoryName } from '../../utils/workspace';
import { isImeComposing } from '../../utils/ime';
import type { StoryDropMode } from './types';
import type { GrowthSheetSummary } from '../../utils/growthIndex';
import { getPathBasename } from '@/render/utils/path';

/** 根据路径在树中查找节点 */
export function findNodeByPath(nodes: FileNode[], targetPath: string): FileNode | null {
  for (const node of nodes) {
    if (node.path === targetPath) return node;
    if (node.children) {
      const found = findNodeByPath(node.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

/** 递归过滤文件树，保留匹配节点及其父目录路径 */
export function filterTree(nodes: FileNode[], query: string): FileNode[] {
  const lowerQuery = query.toLowerCase();
  return nodes.reduce<FileNode[]>((acc, node) => {
    if (node.type === 'directory') {
      const filteredChildren = node.children ? filterTree(node.children, query) : [];
      const nameMatches = node.name.toLowerCase().includes(lowerQuery);
      if (nameMatches || filteredChildren.length > 0) {
        acc.push({
          ...node,
          children: filteredChildren.length > 0 ? filteredChildren : node.children,
        });
      }
    } else {
      if (node.name.toLowerCase().includes(lowerQuery)) {
        acc.push(node);
      }
    }
    return acc;
  }, []);
}

/** 统计卷下的章与稿数量 */
export function countStoryStats(node: FileNode): { chapters: number; drafts: number } {
  if (node.type === 'file') {
    return isDraftLikeStoryName(node.name) && !isChapterLikeStoryName(node.name)
      ? { chapters: 0, drafts: 1 }
      : { chapters: 1, drafts: 0 };
  }

  return (node.children || []).reduce(
    (summary, child) => {
      const childStats = countStoryStats(child);
      return {
        chapters: summary.chapters + childStats.chapters,
        drafts: summary.drafts + childStats.drafts,
      };
    },
    { chapters: 0, drafts: 0 }
  );
}

/** 递归统计文件数量（不计目录） */
export function countFiles(nodes: FileNode[]): number {
  return nodes.reduce((total, node) => {
    if (node.type === 'file') return total + 1;
    return total + countFiles(node.children || []);
  }, 0);
}

export function getCharacterCategoryLabel(category: CharacterCategory): string {
  return category === 'major' ? '主要角色' : '次要角色';
}

/** 返回目标路径的所有祖先目录路径（从根到父） */
export function findAncestorPaths(
  nodes: FileNode[],
  targetPath: string,
  ancestors: string[] = []
): string[] {
  for (const node of nodes) {
    if (node.path === targetPath) {
      return ancestors;
    }
    if (node.type === 'directory' && node.children) {
      const next = findAncestorPaths(node.children, targetPath, [...ancestors, node.path]);
      if (next.length > 0) return next;
    }
  }
  return [];
}

/** 是否为来自系统文件管理器的外部文件拖拽 */
export function isExternalFileDrag(event: { dataTransfer: { types?: ArrayLike<string> | null } }) {
  return Array.from(event.dataTransfer.types || []).includes('Files');
}

/** 从文件夹路径中取出目录名（兼容 / 与 \ 分隔） */
export function getFolderName(folderPath: string | null): string | null {
  return folderPath ? getPathBasename(folderPath) : null;
}

export function filterCharacters(characters: Character[], normalizedQuery: string): Character[] {
  return characters.filter((item) =>
    normalizedQuery
      ? `${item.name} ${item.role} ${item.description}`.toLowerCase().includes(normalizedQuery)
      : true
  );
}

export function filterLoreEntries(loreEntries: LoreEntry[], normalizedQuery: string): LoreEntry[] {
  return loreEntries.filter((item) =>
    normalizedQuery ? `${item.title} ${item.summary}`.toLowerCase().includes(normalizedQuery) : true
  );
}

export interface CharacterGroup {
  key: CharacterCategory;
  label: string;
  items: Character[];
}

/** 按主要/次要角色分组 */
export function groupCharacters(characters: Character[]): CharacterGroup[] {
  return [
    {
      key: 'major' as const,
      label: '主要角色',
      items: characters.filter((item) => item.category === 'major'),
    },
    {
      key: 'secondary' as const,
      label: '次要角色',
      items: characters.filter((item) => item.category === 'secondary'),
    },
  ];
}

/** 搜索时是否保留"角色"分区 */
export function shouldShowCharactersSection(normalizedQuery: string, matchCount: number): boolean {
  return (
    normalizedQuery.length === 0 ||
    matchCount > 0 ||
    '人物 角色 关系'.includes(normalizedQuery) ||
    normalizedQuery.includes('人') ||
    normalizedQuery.includes('角')
  );
}

/** 搜索时是否保留"设定"分区 */
/** 按角色名 / 别名筛选成长档案 */
export function filterGrowthSheets(
  sheets: GrowthSheetSummary[],
  normalizedQuery: string
): GrowthSheetSummary[] {
  if (!normalizedQuery) return sheets;
  return sheets.filter((item) =>
    [item.name, ...item.aliases].some((name) => name.toLowerCase().includes(normalizedQuery))
  );
}

export function shouldShowGrowthSection(normalizedQuery: string, matchCount: number): boolean {
  return (
    normalizedQuery.length === 0 ||
    matchCount > 0 ||
    '成长 档案 等级 经验 记忆'.includes(normalizedQuery) ||
    normalizedQuery.includes('成长')
  );
}

export function shouldShowLoreSection(normalizedQuery: string, matchCount: number): boolean {
  return (
    normalizedQuery.length === 0 ||
    matchCount > 0 ||
    '设定 世界观 规则 资料'.includes(normalizedQuery) ||
    normalizedQuery.includes('设') ||
    normalizedQuery.includes('定')
  );
}

/** 根据指针在目标行中的纵向位置推算落点：不允许放入内部时按上下半区区分前/后 */
export function resolveStoryDropMode(
  rect: { top: number; height: number },
  clientY: number,
  allowsInside: boolean
): StoryDropMode {
  if (!allowsInside) {
    const ratio = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
    return ratio >= 0.5 ? 'after' : 'before';
  }
  return 'inside';
}

/** 计算粘贴目标目录：目录粘贴到自身，文件粘贴到父目录 */
export function resolvePasteTargetDir(files: FileNode[], selectedFile: string): string {
  const node = findNodeByPath(files, selectedFile);
  return node?.type === 'directory'
    ? selectedFile
    : selectedFile.substring(0, selectedFile.lastIndexOf('/'));
}

/**
 * 统一处理行级可点击节点的键盘交互（Enter / 空格激活），
 * 避免用 button 包 button 触发 DOM 嵌套告警。
 */
export function handleRowActivationKey(event: React.KeyboardEvent, onActivate: () => void): void {
  if (isImeComposing(event)) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    onActivate();
  }
}
