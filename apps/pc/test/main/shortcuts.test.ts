import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeWindow {
  close: ReturnType<typeof vi.fn>;
  minimize: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
  setFullScreen: ReturnType<typeof vi.fn>;
  isFullScreen: ReturnType<typeof vi.fn>;
  webContents: {
    send: ReturnType<typeof vi.fn>;
    isDevToolsOpened: ReturnType<typeof vi.fn>;
    openDevTools: ReturnType<typeof vi.fn>;
    closeDevTools: ReturnType<typeof vi.fn>;
  };
}

interface MenuItemTemplate {
  label?: string;
  role?: string;
  type?: string;
  accelerator?: string;
  visible?: boolean;
  click?: () => void;
  submenu?: MenuItemTemplate[];
}

const state = vi.hoisted(() => ({
  focused: null as unknown,
  windows: [] as unknown[],
  isPackaged: false,
  quit: vi.fn(),
  buildFromTemplate: vi.fn((template: unknown) => ({ template })),
  setApplicationMenu: vi.fn(),
}));

vi.mock('../../src/main/recent-folders', () => ({
  getRecentFolders: () => [],
  clearRecentFolders: vi.fn(),
  onRecentFoldersChanged: () => () => undefined,
}));

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
  app: {
    // dev 模式下 app.name 为 package.json 的 name，菜单中不应出现
    name: '@novel-editor/pc',
    get isPackaged() {
      return state.isPackaged;
    },
    quit: state.quit,
  },
  BrowserWindow: {
    getFocusedWindow: () => state.focused,
    getAllWindows: () => state.windows,
  },
  Menu: {
    buildFromTemplate: state.buildFromTemplate,
    setApplicationMenu: state.setApplicationMenu,
  },
}));

function createWindow(): FakeWindow {
  return {
    close: vi.fn(),
    minimize: vi.fn(),
    reload: vi.fn(),
    setFullScreen: vi.fn(),
    isFullScreen: vi.fn(() => false),
    webContents: {
      send: vi.fn(),
      isDevToolsOpened: vi.fn(() => false),
      openDevTools: vi.fn(),
      closeDevTools: vi.fn(),
    },
  };
}

const originalPlatform = process.platform;
function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

beforeEach(() => {
  state.focused = null;
  state.windows = [];
  state.isPackaged = false;
  state.quit.mockReset();
  state.buildFromTemplate.mockClear();
  state.setApplicationMenu.mockClear();
});

afterEach(() => {
  setPlatform(originalPlatform);
});

describe('shortcut actions', () => {
  it('无聚焦窗口时所有窗口动作都是 no-op', async () => {
    const mods = await Promise.all([
      import('../../src/main/shortcuts/closeWindow'),
      import('../../src/main/shortcuts/minimizeWindow'),
      import('../../src/main/shortcuts/reloadWindow'),
      import('../../src/main/shortcuts/toggleFullscreen'),
      import('../../src/main/shortcuts/devtools'),
      import('../../src/main/shortcuts/newFile'),
      import('../../src/main/shortcuts/openFolder'),
      import('../../src/main/shortcuts/saveFile'),
      import('../../src/main/shortcuts/saveAsFile'),
    ]);
    const actions = [
      mods[0].closeWindow,
      mods[1].minimizeWindow,
      mods[2].reloadWindow,
      mods[3].toggleFullscreen,
      mods[4].toggleDevTools,
      mods[5].newFile,
      mods[6].openFolder,
      mods[7].saveFile,
      mods[8].saveAsFile,
    ];
    for (const action of actions) expect(() => action()).not.toThrow();
  });

  it('窗口操作作用于聚焦窗口', async () => {
    const win = createWindow();
    state.focused = win;
    const { closeWindow } = await import('../../src/main/shortcuts/closeWindow');
    const { minimizeWindow } = await import('../../src/main/shortcuts/minimizeWindow');
    const { reloadWindow } = await import('../../src/main/shortcuts/reloadWindow');
    closeWindow();
    minimizeWindow();
    reloadWindow();
    expect(win.close).toHaveBeenCalledOnce();
    expect(win.minimize).toHaveBeenCalledOnce();
    expect(win.reload).toHaveBeenCalledOnce();
  });

  it('toggleFullscreen 取反当前全屏状态', async () => {
    const win = createWindow();
    state.focused = win;
    const { toggleFullscreen } = await import('../../src/main/shortcuts/toggleFullscreen');
    toggleFullscreen();
    expect(win.setFullScreen).toHaveBeenLastCalledWith(true);
    win.isFullScreen.mockReturnValue(true);
    toggleFullscreen();
    expect(win.setFullScreen).toHaveBeenLastCalledWith(false);
  });

  it('toggleDevTools 根据当前状态打开或关闭', async () => {
    const win = createWindow();
    state.focused = win;
    const { toggleDevTools } = await import('../../src/main/shortcuts/devtools');
    toggleDevTools();
    expect(win.webContents.openDevTools).toHaveBeenCalledOnce();
    win.webContents.isDevToolsOpened.mockReturnValue(true);
    toggleDevTools();
    expect(win.webContents.closeDevTools).toHaveBeenCalledOnce();
  });

  it('文件类动作通过 IPC 通知渲染进程', async () => {
    const win = createWindow();
    state.focused = win;
    (await import('../../src/main/shortcuts/newFile')).newFile();
    (await import('../../src/main/shortcuts/openFolder')).openFolder();
    (await import('../../src/main/shortcuts/saveFile')).saveFile();
    (await import('../../src/main/shortcuts/saveAsFile')).saveAsFile();
    expect(win.webContents.send.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      'shortcut-new-file',
      'shortcut-open-folder',
      'shortcut-save-file',
      'shortcut-save-as-file',
    ]);
  });

  it('quitApp 调用 app.quit', async () => {
    (await import('../../src/main/shortcuts/quitApp')).quitApp();
    expect(state.quit).toHaveBeenCalledOnce();
  });

  it('unregisterAllShortcuts 是安全的 no-op', async () => {
    const { unregisterAllShortcuts } = await import(
      '../../src/main/shortcuts/unregisterAllShortcuts'
    );
    expect(unregisterAllShortcuts()).toBeUndefined();
  });
});

async function loadFresh(platform: NodeJS.Platform, isPackaged: boolean) {
  setPlatform(platform);
  state.isPackaged = isPackaged;
  vi.resetModules();
  const config = await import('../../src/main/shortcuts/config');
  const all = await import('../../src/main/shortcuts/getAllShortcuts');
  const register = await import('../../src/main/shortcuts/registerAllShortcuts');
  return { ...config, ...all, ...register };
}

describe('getShortcutConfigs', () => {
  it('macOS 使用 Cmd 修饰键，开发模式包含重新加载', async () => {
    const { getShortcutConfigs } = await loadFresh('darwin', false);
    const configs = getShortcutConfigs();
    const byId = (id: string) => configs.find((c) => c.id === id)?.accelerator;
    expect(byId('quit')).toBe('Cmd+Q');
    expect(byId('settings')).toBe('Cmd+,');
    expect(byId('hide')).toBe('Cmd+H');
    expect(byId('newFile')).toBe('Cmd+N');
    expect(byId('save')).toBe('Cmd+S');
    expect(byId('saveAs')).toBe('Cmd+Shift+S');
    expect(byId('exportProject')).toBe('Cmd+Shift+E');
    expect(byId('toggleFullscreen')).toBe('Ctrl+Cmd+F');
    expect(byId('toggleDevTools')).toBe('Cmd+Alt+I');
    expect(configs.find((c) => c.id === 'reload')).toMatchObject({
      accelerator: 'Cmd+R',
      devOnly: true,
    });
  });

  it('Windows/Linux 使用 Ctrl，打包后不包含重新加载，没有隐藏 / 全屏加速键', async () => {
    const { getShortcutConfigs } = await loadFresh('win32', true);
    const configs = getShortcutConfigs();
    expect(configs.every((c) => !c.accelerator.includes('Cmd'))).toBe(true);
    expect(configs.map((c) => c.id)).not.toContain('reload');
    expect(configs.map((c) => c.id)).not.toContain('hide');
    expect(configs.map((c) => c.id)).not.toContain('toggleFullscreen');
    expect(configs.find((c) => c.id === 'toggleDevTools')?.accelerator).toBe('Ctrl+Shift+I');
  });

  it('同一平台内加速键不重复', async () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const { getShortcutConfigs } = await loadFresh(platform, false);
      const accelerators = getShortcutConfigs().map((c) => c.accelerator);
      expect(new Set(accelerators).size).toBe(accelerators.length);
    }
  });

  it('toElectronAccelerator 统一为 CommandOrControl，保留 Ctrl+Cmd 组合', async () => {
    const { toElectronAccelerator } = await loadFresh('darwin', true);
    expect(toElectronAccelerator('Cmd+Shift+S')).toBe('CommandOrControl+Shift+S');
    expect(toElectronAccelerator('Ctrl+N')).toBe('CommandOrControl+N');
    expect(toElectronAccelerator('Ctrl+Cmd+F')).toBe('Control+Command+F');
    expect(toElectronAccelerator('F11')).toBe('F11');
  });
});

describe('getAllShortcuts', () => {
  it('过滤掉开发模式快捷键，并合并渲染进程快捷键', async () => {
    const { getAllShortcuts } = await loadFresh('linux', false);
    const list = getAllShortcuts();
    expect(list.some((s) => s.description.includes('开发模式'))).toBe(false);
    expect(list.find((s) => s.description === '保存文件')?.accelerator).toBe('Ctrl+S');
    expect(list.find((s) => s.description === '另存为')?.accelerator).toBe('Ctrl+Shift+S');
    expect(list.find((s) => s.description === '导出项目')?.accelerator).toBe('Ctrl+Shift+E');
    expect(list.find((s) => s.description === '打开设置')?.accelerator).toBe('Ctrl+,');
    expect(list.find((s) => s.description === '搜索文件')?.accelerator).toBe('Ctrl+P');
    expect(list.find((s) => s.description === '退出应用')?.category).toBe('应用');
    expect(list.find((s) => s.description === '最小化窗口')?.category).toBe('应用');
    expect(list.find((s) => s.description === '新建文件')?.category).toBe('文件');
    expect(list.find((s) => s.description === '打开文件夹')?.category).toBe('文件');
    expect(list.filter((s) => s.accelerator === 'F11')).toHaveLength(1);
  });

  // 回归：总览曾列出没有任何处理逻辑的按键（Cmd+H 查找替换在 macOS 上实际是「隐藏应用」）
  it('不列出没有实现的快捷键', async () => {
    const { getAllShortcuts } = await loadFresh('darwin', true);
    const descriptions = getAllShortcuts().map((s) => s.description);
    expect(descriptions).not.toContain('查找替换');
    expect(descriptions).not.toContain('导出为 Word');
    expect(descriptions).not.toContain('导出为 PPT');
    const cmdH = getAllShortcuts().filter((s) => s.accelerator === 'Cmd+H');
    expect(cmdH.map((s) => s.description)).toEqual(['隐藏应用']);
  });

  it('macOS 快捷键使用 Cmd', async () => {
    const { getAllShortcuts } = await loadFresh('darwin', true);
    expect(getAllShortcuts().find((s) => s.description === '撤销')?.accelerator).toBe('Cmd+Z');
  });

  it('所有条目的分类都合法，且总览中的描述不重复（专注模式备用键除外）', async () => {
    const { getAllShortcuts } = await loadFresh('linux', true);
    const list = getAllShortcuts();
    for (const item of list) {
      expect(['文件', '编辑', '视图', '应用']).toContain(item.category);
    }
    const descriptions = list.map((s) => s.description).filter((d) => d !== '切换专注模式');
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it('开发者工具快捷键归入「视图」分类', async () => {
    const { getAllShortcuts } = await loadFresh('linux', true);
    expect(getAllShortcuts().find((s) => s.accelerator === 'Ctrl+Shift+I')?.category).toBe('视图');
  });
});

describe('registerAllShortcuts', () => {
  function lastTemplate(): MenuItemTemplate[] {
    const calls = state.buildFromTemplate.mock.calls;
    return calls[calls.length - 1][0] as MenuItemTemplate[];
  }

  it('设置应用菜单，不再有隐藏的「快捷键」菜单', async () => {
    const { registerAllShortcuts } = await loadFresh('darwin', false);
    registerAllShortcuts();
    expect(state.setApplicationMenu).toHaveBeenCalledOnce();
    const template = lastTemplate();
    expect(template.map((t) => t.label)).not.toContain('快捷键');
    const hasHidden = (items: MenuItemTemplate[] = []): boolean =>
      items.some((i) => i.visible === false || hasHidden(i.submenu));
    expect(hasHidden(template)).toBe(false);
  });

  it('「关于」菜单项通知渲染进程打开应用内对话框', async () => {
    const { registerAllShortcuts } = await loadFresh('darwin', true);
    registerAllShortcuts();
    const aboutItem = lastTemplate()[0].submenu?.[0];
    expect(aboutItem?.label).toBe('关于 小说编辑器');
    expect(() => aboutItem?.click?.()).not.toThrow(); // 没有任何窗口

    // 无聚焦窗口时发给第一个窗口
    const first = createWindow();
    state.windows = [first];
    aboutItem?.click?.();
    expect(first.webContents.send).toHaveBeenCalledWith('menu-open-about');

    const focused = createWindow();
    state.focused = focused;
    aboutItem?.click?.();
    expect(focused.webContents.send).toHaveBeenCalledWith('menu-open-about');
  });

  it('syncMenuShortcuts 规范化渲染进程绑定，变化时重建菜单', async () => {
    const { registerAllShortcuts, syncMenuShortcuts } = await loadFresh('darwin', true);
    registerAllShortcuts();
    const view = () => lastTemplate().find((t) => t.label === '视图')?.submenu ?? [];
    expect(view().find((i) => i.label === '切换侧边栏')?.accelerator).toBe('CommandOrControl+B');

    const result = syncMenuShortcuts({ toggleSidebar: 'Mod+Shift+B', toggleFocusMode: 42 });
    expect(result).toEqual({ toggleSidebar: 'Mod+Shift+B', toggleFocusMode: 'Mod+Shift+F' });
    expect(view().find((i) => i.label === '切换侧边栏')?.accelerator).toBe(
      'CommandOrControl+Shift+B'
    );

    // 未变化时不重建
    const builds = state.buildFromTemplate.mock.calls.length;
    syncMenuShortcuts({ toggleSidebar: 'Mod+Shift+B', toggleFocusMode: 'Mod+Shift+F' });
    expect(state.buildFromTemplate.mock.calls.length).toBe(builds);

    // 清空绑定后菜单项不显示加速键
    syncMenuShortcuts({ toggleSidebar: '', toggleFocusMode: 'Mod+Shift+F' });
    expect(view().find((i) => i.label === '切换侧边栏')?.accelerator).toBeUndefined();
  });
});
