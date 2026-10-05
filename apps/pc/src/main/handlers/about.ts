/**
 * 「关于小说编辑器」IPC Handlers
 *
 * - get-about-info:        版本、发布/更新通道、灰度分组、设备 ID、运行时与数据目录
 * - about-open-directory:  在系统文件管理器中打开数据目录（只接受 get-about-info 返回的目录）
 * - about-open-link:       在浏览器中打开仓库 / 更新日志 / 问题反馈（只接受预定义的链接 key）
 * - about-copy-text:       写入系统剪贴板（不依赖渲染进程焦点，复制诊断信息 / 设备 ID 用）
 */
import { app, clipboard, ipcMain, shell } from 'electron';
import { mkdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getDeviceId } from '../device-id';
import { isE2ETestMode } from '../launch-mode';
import { getUserSampleDataPath } from '../sample-data';
import { getUpdateStatus } from '../auto-updater';
import {
  APP_DISPLAY_NAME,
  buildAboutLinks,
  inferReleaseChannel,
  type AboutDirectory,
  type AboutInfo,
  type AboutLinkKey,
  type AboutRolloutInfo,
  type AboutUpdateChannel,
} from '../../shared/about';

/** 剪贴板写入上限，防止渲染进程塞入超大文本 */
const MAX_CLIPBOARD_TEXT_LENGTH = 64 * 1024;

function safeGetPath(name: Parameters<typeof app.getPath>[0]): string | null {
  try {
    return app.getPath(name);
  } catch {
    return null;
  }
}

/** 可打开的数据目录（示例数据目录与 file-system.ts 中的 getSampleDataPaths 保持一致） */
export function getAboutDirectories(): AboutDirectory[] {
  const directories: AboutDirectory[] = [];
  const userData = safeGetPath('userData');
  if (userData) directories.push({ key: 'userData', label: '用户数据', path: userData });
  const logs = safeGetPath('logs');
  if (logs) directories.push({ key: 'logs', label: '日志', path: logs });
  const documents = safeGetPath('documents');
  if (documents) {
    directories.push({
      key: 'sampleData',
      label: '示例项目',
      path: getUserSampleDataPath(),
    });
  }
  return directories;
}

/** 首次运行时间：取 device-id 文件的创建时间（不可用时退回修改时间） */
async function getFirstRunAt(): Promise<string | null> {
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
    runtime: {
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node,
      v8: process.versions.v8,
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      isPackaged: app.isPackaged,
    },
    directories: getAboutDirectories(),
    links: buildAboutLinks(version),
  };
}

export async function openAboutDirectory(
  requestedPath: unknown
): Promise<{ success: boolean; error?: string }> {
  if (typeof requestedPath !== 'string' || !requestedPath) {
    return { success: false, error: '无效的目录' };
  }
  // 只允许打开 get-about-info 返回的目录，不信任渲染进程传入的任意路径
  const target = getAboutDirectories().find((dir) => dir.path === requestedPath);
  if (!target) return { success: false, error: '不允许打开该目录' };

  if (target.key === 'logs') {
    // 日志目录可能尚未生成
    await mkdir(target.path, { recursive: true }).catch(() => undefined);
  }
  try {
    const info = await stat(target.path);
    if (!info.isDirectory()) return { success: false, error: '目录不存在' };
  } catch {
    return {
      success: false,
      error: target.key === 'sampleData' ? '示例项目尚未创建' : '目录不存在',
    };
  }

  const error = await shell.openPath(target.path);
  return error ? { success: false, error } : { success: true };
}

export async function openAboutLink(key: unknown): Promise<{ success: boolean; error?: string }> {
  const links = buildAboutLinks(app.getVersion());
  if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(links, key)) {
    return { success: false, error: '未知链接' };
  }
  await shell.openExternal(links[key as AboutLinkKey]);
  return { success: true };
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
  ipcMain.handle('about-open-directory', (_event, dirPath: unknown) => openAboutDirectory(dirPath));
  ipcMain.handle('about-open-link', (_event, key: unknown) => openAboutLink(key));
  ipcMain.handle('about-copy-text', (_event, text: unknown) => copyAboutText(text));
}
