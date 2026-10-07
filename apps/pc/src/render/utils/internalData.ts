/**
 * 渲染进程的内部数据入口（判定规则见 core internal-data）：
 * 作者从任何地方「打开」内部数据时，转到对应的可视化界面，而不是在编辑器里显示原始 JSON
 */
import { MEMORY_SHEETS_DIR } from '@novel-editor/core/growth';
import {
  INTERNAL_DATA_OWNER_LABELS,
  SCENE_STATE_FILE,
  classifyWorkspacePath,
  isSceneVideoDirPath,
  sceneStateFilePath,
  type InternalDataOwner,
  type WorkspaceEntryClassification,
} from '@novel-editor/core/internal-data';

export { INTERNAL_DATA_OWNER_LABELS };
export type { InternalDataOwner };

/** 打开内部数据时的去向 */
export type InternalOpenTarget =
  | { kind: 'scene-video'; stateFile: string }
  | { kind: 'growth'; character: string | null }
  | { kind: 'blocked'; owner: InternalDataOwner };

function baseName(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] ?? '';
}

function parentPath(filePath: string): string {
  return filePath.replace(/[\\/][^\\/]*$/, '');
}

export function classifyPath(
  filePath: string | null | undefined,
  root: string | null | undefined
): WorkspaceEntryClassification {
  if (!filePath || filePath.startsWith('__')) return { kind: 'user' };
  return classifyWorkspacePath(filePath, root);
}

/** 内部数据（不在编辑器里显示原文） */
export function isInternalDataFile(
  filePath: string | null | undefined,
  root: string | null | undefined
): boolean {
  return classifyPath(filePath, root).kind === 'internal';
}

/** 派生的可读摘要：显示但只读 */
export function isReadOnlyDataFile(
  filePath: string | null | undefined,
  root: string | null | undefined
): boolean {
  return classifyPath(filePath, root).kind === 'derived';
}

/**
 * 打开路径时的去向；普通文件返回 null（照常打开）。
 * isSceneVideoDir：该路径是资料树里标记为场景视频的目录
 */
export function resolveInternalOpenTarget(
  filePath: string,
  root: string | null | undefined,
  isSceneVideoDir = false
): InternalOpenTarget | null {
  if (isSceneVideoDir && isSceneVideoDirPath(filePath)) {
    return { kind: 'scene-video', stateFile: sceneStateFilePath(filePath) };
  }
  const classification = classifyPath(filePath, root);
  if (classification.kind !== 'internal' || !classification.owner) return null;
  const name = baseName(filePath);
  if (classification.owner === 'scene-video' && name === SCENE_STATE_FILE) {
    return { kind: 'scene-video', stateFile: filePath };
  }
  if (classification.owner === 'growth') {
    // 角色/<角色名>.json → 该角色的成长档案；规则 / 队伍 / 地图 → 成长总览
    const inSheets = baseName(parentPath(filePath)) === MEMORY_SHEETS_DIR;
    return { kind: 'growth', character: inSheets ? name.replace(/\.json$/i, '') : null };
  }
  return { kind: 'blocked', owner: classification.owner };
}

/** 友好提示文案：「这是软件内部数据，请在 XX 中查看」 */
export function internalDataMessage(owner: InternalDataOwner | undefined): string {
  const where = owner ? INTERNAL_DATA_OWNER_LABELS[owner] : '对应的界面';
  return `这是软件内部数据，请在「${where}」中查看`;
}
