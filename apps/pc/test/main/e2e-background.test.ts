import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  listeners: new Map<string, (...args: unknown[]) => void>(),
  dockHide: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    on: (event: string, listener: (...args: unknown[]) => void) =>
      state.listeners.set(event, listener),
    whenReady: () => Promise.resolve(),
    dock: { hide: state.dockHide },
  },
  BrowserWindow: class {},
}));

import {
  backgroundWindow,
  installE2EBackgroundMode,
  isE2EBackgroundMode,
} from '../../src/main/e2e-background';

function fakeWindow() {
  const win = {
    setOpacity: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    setSkipTaskbar: vi.fn(),
    showInactive: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    moveTop: vi.fn(),
    webContents: { setAudioMuted: vi.fn() },
  };
  return win;
}

describe('E2E 后台运行', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    state.listeners.clear();
    state.dockHide.mockClear();
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('默认显示窗口；只有 E2E 模式且设置了 NOVEL_EDITOR_E2E_BACKGROUND=1 才在后台运行', () => {
    expect(isE2EBackgroundMode({ NOVEL_EDITOR_E2E_BACKGROUND: '1' })).toBe(false);
    process.env.NOVEL_EDITOR_E2E = '1';
    expect(isE2EBackgroundMode({})).toBe(false);
    expect(isE2EBackgroundMode({ NOVEL_EDITOR_E2E_BACKGROUND: '1' })).toBe(true);
  });

  it('窗口透明、忽略系统鼠标、静音；show 不激活，focus / moveTop 不抢前台', () => {
    const win = fakeWindow();
    const originalShow = win.show;
    backgroundWindow(win as never);
    expect(win.setOpacity).toHaveBeenCalledWith(0);
    expect(win.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
    expect(win.webContents.setAudioMuted).toHaveBeenCalledWith(true);
    win.show();
    expect(win.showInactive).toHaveBeenCalledTimes(1);
    expect(originalShow).not.toHaveBeenCalled();
    win.focus();
    win.moveTop();
  });

  it('E2E 默认只静音、窗口照常显示；非 E2E 不安装', () => {
    delete process.env.NOVEL_EDITOR_E2E;
    installE2EBackgroundMode();
    expect(state.listeners.size).toBe(0);
    process.env.NOVEL_EDITOR_E2E = '1';
    installE2EBackgroundMode();
    expect([...state.listeners.keys()]).toEqual(['web-contents-created']);
    expect(state.dockHide).not.toHaveBeenCalled();
  });

  it('设置后台运行后：新窗口自动进入后台、所有页面静音、隐藏 Dock', async () => {
    process.env.NOVEL_EDITOR_E2E = '1';
    process.env.NOVEL_EDITOR_E2E_BACKGROUND = '1';
    installE2EBackgroundMode();
    const win = fakeWindow();
    state.listeners.get('browser-window-created')?.({}, win);
    expect(win.setOpacity).toHaveBeenCalledWith(0);
    const contents = { setAudioMuted: vi.fn() };
    state.listeners.get('web-contents-created')?.({}, contents);
    expect(contents.setAudioMuted).toHaveBeenCalledWith(true);
    await Promise.resolve();
    expect(state.dockHide).toHaveBeenCalled();
  });
});
