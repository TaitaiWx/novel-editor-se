/**
 * 正文树结构：把文件树整理成「项目文档 + 作品 / 卷 / 章」
 *
 * - `ne init` 项目（有 .novel-editor/config.json，见 core `readProjectLayout`）：
 *   novelsDir 下每个作品目录是一个「作品」，其子目录是「卷」，正文文件是「章」，
 *   与 CLI `ne novel list` / `ne chapter list` 同一口径；novelsDir 容器本身不展示。
 *   项目根目录下的文档（欢迎使用.md、README.md）是「项目文档」，不算章节。
 * - 普通文件夹：沿用按名称猜测的卷 / 正文夹 / 稿夹规则，未归卷的内容收进「未分卷」；
 *   根目录下的说明文档只在规则明确时才算项目文档（见 `isLooseProjectDocument`）。
 */
import {
  compareChapterFileNames,
  compareVolumeDirNames,
  isChapterLikeFileName,
  isProjectDocumentName,
} from '@novel-editor/core/story-layout';
import type { FileNode, WorkspaceProjectLayout } from '../types';
import {
  buildStoryDisplayNodes,
  flattenFileNodes,
  isStoryFilePath,
  isVolumeLikeStoryName,
  sortStoryNodesForDisplay,
  type SplitWorkspaceOptions,
  type StoryOrderMap,
} from './workspace';

/** 正文树节点的明确类型（项目模式下由结构决定，普通文件夹按名称推断时为 undefined） */
export type StoryNodeKind = 'work' | 'volume' | 'chapter' | 'document';

export interface StoryDisplayNode extends FileNode {
  storyKind?: StoryNodeKind;
  children?: StoryDisplayNode[];
}

export interface StoryStructure {
  /** project：按 `ne init` 项目结构展示；folder：普通文件夹 */
  mode: 'project' | 'folder';
  /** 正文分区的顶层节点（作品 / 卷 / 未分卷 …） */
  displayNodes: StoryDisplayNode[];
  /** 项目文档（根目录下的说明文档），不算章节 */
  projectDocs: FileNode[];
  /** 普通文件夹中承接未归卷正文的「未分卷」虚拟节点（不含项目文档）；项目模式为 null */
  unassignedNode: FileNode | null;
  /** 作品节点的父目录（拖拽排序作品时使用）；普通文件夹为 null */
  worksParentPath: string | null;
}

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

function samePath(left: string, right: string): boolean {
  return normalize(left).toLowerCase() === normalize(right).toLowerCase();
}

function joinPath(base: string, name: string): string {
  const separator = base.includes('\\') && !base.includes('/') ? '\\' : '/';
  return `${base.replace(/[\\/]+$/, '')}${separator}${name}`;
}

/** 项目模式下作品目录的绝对路径（与 core listNovelNames 的顺序一致） */
export function getWorkPaths(layout: WorkspaceProjectLayout): string[] {
  return layout.novels.map((name) => joinPath(layout.novelsPath, name));
}

/** splitWorkspaceFiles 的参数：项目模式下作品目录整体视为正文 */
export function getSplitWorkspaceOptions(
  layout: WorkspaceProjectLayout | null | undefined
): SplitWorkspaceOptions {
  if (!layout) return {};
  return { storyRoots: getWorkPaths(layout) };
}

function isRootLevel(node: FileNode, folderPath: string): boolean {
  const target = normalize(node.path);
  const root = normalize(folderPath);
  return target.startsWith(`${root}/`) && !target.slice(root.length + 1).includes('/');
}

function containsStoryFile(node: FileNode): boolean {
  return flattenFileNodes([node]).some((item) => isStoryFilePath(item.path));
}

/**
 * 普通文件夹的根目录文档是否算项目文档（保守规则）：
 * 1. README / 欢迎使用 这类常见说明文档名一律算（与 core `isProjectDocumentPath` 一致）
 * 2. 其他文档只有在「根目录没有任何像章节的文件、且有子目录装着正文」时才算，
 *    例如根目录的 灵感.md 与 第一卷/第一章.md 并存；根目录本身就放章节的文件夹不受影响
 */
function collectLooseProjectDocs(storyNodes: FileNode[]): Set<FileNode> {
  const rootFiles = storyNodes.filter((node) => node.type === 'file');
  const docs = new Set(rootFiles.filter((node) => isProjectDocumentName(node.name)));
  const hasChapterLikeRootFile = rootFiles.some(
    (node) => !docs.has(node) && isChapterLikeFileName(node.name)
  );
  const hasStoryFolder = storyNodes.some(
    (node) => node.type === 'directory' && containsStoryFile(node)
  );
  if (!hasChapterLikeRootFile && hasStoryFolder) {
    rootFiles.forEach((node) => docs.add(node));
  }
  return docs;
}

function compareProjectStoryNodes(
  left: FileNode,
  right: FileNode,
  parentPath: string,
  storyOrderMap: StoryOrderMap
): number {
  const manualOrder = storyOrderMap[parentPath] || [];
  const leftIndex = manualOrder.indexOf(left.path);
  const rightIndex = manualOrder.indexOf(right.path);
  if (leftIndex >= 0 && rightIndex >= 0 && leftIndex !== rightIndex) return leftIndex - rightIndex;
  if (leftIndex >= 0 && rightIndex < 0) return -1;
  if (leftIndex < 0 && rightIndex >= 0) return 1;
  // 与 core listChapters 相同：作品根目录的章节在前，然后按卷序号（支持中文数字）
  if (left.type !== right.type) return left.type === 'file' ? -1 : 1;
  return left.type === 'file'
    ? compareChapterFileNames(left.name, right.name)
    : compareVolumeDirNames(left.name, right.name);
}

function buildWorkChildren(
  nodes: FileNode[],
  parentPath: string,
  storyOrderMap: StoryOrderMap
): StoryDisplayNode[] {
  return nodes
    .filter((node) => node.type === 'directory' || isStoryFilePath(node.path))
    .map(
      (node): StoryDisplayNode =>
        node.type === 'directory'
          ? {
              ...node,
              storyKind: 'volume',
              children: buildWorkChildren(node.children || [], node.path, storyOrderMap),
            }
          : { ...node, storyKind: 'chapter' }
    )
    .sort((left, right) => compareProjectStoryNodes(left, right, parentPath, storyOrderMap));
}

function findNode(nodes: FileNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (samePath(node.path, path)) return node;
    if (node.type === 'directory' && node.children?.length) {
      const found = findNode(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

function buildProjectStructure(
  storyNodes: FileNode[],
  folderPath: string,
  layout: WorkspaceProjectLayout,
  storyOrderMap: StoryOrderMap
): StoryStructure {
  const workPaths = getWorkPaths(layout);
  const works: StoryDisplayNode[] = [];
  workPaths.forEach((workPath) => {
    const node = findNode(storyNodes, workPath);
    if (node?.type !== 'directory') return;
    works.push({
      ...node,
      storyKind: 'work',
      children: buildWorkChildren(node.children || [], node.path, storyOrderMap),
    });
  });
  const worksParentPath = layout.novelsPath;
  const manualWorkOrder = storyOrderMap[worksParentPath] || [];
  works.sort((left, right) => {
    const leftIndex = manualWorkOrder.indexOf(left.path);
    const rightIndex = manualWorkOrder.indexOf(right.path);
    if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
    if (leftIndex >= 0 || rightIndex >= 0) return leftIndex >= 0 ? -1 : 1;
    return workPaths.indexOf(left.path) - workPaths.indexOf(right.path);
  });

  const projectDocs = storyNodes.filter(
    (node) => node.type === 'file' && isRootLevel(node, folderPath)
  );

  // 作品之外的其他正文目录（例如根目录的「大纲」）：保持原样展示在作品之后，不算任何作品的章节
  const isWorkOrContainer = (node: FileNode) =>
    samePath(node.path, layout.novelsPath) || workPaths.some((path) => samePath(path, node.path));
  const leftovers: FileNode[] = [];
  const collectLeftovers = (nodes: FileNode[]) => {
    nodes.forEach((node) => {
      if (node.type === 'file') {
        if (!isRootLevel(node, folderPath)) leftovers.push(node);
        return;
      }
      if (isWorkOrContainer(node)) {
        // 作品根目录（novelsDir）中不属于任何作品的内容
        if (samePath(node.path, layout.novelsPath)) {
          collectLeftovers((node.children || []).filter((child) => !isWorkOrContainer(child)));
        }
        return;
      }
      leftovers.push(node);
    });
  };
  collectLeftovers(storyNodes);

  return {
    mode: 'project',
    displayNodes: [...works, ...sortStoryNodesForDisplay(leftovers, folderPath, storyOrderMap)],
    projectDocs: sortByName(projectDocs),
    unassignedNode: null,
    worksParentPath,
  };
}

function sortByName(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((left, right) => compareChapterFileNames(left.name, right.name));
}

/**
 * 构建正文分区的展示结构。
 * storyNodes 来自 `splitWorkspaceFiles(files, getSplitWorkspaceOptions(layout))`。
 */
export function buildStoryStructure(
  storyNodes: FileNode[],
  folderPath: string | null,
  layout: WorkspaceProjectLayout | null | undefined,
  storyOrderMap: StoryOrderMap = {}
): StoryStructure {
  if (folderPath && layout) {
    return buildProjectStructure(storyNodes, folderPath, layout, storyOrderMap);
  }

  const docs = collectLooseProjectDocs(storyNodes);
  const remaining = storyNodes.filter((node) => !docs.has(node));
  const displayNodes = buildStoryDisplayNodes(remaining, folderPath, storyOrderMap);
  const unassignedNode =
    folderPath && displayNodes.length > 0
      ? (displayNodes.find(
          (node) => node.path === folderPath && !isVolumeLikeStoryName(node.name)
        ) ?? null)
      : null;
  return {
    mode: 'folder',
    displayNodes,
    projectDocs: sortByName([...docs]),
    unassignedNode,
    worksParentPath: null,
  };
}

/** 项目文档路径集合（用于把它们排除在章节助手、章节统计之外） */
export function getProjectDocPathSet(structure: StoryStructure): ReadonlySet<string> {
  return new Set(structure.projectDocs.map((node) => node.path));
}

/** 路径所在的作品目录（项目模式）；不在任何作品中时返回 null */
export function findContainingWorkPath(
  layout: WorkspaceProjectLayout | null | undefined,
  path: string | null
): string | null {
  if (!layout || !path) return null;
  const target = normalize(path).toLowerCase();
  return (
    getWorkPaths(layout).find((workPath) => {
      const work = normalize(workPath).toLowerCase();
      return target === work || target.startsWith(`${work}/`);
    }) ?? null
  );
}

/**
 * 项目模式下新建卷 / 章的默认目录：当前打开内容所在的作品，否则第一部作品；
 * 没有作品（或普通文件夹）时返回 null，由调用方回退到项目根目录
 */
export function resolveDefaultWorkPath(
  layout: WorkspaceProjectLayout | null | undefined,
  activePath: string | null
): string | null {
  if (!layout) return null;
  return findContainingWorkPath(layout, activePath) ?? getWorkPaths(layout)[0] ?? null;
}
