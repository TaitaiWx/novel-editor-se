import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const helper = require('../../scripts/dev-electron-app.cjs') as {
  devElectronPaths: (
    binary: string,
    version: string,
    pcRoot: string,
    displayName?: string
  ) => {
    sourceApp: string;
    cacheDir: string;
    targetApp: string;
    targetBinary: string;
    stampFile: string;
  };
  isCopyReady: (paths: { targetBinary: string; stampFile: string }, name: string) => boolean;
  writeLocalizedDisplayName: (appBundle: string, name: string) => void;
};

const BINARY = '/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron';

describe('开发用 Electron 副本（菜单栏显示应用名）', () => {
  it('副本放在 apps/pc/.electron-dev/v<版本>/<显示名>.app，可执行文件相对位置不变', () => {
    const paths = helper.devElectronPaths(BINARY, '42.3.3', '/repo/apps/pc', '小说编辑器');
    expect(paths.sourceApp).toBe('/repo/node_modules/electron/dist/Electron.app');
    expect(paths.cacheDir).toBe('/repo/apps/pc/.electron-dev/v42.3.3');
    expect(paths.targetApp).toBe('/repo/apps/pc/.electron-dev/v42.3.3/小说编辑器.app');
    expect(paths.targetBinary).toBe(
      '/repo/apps/pc/.electron-dev/v42.3.3/小说编辑器.app/Contents/MacOS/Electron'
    );
  });

  it('副本可用：可执行文件存在且记录的名称一致；名称变化或缺文件时重建', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dev-electron-'));
    const paths = helper.devElectronPaths(
      path.join(root, 'src/Electron.app/Contents/MacOS/Electron'),
      '1.0.0',
      root,
      '小说编辑器'
    );
    expect(helper.isCopyReady(paths, '小说编辑器')).toBe(false);
    mkdirSync(path.dirname(paths.targetBinary), { recursive: true });
    writeFileSync(paths.targetBinary, '');
    writeFileSync(paths.stampFile, '小说编辑器\n');
    expect(helper.isCopyReady(paths, '小说编辑器')).toBe(true);
    expect(helper.isCopyReady(paths, '新名字')).toBe(false);
  });

  it('每个 lproj 写入 UTF-16 的 CFBundleName 与 CFBundleDisplayName', () => {
    const app = mkdtempSync(path.join(os.tmpdir(), 'dev-electron-app-'));
    for (const lproj of ['zh_CN.lproj', 'en.lproj']) {
      mkdirSync(path.join(app, 'Contents', 'Resources', lproj), { recursive: true });
    }
    mkdirSync(path.join(app, 'Contents', 'Resources', 'not-a-locale'), { recursive: true });
    helper.writeLocalizedDisplayName(app, '小说编辑器');
    const bytes = readFileSync(
      path.join(app, 'Contents', 'Resources', 'zh_CN.lproj', 'InfoPlist.strings')
    );
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xfe]);
    const text = bytes.subarray(2).toString('utf16le');
    expect(text).toContain('"CFBundleName" = "小说编辑器";');
    expect(text).toContain('"CFBundleDisplayName" = "小说编辑器";');
  });
});
