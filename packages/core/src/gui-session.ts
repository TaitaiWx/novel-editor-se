import { withWorkspaceLease } from './workspace-lock';
/**
 * GUI 会话文件（`ne status` 读取 GUI 状态的数据来源）
 *
 * 存储位置：<project>/.novel-editor/session.json
 * 写入方：GUI 渲染进程把打开的标签、当前文件、未保存文件经 IPC（gui-session-publish）交给主进程，
 *         主进程调用 writeGuiSession 防抖写入；窗口关闭 / 切换文件夹 / 退出时调用 markGuiSessionClosed。
 * 读取方：CLI `ne status` 调用 readGuiSession，按 pid 存活与 updatedAt 新鲜度判断会话是否仍然有效。
 *
 * GUI 运行期间会定期（GUI_SESSION_HEARTBEAT_MS）重新发布以刷新 updatedAt，
 * 因此 updatedAt 超过 GUI_SESSION_STALE_MS 即视为过期（例如 GUI 崩溃未能清理）。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_META_DIR } from './project';

export const GUI_SESSION_FILE = 'session.json';
/** GUI 刷新会话文件的心跳间隔 */
export const GUI_SESSION_HEARTBEAT_MS = 60 * 1000;
/** 超过该时长未刷新的会话视为过期 */
export const GUI_SESSION_STALE_MS = 5 * 60 * 1000;

export interface GuiSessionFile {
  /** 绝对路径；未命名标签为 `__untitled__:<名称>` */
  path: string;
  /** 相对项目根的路径（未命名标签或不在项目内时为 null） */
  relativePath: string | null;
  /** 是否有未保存的修改 */
  dirty: boolean;
  /** 是否为尚未保存到磁盘的未命名标签 */
  untitled: boolean;
}

export interface GuiSession {
  schemaVersion: 1;
  /** 主进程 pid，用于判断 GUI 是否仍在运行 */
  pid: number;
  appVersion: string | null;
  /** GUI 打开的文件夹 */
  workspaceRoot: string;
  /** open：GUI 正在使用该文件夹；closed：窗口已关闭或已切换到其他文件夹 */
  state: 'open' | 'closed';
  activeFile: string | null;
  openFiles: GuiSessionFile[];
  /** 有未保存修改的文件（openFiles 中 dirty 的子集，便于直接读取） */
  dirtyFiles: string[];
  startedAt: string;
  updatedAt: string;
}

/** 渲染进程上报的会话快照（主进程补全 pid / 版本 / 时间戳） */
export interface GuiSessionSnapshot {
  workspaceRoot: string;
  activeFile: string | null;
  openFiles: Array<{ path: string; dirty: boolean }>;
}

export type GuiSessionStatus = 'active' | 'closed' | 'stale' | 'none';

export interface GuiSessionReadResult {
  status: GuiSessionStatus;
  /** status 为 stale 时的原因 */
  reason?: 'pid-not-alive' | 'outdated';
  session: GuiSession | null;
}

const UNTITLED_PREFIX = '__untitled__:';

export function getGuiSessionPath(projectRoot: string): string {
  return path.join(projectRoot, PROJECT_META_DIR, GUI_SESSION_FILE);
}

function toRelative(root: string, filePath: string): string | null {
  if (filePath.startsWith(UNTITLED_PREFIX)) return null;
  const relative = path.relative(root, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join('/');
}

/** 由渲染进程快照构造完整会话对象 */
export function buildGuiSession(
  snapshot: GuiSessionSnapshot,
  meta: { pid: number; appVersion?: string | null; startedAt?: string; now?: Date }
): GuiSession {
  const root = path.resolve(snapshot.workspaceRoot);
  const seen = new Set<string>();
  const openFiles: GuiSessionFile[] = [];
  for (const file of snapshot.openFiles) {
    if (!file.path || seen.has(file.path)) continue;
    seen.add(file.path);
    openFiles.push({
      path: file.path,
      relativePath: toRelative(root, file.path),
      dirty: Boolean(file.dirty),
      untitled: file.path.startsWith(UNTITLED_PREFIX),
    });
  }
  const now = (meta.now ?? new Date()).toISOString();
  return {
    schemaVersion: 1,
    pid: meta.pid,
    appVersion: meta.appVersion ?? null,
    workspaceRoot: root,
    state: 'open',
    activeFile: snapshot.activeFile,
    openFiles,
    dirtyFiles: openFiles.filter((file) => file.dirty).map((file) => file.path),
    startedAt: meta.startedAt ?? now,
    updatedAt: now,
  };
}

async function saveJsonAtomic(target: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  await rename(temp, target);
}

export async function writeGuiSession(session: GuiSession): Promise<void> {
  return withWorkspaceLease(
    async () => {
      await saveJsonAtomic(getGuiSessionPath(session.workspaceRoot), session);
    },
    { resources: [session.workspaceRoot] }
  );
}

async function readRawGuiSession(projectRoot: string): Promise<GuiSession | null> {
  try {
    const raw = JSON.parse(await readFile(getGuiSessionPath(projectRoot), 'utf-8')) as GuiSession;
    if (raw && typeof raw.pid === 'number' && Array.isArray(raw.openFiles)) return raw;
  } catch {
    // 文件不存在或损坏时视为没有会话
  }
  return null;
}

/**
 * 标记会话已关闭（保留最后的打开文件列表，方便排查）。
 * 只处理 pid 匹配的会话，避免误关另一个 GUI 进程刚写入的会话。
 */
export async function markGuiSessionClosed(
  projectRoot: string,
  pid: number,
  now = new Date()
): Promise<boolean> {
  return withWorkspaceLease(
    async () => {
      const session = await readRawGuiSession(projectRoot);
      if (!session || session.pid !== pid || session.state === 'closed') return false;
      await saveJsonAtomic(getGuiSessionPath(projectRoot), {
        ...session,
        state: 'closed',
        updatedAt: now.toISOString(),
      });
      return true;
    },
    { resources: [projectRoot] }
  );
}

/** 进程是否存活（EPERM 表示进程存在但无权发信号，同样视为存活） */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface ReadGuiSessionOptions {
  now?: Date;
  staleMs?: number;
  isPidAlive?: (pid: number) => boolean;
}

/** 读取并判定 GUI 会话状态：active / closed / stale（pid 不存在或过久未刷新）/ none */
export async function readGuiSession(
  projectRoot: string,
  options: ReadGuiSessionOptions = {}
): Promise<GuiSessionReadResult> {
  const session = await readRawGuiSession(projectRoot);
  if (!session) return { status: 'none', session: null };
  if (session.state === 'closed') return { status: 'closed', session };
  const alive = (options.isPidAlive ?? isProcessAlive)(session.pid);
  if (!alive) return { status: 'stale', reason: 'pid-not-alive', session };
  const now = (options.now ?? new Date()).getTime();
  const updatedAt = new Date(session.updatedAt).getTime();
  const staleMs = options.staleMs ?? GUI_SESSION_STALE_MS;
  if (!Number.isFinite(updatedAt) || now - updatedAt > staleMs) {
    return { status: 'stale', reason: 'outdated', session };
  }
  return { status: 'active', session };
}
