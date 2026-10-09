import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  isLowSpec: true,
  calls: [] as string[],
  disable: vi.fn(),
}));
vi.mock('electron', () => ({
  app: {
    disableHardwareAcceleration: () => {
      state.calls.push('disable');
      state.disable();
    },
    whenReady: () => {
      state.calls.push('ready');
      return new Promise(() => {});
    },
    on: vi.fn(),
    requestSingleInstanceLock: () => true,
  },
  BrowserWindow: {},
}));
vi.mock('../../src/main/system-profile', () => ({
  detectSystemProfile: () => ({
    isLowSpec: state.isLowSpec,
    cpuCount: 2,
    totalMemoryGB: 4,
    reasons: ['逻辑核数 2 ≤ 4'],
  }),
}));
vi.mock('../../src/main/graceful-shutdown', () => ({ installGracefulShutdown: () => {} }));
vi.mock('../../src/main/window', () => ({
  createMainWindow: () => {},
  setupWindowEvents: () => {},
}));
vi.mock('../../src/main/static/splash/splash-window', () => ({ createSplashWindow: () => {} }));
vi.mock('../../src/main/ipc-handlers', () => ({ setupIPC: () => {} }));
vi.mock('../../src/main/shortcuts/registerAllShortcuts', () => ({
  registerAllShortcuts: () => {},
}));
vi.mock('../../src/main/shortcuts/unregisterAllShortcuts', () => ({
  unregisterAllShortcuts: () => {},
}));
vi.mock('../../src/main/auto-updater', () => ({ setupAutoUpdater: () => {} }));
vi.mock('../../src/main/launch-mode', () => ({
  applySmokeTestPaths: () => {},
  isAutoUpdaterDisabled: () => true,
}));
vi.mock('../../src/main/e2e-background', () => ({ installE2EBackgroundMode: () => {} }));
vi.mock('../../src/main/windows-shortcut', () => ({ ensureWindowsShortcuts: () => {} }));
vi.mock('../../src/main/webauthn', () => ({
  configureWebAuthn: () => {},
  registerWebAuthnSessionHandlers: () => {},
}));
vi.mock('../../src/main/launch-folder', () => ({ resolveLaunchFolder: () => null }));
vi.mock('../../src/main/recent-folders', () => ({ addRecentFolder: () => {} }));
vi.mock('../../src/main/sample-data', () => ({ syncSampleData: () => {} }));
vi.mock('../../src/main/log-upload', () => ({ setupCrashLogUpload: () => {} }));

beforeEach(() => {
  vi.resetModules();
  state.calls.length = 0;
  state.disable.mockClear();
  vi.stubEnv('NOVEL_EDITOR_DISABLE_HARDWARE_ACCELERATION', undefined);
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.each([true, false])(
  'preserves Chromium GPU/WebGL availability for isLowSpec=%s',
  async (isLowSpec) => {
    state.isLowSpec = isLowSpec;
    await import('../../src/main/index');
    expect(state.disable).not.toHaveBeenCalled();
    expect(state.calls).toEqual(['ready']);
  }
);

it.each([true, false])(
  'honors the explicit GPU disable override before app readiness for isLowSpec=%s',
  async (isLowSpec) => {
    state.isLowSpec = isLowSpec;
    vi.stubEnv('NOVEL_EDITOR_DISABLE_HARDWARE_ACCELERATION', '1');
    await import('../../src/main/index');
    expect(state.disable).toHaveBeenCalledOnce();
    expect(state.calls).toEqual(['disable', 'ready']);
  }
);
