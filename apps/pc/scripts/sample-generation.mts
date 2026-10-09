/** 示例生成只在隔离目录内执行；完整成功后发布，失败保留原目录。 */
import { cp, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { isProcessAlive, readGuiSession, withWorkspaceLease } from '@novel-editor/core';

async function rejectLinks(root: string): Promise<void> {
  const info = await lstat(root);
  if (info.isSymbolicLink()) throw new Error('生成目标中不能包含符号链接');
  if (info.isDirectory()) {
    for (const name of await readdir(root)) await rejectLinks(path.join(root, name));
  }
}

async function validateTarget(root: string): Promise<boolean> {
  const info = await lstat(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!info) return false;
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new Error('示例目标必须是普通目录，不能是符号链接');
  const entries = await readdir(root);
  if (entries.length) {
    const meta = await readFile(path.join(root, '.novel-editor/sample.json'), 'utf8')
      .then((value) => JSON.parse(value) as { sampleVersion?: unknown })
      .catch(() => null);
    if (!meta || !Number.isInteger(meta.sampleVersion) || Number(meta.sampleVersion) < 1) {
      throw new Error('目标不是已标记的示例目录；请使用空目录生成，不能覆盖作者项目');
    }
  }
  await rejectLinks(root);
  const { session } = await readGuiSession(root);
  // 即使心跳过期，只要持有该工作区的进程仍活着，也不能交换它正在使用的目录。
  if (session?.state === 'open' && isProcessAlive(session.pid)) {
    throw new Error('示例正在应用中打开，请先关闭该工作区再生成');
  }
  return true;
}

type Identity = { dev: number; ino: number };
interface Journal {
  version: 1;
  pid: number;
  target: string;
  stage: string;
  backup: string;
  original: Identity | null;
  generated: Identity;
}

async function identity(file: string): Promise<Identity | null> {
  const info = await lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!info) return null;
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error(`事务路径不是普通目录：${file}`);
  return { dev: info.dev, ino: info.ino };
}
function same(a: Identity | null, b: Identity | null): boolean {
  return a === null ? b === null : b !== null && a.dev === b.dev && a.ino === b.ino;
}
async function syncPath(file: string): Promise<void> {
  const handle = await open(file, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function syncTree(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) await syncTree(file);
    else await syncPath(file);
  }
  if (process.platform !== 'win32') await syncPath(root);
}
async function syncParent(root: string): Promise<void> {
  if (process.platform !== 'win32') await syncPath(path.dirname(root));
}
function validIdentity(value: unknown): value is Identity {
  if (!value || typeof value !== 'object') return false;
  const v = value as Identity;
  return Number.isSafeInteger(v.dev) && Number.isSafeInteger(v.ino);
}
async function readJournal(lockPath: string, root: string): Promise<Journal | null> {
  const raw = await readFile(lockPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (raw === null) return null;
  const j = JSON.parse(raw) as Journal;
  const prefix = `.${path.basename(root)}.generate-`;
  if (
    j.version !== 1 ||
    j.target !== root ||
    !Number.isSafeInteger(j.pid) ||
    j.pid <= 0 ||
    typeof j.stage !== 'string' ||
    path.dirname(j.stage) !== path.dirname(root) ||
    !path.basename(j.stage).startsWith(prefix) ||
    j.backup !== `${j.stage}.previous` ||
    !validIdentity(j.generated) ||
    !(j.original === null || validIdentity(j.original))
  ) {
    throw new Error(`未知示例生成记录，保留现场：${lockPath}`);
  }
  return j;
}

/** Only remove directories whose inode belongs to this journal; never guess at unknown backups. */
async function recover(j: Journal, lockPath: string): Promise<void> {
  const current = await identity(j.target);
  const stage = await identity(j.stage);
  const backup = await identity(j.backup);
  if ((stage && !same(stage, j.generated)) || (backup && !same(backup, j.original))) {
    throw new Error('示例恢复目录身份不符，保留锁与备份');
  }
  if (same(current, j.generated)) {
    // The second rename committed: preserve the complete new generation.
    if (stage) throw new Error('示例恢复目录重复，保留现场');
  } else if (current === null && backup) {
    await rename(j.backup, j.target);
    await syncParent(j.target);
  } else if (!same(current, j.original) || backup) {
    throw new Error('示例目标已被外部替换，保留锁与备份');
  }
  if (stage) await rm(j.stage, { recursive: true });
  if (same(current, j.generated) && backup) await rm(j.backup, { recursive: true });
  await rm(lockPath);
  await syncParent(j.target);
}

export interface PublicationOptions {
  /** Maintenance diagnostics; errors abort publication and recover the previous tree. */
  checkpoint?: (phase: 'prepared' | 'backed-up' | 'published') => Promise<void>;
}

/** apply=false previews in isolation; next invocation recovers an interrupted known transaction. */
export async function publishGeneratedSample(
  target: string,
  generate: (stage: string) => Promise<void>,
  apply: boolean,
  options: PublicationOptions = {}
): Promise<void> {
  const root = path.resolve(target);
  if (root === path.parse(root).root) throw new Error('不能把根目录作为示例目标');
  await withWorkspaceLease(
    async () => {
      await mkdir(path.dirname(root), { recursive: true });
      const lockPath = path.join(path.dirname(root), `.${path.basename(root)}.generation.lock`);
      const previous = await readJournal(lockPath, root);
      if (previous) {
        if (isProcessAlive(previous.pid)) throw new Error(`示例生成锁已存在：${lockPath}`);
        await recover(previous, lockPath);
      }
      const existed = await validateTarget(root);
      const original = await identity(root);
      const stage = await mkdtemp(
        path.join(path.dirname(root), `.${path.basename(root)}.generate-`)
      );
      const generated = await identity(stage);
      if (!generated) throw new Error('暂存目录消失');
      const journal: Journal = {
        version: 1,
        pid: process.pid,
        target: root,
        stage,
        backup: `${stage}.previous`,
        original,
        generated,
      };
      // Persist intent before touching the original. A partial/unknown journal fails closed.
      const handle = await open(lockPath, 'wx');
      try {
        await handle.writeFile(JSON.stringify(journal));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await syncParent(root);
      try {
        if (existed) await cp(root, stage, { recursive: true, dereference: false });
        await generate(stage);
        await rejectLinks(stage);
        if (!apply) return;
        await validateTarget(root);
        if (!same(await identity(root), original)) throw new Error('示例目录在生成期间已被替换');
        await syncTree(stage);
        await options.checkpoint?.('prepared');
        if (existed) {
          await rename(root, journal.backup);
          await syncParent(root);
        }
        await options.checkpoint?.('backed-up');
        await rename(stage, root);
        await syncParent(root);
        await options.checkpoint?.('published');
      } finally {
        // Handles ordinary failures; SIGKILL recovery takes the same path on next invocation.
        await recover(journal, lockPath);
      }
    },
    { timeoutMs: 10_000 }
  );
}
