/** Project export has no Electron/SQLite dependency: callers supply a database backup adapter. */
import { existsSync } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readdir, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { withWorkspaceLease } from './workspace-lock';
import { CoreError, toCoreError } from './errors';

export interface ProjectCopyOptions {
  /** Must create a standalone consistent SQLite database, never copy the live DB/WAL files. */
  backupDatabase?: (
    source: string,
    destination: string,
    roots: { sourceRoot: string; destinationRoot: string }
  ) => Promise<void>;
}

/**
 * Acquires the shared cooperative GUI/CLI lease. External editors are checked for changes,
 * but cannot be excluded by a cooperative protocol.
 * Stage on the destination filesystem and publish only after every file and database succeeds.
 */
export async function copyProjectTo(
  folderPath: string,
  destParent: string,
  options: ProjectCopyOptions = {}
): Promise<string> {
  return withWorkspaceLease(() => copyProjectSnapshot(folderPath, destParent, options), {
    resources: [folderPath, destParent],
  });
}

/** Detect non-participating writers, including SQLite WAL commits, before publication.
 * Metadata uses nanosecond timestamps and inode identity, so atomic replacement and writes
 * restoring original text/mtime still invalidate the snapshot. Directory timestamps and
 * SQLite shm are excluded (readers update shm); the complete entry set is compared instead.
 * This is change detection, not a filesystem snapshot against adversarial external writers.
 */
async function sourceFingerprint(root: string): Promise<string> {
  const entries: string[] = [];
  async function visit(file: string): Promise<void> {
    const name = path.basename(file);
    if (name.startsWith('.novel-editor-save-') && name.endsWith('.tmp')) return;
    if (
      path.basename(path.dirname(file)) === '.novel-editor' &&
      (name === 'session.json' || /\.db-shm$/i.test(name))
    )
      return;
    const info = await lstat(file, { bigint: true });
    if (info.isSymbolicLink()) throw new CoreError('UNSUPPORTED', '不能导出包含符号链接的项目目录');
    const relative = path.relative(root, file);
    if (info.isDirectory()) {
      entries.push(JSON.stringify([relative, 'directory', String(info.ino)]));
      for (const child of (await readdir(file)).sort()) await visit(path.join(file, child));
    } else {
      entries.push(
        JSON.stringify([
          relative,
          String(info.dev),
          String(info.ino),
          String(info.size),
          String(info.mtimeNs),
          String(info.ctimeNs),
        ])
      );
    }
  }
  await visit(root);
  return entries.join('\n');
}

async function copyProjectSnapshot(
  folderPath: string,
  destParent: string,
  options: ProjectCopyOptions
): Promise<string> {
  if (!existsSync(folderPath)) throw new CoreError('NOT_FOUND', '项目目录不存在');
  const source = await realpath(folderPath);
  const parent = await realpath(destParent);
  const relative = path.relative(source, parent);
  if (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  ) {
    throw new CoreError('IO_ERROR', '导出位置不能位于项目目录内');
  }
  const base = path.join(destParent, path.basename(folderPath));
  let destination = base;
  let index = 2;
  while (existsSync(destination)) destination = `${base} (${index++})`;
  const before = await sourceFingerprint(source);
  const stage = await mkdtemp(path.join(parent, '.novel-editor-export-'));
  const databases: Array<{ source: string; destination: string }> = [];
  try {
    await cp(source, stage, {
      recursive: true,
      filter: async (file) => {
        if ((await lstat(file)).isSymbolicLink())
          throw new CoreError('UNSUPPORTED', '不能导出包含符号链接的项目目录');
        const name = path.basename(file);
        if (name.startsWith('.novel-editor-save-') && name.endsWith('.tmp')) return false;
        if (path.basename(path.dirname(file)) !== '.novel-editor') return true;
        if (name === 'session.json' || /\.db-(wal|shm|journal)$/i.test(name)) return false;
        if (/\.db$/i.test(name)) {
          databases.push({
            source: file,
            destination: path.join(stage, path.relative(source, file)),
          });
          return false;
        }
        return true;
      },
    });
    for (const database of databases) {
      if (!options.backupDatabase) {
        throw new CoreError('UNSUPPORTED', '导出 SQLite 数据库需要提供一致性备份功能');
      }
      await mkdir(path.dirname(database.destination), { recursive: true });
      await options.backupDatabase(database.source, database.destination, {
        sourceRoot: folderPath,
        destinationRoot: destination,
      });
    }
    if ((await sourceFingerprint(source)) !== before) {
      throw new CoreError('IO_ERROR', '导出期间项目发生变化，请等待其他程序保存完成后重试');
    }
    // Cooperative exports are serialized across processes. Never merge into an old export.
    if (existsSync(destination)) throw new CoreError('ALREADY_EXISTS', '导出位置已被占用，请重试');
    await rename(stage, destination);
    return destination;
  } catch (error) {
    throw toCoreError(error, destParent);
  } finally {
    await rm(stage, { recursive: true, force: true }).catch(() => undefined);
  }
}
