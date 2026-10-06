/**
 * electron-builder afterPack 钩子：让 macOS 菜单栏的应用名显示为「小说编辑器」。
 *
 * 菜单栏的应用菜单标题由系统根据 CFBundleName 决定（Electron 菜单模板里的 label 不生效）。
 * 不能直接改 Info.plist 的 CFBundleName / productName：
 * - productName 决定 .app 文件名、安装路径与自动更新产物名，修改会破坏升级
 * - Electron 用 Info.plist 中（未本地化的）CFBundleName 查找 "<名称> Helper.app"，
 *   改成中文会找不到 Helper 而启动崩溃（electron-builder#6962）
 *
 * 因此只在 Contents/Resources 下每个 *.lproj 写入本地化的 InfoPlist.strings（UTF-16 LE + BOM）：
 * 系统展示用的本地化名称变为「小说编辑器」，infoDictionary 中的 CFBundleName 仍为 productName，
 * app.getName() / userData 目录（由 package.json 决定）均不受影响。签名在 afterPack 之后进行。
 */
import { readdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';

/** 与 src/shared/about.ts 的 APP_DISPLAY_NAME 保持一致（由单测校验） */
export const MAC_LOCALIZED_APP_NAME = '小说编辑器';

/** 生成 InfoPlist.strings 内容（UTF-16 LE，带 BOM） */
export function buildInfoPlistStrings(name = MAC_LOCALIZED_APP_NAME) {
  const escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const text = `"CFBundleName" = "${escaped}";\n`;
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}

/** 向 .app/Contents/Resources 下所有 *.lproj 写入 InfoPlist.strings，返回写入的目录数 */
export async function writeLocalizedAppName(appBundlePath, name = MAC_LOCALIZED_APP_NAME) {
  const resourcesDir = join(appBundlePath, 'Contents', 'Resources');
  const entries = await readdir(resourcesDir, { withFileTypes: true });
  const content = buildInfoPlistStrings(name);
  const lprojDirs = entries.filter((entry) => entry.isDirectory() && entry.name.endsWith('.lproj'));
  await Promise.all(
    lprojDirs.map((entry) =>
      writeFile(join(resourcesDir, entry.name, 'InfoPlist.strings'), content)
    )
  );
  return lprojDirs.length;
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin' && context.electronPlatformName !== 'mas') return;
  const productFilename = context.packager.appInfo.productFilename;
  const appBundlePath = join(context.appOutDir, `${productFilename}.app`);
  const count = await writeLocalizedAppName(appBundlePath);
  console.log(`  • 已写入本地化应用名「${MAC_LOCALIZED_APP_NAME}」到 ${count} 个 lproj`);
}

// 允许手动对已打包的 .app 执行：node scripts/mac-localized-app-name.mjs "<路径>/Novel Editor.app"
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2]) {
  writeLocalizedAppName(process.argv[2]).catch((error) => {
    console.error('写入本地化应用名失败:', error);
    process.exit(1);
  });
}
