import { parseChineseInteger } from '@novel-editor/basic-algorithm';
import { GENERATED_MATERIAL_ROOT_NAME, isGeneratedMaterialPath } from '@novel-editor/core/material';
import type { FileNode } from '../types';
import type { Character, LoreEntry } from '../components/RightPanel/types';

export const WORKSPACE_TAB_CHARACTERS = '__workspace__:characters';
export const WORKSPACE_TAB_LORE = '__workspace__:lore';
export const WORKSPACE_TAB_CHARACTER_PREFIX = '__workspace__:character:';
export const WORKSPACE_TAB_LORE_ENTRY_PREFIX = '__workspace__:lore-entry:';
export const WORKSPACE_TAB_VOLUME_PREFIX = '__workspace__:volume:';
/** 成长档案总览（不指定角色） */
export const WORKSPACE_TAB_GROWTH = '__workspace__:growth';
/** 单个角色的成长档案：`__workspace__:growth:<角色名>` */
export const WORKSPACE_TAB_GROWTH_PREFIX = '__workspace__:growth:';
/** 场景视频：`__workspace__:scene-video:<章路径>#<场景>` */
export const WORKSPACE_TAB_SCENE_VIDEO_PREFIX = '__workspace__:scene-video:';

export type AssistantScopeKind = 'project' | 'volume' | 'chapter';
export type AssistantArtifactKind = 'characters' | 'lore' | 'materials';
export type StoryOrderMap = Record<string, string[]>;

export const WORKSPACE_TAB_LABELS: Record<string, string> = {
  [WORKSPACE_TAB_CHARACTERS]: '角色',
  [WORKSPACE_TAB_LORE]: '设定',
  [WORKSPACE_TAB_GROWTH]: '成长档案',
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
  return /(draft|sample|test|outline|note|\u8349\u7a3f|\u6837\u7a3f|\u6d4b\u8bd5|\u7247\u6bb5|\u63d0\u7eb2|\u7075\u611f)/i.test(
    name
  );
}

export function isChapterLikeStoryName(name: string): boolean {
  return /(^\u7b2c[\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07\u96f6\u3007\d]+[\u7ae0\u5e55\u8282\u56de\u7bc7\u96c6])|(^chapter\s*\d+)|(^scene\s*\d+)/i.test(
    stripStoryFileExtension(name)
  );
}

export function isVolumeLikeStoryName(name: string): boolean {
  return /(^\u7b2c[\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07\u96f6\u3007\d]+\u5377)|(^volume\s*\d+)|(^part\s*\d+)|(^act\s*\d+)|(^\u5377[\s_-]?\d+)/i.test(
    stripStoryFileExtension(name)
  );
}

function extractStoryOrder(name: string, type: 'volume' | 'chapter'): number | null {
  const normalized = stripStoryFileExtension(name).trim();
  const patterns =
    type === 'volume'
      ? [
          /^\u7b2c([\d\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07\u96f6\u3007]+)\u5377/i,
          /^volume\s*(\d+)/i,
          /^part\s*(\d+)/i,
          /^act\s*(\d+)/i,
          /^\u5377[\s_-]?(\d+)/i,
        ]
      : [
          /^\u7b2c([\d\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07\u96f6\u3007]+)[\u7ae0\u5e55\u8282\u56de\u7bc7\u96c6]/i,
          /^chapter\s*(\d+)/i,
          /^scene\s*(\d+)/i,
        ];

  for (const pattern of patterns) {
    const matched = normalized.match(pattern);
    if (!matched) continue;
    // 同时支持阿拉伯数字与中文数字（第四章、第一百零三章、第两千章）
    const raw = matched[1];
    const value = /^\d+$/.test(raw) ? Number(raw) : parseChineseInteger(raw);
    if (value !== undefined && Number.isFinite(value)) return value;
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

function classifyDirectoryZone(name: string, inheritedZone: WorkspaceZone): WorkspaceZone {
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
        path.startsWith(WORKSPACE_TAB_VOLUME_PREFIX) ||
        path.startsWith(WORKSPACE_TAB_GROWTH_PREFIX) ||
        path.startsWith(WORKSPACE_TAB_SCENE_VIDEO_PREFIX))
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

/** 成长档案标签：传入角色名时打开该角色，否则打开总览 */
export function createGrowthWorkspaceTab(characterName?: string | null): string {
  const name = characterName?.trim();
  return name ? `${WORKSPACE_TAB_GROWTH_PREFIX}${name}` : WORKSPACE_TAB_GROWTH;
}

export function isGrowthWorkspaceTab(path: string | null): boolean {
  return path === WORKSPACE_TAB_GROWTH || Boolean(path?.startsWith(WORKSPACE_TAB_GROWTH_PREFIX));
}

/** 解析成长档案标签中的角色名；总览或非成长档案标签返回 null */
export function parseGrowthWorkspaceTab(path: string | null): string | null {
  if (!path?.startsWith(WORKSPACE_TAB_GROWTH_PREFIX)) return null;
  return path.slice(WORKSPACE_TAB_GROWTH_PREFIX.length).trim() || null;
}

export interface SceneVideoTabTarget {
  chapterPath: string;
  scene: string;
}

/** 场景名里不允许出现「#」（标签路径用最后一个「#」分隔章路径与场景） */
export function normalizeSceneVideoName(scene: string): string {
  return scene.replace(/#/g, '＃').replace(/\s+/g, ' ').trim();
}

/** 场景视频标签：同一章的同一场景只打开一个标签 */
export function createSceneVideoWorkspaceTab(target: SceneVideoTabTarget): string {
  return `${WORKSPACE_TAB_SCENE_VIDEO_PREFIX}${target.chapterPath}#${normalizeSceneVideoName(
    target.scene
  )}`;
}

export function parseSceneVideoWorkspaceTab(path: string | null): SceneVideoTabTarget | null {
  if (!path?.startsWith(WORKSPACE_TAB_SCENE_VIDEO_PREFIX)) return null;
  const rest = path.slice(WORKSPACE_TAB_SCENE_VIDEO_PREFIX.length);
  const hash = rest.lastIndexOf('#');
  if (hash <= 0) return null;
  const chapterPath = rest.slice(0, hash);
  const scene = rest.slice(hash + 1).trim();
  return chapterPath && scene ? { chapterPath, scene } : null;
}

export function isUntitledWritingTab(path: string | null): boolean {
  return typeof path === 'string' && path.startsWith('__untitled__:');
}

/**
 * 是否为正文文件。传入项目根目录时，位于生成资料目录（`<root>/资料/`，含记忆库）下的
 * 文本文件不算正文，与 core 的 `isGeneratedMaterialPath` 保持同一口径。
 */
export function isStoryFilePath(path: string | null, projectRoot?: string | null): boolean {
  if (!path || path.startsWith('__')) return false;
  const normalized = normalizePath(path);
  if (!STORY_FILE_EXTENSIONS.some((ext) => normalized.endsWith(ext))) return false;
  return !(projectRoot && isGeneratedMaterialPath(path, projectRoot));
}

export function shouldEnableChapterAssistant(
  path: string | null,
  projectRoot?: string | null
): boolean {
  return isUntitledWritingTab(path) || isStoryFilePath(path, projectRoot);
}

type WorkspaceZone = 'story' | 'material' | null;

export interface SplitWorkspaceOptions {
  /**
   * 强制视为正文的目录（`ne init` 项目的作品根目录或各作品目录）：其中的子目录一律是卷、
   * 正文文件一律是章，不再按目录名猜测（避免「素材之王」这类作品名被当成资料目录）
   */
  storyRoots?: readonly string[];
}

function parentPathOf(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '');
  const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  return index > 0 ? normalized.slice(0, index) : normalized;
}

function isWorkMaterialDirectory(node: FileNode, storyRoots: ReadonlySet<string>): boolean {
  return (
    node.name === GENERATED_MATERIAL_ROOT_NAME &&
    storyRoots.has(normalizePath(parentPathOf(node.path)))
  );
}

function partitionWorkspaceFiles(
  nodes: FileNode[],
  inheritedZone: WorkspaceZone,
  storyRoots: ReadonlySet<string>,
  lockedStory: boolean
): {
  storyNodes: FileNode[];
  materialNodes: FileNode[];
} {
  const storyNodes: FileNode[] = [];
  const materialNodes: FileNode[] = [];

  nodes.forEach((node) => {
    if (node.type === 'directory') {
      // 作品自己的资料目录（`<作品>/资料/`，含记忆库）不是卷，归入资料分区
      if (isWorkMaterialDirectory(node, storyRoots)) {
        materialNodes.push(node);
        return;
      }
      const locked = lockedStory || storyRoots.has(normalizePath(node.path));
      const zone = locked ? 'story' : classifyDirectoryZone(node.name, inheritedZone);
      const partitioned = partitionWorkspaceFiles(node.children || [], zone, storyRoots, locked);

      if (zone === 'story') {
        storyNodes.push({
          ...node,
          children: partitioned.storyNodes,
        });
        // 作品目录里的图片等非正文文件仍归入资料分区
        if (locked && partitioned.materialNodes.length > 0) {
          materialNodes.push({ ...node, children: partitioned.materialNodes });
        }
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

export function splitWorkspaceFiles(
  nodes: FileNode[],
  options: SplitWorkspaceOptions = {}
): {
  storyNodes: FileNode[];
  materialNodes: FileNode[];
} {
  const storyRoots = new Set((options.storyRoots ?? []).map(normalizePath));
  return partitionWorkspaceFiles(nodes, null, storyRoots, false);
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
