/**
 * 应用菜单命令在渲染进程中用到的纯函数（便于单测）
 */
import type { UpdateStatus } from '@/render/types/electron-api';

export type MenuNoticeType = 'success' | 'info' | 'warning' | 'error';

export interface MenuNotice {
  type: MenuNoticeType;
  message: string;
}

/** 「检查更新…」完成后的提示文案 */
export function describeManualUpdateCheck(status: UpdateStatus | null | undefined): MenuNotice {
  if (!status) return { type: 'error', message: '检查更新失败：无法获取更新状态' };
  if (status.lastError) return { type: 'warning', message: `检查更新：${status.lastError}` };
  if (status.updateReady && status.downloadedVersion) {
    return {
      type: 'success',
      message: `新版本 ${status.downloadedVersion} 已下载，${status.recovery?.authorization === 'system-prompt' ? '重启安装时需要系统授权' : '重启后即可完成更新'}`,
    };
  }
  if (status.availableVersion) {
    return { type: 'info', message: `发现新版本 ${status.availableVersion}，正在后台下载` };
  }
  if (status.checking) return { type: 'info', message: '正在检查更新…' };
  return {
    type: 'success',
    message: status.currentVersion
      ? `当前已是最新版本（${status.currentVersion}）`
      : '当前已是最新版本',
  };
}

/** 拆分父目录与文件名，兼容 / 与 \ 分隔符 */
export function splitFilePath(filePath: string): { dir: string; name: string; sep: string } {
  const index = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (index < 0) return { dir: '', name: filePath, sep: '/' };
  return { dir: filePath.slice(0, index), name: filePath.slice(index + 1), sep: filePath[index] };
}

/** 另存为的默认文件名：「第一章.md」→「第一章 副本.md」 */
export function buildSaveAsDefaultName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return `${fileName} 副本`;
  return `${fileName.slice(0, dot)} 副本${fileName.slice(dot)}`;
}

/** 校验另存为输入的文件名，返回错误提示；合法时返回 null */
export function validateSaveAsName(name: string): string | null {
  if (!name) return '文件名不能为空';
  if (/[\\/]/.test(name)) return '文件名不能包含路径分隔符';
  if (name === '.' || name === '..') return '文件名不合法';
  return null;
}
