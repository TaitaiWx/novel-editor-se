import type { FileNode } from '../types';
import type { Character, LoreEntry } from '../components/RightPanel/types';

export const WORKSPACE_TAB_CHARACTERS = '__workspace__:characters';
export const WORKSPACE_TAB_LORE = '__workspace__:lore';
export const WORKSPACE_TAB_CHARACTER_PREFIX = '__workspace__:character:';
export const WORKSPACE_TAB_LORE_ENTRY_PREFIX = '__workspace__:lore-entry:';
export const WORKSPACE_TAB_VOLUME_PREFIX = '__workspace__:volume:';

export type AssistantScopeKind = 'project' | 'volume' | 'chapter';
export type AssistantArtifactKind = 'characters' | 'lore' | 'materials';
export type StoryOrderMap = Record<string, string[]>;

export const WORKSPACE_TAB_LABELS: Record<string, string> = {
  [WORKSPACE_TAB_CHARACTERS]: '人物',
  [WORKSPACE_TAB_LORE]: '设定',
};

const STORY_FILE_EXTENSIONS = ['.md', '.markdown', '.txt'];
const STORY_DIRECTORY_HINTS = [
  '正文',
  'story',
  'stories',
  'chapter',
  'chapters',
  'scene',
  'scenes',
  'volume',
  'volumes',
  'part',
  'parts',
  'act',
  'acts',
  'draft',
  'drafts',
  '样稿',
  '草稿',
  '卷',
];
const MATERIAL_DIRECTORY_HINTS = [
  '资料',
  '素材',
  'material',
  'materials',
  'media',
  'asset',
  'assets',
  'reference',
  'references',
  'research',
  'image',
  'images',
  'img',
  'doc',
  'docs',
  'document',
  'documents',
  'pdf',
];

const STORY_COLLATOR = new Intl.Collator('zh-Hans-CN', {
  numeric: true,
  sensitivity: 'base',
});

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export function stripStoryFileExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

export function isDraftLikeStoryName(name: string): boolean {
  return /(draft|sample|test|outline|note|草稿|样稿|测试|片段|提纲|灵感)/i.test(name);
}

export function isChapterLikeStoryName(name: string): boolean {
  return /(^第[一二三四五六七八九十百千万零〇\d]+[章幕节回篇集])|(^chapter\s*\d+)|(^scene\s*\d+)/i.test(
    stripStoryFileExtension(name)
  );
}

export function isVolumeLikeStoryName(name: string): boolean {
  return /(^第[一二三四五六七八九十百千万零〇\d]+卷)|(^volume\s*\d+)|(^part\s*\d+)|(^act\s*\d+)|(^卷[\s_-]?\d+)/i.test(
    stripStoryFileExtension(name)
  );
}

function extractStoryOrder(name: string, type: 'volume' | 'chapter'): number | null {
  const normalized = stripStoryFileExtension(name).trim();
  const patterns =
    type === 'volume'
      ? [/^第(\d+)卷/i, /^volume\s*(\d+)/i, /^part\s*(\d+)/i, /^act\s*(\d+)/i, /^卷[\s_-]?(\d+)/i]
      : [/^第(\d+)[章幕节回篇集]/i, /^chapter\s*(\d+)/i, /^scene\s*(\d+)/i];

  for (const pattern of patterns) {
    const matched = normalized.match(pattern);
    if (!matched) continue;
    const value = Number(matched[1]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function getStoryBucket(node: FileNode): number {
  if (node.type === 'directory' && isVolumeLikeStoryName(node.name)) return 0;
  if (
    node.type === 'file' &&
    (!isDraftLikeStoryName(node.name) || isChapterLikeStoryName(node.name))
  ) {
    return 1;
  }
  if (node.type === 'directory' && !isDraftLikeStoryName(node.name)) return 2;
  if (node.type === 'directory' && isDraftLikeStoryName(node.name)) return 3;
  return 4;
}

export function compareStoryNodesForDisplay(
  left: FileNode,
  right: FileNode,
  parentPath: string | null,
  storyOrderMap: StoryOrderMap = {}
): number {
  const manualOrder = parentPath ? storyOrderMap[parentPath] || [] : [];
  const leftManualIndex = manualOrder.indexOf(left.path);
  const rightManualIndex = manualOrder.indexOf(right.path);

  if (leftManualIndex >= 0 && rightManualIndex >= 0 && leftManualIndex !== rightManualIndex) {
    return leftManualIndex - rightManualIndex;
  }
  if (leftManualIndex >= 0 && rightManualIndex < 0) return -1;
  if (leftManualIndex < 0 && rightManualIndex >= 0) return 1;

  const bucketDiff = getStoryBucket(left) - getStoryBucket(right);
  if (bucketDiff !== 0) return bucketDiff;

  const leftVolumeOrder = left.type === 'directory' ? extractStoryOrder(left.name, 'volume') : null;
  const rightVolumeOrder =
    right.type === 'directory' ? extractStoryOrder(right.name, 'volume') : null;
  if (
    leftVolumeOrder !== null &&
    rightVolumeOrder !== null &&
    leftVolumeOrder !== rightVolumeOrder
  ) {
    return leftVolumeOrder - rightVolumeOrder;
  }

  const leftChapterOrder = left.type === 'file' ? extractStoryOrder(left.name, 'chapter') : null;
  const rightChapterOrder = right.type === 'file' ? extractStoryOrder(right.name, 'chapter') : null;
  if (
    leftChapterOrder !== null &&
    rightChapterOrder !== null &&
    leftChapterOrder !== rightChapterOrder
  ) {
    return leftChapterOrder - rightChapterOrder;
  }

  return STORY_COLLATOR.compare(
    stripStoryFileExtension(left.name),
    stripStoryFileExtension(right.name)
  );
}

export function sortStoryNodesForDisplay(
  nodes: FileNode[],
  parentPath: string | null,
  storyOrderMap: StoryOrderMap = {}
): FileNode[] {
  return [...nodes]
    .map((node) =>
      node.type === 'directory'
        ? {
            ...node,
            children: sortStoryNodesForDisplay(node.children || [], node.path, storyOrderMap),
          }
        : node
    )
    .sort((left, right) => compareStoryNodesForDisplay(left, right, parentPath, storyOrderMap));
}

export function buildStoryDisplayNodes(
  storyNodes: FileNode[],
  folderPath: string | null,
  storyOrderMap: StoryOrderMap = {}
): FileNode[] {
  const volumeNodes: FileNode[] = [];
  const looseStoryNodes: FileNode[] = [];

  storyNodes.forEach((node) => {
    if (node.type === 'directory' && isVolumeLikeStoryName(node.name)) {
      volumeNodes.push(node);
      return;
    }
    looseStoryNodes.push(node);
  });

  const displayNodes = sortStoryNodesForDisplay(volumeNodes, '__story-volumes__', storyOrderMap);

  if (folderPath && looseStoryNodes.length > 0) {
    displayNodes.push({
      name: '未分卷',
      path: folderPath,
      type: 'directory',
      children: sortStoryNodesForDisplay(looseStoryNodes, folderPath, storyOrderMap),
    });
  }

  return displayNodes;
}

export function findStoryParentPath(
  storyNodes: FileNode[],
  folderPath: string,
  targetPath: string,
  currentParentPath = folderPath
): string | null {
  for (const node of storyNodes) {
    if (node.path === targetPath) return currentParentPath;
    if (node.type !== 'directory' || !node.children?.length) continue;
    const matchedParentPath = findStoryParentPath(node.children, folderPath, targetPath, node.path);
    if (matchedParentPath) return matchedParentPath;
  }
  return null;
}

export function resolveOrderedStoryChildren(
  storyNodes: FileNode[],
  folderPath: string,
  parentPath: string,
  storyOrderMap: StoryOrderMap = {}
): FileNode[] {
  if (parentPath === folderPath) {
    const looseStoryNodes = storyNodes.filter(
      (node) => !(node.type === 'directory' && isVolumeLikeStoryName(node.name))
    );
    return sortStoryNodesForDisplay(looseStoryNodes, folderPath, storyOrderMap);
  }

  const parentNode = storyNodes.find((node) => node.path === parentPath) || null;
  if (parentNode?.type === 'directory') {
    return sortStoryNodesForDisplay(parentNode.children || [], parentPath, storyOrderMap);
  }

  const matchedNode = (() => {
    const stack = [...storyNodes];
    while (stack.length > 0) {
      const current = stack.shift();
      if (!current) continue;
      if (current.path === parentPath) return current;
      if (current.type === 'directory' && current.children?.length) {
        stack.unshift(...current.children);
      }
    }
    return null;
  })();

  return matchedNode?.type === 'directory'
    ? sortStoryNodesForDisplay(matchedNode.children || [], parentPath, storyOrderMap)
    : [];
}

function classifyDirectoryZone(
  name: string,
  inheritedZone: 'story' | 'material' | null
): 'story' | 'material' | null {
  const normalized = normalizeName(name);
  if (MATERIAL_DIRECTORY_HINTS.some((hint) => normalized.includes(hint))) return 'material';
  if (STORY_DIRECTORY_HINTS.some((hint) => normalized.includes(hint))) return 'story';
  return inheritedZone;
}

export function isWorkspaceTab(path: string | null): boolean {
  return Boolean(
    path &&
      (path in WORKSPACE_TAB_LABELS ||
        path.startsWith(WORKSPACE_TAB_CHARACTER_PREFIX) ||
        path.startsWith(WORKSPACE_TAB_LORE_ENTRY_PREFIX) ||
        path.startsWith(WORKSPACE_TAB_VOLUME_PREFIX))
  );
}

export function getWorkspaceTabLabel(path: string): string | null {
  return WORKSPACE_TAB_LABELS[path] || null;
}

export function createCharacterWorkspaceTab(character: Pick<Character, 'id'>): string {
  return `${WORKSPACE_TAB_CHARACTER_PREFIX}${character.id}`;
}

export function parseCharacterWorkspaceTab(path: string | null): number | null {
  if (!path?.startsWith(WORKSPACE_TAB_CHARACTER_PREFIX)) return null;
  const id = Number(path.slice(WORKSPACE_TAB_CHARACTER_PREFIX.length));
  return Number.isFinite(id) ? id : null;
}

export function createLoreWorkspaceTab(entry: Pick<LoreEntry, 'id'>): string {
  return `${WORKSPACE_TAB_LORE_ENTRY_PREFIX}${entry.id}`;
}

export function parseLoreWorkspaceTab(path: string | null): number | null {
  if (!path?.startsWith(WORKSPACE_TAB_LORE_ENTRY_PREFIX)) return null;
  const id = Number(path.slice(WORKSPACE_TAB_LORE_ENTRY_PREFIX.length));
  return Number.isFinite(id) ? id : null;
}

export function createVolumeWorkspaceTab(volumePath: string): string {
  return `${WORKSPACE_TAB_VOLUME_PREFIX}${volumePath}`;
}

export function parseVolumeWorkspaceTab(path: string | null): string | null {
  if (!path?.startsWith(WORKSPACE_TAB_VOLUME_PREFIX)) return null;
  return path.slice(WORKSPACE_TAB_VOLUME_PREFIX.length) || null;
}

export function isUntitledWritingTab(path: string | null): boolean {
  return typeof path === 'string' && path.startsWith('__untitled__:');
}

export function isStoryFilePath(path: string | null): boolean {
  if (!path || path.startsWith('__')) return false;
  const normalized = normalizePath(path);
  return STORY_FILE_EXTENSIONS.some((ext) => normalized.endsWith(ext));
}

export function shouldEnableChapterAssistant(path: string | null): boolean {
  return isUntitledWritingTab(path) || isStoryFilePath(path);
}

function partitionWorkspaceFiles(
  nodes: FileNode[],
  inheritedZone: 'story' | 'material' | null = null
): {
  storyNodes: FileNode[];
  materialNodes: FileNode[];
} {
  const storyNodes: FileNode[] = [];
  const materialNodes: FileNode[] = [];

  nodes.forEach((node) => {
    if (node.type === 'directory') {
      const zone = classifyDirectoryZone(node.name, inheritedZone);
      const partitioned = partitionWorkspaceFiles(node.children || [], zone);

      if (zone === 'story') {
        storyNodes.push({
          ...node,
          children: partitioned.storyNodes,
        });
        return;
      }

      if (zone === 'material') {
        materialNodes.push({
          ...node,
          children: partitioned.materialNodes,
        });
        return;
      }

      if (partitioned.storyNodes.length > 0) {
        storyNodes.push({
          ...node,
          children: partitioned.storyNodes,
        });
      }
      if (partitioned.materialNodes.length > 0) {
        materialNodes.push({
          ...node,
          children: partitioned.materialNodes,
        });
      }
      return;
    }

    if (isStoryFilePath(node.path) && inheritedZone !== 'material') {
      storyNodes.push(node);
      return;
    }

    materialNodes.push(node);
  });

  return { storyNodes, materialNodes };
}

export function splitWorkspaceFiles(nodes: FileNode[]): {
  storyNodes: FileNode[];
  materialNodes: FileNode[];
} {
  return partitionWorkspaceFiles(nodes);
}

export function flattenFileNodes(nodes: FileNode[]): FileNode[] {
  const result: FileNode[] = [];
  nodes.forEach((node) => {
    if (node.type === 'file') {
      result.push(node);
      return;
    }
    result.push(...flattenFileNodes(node.children || []));
  });
  return result;
}

export function createChapterMaterialsStorageKey(path: string | null): string | null {
  if (!path || path.startsWith('__')) return null;
  return `novel-editor:chapter-materials:${path}`;
}

export function createStoryOrderStorageKey(folderPath: string | null): string | null {
  if (!folderPath || folderPath.startsWith('__')) return null;
  return `novel-editor:story-order:${folderPath}`;
}

export function createAssistantArtifactStorageKey(
  artifact: AssistantArtifactKind,
  scopeKind: AssistantScopeKind,
  scopePath: string | null
): string | null {
  if (!scopePath || scopePath.startsWith('__')) return null;
  return `novel-editor:assistant-artifact:${artifact}:${scopeKind}:${scopePath}`;
}
