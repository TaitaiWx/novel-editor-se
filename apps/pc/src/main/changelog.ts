/**
 * 更新日志（release-notes.json）相关的纯逻辑，便于单元测试
 */
import path from 'path';

/**
 * release-notes.json 的候选路径（按优先级）
 *
 * - 打包版：electron-builder 通过 extraResources 放在 resourcesPath 下
 * - 未打包（`electron apps/pc`、pnpm start、E2E）：appPath 即 apps/pc，文件就在其根目录；
 *   兼容 appPath 指向 dist 的启动方式，再回退到上一级目录
 */
export function getReleaseNotesCandidates(options: {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
}): string[] {
  if (options.isPackaged) {
    return [path.join(options.resourcesPath, 'release-notes.json')];
  }
  return [
    path.join(options.appPath, 'release-notes.json'),
    path.join(options.appPath, '..', 'release-notes.json'),
  ];
}

/**
 * 是否属于「刚完成更新」：只有记录过旧版本且与当前版本不同才算。
 * 全新安装（没有记录）不是更新，不应自动弹出更新日志
 */
export function isJustUpdated(previousVersion: string | null, currentVersion: string): boolean {
  return Boolean(previousVersion) && previousVersion !== currentVersion;
}
