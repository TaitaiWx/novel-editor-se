/**
 * 当前作品（作品作用域）：角色、设定、成长档案、资料都跟随作品（与 core work-scope.ts 同一规则）
 *
 * - `ne init` 项目：作用域是 `<novelsDir>/<作品>/`；项目根还有旧版 `资料/` 或旧版人物 / 设定等
 *   数据库内容时，额外提供「未归属」作用域（路径为项目根），让旧数据继续可见
 * - 普通文件夹：整个文件夹就是一部作品，作用域即文件夹本身（与旧行为一致）
 *
 * 纯函数，不依赖 DOM；上次选择的作品按项目保存在 localStorage。
 */
import type { WorkspaceProjectLayout } from '../types';
import { getWorkPaths } from './storyStructure';

/** 旧版项目根资料 / 数据（不属于任何作品）的分组名，与 core UNASSIGNED_WORK_NAME 一致 */
export const UNASSIGNED_WORK_LABEL = '未归属';

export type WorkScopeKind = 'work' | 'unassigned' | 'folder';

export interface WorkScopeOption {
  kind: WorkScopeKind;
  name: string;
  /** 作用域根目录：数据库按它区分作品，资料在 `<path>/资料/`，记忆库在 `<path>/资料/记忆/` */
  path: string;
}

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function isSameWorkPath(left: string | null, right: string | null): boolean {
  return Boolean(left && right && normalize(left) === normalize(right));
}

function basename(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || path
  );
}

/**
 * 可切换的作用域：项目模式下为各作品 +（有旧数据时）「未归属」；普通文件夹只有它自己。
 */
export function listWorkScopeOptions(
  folderPath: string | null,
  layout: WorkspaceProjectLayout | null | undefined,
  unassignedRecords = false
): WorkScopeOption[] {
  if (!folderPath) return [];
  if (!layout) return [{ kind: 'folder', name: basename(folderPath), path: folderPath }];
  const works = getWorkPaths(layout).map(
    (path, index): WorkScopeOption => ({ kind: 'work', name: layout.novels[index], path })
  );
  if (layout.hasProjectMaterials || unassignedRecords || works.length === 0) {
    works.push({ kind: 'unassigned', name: UNASSIGNED_WORK_LABEL, path: folderPath });
  }
  return works;
}

/** 当前作用域：优先使用作者选择的作品，失效时回退到第一部作品（没有作品时为项目根） */
export function resolveWorkScope(
  options: WorkScopeOption[],
  preferredPath: string | null
): WorkScopeOption | null {
  if (options.length === 0) return null;
  return options.find((option) => isSameWorkPath(option.path, preferredPath)) ?? options[0];
}

/** 文件所在的作品作用域；不属于任何作品时返回 null（不切换） */
export function findWorkScopeForPath(
  options: WorkScopeOption[],
  filePath: string | null
): WorkScopeOption | null {
  if (!filePath || filePath.startsWith('__')) return null;
  const target = normalize(filePath);
  return (
    options.find((option) => {
      if (option.kind !== 'work') return false;
      const root = normalize(option.path);
      return target === root || target.startsWith(`${root}/`);
    }) ?? null
  );
}

const STORAGE_PREFIX = 'novel-editor:current-work:';

export function readStoredWorkPath(folderPath: string | null): string | null {
  if (!folderPath) return null;
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${folderPath}`);
  } catch {
    return null;
  }
}

export function storeWorkPath(folderPath: string | null, workPath: string | null): void {
  if (!folderPath) return;
  try {
    const key = `${STORAGE_PREFIX}${folderPath}`;
    if (workPath) window.localStorage.setItem(key, workPath);
    else window.localStorage.removeItem(key);
  } catch {
    // 存储不可用时只是不记住选择
  }
}

// ─── 按作品筛选文件树（文件面板「正文 / 资料」分区） ────────────────────────────

interface TreeNode {
  path: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
}

function findTreeNode<T extends TreeNode>(nodes: T[], path: string): T | null {
  for (const node of nodes) {
    if (isSameWorkPath(node.path, path)) return node;
    if (node.type === 'directory' && node.children?.length) {
      const found = findTreeNode(node.children as T[], path);
      if (found) return found;
    }
  }
  return null;
}

/** 去掉作品目录（以及只装作品的 novelsDir 容器），剩下不属于任何作品的内容 */
function withoutWorks<T extends TreeNode>(
  nodes: T[],
  workPaths: string[],
  novelsPath: string | null
): T[] {
  const result: T[] = [];
  nodes.forEach((node) => {
    if (workPaths.some((path) => isSameWorkPath(path, node.path))) return;
    if (node.type === 'directory' && novelsPath && isSameWorkPath(node.path, novelsPath)) {
      const rest = withoutWorks((node.children ?? []) as T[], workPaths, novelsPath);
      if (rest.length > 0) result.push({ ...node, children: rest });
      return;
    }
    result.push(node);
  });
  return result;
}

/**
 * 当前作用域在某棵树（资料分区 / 正文分区）中的节点：
 * - 作品：该作品目录的子节点（例如 `资料/`、卷、章）
 * - 未归属：不属于任何作品的节点（项目根的 `资料/`、作品之外的目录）
 * - 普通文件夹 / 没有作用域：整棵树
 */
export function selectWorkScopeNodes<T extends TreeNode>(
  nodes: T[],
  scope: WorkScopeOption | null,
  layout: WorkspaceProjectLayout | null | undefined
): T[] {
  if (!scope || !layout || scope.kind === 'folder') return nodes;
  if (scope.kind === 'work') {
    return (findTreeNode(nodes, scope.path)?.children ?? []) as T[];
  }
  return withoutWorks(nodes, getWorkPaths(layout), layout.novelsPath);
}
