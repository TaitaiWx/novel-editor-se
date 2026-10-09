import { registerWorkspaceHandler } from '../workspace-ipc';
/**
 * 正文结构规则 IPC：project-structure-get / project-structure-set（「设置 → 正文结构」）
 *
 * - 读写交给 core structure-config（与 CLI `ne structure` 同一份文件）
 * - 不信任渲染进程：folderPath 必须是存在的绝对目录，且（解析符号链接后）等于该窗口已上报的工作区根；
 *   写入还要求窗口已上报工作区；配置按 core assertValidStructureConfig 严格校验（预设白名单、正则安全检查）
 * - 保存成功后向所有窗口广播 project-structure-changed，打开的编辑器立即按新规则刷新
 */
import { BrowserWindow } from 'electron';
import { realpath, stat } from 'fs/promises';
import path from 'path';
import {
  readStructureConfig,
  writeStructureConfig,
  type StructureConfigReadResult,
} from '@novel-editor/core';
import {
  PROJECT_STRUCTURE_CHANGED,
  PROJECT_STRUCTURE_GET,
  PROJECT_STRUCTURE_SET,
  type ProjectStructureChangedEvent,
  type ProjectStructureInfo,
  type ProjectStructureResult,
} from '../../shared/project-structure';
import { isPathInWorkspace } from './database/workspace-path';
import { getWorkspaceRootForSender } from './session';

/** 配置 JSON 的大小上限（30 条规则 × 200 字符远小于此） */
const MAX_PAYLOAD_CHARS = 32 * 1024;

function isSameFolder(a: string, b: string): boolean {
  return isPathInWorkspace(a, b) && isPathInWorkspace(b, a);
}

/** 校验 folderPath：存在的绝对目录；窗口已上报工作区时必须就是该工作区（requireWorkspace 时必须已上报） */
export async function assertStructureFolder(
  raw: unknown,
  workspaceRoot: string | null,
  requireWorkspace: boolean
): Promise<string> {
  if (typeof raw !== 'string' || !raw.trim() || !path.isAbsolute(raw)) {
    throw new Error('无效的文件夹路径');
  }
  const resolved = path.resolve(raw);
  const info = await stat(resolved).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`文件夹不存在: ${resolved}`);
  if (!workspaceRoot) {
    if (requireWorkspace) throw new Error('项目还在加载，请稍后再保存');
    return resolved;
  }
  const [realFolder, realRoot] = await Promise.all([
    realpath(resolved),
    realpath(workspaceRoot).catch(() => workspaceRoot),
  ]);
  if (!isSameFolder(realFolder, realRoot)) throw new Error('只能修改当前打开的项目的正文结构');
  return resolved;
}

function toInfo(folderPath: string, result: StructureConfigReadResult): ProjectStructureInfo {
  return {
    folderPath,
    config: result.config,
    location: result.location.kind,
    file: result.location.file,
    stored: result.stored,
    warnings: result.warnings,
  };
}

async function guard(task: () => Promise<ProjectStructureInfo>): Promise<ProjectStructureResult> {
  try {
    return { ok: true, data: await task() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function broadcast(event: ProjectStructureChangedEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(PROJECT_STRUCTURE_CHANGED, event);
  }
}

export function registerProjectStructureHandlers(
  workspaceRootFor: (senderId: number | undefined) => string | null = getWorkspaceRootForSender
): void {
  registerWorkspaceHandler(PROJECT_STRUCTURE_GET, (event, folderPath: unknown) =>
    guard(async () => {
      const folder = await assertStructureFolder(
        folderPath,
        workspaceRootFor(event?.sender?.id),
        false
      );
      return toInfo(folder, await readStructureConfig(folder));
    })
  );
  registerWorkspaceHandler(PROJECT_STRUCTURE_SET, (event, folderPath: unknown, config: unknown) =>
    guard(async () => {
      const folder = await assertStructureFolder(
        folderPath,
        workspaceRootFor(event?.sender?.id),
        true
      );
      let size = 0;
      try {
        size = JSON.stringify(config ?? null).length;
      } catch {
        throw new Error('结构配置格式不正确');
      }
      if (size > MAX_PAYLOAD_CHARS) throw new Error('结构配置过大');
      const info = toInfo(folder, await writeStructureConfig(folder, config));
      broadcast({ folderPath: folder, config: info.config });
      return info;
    })
  );
}
