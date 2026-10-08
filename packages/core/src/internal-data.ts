/**
 * 软件内部数据的唯一判定（纯函数，不依赖 Node / Electron；GUI 渲染进程、主进程与测试共用）
 *
 * 内部数据由软件自己读写（成长档案 JSON、场景视频的分镜状态、AI 出图 / 成片的提示词记录、
 * `.novel-editor/` 下的配置与会话），作者只通过可视化界面处理：
 * - internal：不在资料树、搜索、参考窗格等任何浏览入口出现，编辑器里不显示原文，主进程拒绝通用 write-file 写入
 * - derived：由内部数据重新生成的可读摘要（记忆库 README、角色摘要、人物卡 / 设定快照、分镜.md），
 *   可以看，但只读（每次保存都会重新生成，手改会被覆盖）
 * - user：作者自己的文件（包括作者放在资料里的 .json），照常显示与编辑
 *
 * CLI 与 AI agent 不受影响：它们仍按 docs/ 中的约定直接读写这些文件。
 *
 * 判定只看路径段（相对工作区根目录），文件夹名来自共享常量；不按文件内容猜测。
 */
import { ENTITY_MEDIA_ROOT } from './entity-media';
import {
  MEMORY_CHARACTER_CARDS_DIR,
  MEMORY_DIR_SEGMENTS,
  MEMORY_README_FILE,
  MEMORY_SETTINGS_DIR,
  MEMORY_SHEETS_DIR,
} from './growth/types';

/** 项目元数据目录（与 project.ts 的 PROJECT_META_DIR 相同；project.ts 依赖 Node，这里不能引入） */
export const INTERNAL_PROJECT_META_DIR = '.novel-editor';
/** 资料目录下的视频目录（与 @novel-editor/video 的 VIDEO_MATERIAL_SEGMENTS 第二段相同） */
export const INTERNAL_VIDEO_DIR = '视频';
/** 场景视频工作区状态（与 @novel-editor/video 的 SCENE_STORYBOARD_JSON 相同） */
export const SCENE_STATE_FILE = '分镜.json';
/** 场景视频的可读分镜表（与 @novel-editor/video 的 SCENE_STORYBOARD_MARKDOWN 相同） */
export const SCENE_STORYBOARD_MD_FILE = '分镜.md';
/** AI 出图 / 成片旁边的提示词记录后缀 */
export const PROMPT_RECORD_SUFFIX = '.prompt.json';

export type WorkspaceEntryKind = 'user' | 'internal' | 'derived';

/** 内部数据归属的可视化界面 */
export type InternalDataOwner = 'growth' | 'scene-video' | 'entity-media' | 'project-meta';

export interface WorkspaceEntryClassification {
  kind: WorkspaceEntryKind;
  owner?: InternalDataOwner;
}

/** 归属界面的叫法（友好提示「请在 XX 中查看」） */
export const INTERNAL_DATA_OWNER_LABELS: Record<InternalDataOwner, string> = {
  growth: '成长档案',
  'scene-video': '场景视频',
  'entity-media': '人物 / 设定的图集',
  'project-meta': '设置中心',
};

const USER: WorkspaceEntryClassification = { kind: 'user' };

function splitSegments(value: string): string[] {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment && segment !== '.');
}

function endsWithIgnoreCase(name: string, suffix: string): boolean {
  return name.toLowerCase().endsWith(suffix);
}

/** 资料目录下第 index 段是否是某个子目录（例如 资料/记忆） */
function materialChildAt(segments: string[], index: number, child: string): boolean {
  return segments[index] === MEMORY_DIR_SEGMENTS[0] && segments[index + 1] === child;
}

const MEMORY_DERIVED_DIRS = new Set<string>([
  MEMORY_SHEETS_DIR,
  MEMORY_CHARACTER_CARDS_DIR,
  MEMORY_SETTINGS_DIR,
]);

function classifyMemory(rest: string[]): WorkspaceEntryClassification | null {
  if (rest.length === 0) return null;
  const name = rest[rest.length - 1];
  if (endsWithIgnoreCase(name, '.json')) return { kind: 'internal', owner: 'growth' };
  if (rest.length === 1 && name === MEMORY_README_FILE) return { kind: 'derived', owner: 'growth' };
  if (rest.length === 2 && MEMORY_DERIVED_DIRS.has(rest[0]) && endsWithIgnoreCase(name, '.md')) {
    return { kind: 'derived', owner: 'growth' };
  }
  return null;
}

function classifyVideo(rest: string[]): WorkspaceEntryClassification | null {
  if (rest.length === 0) return null;
  const name = rest[rest.length - 1];
  if (endsWithIgnoreCase(name, PROMPT_RECORD_SUFFIX)) {
    return { kind: 'internal', owner: 'scene-video' };
  }
  // 资料/视频/<章>/<场景>/分镜.json | 分镜.md
  if (rest.length === 3 && name === SCENE_STATE_FILE) {
    return { kind: 'internal', owner: 'scene-video' };
  }
  if (rest.length === 3 && name === SCENE_STORYBOARD_MD_FILE) {
    return { kind: 'derived', owner: 'scene-video' };
  }
  return null;
}

/**
 * 判定工作区条目（文件或目录，路径相对工作区根目录，`/` 或 `\` 分隔均可）
 * 目录本身只有 `.novel-editor` 被视为内部数据；资料 / 记忆、资料 / 视频 等目录照常显示
 */
export function classifyWorkspaceEntry(relativePath: string): WorkspaceEntryClassification {
  const segments = splitSegments(relativePath);
  if (segments.length === 0) return USER;
  if (segments.includes(INTERNAL_PROJECT_META_DIR)) {
    return { kind: 'internal', owner: 'project-meta' };
  }
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (materialChildAt(segments, index, MEMORY_DIR_SEGMENTS[1])) {
      const result = classifyMemory(segments.slice(index + 2));
      if (result) return result;
    } else if (materialChildAt(segments, index, INTERNAL_VIDEO_DIR)) {
      const result = classifyVideo(segments.slice(index + 2));
      if (result) return result;
    } else if (
      segments[index] === ENTITY_MEDIA_ROOT[0] &&
      segments[index + 1] === ENTITY_MEDIA_ROOT[1] &&
      endsWithIgnoreCase(segments[segments.length - 1], PROMPT_RECORD_SUFFIX)
    ) {
      return { kind: 'internal', owner: 'entity-media' };
    }
  }
  return USER;
}

export function isInternalDataPath(relativePath: string): boolean {
  return classifyWorkspaceEntry(relativePath).kind === 'internal';
}

/** 由内部数据重新生成的可读摘要（显示但只读） */
export function isDerivedDataPath(relativePath: string): boolean {
  return classifyWorkspaceEntry(relativePath).kind === 'derived';
}

/** 作者不能直接修改的路径（内部数据 + 派生摘要） */
export function isManagedDataPath(relativePath: string): boolean {
  return classifyWorkspaceEntry(relativePath).kind !== 'user';
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * 绝对路径相对工作区根目录的路径；不在根目录内时返回 null。
 * root 为空时返回原路径（无法确定根目录时按完整路径判定）
 */
export function workspaceRelativePath(
  filePath: string,
  root: string | null | undefined
): string | null {
  const target = normalizePath(filePath);
  if (!root) return target;
  const base = normalizePath(root);
  if (target === base) return '';
  if (!target.startsWith(`${base}/`)) return null;
  return target.slice(base.length + 1);
}

/** 按绝对路径判定（root 为工作区根目录；没有根目录或路径不在根目录内时按完整路径判定） */
export function classifyWorkspacePath(
  filePath: string,
  root: string | null | undefined
): WorkspaceEntryClassification {
  const relative = workspaceRelativePath(filePath, root);
  return classifyWorkspaceEntry(relative ?? normalizePath(filePath));
}

/** 资料/视频/<章>/<场景> 目录（场景视频的工作目录）；路径相对工作区根目录 */
export function isSceneVideoDirPath(relativePath: string): boolean {
  const segments = splitSegments(relativePath);
  const n = segments.length;
  return n >= 4 && materialChildAt(segments, n - 4, INTERNAL_VIDEO_DIR);
}

/** 场景目录中的分镜状态文件路径（沿用目录的分隔符） */
export function sceneStateFilePath(sceneDir: string): string {
  const separator = sceneDir.includes('\\') && !sceneDir.includes('/') ? '\\' : '/';
  return `${sceneDir.replace(/[\\/]+$/, '')}${separator}${SCENE_STATE_FILE}`;
}

/** 文件树节点的最小结构（core FileNode 与渲染进程 FileNode 都满足） */
export interface InternalDataTreeNode<T> {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: T[];
  /** 该目录是一场场景视频（含分镜状态），点击打开画布 */
  sceneVideo?: boolean;
}

/**
 * 从文件树中去掉内部数据，并把装着分镜状态的场景目录标记为 sceneVideo。
 * 不修改传入的节点；没有变化的子树原样复用（保持引用，避免无谓的重渲染）
 */
export function filterInternalDataTree<T extends InternalDataTreeNode<T>>(
  nodes: readonly T[],
  root: string | null | undefined
): T[] {
  let changed = false;
  const result: T[] = [];
  for (const node of nodes) {
    const relative = workspaceRelativePath(node.path, root) ?? normalizePath(node.path);
    if (classifyWorkspaceEntry(relative).kind === 'internal') {
      changed = true;
      continue;
    }
    if (node.type !== 'directory' || !node.children) {
      result.push(node);
      continue;
    }
    const children = filterInternalDataTree(node.children, root);
    const sceneVideo =
      node.sceneVideo === true ||
      (isSceneVideoDirPath(relative) &&
        node.children.some((child) => child.type === 'file' && child.name === SCENE_STATE_FILE));
    if (children === node.children && sceneVideo === Boolean(node.sceneVideo)) {
      result.push(node);
      continue;
    }
    changed = true;
    result.push({ ...node, children, ...(sceneVideo ? { sceneVideo: true } : {}) });
  }
  return changed ? result : (nodes as T[]);
}
