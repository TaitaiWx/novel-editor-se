/** Main-process capabilities. Only OS dialogs, trusted drop events and persisted recents grant paths. */
import { realpathSync, statSync } from 'node:fs';
import { lstat, realpath, readdir } from 'node:fs/promises';
import path from 'node:path';
import { classifyWorkspacePath } from '@novel-editor/core/internal-data';

type Sender = { id: number; once?: (event: 'destroyed', listener: () => void) => void };
type Grant = { path: string; real: string; directory: boolean; writable: boolean };
const grants = new Map<number, Grant[]>();

export function absolutePath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\0') ||
    value.split(/[\\/]/).includes('..') ||
    !path.isAbsolute(value)
  ) {
    throw new Error('无效的绝对路径');
  }
  return path.resolve(value);
}

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

/** Resolve a new file via its nearest existing ancestor; dangling links must fail closed. */
async function canonicalPath(target: string): Promise<string> {
  try {
    await lstat(target);
    return await realpath(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // Distinguish absent entries from dangling symlinks.
    const entry = await lstat(target).catch(() => null);
    if (entry?.isSymbolicLink()) throw new Error('无效的符号链接');
    const parent = path.dirname(target);
    if (parent === target) throw error;
    return path.join(await canonicalPath(parent), path.basename(target));
  }
}

export async function grantPathAccess(
  sender: Sender,
  value: unknown,
  directory: boolean,
  writable = true
): Promise<void> {
  const target = absolutePath(value);
  const real = await canonicalPath(target);
  if (directory && !(await lstat(real)).isDirectory()) throw new Error('不是文件夹');
  let entries = grants.get(sender.id);
  if (!entries) {
    entries = [];
    grants.set(sender.id, entries);
    sender.once?.('destroyed', () => grants.delete(sender.id));
  }
  const existing = entries.find((entry) => entry.path === target && entry.directory === directory);
  if (existing) {
    existing.real = real;
    existing.writable ||= writable;
  } else entries.push({ path: target, real, directory, writable });
}

/** Used only for synchronous OS drop dispatch, before renderer drop handlers run. */
export function grantDroppedPathAccess(sender: Sender, value: unknown): void {
  const target = absolutePath(value);
  // Match fs/promises.realpath, including expansion of Windows 8.3 aliases.
  const real = realpathSync.native(target);
  let entries = grants.get(sender.id);
  if (!entries) {
    entries = [];
    grants.set(sender.id, entries);
    sender.once?.('destroyed', () => grants.delete(sender.id));
  }
  // Dropped items are import sources only; dropping a folder does not open it as a workspace.
  entries.push({ path: target, real, directory: statSync(target).isDirectory(), writable: false });
}

export async function assertPathAccess(
  senderId: number | undefined,
  value: unknown,
  write = false
): Promise<string> {
  const target = absolutePath(value);
  const entries = senderId === undefined ? [] : (grants.get(senderId) ?? []);
  const candidates = entries.filter(
    (entry) =>
      (!write || entry.writable) &&
      (entry.directory ? within(entry.path, target) : entry.path === target)
  );
  if (!candidates.length) throw new Error('路径未授权，请先打开所在文件夹或选择该文件');
  const real = await canonicalPath(target);
  if (
    !candidates.some((entry) => (entry.directory ? within(entry.real, real) : entry.real === real))
  ) {
    throw new Error('路径指向授权范围之外');
  }
  return target;
}

export async function assertDirectoryAccess(
  senderId: number | undefined,
  value: unknown
): Promise<string> {
  const target = await assertPathAccess(senderId, value, true);
  const entries = senderId === undefined ? [] : (grants.get(senderId) ?? []);
  if (!entries.some((entry) => entry.directory && entry.writable && within(entry.path, target))) {
    throw new Error('文件夹未授权');
  }
  return target;
}

export function assertUserDataPath(value: unknown, workspaceRoot: string | null): void {
  const target = absolutePath(value);
  if (classifyWorkspacePath(target, workspaceRoot).kind !== 'user') {
    throw new Error('这是软件内部数据，不能直接修改，请在对应的界面中处理');
  }
}

/** Check both the visible name and its physical target (aliases must not bypass managed-data rules). */
export async function assertWritablePath(
  senderId: number | undefined,
  value: unknown,
  workspaceRoot: string | null
): Promise<string> {
  const target = await assertPathAccess(senderId, value, true);
  assertUserDataPath(target, workspaceRoot);
  assertUserDataPath(
    await canonicalPath(target),
    workspaceRoot ? await canonicalPath(workspaceRoot) : null
  );
  return target;
}

/** Destructive directory operations cannot mutate managed descendants or follow hidden symlinks. */
export async function assertMutableTree(
  senderId: number | undefined,
  target: string,
  root: string | null
): Promise<void> {
  await assertWritablePath(senderId, target, root);
  const info = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (info?.isDirectory()) {
    for (const entry of await readdir(target))
      await assertMutableTree(senderId, path.join(target, entry), root);
  }
}

export function childPath(folder: unknown, name: unknown): string {
  const parent = absolutePath(folder);
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[\\/\0]/.test(name)) {
    throw new Error('无效的文件名');
  }
  return path.join(parent, name);
}

export function resetPathAccessForTest(): void {
  grants.clear();
  mutations.clear();
}

/** Renaming an opened workspace grants exactly one new sibling name, only after rename succeeds. */
export async function assertWorkspaceRename(
  senderId: number | undefined,
  source: unknown,
  destination: unknown
): Promise<boolean> {
  const from = absolutePath(source);
  const to = absolutePath(destination);
  const entries = senderId === undefined ? [] : (grants.get(senderId) ?? []);
  if (!entries.some((entry) => entry.directory && entry.writable && entry.path === from))
    return false;
  await assertDirectoryAccess(senderId, from);
  if (path.dirname(from) !== path.dirname(to) || from === to)
    throw new Error('工作区只能在原位置更名');
  const existing = await lstat(to).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (existing) throw new Error('目标已存在');
  return true;
}

export function movePathAccess(source: string, destination: string): void {
  const newReal = realpathSync.native(destination);
  for (const entries of grants.values()) {
    for (const entry of entries) {
      if (!within(source, entry.path)) continue;
      const relative = path.relative(source, entry.path);
      entry.path = path.join(destination, relative);
      entry.real = path.join(newReal, relative);
    }
  }
}

/** Admission metadata only: the most specific directory capability containing a path.
 * This never grants access; handlers still validate the capability and its real target. */
export function getPathAccessLeaseRoot(
  senderId: number | undefined,
  target: string
): string | null {
  if (senderId === undefined) return null;
  const directories = (grants.get(senderId) ?? []).filter(
    (entry) => entry.directory && within(entry.path, target)
  );
  directories.sort((a, b) => b.path.length - a.path.length);
  return directories[0]?.path ?? null;
}

const mutations = new Map<symbol, string>();

/** Block new saves during delete/rename while previously queued saves are drained. */
export function beginPathMutation(value: unknown): () => void {
  const target = absolutePath(value);
  const key = Symbol(target);
  mutations.set(key, target);
  return () => {
    mutations.delete(key);
  };
}

export function assertNoPathMutation(value: unknown): void {
  const target = absolutePath(value);
  if ([...mutations.values()].some((root) => within(root, target))) {
    throw new Error('文件正在删除或移动，请稍后重试');
  }
}
