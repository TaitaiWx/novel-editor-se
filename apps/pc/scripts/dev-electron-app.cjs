/**
 * 开发 / 本地启动（pnpm dev、pnpm start）时让 macOS 菜单栏与 Dock 显示「小说编辑器」而不是「Electron」。
 *
 * 菜单栏标题来自 .app 的（本地化）CFBundleName。打包时由 afterPack（mac-localized-app-name.mjs）
 * 在每个 *.lproj 写入 InfoPlist.strings；开发时用的是 node_modules 里的 Electron.app，不能修改它，
 * 所以把它复制一份到 apps/pc/.electron-dev/v<版本>/（已 gitignore），对副本写入同样的本地化名称，
 * 再做一次 ad-hoc 重签名，然后用副本启动。Electron 版本变化或本地化名称变化时自动重建副本。
 * 任何一步失败都回退到原始 Electron（只是菜单栏仍显示 Electron，不影响开发）。
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/** 由 Electron 可执行文件路径推出 .app 路径与副本位置（纯函数，便于测试） */
function devElectronPaths(electronBinary, electronVersion, pcRoot, displayName = 'Electron') {
  const sourceApp = path.resolve(electronBinary, '..', '..', '..');
  const cacheDir = path.join(pcRoot, '.electron-dev', `v${electronVersion}`);
  // 副本的文件夹名也用显示名：Dock / 访达在没有本地化名称时会回退到文件名
  const targetApp = path.join(cacheDir, `${displayName}.app`);
  const relativeBinary = path.relative(sourceApp, electronBinary);
  return {
    sourceApp,
    cacheDir,
    targetApp,
    targetBinary: path.join(targetApp, relativeBinary),
    stampFile: path.join(cacheDir, '.localized-name'),
  };
}

/**
 * 在副本的每个 *.lproj 里追加本地化的 CFBundleDisplayName（Dock 悬停提示优先用它）。
 * 只用于开发副本：Electron 用未本地化的 CFBundleName 找 Helper，显示名不影响启动
 */
function writeLocalizedDisplayName(appBundle, name) {
  const resources = path.join(appBundle, 'Contents', 'Resources');
  const escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const text = `"CFBundleName" = "${escaped}";\n"CFBundleDisplayName" = "${escaped}";\n`;
  const content = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  for (const entry of fs.readdirSync(resources, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.endsWith('.lproj')) {
      fs.writeFileSync(path.join(resources, entry.name, 'InfoPlist.strings'), content);
    }
  }
}

/** 副本是否可用：可执行文件存在且记录的本地化名称与当前一致 */
function isCopyReady(paths, localizedName, fsApi = fs) {
  try {
    return (
      fsApi.existsSync(paths.targetBinary) &&
      fsApi.readFileSync(paths.stampFile, 'utf-8').trim() === localizedName
    );
  } catch {
    return false;
  }
}

/** 准备带本地化名称的 Electron 副本，返回应该启动的可执行文件路径 */
async function prepareDevElectronApp(electronBinary) {
  if (process.platform !== 'darwin') return electronBinary;
  if (!electronBinary.includes('.app/')) return electronBinary;
  const pcRoot = path.resolve(__dirname, '..');
  const { version } = require('electron/package.json');
  const localization = await import(
    pathToFileURL(path.join(__dirname, 'mac-localized-app-name.mjs')).href
  );
  const name = localization.MAC_LOCALIZED_APP_NAME;
  const paths = devElectronPaths(electronBinary, version, pcRoot, name);
  if (isCopyReady(paths, name)) return paths.targetBinary;

  // 旧版本的副本一并清掉，只保留当前版本
  fs.rmSync(path.join(pcRoot, '.electron-dev'), { recursive: true, force: true });
  fs.mkdirSync(paths.cacheDir, { recursive: true });
  // ditto 保留符号链接与扩展属性（Electron.app 里的 Frameworks 依赖符号链接）
  execFileSync('ditto', [paths.sourceApp, paths.targetApp]);
  await localization.writeLocalizedAppName(paths.targetApp, name);
  writeLocalizedDisplayName(paths.targetApp, name);
  try {
    // 修改了资源，重新 ad-hoc 签名，避免系统认为签名无效
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', paths.targetApp], {
      stdio: 'ignore',
    });
  } catch {
    // 签名失败通常不影响本机开发运行
  }
  fs.writeFileSync(paths.stampFile, `${name}\n`);
  console.log(`[dev] 已准备显示为「${name}」的 Electron 副本：${paths.targetApp}`);
  return paths.targetBinary;
}

module.exports = {
  devElectronPaths,
  isCopyReady,
  prepareDevElectronApp,
  writeLocalizedDisplayName,
};
