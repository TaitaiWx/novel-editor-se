/**
 * 日志包里的 diagnostics.json：关于窗口不再展示的运行环境、数据目录等信息都放在这里
 */
import { app } from 'electron';
import log from 'electron-log/main';
import os from 'node:os';
import path from 'node:path';
import { describeOs } from '../../shared/about';
import type { LogUploadReason } from '../../shared/log-upload';
import { APP_STARTED_AT_MS, getAboutInfo, safeGetPath } from '../handlers/about';
import { getUserSampleDataPath } from '../sample-data';

/** 崩溃日志包的保存目录 */
export function getCrashReportsDir(): string | null {
  const userData = safeGetPath('userData');
  return userData ? path.join(userData, 'crash-reports') : null;
}

/** electron-log 文件日志所在目录（默认 app.getPath('logs')） */
export function resolveLogDirectory(): string | null {
  try {
    const file = log.transports.file.getFile();
    if (file?.path) return path.dirname(file.path);
  } catch {
    // electron-log 未初始化时退回系统日志目录
  }
  return safeGetPath('logs');
}

/** 需要一并打包的小状态文件 */
export function getStateFiles(): string[] {
  const userData = safeGetPath('userData');
  if (!userData) return [];
  return [
    path.join(userData, 'updater-state.json'),
    path.join(userData, 'log-upload-settings.json'),
  ];
}

function safeSampleDataPath(): string | null {
  try {
    return getUserSampleDataPath();
  } catch {
    return null;
  }
}

export async function collectDiagnostics(
  reason: LogUploadReason,
  now: number = Date.now()
): Promise<Record<string, unknown>> {
  const about = await getAboutInfo();
  const release = os.release();
  return {
    reason,
    app: {
      name: about.appName,
      productName: about.productName,
      version: about.version,
      releaseChannel: about.releaseChannel,
      isPackaged: app.isPackaged,
      locale: (() => {
        try {
          return app.getLocale();
        } catch {
          return null;
        }
      })(),
    },
    update: {
      channel: about.updateChannel,
      canaryEnrolled: about.rollout.canaryEnrolled,
      rolloutBucket: about.rollout.bucket,
      rolloutPercentage: about.rollout.percentage,
      rolloutEligible: about.rollout.eligible,
    },
    deviceId: about.deviceId,
    os: {
      platform: process.platform,
      arch: process.arch,
      release,
      description: describeOs(process.platform, release, process.arch),
      totalMemoryGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
      cpuCount: os.cpus().length,
    },
    runtime: {
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node,
      v8: process.versions.v8,
    },
    time: {
      firstRunAt: about.firstRunAt,
      startedAt: about.startedAt,
      uptimeMs: now - APP_STARTED_AT_MS,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    directories: {
      userData: safeGetPath('userData'),
      logs: resolveLogDirectory(),
      sampleData: safeSampleDataPath(),
      crashReports: getCrashReportsDir(),
    },
  };
}
