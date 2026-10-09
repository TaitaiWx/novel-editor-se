import { withWorkspaceSnapshot } from './workspace-mutation-gate';
import { app, BrowserWindow } from 'electron';
import { requestRendererPreparation, type RendererPreparationLease } from './renderer-preparation';
import { drainFileWrites } from './handlers/file-system';
import {
  captureGuiSessionRestore,
  closeAllGuiSessions,
  closeGuiSessionForSender,
} from './handlers/session';
const approved = new WeakSet<BrowserWindow>();
const closing = new WeakSet<BrowserWindow>();
let exiting = false;
let preparingExit: Promise<boolean> | null = null;

/** Shared by app.quit and updater installation. No destructive action precedes all acknowledgements. */
export function prepareAppForExit(exit: () => void | Promise<void>): Promise<boolean> {
  if (preparingExit) return preparingExit;
  preparingExit = (async () => {
    const leases: RendererPreparationLease[] = [];
    try {
      const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
      for (const win of windows) {
        // Splash and startup error windows cannot contain edited documents.
        if (!guarded.has(win)) continue;
        const lease = await requestRendererPreparation(win.webContents, 'close');
        if (!lease) return false;
        leases.push(lease);
      }
      await withWorkspaceSnapshot(async () => {
        await drainFileWrites();
        const restoreSessions = await captureGuiSessionRestore();
        try {
          await closeAllGuiSessions();
          for (const win of windows) approved.add(win);
          exiting = true;
          await exit();
        } catch (error) {
          await restoreSessions((senderId) =>
            windows.some((win) => !win.isDestroyed() && win.webContents.id === senderId)
          );
          throw error;
        }
      });
      return true;
    } catch (error) {
      console.error('退出前保存失败，窗口保持打开:', error);
      exiting = false;
      for (const win of BrowserWindow.getAllWindows()) approved.delete(win);
      return false;
    } finally {
      if (!exiting) leases.forEach((lease) => lease.release());
    }
  })().finally(() => {
    preparingExit = null;
  });
  return preparingExit;
}
const guarded = new WeakSet<BrowserWindow>();
export function guardWindowClose(win: BrowserWindow): void {
  if (guarded.has(win)) return;
  guarded.add(win);
  win.on('close', (event) => {
    if (approved.has(win) || exiting) return;
    event.preventDefault();
    if (closing.has(win) || preparingExit) return;
    closing.add(win);
    void (async () => {
      let lease: RendererPreparationLease | null = null;
      try {
        lease = await requestRendererPreparation(win.webContents, 'close');
        if (!lease) return;
        await withWorkspaceSnapshot(async () => {
          await drainFileWrites();
          await closeGuiSessionForSender(win.webContents.id);
          approved.add(win);
          win.close();
        });
      } catch (error) {
        approved.delete(win);
        console.error('关闭前保存失败，窗口保持打开:', error);
      } finally {
        if (!approved.has(win)) lease?.release();
        closing.delete(win);
      }
    })();
  });
}
export function installGracefulShutdown(): void {
  app.on('before-quit', (event) => {
    if (exiting) return;
    event.preventDefault();
    void prepareAppForExit(() => app.quit());
  });
}
