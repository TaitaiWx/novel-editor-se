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
