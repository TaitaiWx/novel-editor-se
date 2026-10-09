import { withWorkspaceLease } from './workspace-lock';
/** 同目录临时文件落盘后原子替换，避免保存中断截断原正文。 */
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, open, readlink, realpath, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { CoreError } from './errors';

async function resolveWriteTarget(filePath: string, depth = 0): Promise<string> {
  try {
    return await realpath(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  // realpath 不接受尚未创建的文件；悬空链接仍应写入其目标，而不是覆盖链接本身。
  const entry = await lstat(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (entry?.isSymbolicLink()) {
    if (depth >= 40) throw new CoreError('IO_ERROR', `符号链接层级过深: ${filePath}`);
    return resolveWriteTarget(
      path.resolve(path.dirname(filePath), await readlink(filePath)),
      depth + 1
    );
  }
  return path.join(await realpath(path.dirname(filePath)), path.basename(filePath));
}

/** UTF-8 写入；不创建父目录。调用方负责路径授权及并发保存的先后顺序。 */
export async function atomicWriteTextFile(filePath: string, content: string): Promise<void> {
  return withWorkspaceLease(
    async () => {
      const target = await resolveWriteTarget(path.resolve(filePath));
      const previous = await stat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
      if (previous) {
        if (!previous.isFile()) throw new CoreError('NOT_A_FILE', `不是文件: ${filePath}`);
        // rename 本身只检查目录权限，另行保留原有不可写文件的保护。
        await access(target, constants.W_OK);
      }

      const temporary = path.join(path.dirname(target), `.novel-editor-save-${randomUUID()}.tmp`);
      // wx 保证不覆盖其他并发写入的临时文件；仅清理由本次成功创建的文件。
      const handle = await open(temporary, 'wx', previous ? 0o600 : 0o666);
      let closed = false;
      try {
        await handle.writeFile(content, 'utf8');
        if (previous) await handle.chmod(previous.mode & 0o7777);
        await handle.sync();
        await handle.close();
        closed = true;
        await rename(temporary, target);
      } finally {
        if (!closed) await handle.close().catch(() => undefined);
        // 失败时尽力清理；不得因清理失败掩盖最初的保存错误。
        await unlink(temporary).catch(() => undefined);
      }
    },
    { resources: [filePath] }
  );
}
