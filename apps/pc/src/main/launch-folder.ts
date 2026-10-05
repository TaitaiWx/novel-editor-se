/**
 * 启动参数中的工作区目录解析
 *
 * 支持 `ne open <path>` 以及系统层面的 `Novel Editor <path>` 启动方式：
 * - 打包版 argv: [exe, ...args]
 * - 开发版 argv: [electron, appPath, ...args]（需要跳过 appPath，例如 `electron .`）
 */
import { app } from 'electron';
import { statSync } from 'fs';
import path from 'path';

export function resolveLaunchFolder(argv: string[], cwd: string = process.cwd()): string | null {
  const userArgs = argv.slice(app.isPackaged ? 1 : 2);
  // 从后往前取最后一个有效目录，与 VS Code 打开多个路径时以最后一个为准的习惯一致
  for (let index = userArgs.length - 1; index >= 0; index -= 1) {
    const arg = userArgs[index];
    if (!arg || arg.startsWith('-')) continue;
    const resolved = path.resolve(cwd, arg);
    try {
      if (statSync(resolved).isDirectory()) return resolved;
    } catch {
      // 不存在的路径直接忽略
    }
  }
  return null;
}
