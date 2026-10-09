import { beforeEach, expect, it, vi } from 'vitest';
type WindowStub = Partial<{
  close: () => void;
  minimize: () => void;
  maximize: () => void;
  unmaximize: () => void;
  setFullScreen: (value: boolean) => void;
  isFullScreen: () => boolean;
  isMaximized: () => boolean;
}>;
const env = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  senderWindow: null as WindowStub | null,
  focusedWindow: null as WindowStub | null,
  cacheRows: 2,
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      env.handlers.set(channel, handler),
  },
  app: {},
  BrowserWindow: {
    fromWebContents: () => env.senderWindow,
    getFocusedWindow: () => env.focusedWindow,
  },
}));
vi.mock('../../src/main/shortcuts/getAllShortcuts', () => ({}));
vi.mock('../../src/main/shortcuts/registerAllShortcuts', () => ({}));
vi.mock('../../src/main/shortcuts/devtools', () => ({}));
vi.mock('../../src/main/device-id', () => ({}));
vi.mock('../../src/main/recent-folders', () => ({
  getRecentFolders: () => [],
  clearRecentFolders: () => {},
}));
vi.mock('../../src/main/auto-updater', () => ({}));
vi.mock('@novel-editor/store', () => ({
  settingsOps: {
    deleteByPrefixes: () => {
      const count = env.cacheRows;
      env.cacheRows = 0;
      return count;
    },
  },
}));
vi.mock('../../src/main/launch-mode', () => ({}));
vi.mock('../../src/main/changelog', () => ({}));
vi.mock('../../src/main/system-profile', () => ({}));
vi.mock('../../src/main/webauthn', () => ({}));
vi.mock('../../src/main/sample-data', () => ({}));
vi.mock('../../src/main/path-access', () => ({}));
import { registerWindowAppHandlers } from '../../src/main/handlers/window-app';
beforeEach(() => {
  env.handlers.clear();
  env.senderWindow = null;
  env.focusedWindow = null;
  registerWindowAppHandlers();
});
it('native close targets the invoking window even with no focused window', () => {
  const close = vi.fn();
  env.senderWindow = { close };
  env.handlers.get('window-close')!({ sender: { id: 7 } });
  expect(close).toHaveBeenCalledOnce();
});
it('window controls do not change another window which happens to have focus', () => {
  const other = { close: vi.fn(), minimize: vi.fn(), maximize: vi.fn(), setFullScreen: vi.fn() };
  env.focusedWindow = other;
  const own = {
    close: vi.fn(),
    minimize: vi.fn(),
    maximize: vi.fn(),
    setFullScreen: vi.fn(),
    isFullScreen: () => false,
    isMaximized: () => false,
  };
  env.senderWindow = own;
  for (const name of [
    'window-close',
    'window-minimize',
    'window-maximize',
    'window-toggle-fullscreen',
  ])
    env.handlers.get(name)!({ sender: { id: 7 } });
  expect(own.close).toHaveBeenCalledOnce();
  expect(own.minimize).toHaveBeenCalledOnce();
  expect(own.maximize).toHaveBeenCalledOnce();
  expect(own.setFullScreen).toHaveBeenCalledWith(true);
  Object.values(other).forEach((fn) => expect(fn).not.toHaveBeenCalled());
});
it('maximized state comes from the sender and absent sender windows are ignored', () => {
  env.senderWindow = { isMaximized: () => true };
  expect(env.handlers.get('window-is-maximized')!({ sender: { id: 7 } })).toBe(true);
  env.senderWindow = null;
  expect(env.handlers.get('window-is-maximized')!({ sender: { id: 7 } })).toBe(false);
  expect(() => env.handlers.get('window-close')!({ sender: { id: 7 } })).not.toThrow();
});

it('does not clear project settings while a snapshot is being copied', async () => {
  const { withWorkspaceSnapshot } = await import('../../src/main/workspace-mutation-gate');
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  env.cacheRows = 2;
  const snapshot = withWorkspaceSnapshot(async () => {
    started();
    await waiting;
  });
  await ready;
  const deletion = Promise.resolve(env.handlers.get('app-cache-clear')!({}, 'document-data'));
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(env.cacheRows).toBe(2);
  } finally {
    release();
    await Promise.all([snapshot, deletion]);
  }
  expect(env.cacheRows).toBe(0);
});
