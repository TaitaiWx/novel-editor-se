import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

interface MenuItemTemplate {
  label?: string;
  role?: string;
  type?: string;
  accelerator?: string;
  enabled?: boolean;
  visible?: boolean;
  click?: () => void;
  submenu?: MenuItemTemplate[];
}

interface FakeWindow {
  setFullScreen: ReturnType<typeof vi.fn>;
  isFullScreen: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
  webContents: {
    send: ReturnType<typeof vi.fn>;
    isDevToolsOpened: ReturnType<typeof vi.fn>;
    openDevTools: ReturnType<typeof vi.fn>;
    closeDevTools: ReturnType<typeof vi.fn>;
  };
}

const state = vi.hoisted(() => ({
  focused: null as unknown,
  isPackaged: false,
  recent: [] as string[],
  recentListener: null as null | (() => void),
  clearRecentFolders: vi.fn(),
  openExternal: vi.fn(async () => undefined),
  buildFromTemplate: vi.fn((template: unknown) => ({ template })),
  setApplicationMenu: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    // 开发模式下 app.name 为 package.json 的 name，菜单中不应出现
    name: '@novel-editor/pc',
    get isPackaged() {
      return state.isPackaged;
    },
    quit: vi.fn(),
  },
  shell: { openExternal: state.openExternal },
  BrowserWindow: {
    getFocusedWindow: () => state.focused,
    getAllWindows: () => (state.focused ? [state.focused] : []),
  },
  Menu: {
    buildFromTemplate: state.buildFromTemplate,
    setApplicationMenu: state.setApplicationMenu,
  },
}));

vi.mock('../../src/main/recent-folders', () => ({
  getRecentFolders: () => state.recent,
  clearRecentFolders: state.clearRecentFolders,
  onRecentFoldersChanged: (listener: () => void) => {
    state.recentListener = listener;
    return () => {
      state.recentListener = null;
    };
  },
}));

const originalPlatform = process.platform;
function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

function createWindow(): FakeWindow {
  return {
    setFullScreen: vi.fn(),
    isFullScreen: vi.fn(() => false),
    reload: vi.fn(),
    webContents: {
      send: vi.fn(),
      isDevToolsOpened: vi.fn(() => false),
      openDevTools: vi.fn(),
      closeDevTools: vi.fn(),
    },
  };
}

async function buildMenu(platform: NodeJS.Platform, isPackaged: boolean) {
  setPlatform(platform);
  state.isPackaged = isPackaged;
  vi.resetModules();
  const { registerAllShortcuts } = await import('../../src/main/shortcuts/registerAllShortcuts');
  registerAllShortcuts();
  const calls = state.buildFromTemplate.mock.calls;
  return calls[calls.length - 1][0] as MenuItemTemplate[];
}

function flatten(items: MenuItemTemplate[] = []): MenuItemTemplate[] {
  return items.flatMap((item) => [item, ...flatten(item.submenu)]);
}

function menu(template: MenuItemTemplate[], label: string): MenuItemTemplate[] {
  const found = template.find((t) => t.label === label);
  expect(found, `缺少顶层菜单「${label}」`).toBeTruthy();
  return found?.submenu ?? [];
}

function item(items: MenuItemTemplate[], label: string): MenuItemTemplate {
  const found = items.find((i) => i.label === label);
  expect(found, `缺少菜单项「${label}」`).toBeTruthy();
  return found as MenuItemTemplate;
}

/** 去掉分隔符后的标签序列（分隔符记为 ─） */
function labels(items: MenuItemTemplate[]): string[] {
  return items.map((i) => (i.type === 'separator' ? '─' : (i.label ?? i.role ?? '')));
}

let tempDir: string;

beforeEach(() => {
  state.focused = null;
  state.isPackaged = false;
  tempDir = mkdtempSync(join(tmpdir(), 'ne-menu-'));
  state.recent = [];
  state.recentListener = null;
  state.clearRecentFolders.mockClear();
  state.openExternal.mockClear();
  state.buildFromTemplate.mockClear();
  state.setApplicationMenu.mockClear();
});

afterEach(() => {
  setPlatform(originalPlatform);
  rmSync(tempDir, { recursive: true, force: true });
});

describe('应用菜单（macOS）', () => {
  it('顶层菜单为中文，应用菜单使用 APP_DISPLAY_NAME', async () => {
    const template = await buildMenu('darwin', true);
    expect(template.map((t) => t.label)).toEqual([
      '小说编辑器',
      '文件',
      '编辑',
      '视图',
      '窗口',
      '帮助',
    ]);
    // 不出现 package.json 的包名，也没有英文顶层菜单 / 原生 editMenu
    const all = flatten(template);
    expect(all.some((i) => i.label?.includes('@novel-editor'))).toBe(false);
    expect(template.some((t) => t.role === 'editMenu' || t.role === 'fileMenu')).toBe(false);
    for (const top of template) expect(top.label).toMatch(/^[一-龥]+$/);
  });

  it('应用菜单：关于 / 检查更新 / 设置 / 服务 / 隐藏 / 退出', async () => {
    const appMenu = menu(await buildMenu('darwin', true), '小说编辑器');
    expect(labels(appMenu)).toEqual([
      '关于 小说编辑器',
      '检查更新…',
      '─',
      '设置…',
      '─',
      '服务',
      '─',
      '隐藏 小说编辑器',
      '隐藏其他',
      '全部显示',
      '─',
      '退出 小说编辑器',
    ]);
    expect(item(appMenu, '设置…').accelerator).toBe('CommandOrControl+,');
    expect(item(appMenu, '服务').role).toBe('services');
    expect(item(appMenu, '隐藏 小说编辑器')).toMatchObject({
      role: 'hide',
      accelerator: 'CommandOrControl+H',
    });
    expect(item(appMenu, '隐藏其他')).toMatchObject({
      role: 'hideOthers',
      accelerator: 'CommandOrControl+Alt+H',
    });
    expect(item(appMenu, '退出 小说编辑器')).toMatchObject({
      role: 'quit',
      accelerator: 'CommandOrControl+Q',
    });
    // 不使用原生 about 面板
    expect(appMenu.some((i) => i.role === 'about')).toBe(false);
  });

  it('文件菜单：新建 / 打开 / 最近使用 / 保存 / 另存为 / 导出', async () => {
    const file = menu(await buildMenu('darwin', true), '文件');
    expect(labels(file)).toEqual([
      '新建文件',
      '打开文件夹…',
      '打开最近使用',
      '─',
      '保存',
      '另存为…',
      '─',
      '导出项目…',
    ]);
    expect(item(file, '新建文件').accelerator).toBe('CommandOrControl+N');
    expect(item(file, '打开文件夹…').accelerator).toBe('CommandOrControl+O');
    expect(item(file, '保存').accelerator).toBe('CommandOrControl+S');
    expect(item(file, '另存为…').accelerator).toBe('CommandOrControl+Shift+S');
    expect(item(file, '导出项目…').accelerator).toBe('CommandOrControl+Shift+E');
  });

  it('编辑菜单使用原生 role 与中文标签，并提供查找、灵感抽签与场景视频', async () => {
    const edit = menu(await buildMenu('darwin', true), '编辑');
    expect(labels(edit)).toEqual([
      '撤销',
      '重做',
      '─',
      '剪切',
      '复制',
      '粘贴',
      '全选',
      '─',
      '查找',
      '─',
      '灵感抽签…',
      '场景视频…',
    ]);
    expect(
      edit
        .slice(0, 7)
        .filter((i) => i.role)
        .map((i) => i.role)
    ).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);
    expect(item(edit, '撤销').accelerator).toBe('CommandOrControl+Z');
    expect(item(edit, '重做').accelerator).toBe('CommandOrControl+Shift+Z');
    expect(item(edit, '查找').accelerator).toBe('CommandOrControl+F');
    // 灵感抽签的加速键来自设置中心（默认 Mod+Shift+Y），与渲染进程按键一致
    expect(item(edit, '灵感抽签…').accelerator).toBe('CommandOrControl+Shift+Y');
    // 场景视频是固定加速键（config.ts），渲染进程同样处理并 preventDefault
    expect(item(edit, '场景视频…').accelerator).toBe('CommandOrControl+Alt+V');
  });

  it('视图菜单：打包版本不含重新加载 / 开发者工具', async () => {
    const view = menu(await buildMenu('darwin', true), '视图');
    expect(labels(view)).toEqual([
      '切换侧边栏',
      '切换右侧面板',
      '专注写作',
      '─',
      '放大',
      '缩小',
      '实际大小',
      '─',
      '切换全屏',
    ]);
    expect(item(view, '切换侧边栏').accelerator).toBe('CommandOrControl+B');
    expect(item(view, '切换右侧面板').accelerator).toBeUndefined();
    expect(item(view, '专注写作').accelerator).toBe('CommandOrControl+Shift+F');
    expect(item(view, '放大')).toMatchObject({ role: 'zoomIn', accelerator: 'CommandOrControl+=' });
    expect(item(view, '缩小')).toMatchObject({
      role: 'zoomOut',
      accelerator: 'CommandOrControl+-',
    });
    expect(item(view, '实际大小')).toMatchObject({
      role: 'resetZoom',
      accelerator: 'CommandOrControl+0',
    });
    expect(item(view, '切换全屏').accelerator).toBe('Control+Command+F');
  });

  it('开发模式视图菜单包含重新加载与开发者工具', async () => {
    const view = menu(await buildMenu('darwin', false), '视图');
    expect(item(view, '重新加载').accelerator).toBe('CommandOrControl+R');
    expect(item(view, '开发者工具').accelerator).toBe('CommandOrControl+Alt+I');
    const win = createWindow();
    state.focused = win;
    item(view, '重新加载').click?.();
    item(view, '开发者工具').click?.();
    item(view, '切换全屏').click?.();
    expect(win.reload).toHaveBeenCalledOnce();
    expect(win.webContents.openDevTools).toHaveBeenCalledOnce();
    expect(win.setFullScreen).toHaveBeenCalledWith(true);
  });

  it('生产版本的任何菜单里都没有开发者工具，也没有对应加速键', async () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const all = flatten(await buildMenu(platform, true));
      expect(all.some((entry) => entry.label?.includes('开发者工具')), platform).toBe(false);
      expect(
        all.some((entry) =>
          ['CommandOrControl+Alt+I', 'CommandOrControl+Shift+I'].includes(entry.accelerator ?? '')
        ),
        platform
      ).toBe(false);
    }
  });

  it('生产版本只有设置 NOVEL_EDITOR_ENABLE_DEVTOOLS=1 时帮助菜单才有开发者工具（内部排查）', async () => {
    process.env.NOVEL_EDITOR_ENABLE_DEVTOOLS = '1';
    try {
      const help = menu(await buildMenu('darwin', true), '帮助');
      expect(labels(help)).toContain('切换开发者工具');
    } finally {
      delete process.env.NOVEL_EDITOR_ENABLE_DEVTOOLS;
    }
  });

  it('生产版本直接调用 toggleDevTools 不会打开开发者工具', async () => {
    await buildMenu('darwin', true);
    const win = createWindow();
    state.focused = win;
    const { toggleDevTools } = await import('../../src/main/shortcuts/devtools');
    toggleDevTools();
    expect(win.webContents.openDevTools).not.toHaveBeenCalled();
  });

  it('窗口菜单：最小化 / 缩放 / 前置全部窗口', async () => {
    const template = await buildMenu('darwin', true);
    expect(template.find((t) => t.label === '窗口')?.role).toBe('windowMenu');
    const windowMenu = menu(template, '窗口');
    expect(labels(windowMenu)).toEqual(['最小化', '缩放', '─', '前置全部窗口']);
    expect(item(windowMenu, '最小化')).toMatchObject({
      role: 'minimize',
      accelerator: 'CommandOrControl+M',
    });
    expect(item(windowMenu, '缩放').role).toBe('zoom');
    expect(item(windowMenu, '前置全部窗口').role).toBe('front');
  });

  it('帮助菜单：快捷键说明 / 更新日志 / 上传日志 / 问题反馈（生产版本没有开发者工具）', async () => {
    const help = menu(await buildMenu('darwin', true), '帮助');
    expect(labels(help)).toEqual(['快捷键说明', '更新日志', '─', '上传日志…', '问题反馈']);
    item(help, '问题反馈').click?.();
    expect(state.openExternal).toHaveBeenCalledWith(
      'https://github.com/TaitaiWx/novel-editor-se/issues'
    );
  });

  it('菜单项发送对应的渲染进程事件', async () => {
    const template = await buildMenu('darwin', true);
    const win = createWindow();
    state.focused = win;
    const expectations: Array<[string, string, string]> = [
      ['小说编辑器', '检查更新…', 'menu-check-updates'],
      ['小说编辑器', '设置…', 'menu-open-settings'],
      ['文件', '新建文件', 'shortcut-new-file'],
      ['文件', '打开文件夹…', 'shortcut-open-folder'],
      ['文件', '保存', 'shortcut-save-file'],
      ['文件', '另存为…', 'shortcut-save-as-file'],
      ['文件', '导出项目…', 'menu-export-project'],
      ['编辑', '查找', 'menu-find'],
      ['编辑', '灵感抽签…', 'menu-open-inspiration'],
      ['编辑', '场景视频…', 'menu-open-scene-video'],
      ['视图', '切换侧边栏', 'menu-toggle-sidebar'],
      ['视图', '切换右侧面板', 'menu-toggle-right-panel'],
      ['视图', '专注写作', 'menu-toggle-focus-mode'],
      ['帮助', '快捷键说明', 'menu-show-shortcuts'],
      ['帮助', '更新日志', 'menu-open-changelog'],
      ['帮助', '上传日志…', 'menu-upload-logs'],
    ];
    for (const [top, label, channel] of expectations) {
      win.webContents.send.mockClear();
      item(menu(template, top), label).click?.();
      expect(win.webContents.send, `${top} → ${label}`).toHaveBeenCalledWith(channel);
    }
  });

  it('菜单事件通道都在 preload 白名单中', async () => {
    const { readFileSync } = await import('fs');
    const preload = readFileSync(join(__dirname, '../../src/main/preload.ts'), 'utf-8');
    const onBlock = preload.slice(
      preload.indexOf('on: (channel'),
      preload.indexOf('removeListener:')
    );
    const { APP_MENU_EVENTS } = await import('../../src/shared/app-menu');
    for (const channel of [
      ...Object.values(APP_MENU_EVENTS),
      'menu-open-about',
      'menu-export-project',
      'open-folder-request',
      'shortcut-save-as-file',
    ]) {
      expect(onBlock, channel).toContain(`'${channel}'`);
    }
    expect(preload).toContain("'menu-sync-shortcuts'");
  });
});

describe('打开最近使用', () => {
  it('列出仍存在的目录，点击走 open-folder-request，可清除', async () => {
    const missing = join(tempDir, '不存在');
    state.recent = [tempDir, missing];
    const recent =
      item(menu(await buildMenu('darwin', true), '文件'), '打开最近使用').submenu ?? [];
    expect(recent).toHaveLength(3);
    expect(recent[0].label).toContain(tempDir);
    expect(labels(recent).slice(1)).toEqual(['─', '清除最近使用']);

    const win = createWindow();
    state.focused = win;
    recent[0].click?.();
    expect(win.webContents.send).toHaveBeenCalledWith('open-folder-request', tempDir);
    item(recent, '清除最近使用').click?.();
    expect(state.clearRecentFolders).toHaveBeenCalledOnce();
  });

  it('没有记录时显示禁用的占位项', async () => {
    const recent = item(menu(await buildMenu('linux', true), '文件'), '打开最近使用').submenu ?? [];
    expect(recent).toEqual([{ label: '无最近使用的文件夹', enabled: false }]);
  });

  it('最近使用列表变化时重建菜单', async () => {
    await buildMenu('darwin', true);
    const builds = state.buildFromTemplate.mock.calls.length;
    state.recent = [tempDir];
    state.recentListener?.();
    expect(state.buildFromTemplate.mock.calls.length).toBe(builds + 1);
  });
});

describe('应用菜单（Windows / Linux）', () => {
  it('没有应用菜单；设置与退出在文件菜单，关于与检查更新在帮助菜单', async () => {
    for (const platform of ['win32', 'linux'] as const) {
      const template = await buildMenu(platform, true);
      expect(template.map((t) => t.label)).toEqual(['文件', '编辑', '视图', '窗口', '帮助']);
      const file = menu(template, '文件');
      expect(labels(file).slice(-4)).toEqual(['─', '设置…', '─', '退出']);
      expect(item(file, '设置…').accelerator).toBe('CommandOrControl+,');
      expect(item(file, '退出')).toMatchObject({ role: 'quit', accelerator: 'CommandOrControl+Q' });
      const help = menu(template, '帮助');
      expect(labels(help).slice(-3)).toEqual(['─', '检查更新…', '关于 小说编辑器']);
      expect(labels(menu(template, '窗口'))).toEqual(['最小化']);
      // F11 留给专注模式，全屏不设加速键
      expect(item(menu(template, '视图'), '切换全屏').accelerator).toBeUndefined();
      expect(flatten(template).some((i) => i.label?.includes('@novel-editor'))).toBe(false);
    }
  });

  it('帮助菜单「关于」通知渲染进程', async () => {
    const help = menu(await buildMenu('linux', true), '帮助');
    const win = createWindow();
    state.focused = win;
    item(help, '关于 小说编辑器').click?.();
    expect(win.webContents.send).toHaveBeenCalledWith('menu-open-about');
  });
});

describe('菜单加速键与快捷键总览一致', () => {
  it('每个带加速键的菜单项都出现在快捷键总览中（全屏 / 视图切换由渲染进程条目覆盖）', async () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const template = await buildMenu(platform, true);
      const { getAllShortcuts } = await import('../../src/main/shortcuts/getAllShortcuts');
      const { toElectronAccelerator } = await import('../../src/main/shortcuts/config');
      const listed = new Set(
        getAllShortcuts().map((s) => toElectronAccelerator(s.accelerator.replace('Mod+', 'Ctrl+')))
      );
      for (const entry of flatten(template)) {
        if (!entry.accelerator) continue;
        expect(listed.has(entry.accelerator), `${platform} ${entry.label}`).toBe(true);
      }
    }
  });
});
