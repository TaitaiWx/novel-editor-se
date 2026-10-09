import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
type CloseEvent = { preventDefault: () => void };
type MockWindow = {
  isDestroyed: () => boolean;
  webContents: { id: number; isDestroyed: () => boolean; isCrashed: () => boolean };
};
const env = vi.hoisted(() => ({
  windows: [] as MockWindow[],
  drain: vi.fn(),
  close: vi.fn(),
  prepare: vi.fn(),
  quit: vi.fn(),
  handlers: new Map<string, (event: CloseEvent) => void>(),
}));
vi.mock('electron', () => ({
  app: {
    on: (e: string, cb: (event: CloseEvent) => void) => env.handlers.set(e, cb),
    quit: env.quit,
  },
  BrowserWindow: { getAllWindows: () => env.windows },
}));
vi.mock('../../src/main/renderer-preparation', () => ({ requestRendererPreparation: env.prepare }));
vi.mock('../../src/main/handlers/file-system', () => ({ drainFileWrites: env.drain }));
vi.mock('../../src/main/handlers/session', () => ({
  captureGuiSessionRestore: async () => async () => {},
  closeAllGuiSessions: env.close,
  closeGuiSessionForSender: env.close,
}));
import {
  installGracefulShutdown,
  guardWindowClose,
  prepareAppForExit,
} from '../../src/main/graceful-shutdown';
function windowMock() {
  const win = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    webContents: { id: 3, isDestroyed: () => false, isCrashed: () => false },
    close: vi.fn(),
  });
  env.windows = [win];
  guardWindowClose(win as unknown as BrowserWindow);
  return win;
}
beforeEach(() => {
  vi.clearAllMocks();
  env.windows = [];
  env.prepare.mockResolvedValue({ release: vi.fn() });
  env.drain.mockResolvedValue(undefined);
  env.close.mockResolvedValue(undefined);
});
describe('graceful shutdown', () => {
  it('native close waits for renderer, file writes and session before closing', async () => {
    let finish!: () => void;
    env.drain.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const win = windowMock();
    guardWindowClose(win as unknown as BrowserWindow);
    const event = { preventDefault: vi.fn() };
    win.emit('close', event);
    await vi.waitFor(() => expect(env.drain).toHaveBeenCalled());
    expect(event.preventDefault).toHaveBeenCalled();
    expect(win.close).not.toHaveBeenCalled();
    expect(env.close).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(win.close).toHaveBeenCalled());
    expect(env.close).toHaveBeenCalledWith(3);
  });
  it('cancelled renderer save keeps all app windows and releases prepared leases', async () => {
    const win = windowMock();
    const release = vi.fn();
    const other = Object.assign(new EventEmitter(), {
      ...win,
      webContents: { ...win.webContents, id: 4 },
    });
    guardWindowClose(other as unknown as BrowserWindow);
    env.windows.push(other);
    env.prepare.mockResolvedValueOnce({ release }).mockResolvedValueOnce(null);
    const install = vi.fn();
    expect(await prepareAppForExit(install)).toBe(false);
    expect(install).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
    expect(env.close).not.toHaveBeenCalled();
  });
  it('drain failure never authorizes updater exit', async () => {
    windowMock();
    env.drain.mockRejectedValue(new Error('disk'));
    const exit = vi.fn();
    expect(await prepareAppForExit(exit)).toBe(false);
    expect(exit).not.toHaveBeenCalled();
  });
  it('app before-quit is prevented until successful preparation', async () => {
    windowMock();
    env.prepare.mockResolvedValue(null);
    installGracefulShutdown();
    const event = { preventDefault: vi.fn() };
    env.handlers.get('before-quit')!(event);
    expect(event.preventDefault).toHaveBeenCalled();
    await Promise.resolve();
    expect(env.quit).not.toHaveBeenCalled();
  });
});

it('keeps renderer leases and the writer barrier until async native handoff, and restores close protection on rejection', async () => {
  const { withWorkspaceMutation } = await import('../../src/main/workspace-mutation-gate');
  const win = windowMock();
  const release = vi.fn();
  env.prepare.mockResolvedValue({ release });
  let fail!: (error: Error) => void;
  const handoff = new Promise<void>((_resolve, reject) => {
    fail = reject;
  });
  void handoff.catch(() => undefined);
  const install = vi.fn(() => handoff);
  let settled = false;
  const exiting = prepareAppForExit(install).then((result) => {
    settled = true;
    return result;
  });
  await vi.waitFor(() => expect(install).toHaveBeenCalled());
  const background = vi.fn();
  const laterWrite = withWorkspaceMutation(background);
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    expect(background).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  } finally {
    fail(new Error('native installer failed asynchronously'));
    await exiting;
    await laterWrite;
  }
  expect(await exiting).toBe(false);
  expect(release).toHaveBeenCalledOnce();
  const close = { preventDefault: vi.fn() };
  env.prepare.mockResolvedValue(null);
  win.emit('close', close);
  expect(close.preventDefault).toHaveBeenCalledOnce();
});
