/**
 * Cooperative writer/snapshot leases. A single bakery ticket covers the complete resource set;
 * only overlapping canonical paths contend (unknown resource sets use a wildcard).
 * Local filesystems only; applications running as another OS user and external editors do not
 * participate. No TTL stealing: a slow live owner is never mistaken for a crashed process.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import {
  lstat,
  readlink,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export interface WorkspaceLeaseOptions {
  /** Override only for isolated tools/tests; GUI and CLI use the same default. */
  lockDirectory?: string;
  timeoutMs?: number;
  /** Absolute or cwd-relative paths; omitted/empty means conservative user-wide exclusion. */
  resources?: readonly string[];
}
type LeaseScope = { directory: string; active: boolean; resources: string[] | null };
const leases = new AsyncLocalStorage<LeaseScope>();
const defaultDirectory = path.join(homedir(), '.novel-editor', 'workspace-locks-v1');
const ticketName = /^(\d+)-[\da-f-]+\.ticket$/;
const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 15));

/** Short Windows sharing/delete-pending conflicts affect reads, replacement, and removal. */
async function retryTicketIO<T>(
  operation: () => Promise<T>,
  checkTimeout: () => void = () => {}
): Promise<T> {
  for (let retry = 0; ; retry++) {
    if (retry > 0) checkTimeout();
    try {
      return await operation();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (retry >= 8 || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '')) throw error;
      checkTimeout();
      await delay();
    }
  }
}

function isDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    // EPERM is a live process we cannot signal; PID reuse conservatively blocks until timeout.
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

/** Canonicalize even not-yet-created paths and dangling symlinks; never silently ignore errors. */
async function canonicalPath(input: string, depth = 0): Promise<string> {
  if (depth > 40) throw new Error('Workspace resource symlink nesting is too deep');
  const absolute = path.resolve(input);
  try {
    return await realpath(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const entry = await lstat(absolute).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (entry?.isSymbolicLink())
    return canonicalPath(path.resolve(path.dirname(absolute), await readlink(absolute)), depth + 1);
  const parent = path.dirname(absolute);
  if (parent === absolute) throw new Error('Cannot canonicalize workspace resource');
  return path.join(await canonicalPath(parent, depth), path.basename(absolute));
}

export async function canonicalWorkspaceResources(
  resources?: readonly string[]
): Promise<string[] | null> {
  if (!resources?.length) return null;
  const resolved = await Promise.all(
    resources.map(async (resource) => {
      if (typeof resource !== 'string' || !resource) throw new Error('Invalid workspace resource');
      const canonical = await canonicalPath(resource);
      // Folding may over-exclude a case-sensitive macOS volume, but never splits aliases.
      const paths = [path.resolve(resource), canonical];
      return process.platform === 'win32' || process.platform === 'darwin'
        ? paths.map((value) => value.toLowerCase())
        : paths;
    })
  );
  const unique = [...new Set(resolved.flat())].sort();
  return unique.filter(
    (resource) => !unique.some((parent) => parent !== resource && contains(parent, resource))
  );
}

function contains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}
export function workspaceResourcesConflict(
  a: readonly string[] | null,
  b: readonly string[] | null
): boolean {
  return (
    !a || !b || a.some((left) => b.some((right) => contains(left, right) || contains(right, left)))
  );
}
function covered(held: string[] | null, requested: string[] | null): boolean {
  return (
    !held ||
    (!!requested &&
      requested.every((resource) => held.some((parent) => contains(parent, resource))))
  );
}
interface Ticket {
  number: number;
  resources: string[] | null;
}
async function readTicket(
  directory: string,
  name: string,
  checkTimeout: () => void
): Promise<Ticket | null> {
  const match = ticketName.exec(name);
  if (!match) return null;
  const file = path.join(directory, name);
  if (isDead(Number(match[1]))) {
    await retryTicketIO(() => unlink(file), checkTimeout).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    return null;
  }
  try {
    const text = await retryTicketIO(() => readFile(file, 'utf8'), checkTimeout);
    if (text === '') return { number: 0, resources: null };
    // Old tickets are deliberately wildcard, so legacy live owners remain excluded.
    const value = JSON.parse(text);
    const ticket: Ticket = typeof value === 'number' ? { number: value, resources: null } : value;
    if (
      !ticket ||
      !Number.isSafeInteger(ticket.number) ||
      ticket.number <= 0 ||
      (ticket.resources !== null &&
        (!Array.isArray(ticket.resources) ||
          !ticket.resources.length ||
          ticket.resources.some(
            (item: unknown) => typeof item !== 'string' || !path.isAbsolute(item)
          )))
    )
      throw new Error('Invalid workspace lock ticket');
    return ticket;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Lamport bakery admission with atomic ticket publication; each contender owns only its UUID. */
export async function withWorkspaceLease<T>(
  task: () => T | Promise<T>,
  options: WorkspaceLeaseOptions = {}
): Promise<T> {
  const requested = path.resolve(options.lockDirectory ?? defaultDirectory);
  const inherited = leases.getStore();
  // Unspecified nested helpers operate inside the already declared outer scope.
  if (inherited?.active && inherited.directory === requested && !options.resources) return task();
  const resources = await canonicalWorkspaceResources(options.resources);
  await mkdir(requested, { recursive: true, mode: 0o700 });
  const directory = await realpath(requested);
  if (inherited?.active && inherited.directory === directory) {
    if (!options.resources || covered(inherited.resources, resources)) return task();
    throw new Error(
      'Nested workspace lease requests undeclared resources; acquire the complete resource set at the operation boundary'
    );
  }
  const name = `${process.pid}-${randomUUID()}.ticket`;
  const file = path.join(directory, name);
  const temporary = `${file}.tmp`;
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  const checkTimeout = () => {
    if (Date.now() > deadline) throw new Error('工作区正在由其他进程保存或导出，请稍后重试');
  };
  let ownsTicket = false;
  const scope: LeaseScope = { directory, active: true, resources };
  try {
    const choosing = await open(file, 'wx', 0o600);
    ownsTicket = true;
    await choosing.close();
    let maximum = 0;
    for (const other of await readdir(directory)) {
      maximum = Math.max(maximum, (await readTicket(directory, other, checkTimeout))?.number ?? 0);
    }
    const number = maximum + 1;
    if (!Number.isSafeInteger(number)) throw new Error('Workspace lock ticket overflow');
    await writeFile(temporary, JSON.stringify({ number, resources }), { flag: 'wx', mode: 0o600 });
    // Keep the empty choosing ticket visible while replacement is retried; never unlink
    // it to make publication succeed or admit the task without a published ticket.
    await retryTicketIO(() => rename(temporary, file), checkTimeout);
    for (const other of await readdir(directory)) {
      if (other === name || !ticketName.test(other)) continue;
      for (;;) {
        const ticket = await readTicket(directory, other, checkTimeout);
        if (
          ticket === null ||
          !workspaceResourcesConflict(resources, ticket.resources) ||
          (ticket.number > 0 &&
            (ticket.number > number || (ticket.number === number && other > name)))
        )
          break;
        checkTimeout();
        await delay();
      }
    }
    // A preceding rename may have changed a symlink while we waited. Extending an admitted
    // ticket would split exclusion, so fail closed and let the caller retry from fresh paths.
    if (
      JSON.stringify(await canonicalWorkspaceResources(options.resources)) !==
      JSON.stringify(resources)
    )
      throw new Error('工作区路径在等待保存期间发生变化，请重试');
    return await leases.run(scope, task);
  } finally {
    scope.active = false;
    await retryTicketIO(() => unlink(temporary)).catch(() => undefined);
    if (ownsTicket) await retryTicketIO(() => unlink(file)).catch(() => undefined);
  }
}

/** Detached work must not inherit its parent's lease, which may finish before the job. */
export function runOutsideWorkspaceLease<T>(task: () => T): T {
  return leases.exit(task);
}

interface WriterGroup {
  pending: Array<() => void>;
  users: number;
  enter?: (task: () => void) => void;
  release?: () => void;
  fail: Array<(error: unknown) => void>;
}
const writerGroups = new Map<string, WriterGroup>();

/**
 * GUI writers already have per-file queues and admission guards which must start in call
 * order. Let them share one process lease until every admitted callback settles; external
 * processes still see a single exclusive owner. Snapshots use withWorkspaceLease after
 * draining the GUI's existing in-process writer barrier.
 */
export async function withWorkspaceWriterLease<T>(
  task: () => T | Promise<T>,
  options: WorkspaceLeaseOptions = {}
): Promise<T> {
  if (leases.getStore()?.active) return withWorkspaceLease(task, options);
  const resources = await canonicalWorkspaceResources(options.resources);
  const directory = JSON.stringify([options.lockDirectory ?? defaultDirectory, resources]);
  let group = writerGroups.get(directory);
  const first = !group;
  if (!group) {
    group = { pending: [], users: 0, fail: [] };
    writerGroups.set(directory, group);
  }
  const cohort = group;
  cohort.users++;
  const result = new Promise<T>((resolve, reject) => {
    cohort.fail.push(reject);
    const finish = () => {
      if (--cohort.users === 0) {
        writerGroups.delete(directory);
        cohort.release?.();
      }
    };
    const run = () => {
      // Start synchronously to preserve IPC admission / per-file queue order.
      try {
        Promise.resolve(task()).then(resolve, reject).finally(finish);
      } catch (error) {
        reject(error);
        finish();
      }
    };
    if (cohort.enter) cohort.enter(run);
    else cohort.pending.push(run);
  });
  if (first) {
    void withWorkspaceLease(async () => {
      const scope = leases.getStore()!;
      const finished = new Promise<void>((resolve) => {
        cohort.release = resolve;
      });
      cohort.enter = (run) => {
        leases.run(scope, run);
      };
      for (const run of cohort.pending.splice(0)) cohort.enter(run);
      await finished;
    }, options).catch((error) => {
      writerGroups.delete(directory);
      for (const reject of cohort.fail) reject(error);
    });
  }
  return result;
}
