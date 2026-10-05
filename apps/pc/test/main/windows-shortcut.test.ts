import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const state = vi.hoisted(() => ({
  isPackaged: true,
  root: '',
  writeShortcutLink: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return state.isPackaged;
    },
    getPath: (name: string) => join(state.root, name),
  },
  shell: { writeShortcutLink: state.writeShortcutLink },
}));

import { ensureWindowsShortcuts } from '../../src/main/windows-shortcut';

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

describe('ensureWindowsShortcuts', () => {
  beforeEach(() => {
    state.root = mkdtempSync(join(tmpdir(), 'ne-shortcut-'));
    state.isPackaged = true;
    state.writeShortcutLink.mockReset();
    setPlatform('win32');
  });

  afterEach(() => {
    setPlatform(originalPlatform);
    rmSync(state.root, { recursive: true, force: true });
  });

  const desktopPath = () => join(state.root, 'desktop', 'Novel Editor.lnk');
  const startMenuPath = () =>
    join(
      state.root,
      'appData',
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      'Novel Editor.lnk'
    );

  it('非 Windows 平台不做任何事', async () => {
    setPlatform('darwin');
    await ensureWindowsShortcuts();
    expect(state.writeShortcutLink).not.toHaveBeenCalled();
  });

  it('开发模式（未打包）不做任何事', async () => {
    state.isPackaged = false;
    await ensureWindowsShortcuts();
    expect(state.writeShortcutLink).not.toHaveBeenCalled();
  });

  it('以 replace 模式写入桌面和开始菜单快捷方式并创建目录', async () => {
    state.writeShortcutLink.mockReturnValue(true);
    await ensureWindowsShortcuts();

    expect(state.writeShortcutLink).toHaveBeenCalledTimes(2);
    const expectedOptions = {
      target: process.execPath,
      cwd: dirname(process.execPath),
      description: 'Novel Editor',
      icon: process.execPath,
      iconIndex: 0,
    };
    expect(state.writeShortcutLink).toHaveBeenCalledWith(desktopPath(), 'replace', expectedOptions);
    expect(state.writeShortcutLink).toHaveBeenCalledWith(
      startMenuPath(),
      'replace',
      expectedOptions
    );
    expect(existsSync(dirname(desktopPath()))).toBe(true);
    expect(existsSync(dirname(startMenuPath()))).toBe(true);
  });

  it('replace 失败（快捷方式不存在）时回退为创建', async () => {
    state.writeShortcutLink.mockImplementation((_path: string, operation: unknown) =>
      typeof operation === 'string' ? false : true
    );
    await ensureWindowsShortcuts();
    expect(state.writeShortcutLink).toHaveBeenCalledTimes(4);
    const createCalls = state.writeShortcutLink.mock.calls.filter(
      (call: unknown[]) => typeof call[1] === 'object'
    );
    expect(createCalls.map((call: unknown[]) => call[0]).sort()).toEqual(
      [desktopPath(), startMenuPath()].sort()
    );
  });
});
