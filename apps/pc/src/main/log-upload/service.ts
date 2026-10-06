/**
 * 日志上传服务：打包 → 上传（已配置地址时）→ 失败或未配置时本地兜底
 *
 * - 手动（关于窗口「上传日志」）：兜底保存到「下载」目录并在访达 / 资源管理器中定位
 * - 崩溃：只在配置了地址且用户开启「崩溃时自动上传日志」时上传；否则只保存在 userData/crash-reports（最多 5 个）
 */
import { app, shell } from 'electron';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildLogBundleFileName,
  type LogUploadReason,
  type LogUploadResult,
} from '../../shared/log-upload';
import { getDeviceId } from '../device-id';
import { isE2ETestMode, isSmokeTestMode } from '../launch-mode';
import { buildLogBundle, type CrashContext, type LogBundle } from './bundle';
import { getLogUploadEndpoint, MAX_CRASH_BUNDLES } from './config';
import {
  collectDiagnostics,
  getCrashReportsDir,
  getStateFiles,
  resolveLogDirectory,
} from './diagnostics';
import { loadLogUploadSettings } from './settings';
import { uploadLogBundle, type FetchLike, type UploadOutcome } from './uploader';

export interface LogUploadServiceOptions {
  /** 覆盖上传地址（测试用）；undefined 时读取配置 */
  endpoint?: string | null;
  fetchImpl?: FetchLike;
  retryDelayMs?: number;
  now?: Date;
}

export interface PreparedLogBundle extends LogBundle {
  fileName: string;
  deviceId: string;
  appVersion: string;
}

export async function prepareLogBundle(
  reason: LogUploadReason,
  crash: CrashContext | null = null,
  now: Date = new Date()
): Promise<PreparedLogBundle> {
  const deviceId = getDeviceId();
  const diagnostics = await collectDiagnostics(reason, now.getTime());
  const bundle = await buildLogBundle({
    reason,
    diagnostics,
    logDir: resolveLogDirectory(),
    stateFiles: getStateFiles(),
    homeDir: os.homedir(),
    crash,
    now,
  });
  return {
    ...bundle,
    fileName: buildLogBundleFileName(now, deviceId),
    deviceId,
    appVersion: app.getVersion(),
  };
}

async function tryUpload(
  bundle: PreparedLogBundle,
  reason: LogUploadReason,
  endpoint: string,
  options: LogUploadServiceOptions
): Promise<UploadOutcome> {
  return uploadLogBundle({
    endpoint,
    zip: bundle.buffer,
    deviceId: bundle.deviceId,
    appVersion: bundle.appVersion,
    reason,
    fetchImpl: options.fetchImpl,
    retryDelayMs: options.retryDelayMs,
  });
}

function resolveEndpoint(options: LogUploadServiceOptions): string | null {
  return options.endpoint === undefined ? getLogUploadEndpoint() : options.endpoint;
}

/** 「下载」目录（E2E / 烟雾测试下已被 launch-mode 重定向到测试 userData） */
function getDownloadsDir(): string {
  try {
    return app.getPath('downloads');
  } catch {
    return path.join(os.homedir(), 'Downloads');
  }
}

/** 在系统文件管理器中定位文件（测试模式下不弹出访达 / 资源管理器） */
function revealFile(filePath: string): void {
  if (isE2ETestMode() || isSmokeTestMode()) return;
  try {
    shell.showItemInFolder(filePath);
  } catch {
    // 定位失败不影响结果
  }
}

let manualInFlight: Promise<LogUploadResult> | null = null;

async function runManual(options: LogUploadServiceOptions): Promise<LogUploadResult> {
  let bundle: PreparedLogBundle;
  try {
    bundle = await prepareLogBundle('manual', null, options.now);
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  }

  const endpoint = resolveEndpoint(options);
  let uploadError: string | null = null;
  if (endpoint) {
    const outcome = await tryUpload(bundle, 'manual', endpoint, options);
    if (outcome.ok) {
      return { status: 'uploaded', ticketId: outcome.ticketId, bytes: bundle.buffer.byteLength };
    }
    uploadError = outcome.error;
  }

  try {
    const dir = getDownloadsDir();
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, bundle.fileName);
    await writeFile(filePath, bundle.buffer);
    revealFile(filePath);
    return {
      status: 'saved',
      fileName: bundle.fileName,
      filePath,
      uploadError,
      bytes: bundle.buffer.byteLength,
    };
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
}

/** 手动上传日志；重复点击时复用进行中的任务 */
export function runManualLogUpload(
  options: LogUploadServiceOptions = {}
): Promise<LogUploadResult> {
  if (!manualInFlight) {
    manualInFlight = runManual(options).finally(() => {
      manualInFlight = null;
    });
  }
  return manualInFlight;
}

/** 只保留最近 max 个崩溃日志包 */
export async function pruneCrashBundles(
  dir: string,
  max: number = MAX_CRASH_BUNDLES
): Promise<void> {
  const names = (await readdir(dir).catch(() => [] as string[])).filter((name) =>
    name.endsWith('.zip')
  );
  if (names.length <= max) return;
  const files = await Promise.all(
    names.map(async (name) => {
      const filePath = path.join(dir, name);
      const info = await stat(filePath).catch(() => null);
      return { filePath, mtimeMs: info?.mtimeMs ?? 0, name };
    })
  );
  files.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
  await Promise.all(files.slice(max).map((file) => rm(file.filePath, { force: true })));
}

export type CrashReportOutcome =
  | { status: 'uploaded'; ticketId: string | null }
  | { status: 'saved'; filePath: string; uploadError: string | null };

/** 崩溃时打包日志：配置了地址且开启自动上传时上传，否则（或失败时）保存到 crash-reports */
export async function reportCrash(
  crash: CrashContext,
  options: LogUploadServiceOptions = {}
): Promise<CrashReportOutcome> {
  const bundle = await prepareLogBundle('crash', crash, options.now);
  const endpoint = resolveEndpoint(options);
  const settings = await loadLogUploadSettings();
  let uploadError: string | null = null;
  if (endpoint && settings.autoUploadOnCrash) {
    const outcome = await tryUpload(bundle, 'crash', endpoint, options);
    if (outcome.ok) return { status: 'uploaded', ticketId: outcome.ticketId };
    uploadError = outcome.error;
  }

  const dir = getCrashReportsDir();
  if (!dir) throw new Error('无法定位 userData 目录');
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, bundle.fileName);
  await writeFile(filePath, bundle.buffer);
  await pruneCrashBundles(dir);
  return { status: 'saved', filePath, uploadError };
}
