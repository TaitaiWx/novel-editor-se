/**
 * 「关于小说编辑器」IPC Handlers
 *
 * - get-about-info:   名称、版本、发布/更新通道、灰度分组、设备 ID、首次运行与本次启动时间
 * - about-copy-text:  写入系统剪贴板（不依赖渲染进程焦点，点击设备 ID 复制用）
 *
 * 运行环境、数据目录等诊断信息不在界面展示，由 log-upload/diagnostics.ts 写进日志包
 */
import { app, clipboard, ipcMain } from 'electron';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { getDeviceId } from '../device-id';
import { isE2ETestMode } from '../launch-mode';
import { getUpdateStatus } from '../auto-updater';
import {
  APP_DISPLAY_NAME,
  inferReleaseChannel,
  type AboutInfo,
  type AboutRolloutInfo,
  type AboutUpdateChannel,
} from '../../shared/about';

/** 剪贴板写入上限，防止渲染进程塞入超大文本 */
const MAX_CLIPBOARD_TEXT_LENGTH = 64 * 1024;

/** 主进程启动时刻（模块在启动早期加载，用 process.uptime 回推到进程真正启动的时间） */
export const APP_STARTED_AT_MS = Date.now() - Math.round(process.uptime() * 1000);

export function safeGetPath(name: Parameters<typeof app.getPath>[0]): string | null {
  try {
    return app.getPath(name);
  } catch {
    return null;
  }
}

/** 首次运行时间：取 device-id 文件的创建时间（不可用时退回修改时间） */
export async function getFirstRunAt(): Promise<string | null> {
  const userData = safeGetPath('userData');
  if (!userData) return null;
  try {
    const info = await stat(path.join(userData, 'device-id'));
    const birth = info.birthtimeMs > 0 ? info.birthtime : info.mtime;
    return birth.toISOString();
  } catch {
    return null;
  }
}

async function getUpdateSnapshot(
  version: string
): Promise<{ channel: AboutUpdateChannel; rollout: AboutRolloutInfo }> {
  try {
    const status = await getUpdateStatus();
    return {
      channel: status.channel,
      rollout: {
        bucket: status.rolloutBucket,
        percentage: status.rolloutPercentage,
        eligible: status.rolloutEligible,
        canaryEnrolled: status.channel === 'canary',
      },
    };
  } catch {
    // 更新模块不可用时按版本号推断通道
    const releaseChannel = inferReleaseChannel(version);
    const channel: AboutUpdateChannel = releaseChannel === 'alpha' ? 'canary' : releaseChannel;
    return {
      channel,
      rollout: {
        bucket: 0,
        percentage: null,
        eligible: null,
        canaryEnrolled: channel === 'canary',
      },
    };
  }
}

export async function getAboutInfo(): Promise<AboutInfo> {
  const version = app.getVersion();
  // 先确保设备 ID 文件存在，再读取其创建时间
  const deviceId = getDeviceId();
  const [firstRunAt, update] = await Promise.all([getFirstRunAt(), getUpdateSnapshot(version)]);

  return {
    appName: APP_DISPLAY_NAME,
    productName: app.getName(),
    version,
    releaseChannel: inferReleaseChannel(version),
    updateChannel: update.channel,
    rollout: update.rollout,
    deviceId,
    firstRunAt,
    startedAt: new Date(APP_STARTED_AT_MS).toISOString(),
  };
}

export function copyAboutText(text: unknown): { success: boolean } {
  if (typeof text !== 'string' || !text || text.length > MAX_CLIPBOARD_TEXT_LENGTH) {
    return { success: false };
  }
  // E2E 测试不写系统剪贴板，避免覆盖开发者本机剪贴板内容
  if (isE2ETestMode()) {
    lastE2ECopiedText = text;
    return { success: true };
  }
  clipboard.writeText(text);
  return { success: true };
}

/** E2E 模式下最近一次「复制」的文本（不写入系统剪贴板） */
let lastE2ECopiedText: string | null = null;
export function getLastE2ECopiedText(): string | null {
  return lastE2ECopiedText;
}

export function registerAboutHandlers(): void {
  ipcMain.handle('get-about-info', () => getAboutInfo());
  ipcMain.handle('about-copy-text', (_event, text: unknown) => copyAboutText(text));
}
