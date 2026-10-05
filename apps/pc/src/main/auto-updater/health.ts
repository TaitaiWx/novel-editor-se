/**
 * 启动健康检测与版本指针：
 * 新版本启动后，主进程、窗口、渲染进程全部就绪才推进 lastKnownGoodVersion；
 * 连续启动失败达到阈值时提示可回退到旧版本。
 */
import { app, BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { createStartupHealthState, isStartupHealthComplete } from '../auto-updater-state';
import type { StartupHealthState } from '../auto-updater-state';
import { applyHealthyVersion, applyPendingLaunch } from './policy';
import { pruneRollbackCache } from './rollback';
import { loadUpdaterState, persistUpdaterState } from './state-store';
import { emitStatus, updaterStatus } from './status';

let startupHealthCommitted = false;
let startupWindowObserverCleanup: (() => void) | null = null;
const startupHealthState: StartupHealthState = createStartupHealthState();

async function markVersionHealthy() {
  const state = await loadUpdaterState();
  applyHealthyVersion(state, app.getVersion());

  await persistUpdaterState();

  // 版本确认健康后清理旧缓存
  void pruneRollbackCache(state.rollbackTarget?.assetName).catch((error) => {
    log.warn('清理回滚缓存失败:', error);
  });

  updaterStatus.rollbackAvailable = Boolean(state.rollbackTarget);
  updaterStatus.rollbackVersion = state.rollbackTarget?.version ?? null;
  updaterStatus.pendingVersion = null;
  emitStatus();
}

export function resetStartupHealthState() {
  startupHealthCommitted = false;
  Object.assign(startupHealthState, createStartupHealthState());
  if (startupWindowObserverCleanup) {
    startupWindowObserverCleanup();
    startupWindowObserverCleanup = null;
  }
}

export async function tryMarkVersionHealthy() {
  if (startupHealthCommitted) {
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

  await markVersionHealthy();
  startupHealthCommitted = true;
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

  startupWindowObserverCleanup = () => {
    mainWindow.webContents.removeListener('did-finish-load', handleDidFinishLoad);
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

/** 启动时累计待确认版本的启动次数，超过阈值则提示回退 */
export async function trackPendingLaunchState() {
  const state = await loadUpdaterState();
  const { offerRollback } = applyPendingLaunch(state, app.getVersion());
  await persistUpdaterState();

  if (offerRollback && state.rollbackTarget) {
    updaterStatus.rollbackAvailable = true;
    updaterStatus.rollbackVersion = state.rollbackTarget.version;
    updaterStatus.lastError = `新版本 ${app.getVersion()} 连续启动异常，已保留回退到 ${state.rollbackTarget.version} 的能力`;
  }
}
