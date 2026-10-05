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

vi.mock('electron', () => ({
  app: {
    name: 'Novel Editor',
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

describe('shortcutConfigs', () => {
  it('macOS 使用 Cmd 修饰键，开发模式包含刷新', async () => {
    const { shortcutConfigs } = await loadFresh('darwin', false);
    const accelerators = shortcutConfigs.map((c) => c.accelerator);
    expect(accelerators).toEqual(['Cmd+Q', 'Cmd+M', 'Ctrl+Shift+I', 'Cmd+N', 'Cmd+O', 'Cmd+R']);
  });

  it('Windows/Linux 使用 Ctrl，打包后不包含刷新', async () => {
    const { shortcutConfigs } = await loadFresh('win32', true);
    expect(shortcutConfigs.map((c) => c.accelerator)).toEqual([
      'Ctrl+Q',
      'Ctrl+M',
      'Ctrl+Shift+I',
      'Ctrl+N',
      'Ctrl+O',
    ]);
  });
});

describe('getAllShortcuts', () => {
  it('过滤掉开发模式快捷键，并合并渲染进程快捷键', async () => {
    const { getAllShortcuts } = await loadFresh('linux', false);
    const list = getAllShortcuts();
    expect(list.some((s) => s.description.includes('开发模式'))).toBe(false);
    expect(list.find((s) => s.description === '保存文件')?.accelerator).toBe('Ctrl+S');
    expect(list.find((s) => s.description === '退出应用')?.category).toBe('应用');
    expect(list.find((s) => s.description === '最小化窗口')?.category).toBe('应用');
    expect(list.find((s) => s.description === '新建文件')?.category).toBe('文件');
    expect(list.find((s) => s.description === '打开文件夹')?.category).toBe('文件');
    expect(list.filter((s) => s.accelerator === 'F11')).toHaveLength(1);
  });

  it('macOS 渲染进程快捷键使用 Cmd', async () => {
    const { getAllShortcuts } = await loadFresh('darwin', true);
    expect(getAllShortcuts().find((s) => s.description === '撤销')?.accelerator).toBe('Cmd+Z');
  });

  it('所有条目的分类都合法', async () => {
    const { getAllShortcuts } = await loadFresh('linux', true);
    for (const item of getAllShortcuts()) {
      expect(['文件', '编辑', '视图', '应用']).toContain(item.category);
    }
  });

  // 回归：categorize() 曾 先匹配 /新建|打开|保存/，"打开/关闭开发者工具" 含"打开"，
  // 被归入"文件"而不是"视图"（getAllShortcuts.ts:58-59 规则顺序问题）。
  it('开发者工具快捷键应归入"视图"分类', async () => {
    const { getAllShortcuts } = await loadFresh('linux', true);
    expect(getAllShortcuts().find((s) => s.accelerator === 'Ctrl+Shift+I')?.category).toBe('视图');
  });
});

describe('registerAllShortcuts', () => {
  function lastTemplate(): MenuItemTemplate[] {
    const calls = state.buildFromTemplate.mock.calls;
    return calls[calls.length - 1][0] as MenuItemTemplate[];
  }

  it('macOS 添加 appMenu，并跳过 Cmd+Q 的重复注册', async () => {
    const { registerAllShortcuts } = await loadFresh('darwin', false);
    registerAllShortcuts();
    const template = lastTemplate();
    expect(state.setApplicationMenu).toHaveBeenCalledOnce();
    expect(template.map((t) => t.label ?? t.role)).toEqual([
      'Novel Editor',
      '快捷键',
      '文件',
      'editMenu',
    ]);
    expect(template[0].submenu?.some((i) => i.role === 'quit')).toBe(true);
    // 不再使用原生 about 面板
    expect(template[0].submenu?.some((i) => i.role === 'about')).toBe(false);
    expect(template[0].submenu?.[0].label).toBe('关于 小说编辑器');
    const shortcutItems = template[1].submenu ?? [];
    expect(shortcutItems.map((i) => i.accelerator)).toEqual([
      'CommandOrControl+M',
      'CommandOrControl+Shift+I',
      'CommandOrControl+N',
      'CommandOrControl+O',
      'CommandOrControl+R',
    ]);
    expect(shortcutItems.every((i) => i.visible === false)).toBe(true);
  });

  it('Windows 不添加 appMenu，保留 Ctrl+Q', async () => {
    const { registerAllShortcuts } = await loadFresh('win32', true);
    registerAllShortcuts();
    const template = lastTemplate();
    expect(template.map((t) => t.label ?? t.role)).toEqual(['快捷键', '文件', 'editMenu', '帮助']);
    expect(template[0].submenu?.[0]).toMatchObject({
      label: '退出应用',
      accelerator: 'CommandOrControl+Q',
    });
  });

  it('菜单项点击触发对应动作；导出项目通知聚焦窗口', async () => {
    const { registerAllShortcuts } = await loadFresh('linux', true);
    registerAllShortcuts();
    const template = lastTemplate();

    template[0].submenu?.[0].click?.();
    expect(state.quit).toHaveBeenCalledOnce();

    const exportItem = template[1].submenu?.[0];
    expect(exportItem?.accelerator).toBe('CommandOrControl+Shift+E');
    expect(() => exportItem?.click?.()).not.toThrow(); // 无聚焦窗口
    const win = createWindow();
    state.focused = win;
    exportItem?.click?.();
    expect(win.webContents.send).toHaveBeenCalledWith('menu-export-project');
  });

  it('「关于」菜单项通知渲染进程打开应用内对话框', async () => {
    const { registerAllShortcuts } = await loadFresh('darwin', true);
    registerAllShortcuts();
    const aboutItem = lastTemplate()[0].submenu?.[0];
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

  it('Windows / Linux 在帮助菜单中提供「关于」', async () => {
    const { registerAllShortcuts } = await loadFresh('linux', true);
    registerAllShortcuts();
    const help = lastTemplate().find((t) => t.label === '帮助');
    const win = createWindow();
    state.focused = win;
    help?.submenu?.[0].click?.();
    expect(help?.submenu?.[0].label).toBe('关于 小说编辑器');
    expect(win.webContents.send).toHaveBeenCalledWith('menu-open-about');
  });
});
