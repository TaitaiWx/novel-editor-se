/**
 * 启动健康检测与版本指针：
 * 新版本启动后，主进程、窗口、渲染进程全部就绪才推进 lastKnownGoodVersion；
 * 连续启动失败达到阈值或渲染启动失败时，自动安装兼容的已验证旧版本。
 */
import { app, BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { createStartupHealthState, isStartupHealthComplete } from '../auto-updater-state';
import type { StartupHealthState } from '../auto-updater-state';
import { applyHealthyVersion, applyPendingLaunch } from './policy';
import {
  getRollbackCachePath,
  isRollbackInProgress,
  pruneRollbackCache,
  rollbackToPreviousVersion,
} from './rollback';
import { basename } from 'path';
import { isBoundRollbackTarget } from './rollback-metadata';
import { loadUpdaterState, persistUpdaterState } from './state-store';
import { emitStatus, updaterStatus } from './status';
import {
  canConfirmExternalHealth,
  confirmExternalHealth,
  externalRecoveryOwnsFailure,
  syncExternalRecovery,
} from './recovery';

let startupHealthCommitted = false;
let startupDeadline: NodeJS.Timeout | null = null;
let startupWindowObserverCleanup: (() => void) | null = null;
const startupHealthState: StartupHealthState = createStartupHealthState();

async function markVersionHealthy() {
  if (!(await canConfirmExternalHealth())) return false;
  const state = await loadUpdaterState();
  if (state.rollbackPendingVersion && state.rollbackPendingVersion !== app.getVersion())
    return false;
  if (!(await confirmExternalHealth())) return false;
  applyHealthyVersion(state, app.getVersion());

  await persistUpdaterState();

  // 版本确认健康后清理旧缓存
  void pruneRollbackCache(
    state.rollbackTarget && isBoundRollbackTarget(state.rollbackTarget)
      ? basename(getRollbackCachePath(state.rollbackTarget))
      : undefined
  ).catch((error) => {
    log.warn('清理回滚缓存失败:', error);
  });

  updaterStatus.rollbackAvailable = Boolean(
    state.rollbackTarget && isBoundRollbackTarget(state.rollbackTarget)
  );
  updaterStatus.rollbackVersion = state.rollbackTarget?.version ?? null;
  updaterStatus.pendingVersion = state.pendingVersion;
  emitStatus();
  return true;
}

export function resetStartupHealthState() {
  startupHealthCommitted = false;
  if (startupDeadline) clearTimeout(startupDeadline);
  startupDeadline = null;
  Object.assign(startupHealthState, createStartupHealthState());
  if (startupWindowObserverCleanup) {
    startupWindowObserverCleanup();
    startupWindowObserverCleanup = null;
  }
}

export async function tryMarkVersionHealthy() {
  if (startupHealthCommitted || isRollbackInProgress()) {
    return;
  }

  if (!isStartupHealthComplete(startupHealthState)) {
    return;
  }

  const win = BrowserWindow.getAllWindows()[0];
  if (!win || win.isDestroyed() || win.webContents.isCrashed()) {
    log.warn('启动健康检测失败: 窗口不可用或渲染进程已崩溃');
    return;
  }

  if (!(await markVersionHealthy())) return;
  startupHealthCommitted = true;
  if (startupDeadline) clearTimeout(startupDeadline);
  startupDeadline = null;
  if (startupWindowObserverCleanup) {
    startupWindowObserverCleanup();
    startupWindowObserverCleanup = null;
  }
}

export function armHealthyStartupObservers() {
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (!mainWindow) {
    return;
  }

  const handleDidFinishLoad = () => {
    startupHealthState.windowLoaded = true;
    void tryMarkVersionHealthy().catch((error) => {
      log.error('标记健康启动失败:', error);
    });
  };

  if (mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.once('did-finish-load', handleDidFinishLoad);
  } else if (mainWindow.webContents.getURL()) {
    startupHealthState.windowLoaded = true;
  }

  const handleFailure = () => {
    void recoverUnhealthyStartup();
  };
  mainWindow.webContents.once('render-process-gone', handleFailure);
  mainWindow.webContents.once('did-fail-load', handleFailure);
  startupDeadline = setTimeout(handleFailure, 60_000);
  startupDeadline.unref();
  startupWindowObserverCleanup = () => {
    mainWindow.webContents.removeListener('did-finish-load', handleDidFinishLoad);
    mainWindow.webContents.removeListener('render-process-gone', handleFailure);
    mainWindow.webContents.removeListener('did-fail-load', handleFailure);
  };

  void tryMarkVersionHealthy().catch((error) => {
    log.error('初始化健康检测失败:', error);
  });
}

export function noteMainProcessReady() {
  startupHealthState.mainProcessReady = true;
  void tryMarkVersionHealthy().catch((error) => {
    log.error('记录主进程健康状态失败:', error);
  });
}

export function noteUpdaterRendererReady() {
  startupHealthState.rendererReady = true;
  void tryMarkVersionHealthy().catch((error) => {
    log.error('记录渲染进程 ready 失败:', error);
  });
}

export function noteUpdaterRendererHealthy() {
  startupHealthState.rendererHealthy = true;
  void tryMarkVersionHealthy().catch((error) => {
    log.error('记录渲染进程健康状态失败:', error);
  });
}

/** 启动时累计待确认版本的启动次数，超过阈值则执行自动回退 */
export async function trackPendingLaunchState() {
  const state = await loadUpdaterState();
  await syncExternalRecovery(state);
  const { offerRollback } = applyPendingLaunch(state, app.getVersion());
  await persistUpdaterState();

  if (offerRollback && state.rollbackTarget) {
    updaterStatus.rollbackAvailable = isBoundRollbackTarget(state.rollbackTarget);
    updaterStatus.rollbackVersion = state.rollbackTarget.version;
    updaterStatus.lastError = `新版本 ${app.getVersion()} 连续启动异常，正在自动回退到 ${state.rollbackTarget.version}`;
    await recoverUnhealthyStartup();
  }
}

/** Renderer crash/timeout and repeated failed launches use the same recovery transaction. */
export async function recoverUnhealthyStartup() {
  if (startupHealthCommitted || isRollbackInProgress() || (await externalRecoveryOwnsFailure()))
    return;
  const state = await loadUpdaterState();
  if (state.pendingVersion !== app.getVersion() || !state.rollbackTarget) return;
  try {
    await rollbackToPreviousVersion();
  } catch (error) {
    updaterStatus.lastError = `新版本 ${app.getVersion()} 连续启动异常，自动回退失败: ${error instanceof Error ? error.message : String(error)}`;
    log.error(updaterStatus.lastError);
    emitStatus();
  }
}
