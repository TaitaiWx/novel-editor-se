/**
 * 示例数据（sample-data）位置
 *
 * - userSamplePath：拷贝到「文稿/Novel Editor/sample-data」供用户编辑（测试模式下文稿目录已被隔离）
 * - sourcePath：随应用分发的原始示例；打包后位于 resources/sample-data，
 *   开发态 `electron .` 的 appPath 是 apps/pc，示例在 apps/pc/sample-data（兼容 appPath 指向 dist 时再向上一级）
 */
import { app } from 'electron';
import { existsSync } from 'fs';
import path from 'path';
import { syncSeededDirectory, type SeedSyncResult } from '@novel-editor/core';

/** 用户可编辑的示例项目目录（文稿/Novel Editor/sample-data） */
export function getUserSampleDataPath(): string {
  return path.join(app.getPath('documents'), 'Novel Editor', 'sample-data');
}

export function getSampleDataPaths(): { userSamplePath: string; sourcePath: string } {
  const userSamplePath = getUserSampleDataPath();
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'sample-data')]
    : [
        path.join(app.getAppPath(), 'sample-data'),
        path.join(path.resolve(app.getAppPath(), '..'), 'sample-data'),
      ];
  const sourcePath = candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
  return { userSamplePath, sourcePath };
}

// ─── 版本同步 ───────────────────────────────────────────────────────────────

let syncPromise: Promise<SeedSyncResult | null> | null = null;
let pendingUpgradeNotice: { backupPath: string } | null = null;

/**
 * 启动时（以及打开示例前）同步一次示例数据：内置示例版本更高时，旧副本整体备份后换成新版。
 * 同一进程内只执行一次，并发调用共享同一个 Promise；失败只记录日志，不影响启动
 */
export function syncSampleData(): Promise<SeedSyncResult | null> {
  if (!syncPromise) {
    const { userSamplePath, sourcePath } = getSampleDataPaths();
    syncPromise = syncSeededDirectory(userSamplePath, sourcePath)
      .then((result) => {
        if (result.status === 'upgraded' && result.backupPath) {
          pendingUpgradeNotice = { backupPath: result.backupPath };
          console.info(
            `[sample-data] 示例作品集已升级到 v${result.version}，旧版备份: ${result.backupPath}`
          );
        }
        return result;
      })
      .catch((error: unknown) => {
        console.warn('[sample-data] 同步示例数据失败:', error);
        return null;
      });
  }
  return syncPromise;
}

/** 取出（并清空）本次启动的示例升级提示，供渲染进程展示一次 */
export function takeSampleUpgradeNotice(): { backupPath: string } | null {
  const notice = pendingUpgradeNotice;
  pendingUpgradeNotice = null;
  return notice;
}

/** 测试用：重置进程内的同步状态 */
export function resetSampleDataSyncForTests(): void {
  syncPromise = null;
  pendingUpgradeNotice = null;
}
