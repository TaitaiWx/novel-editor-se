/** 检查维护脚本的 JS/CJS/ESM 语法；不会执行脚本或触发生成/发布操作。 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @param {string} directory */
function checkDirectory(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) checkDirectory(file);
    else if (/\.(?:cjs|mjs|js)$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
      if (result.status !== 0) process.exitCode = 1;
    }
  }
}
const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
checkDirectory(scriptsDirectory);
checkDirectory(path.resolve(scriptsDirectory, '../../../scripts'));

checkDirectory(path.resolve(scriptsDirectory, '../signing'));
