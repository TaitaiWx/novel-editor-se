import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
function findFirstDirectory(parentDir: string, matcher: (name: string) => boolean): string | null {
  if (!existsSync(parentDir)) return null;
  const entry = readdirSync(parentDir, { withFileTypes: true }).find(
    (item) => item.isDirectory() && matcher(item.name)
  );
  return entry ? path.join(parentDir, entry.name) : null;
}

/** 按平台定位打包后的可执行文件；找不到返回 null */
export function resolvePackagedExecutable(
  buildDir: string,
  platform: NodeJS.Platform = process.platform
): string | null {
  if (platform === 'darwin') {
    const appOutDir = findFirstDirectory(buildDir, (name) => name.startsWith('mac'));
    const appBundle = appOutDir && findFirstDirectory(appOutDir, (name) => name.endsWith('.app'));
    if (!appBundle) return null;
    const executableName = path.basename(appBundle).replace(/\.app$/u, '');
    const executable = path.join(appBundle, 'Contents', 'MacOS', executableName);
    return existsSync(executable) ? executable : null;
  }

  const unpackedDir = findFirstDirectory(buildDir, (name) => name.endsWith('unpacked'));
  if (!unpackedDir) return null;
  const candidates = readdirSync(unpackedDir, { withFileTypes: true }).filter((entry) => {
    if (!entry.isFile()) return false;
    if (platform === 'win32') return entry.name.endsWith('.exe');
    return (
      !['chrome-sandbox', 'chrome_crashpad_handler'].includes(entry.name) &&
      !entry.name.includes('.') &&
      (statSync(path.join(unpackedDir, entry.name)).mode & 0o111) !== 0
    );
  });
  if (candidates.length > 1) throw new Error(`Ambiguous packaged executables in ${unpackedDir}`);
  return candidates[0] ? path.join(unpackedDir, candidates[0].name) : null;
}
