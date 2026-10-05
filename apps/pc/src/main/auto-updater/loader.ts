/** electron-updater 的懒加载与配置 */
import type { AppUpdater } from 'electron-updater';
import log from 'electron-log/main';
import type { UpdateChannel } from '../auto-updater-state';
import { getDeviceId } from '../device-id';
import { mapUpdateChannel } from './channel';
import { MIRROR_UPDATE_URL } from './constants';

let autoUpdaterInstance: AppUpdater | null = null;
let autoUpdaterLoadPromise: Promise<AppUpdater | null> | null = null;
let autoUpdaterUnavailableReason: string | null = null;

/** 自动更新模块加载失败的原因（未失败时为 null） */
export function getAutoUpdaterUnavailableReason() {
  return autoUpdaterUnavailableReason;
}

export function getUpdaterUnavailableMessage() {
  if (!autoUpdaterUnavailableReason) {
    return '自动更新模块不可用，已降级为仅手动下载安装新版本';
  }
  return `自动更新模块不可用，已降级为仅手动下载安装新版本：${autoUpdaterUnavailableReason}`;
}

export async function getAutoUpdater(): Promise<AppUpdater | null> {
  if (autoUpdaterInstance) {
    return autoUpdaterInstance;
  }

  if (autoUpdaterUnavailableReason) {
    return null;
  }

  if (!autoUpdaterLoadPromise) {
    autoUpdaterLoadPromise = import('electron-updater')
      .then((module) => {
        const updaterModule = module as {
          autoUpdater?: AppUpdater;
          default?: { autoUpdater?: AppUpdater };
        };
        const resolvedUpdater = updaterModule.autoUpdater ?? updaterModule.default?.autoUpdater;
        if (!resolvedUpdater) {
          throw new Error('electron-updater 未导出可用的 autoUpdater');
        }
        autoUpdaterInstance = resolvedUpdater;
        return resolvedUpdater;
      })
      .catch((error) => {
        autoUpdaterUnavailableReason =
          error instanceof Error ? error.message : String(error || '未知错误');
        console.error('加载自动更新模块失败:', error);
        return null;
      });
  }

  return autoUpdaterLoadPromise;
}

export function configureAutoUpdater(updater: AppUpdater, channel: UpdateChannel) {
  const mappedChannel = mapUpdateChannel(channel);
  updater.autoDownload = true;
  // oneClick: true NSIS 不运行卸载程序，直接覆盖文件，静默安装安全可靠。
  updater.autoInstallOnAppQuit = true;
  updater.allowPrerelease = mappedChannel !== 'latest';
  updater.allowDowngrade = true;
  updater.channel = mappedChannel;
  updater.logger = log;

  // 使用镜像服务器检查更新：避免私有仓库 404，且国内可用
  updater.setFeedURL({
    provider: 'generic',
    url: MIRROR_UPDATE_URL,
    requestHeaders: { 'X-Device-Id': getDeviceId() },
  });
}

export function configureUpdaterLogger() {
  log.initialize();
  log.transports.file.level = 'info';
}
