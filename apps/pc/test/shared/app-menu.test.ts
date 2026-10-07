import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  APP_MENU_EVENTS,
  CHANGELOG_TAB_PATH,
  DEFAULT_MENU_SHORTCUT_BINDINGS,
  normalizeMenuShortcutBindings,
  toMenuAccelerator,
} from '../../src/shared/app-menu';
import { APP_DISPLAY_NAME } from '../../src/shared/about';
import { DEFAULT_SHORTCUT_SETTINGS } from '../../src/render/utils/appSettings';
import {
  buildInfoPlistStrings,
  MAC_LOCALIZED_APP_NAME,
  writeLocalizedAppName,
} from '../../scripts/mac-localized-app-name.mjs';

describe('toMenuAccelerator', () => {
  it('把渲染进程格式转换为 Electron 加速键', () => {
    expect(toMenuAccelerator('Mod+B')).toBe('CommandOrControl+B');
    expect(toMenuAccelerator('Mod+Shift+F')).toBe('CommandOrControl+Shift+F');
    expect(toMenuAccelerator('alt+mod+l')).toBe('CommandOrControl+Alt+L');
    expect(toMenuAccelerator('Cmd+Option+Space')).toBe('CommandOrControl+Alt+Space');
    expect(toMenuAccelerator('F11')).toBe('F11');
    expect(toMenuAccelerator('Mod+=')).toBe('CommandOrControl+=');
  });

  it('非法、空值或无修饰键的普通键返回 null', () => {
    expect(toMenuAccelerator('')).toBeNull();
    expect(toMenuAccelerator(undefined)).toBeNull();
    expect(toMenuAccelerator(42)).toBeNull();
    expect(toMenuAccelerator('B')).toBeNull();
    expect(toMenuAccelerator('Mod+B+C')).toBeNull();
    expect(toMenuAccelerator('Mod+Shift')).toBeNull();
    expect(toMenuAccelerator('Mod+<script>')).toBeNull();
    expect(toMenuAccelerator('Mod+Shift+Alt+Ctrl+B')).toBeNull();
  });
});

describe('normalizeMenuShortcutBindings', () => {
  it('缺失或类型错误的字段回退为默认值，空字符串保留（表示未绑定）', () => {
    expect(normalizeMenuShortcutBindings(null)).toEqual(DEFAULT_MENU_SHORTCUT_BINDINGS);
    expect(normalizeMenuShortcutBindings(['x'])).toEqual(DEFAULT_MENU_SHORTCUT_BINDINGS);
    expect(normalizeMenuShortcutBindings({ toggleSidebar: '', toggleFocusMode: 1 })).toEqual({
      toggleSidebar: '',
      toggleFocusMode: 'Mod+Shift+F',
      openInspiration: 'Mod+Shift+Y',
    });
    expect(normalizeMenuShortcutBindings({ openInspiration: 'Mod+Alt+I' }).openInspiration).toBe(
      'Mod+Alt+I'
    );
  });

  it('默认值与渲染进程设置的默认快捷键一致', () => {
    expect(DEFAULT_MENU_SHORTCUT_BINDINGS.toggleSidebar).toBe(
      DEFAULT_SHORTCUT_SETTINGS.toggleSidebar
    );
    expect(DEFAULT_MENU_SHORTCUT_BINDINGS.toggleFocusMode).toBe(
      DEFAULT_SHORTCUT_SETTINGS.toggleFocusMode
    );
    expect(DEFAULT_MENU_SHORTCUT_BINDINGS.openInspiration).toBe(
      DEFAULT_SHORTCUT_SETTINGS.openInspiration
    );
  });

  it('事件通道唯一，更新日志标签路径与渲染进程约定一致', () => {
    const channels = Object.values(APP_MENU_EVENTS);
    expect(new Set(channels).size).toBe(channels.length);
    expect(channels.every((c) => c.startsWith('menu-'))).toBe(true);
    expect(CHANGELOG_TAB_PATH).toBe('__changelog__:更新日志');
  });
});

describe('macOS 本地化应用名（afterPack）', () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('名称与 APP_DISPLAY_NAME 一致，内容为 UTF-16 LE + BOM', () => {
    expect(MAC_LOCALIZED_APP_NAME).toBe(APP_DISPLAY_NAME);
    const buf = buildInfoPlistStrings();
    expect([buf[0], buf[1]]).toEqual([0xff, 0xfe]);
    expect(buf.subarray(2).toString('utf16le')).toBe(`"CFBundleName" = "${APP_DISPLAY_NAME}";\n`);
  });

  it('写入每个 lproj，不修改 Info.plist', async () => {
    dir = mkdtempSync(join(tmpdir(), 'ne-lproj-'));
    const app = join(dir, 'Novel Editor.app');
    const resources = join(app, 'Contents', 'Resources');
    for (const name of ['en.lproj', 'zh_CN.lproj'])
      mkdirSync(join(resources, name), { recursive: true });
    writeFileSync(join(resources, 'app.asar'), '');
    const plist = join(app, 'Contents', 'Info.plist');
    writeFileSync(
      plist,
      '<plist><dict><key>CFBundleName</key><string>Novel Editor</string></dict></plist>'
    );

    expect(await writeLocalizedAppName(app)).toBe(2);
    const zh = readFileSync(join(resources, 'zh_CN.lproj', 'InfoPlist.strings'));
    expect(zh.subarray(2).toString('utf16le')).toContain('小说编辑器');
    expect(readFileSync(plist, 'utf-8')).toContain('<string>Novel Editor</string>');
  });
});
