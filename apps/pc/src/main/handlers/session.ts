import { withBackgroundWorkspaceMutation } from '../workspace-mutation-gate';
import { registerWorkspaceHandler } from '../workspace-ipc';
/**
 * GUI 会话 IPC Handlers
 *
 * Handles: gui-session-publish
 *
 * 渲染进程把「打开的文件夹 / 标签 / 当前文件 / 未保存文件」防抖上报到这里，
 * 主进程补全 pid、版本与时间戳后写入 <folder>/.novel-editor/session.json（实现见 @novel-editor/core gui-session），
 * 供 CLI `ne status` 读取。窗口销毁、切换文件夹或上报 null 时把旧文件夹的会话标记为 closed。
 *
 * 同时记录每个窗口当前打开的文件夹：write-file 记录写作日志时，
 * 若文件不在 `ne init` 项目内，日志回退写入该文件夹的 .novel-editor/。
 */
import { app } from 'electron';
import path from 'path';
import { assertDirectoryAccess, assertPathAccess, assertNoPathMutation } from '../path-access';
import {
  buildGuiSession,
  markGuiSessionClosed,
  readGuiSession,
  writeGuiSession,
  type GuiSessionSnapshot,
} from '@novel-editor/core';

interface SenderLike {
  id: number;
  once?: (event: 'destroyed', listener: () => void) => void;
}

interface SenderSession {
  root: string;
  startedAt: string;
}

const senderSessions = new Map<number, SenderSession>();
/** 已监听 destroyed 事件的窗口，避免重复注册 */
const watchedSenders = new Set<number>();
/** 按文件夹串行化会话文件写入，避免关闭标记与最后一次发布交错 */
const rootQueues = new Map<string, Promise<void>>();

function enqueue(root: string, task: () => Promise<unknown>): Promise<void> {
  const previous = rootQueues.get(root) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(task)
    .then(() => undefined);
  rootQueues.set(root, next);
  void next
    .catch(() => undefined)
    .then(() => {
      if (rootQueues.get(root) === next) rootQueues.delete(root);
    });
  return next;
}

function getAppVersion(): string | null {
  try {
    return app.getVersion();
  } catch {
    return null;
  }
}

/** 某个窗口（webContents）当前打开的文件夹；未上报时返回 null */
export function getWorkspaceRootForSender(senderId: number | undefined): string | null {
  if (senderId === undefined) return null;
  return senderSessions.get(senderId)?.root ?? null;
}

export async function closeGuiSessionForSender(senderId: number): Promise<void> {
  const current = senderSessions.get(senderId);
  if (!current) return;
  // 另一个窗口仍在使用同一文件夹时不标记关闭
  const stillUsed = Array.from(senderSessions.entries()).some(
    ([id, item]) => id !== senderId && item.root === current.root
  );
  if (!stillUsed)
    await enqueue(current.root, () => markGuiSessionClosed(current.root, process.pid));
  senderSessions.delete(senderId);
}

/** Window destruction is detached from any IPC/lease context that emitted the event. */
async function closeDestroyedGuiSession(senderId: number): Promise<void> {
  for (;;) {
    const current = senderSessions.get(senderId);
    if (!current) return;
    const root = current.root;
    const closed = await withBackgroundWorkspaceMutation(
      async () => {
        // A queued workspace rename can move this session before admission. Release the old
        // declaration before retrying the new root, rather than recreating its previous path.
        if (senderSessions.get(senderId) !== current || current.root !== root) return false;
        await closeGuiSessionForSender(senderId);
        return true;
      },
      { resources: [root] }
    );
    if (closed) return;
  }
}

/** 处理一次会话上报；snapshot 为 null 表示该窗口已关闭文件夹 */
export async function publishGuiSession(
  sender: SenderLike,
  snapshot: GuiSessionSnapshot | null
): Promise<void> {
  if (snapshot) {
    assertNoPathMutation(snapshot.workspaceRoot);
    await assertDirectoryAccess(sender.id, snapshot.workspaceRoot);
    await assertPathAccess(
      sender.id,
      path.join(snapshot.workspaceRoot, '.novel-editor', 'session.json'),
      true
    );
  }
  const previous = senderSessions.get(sender.id);
  const nextRoot = snapshot?.workspaceRoot ? path.resolve(snapshot.workspaceRoot) : null;

  if (previous && previous.root !== nextRoot) {
    await closeGuiSessionForSender(sender.id);
  }
  if (!snapshot || !nextRoot) return;
  assertNoPathMutation(nextRoot);

  if (!watchedSenders.has(sender.id)) {
    // 首次上报时监听窗口销毁（含应用退出），把会话标记为 closed
    watchedSenders.add(sender.id);
    sender.once?.('destroyed', () => {
      watchedSenders.delete(sender.id);
      void closeDestroyedGuiSession(sender.id).catch(() => undefined);
    });
  }
  if (!senderSessions.has(sender.id)) {
    senderSessions.set(sender.id, { root: nextRoot, startedAt: new Date().toISOString() });
  }
  const { startedAt } = senderSessions.get(sender.id) as SenderSession;
  const session = buildGuiSession(
    { ...snapshot, workspaceRoot: nextRoot },
    { pid: process.pid, appVersion: getAppVersion(), startedAt }
  );
  await enqueue(nextRoot, () => writeGuiSession(session));
}

/** Wait for already submitted session metadata before moving a workspace. */
export async function drainGuiSessionRoot(root: string): Promise<void> {
  await rootQueues.get(root)?.catch(() => undefined);
}

/** Workspace rename already succeeded on disk; keep subsequent publication and save logs scoped to its new path. */
export function moveGuiSessionRoot(source: string, destination: string): void {
  for (const session of senderSessions.values()) {
    if (session.root === source) session.root = destination;
  }
}

/** Capture the flushed state before closing; failed native handoff restores it under the writer barrier. */
export async function captureGuiSessionRestore(): Promise<
  (isAlive: (senderId: number) => boolean) => Promise<void>
> {
  await Promise.all(rootQueues.values());
  const senders = new Map([...senderSessions].map(([id, session]) => [id, { ...session }]));
  const roots = [...new Set([...senders.values()].map((session) => session.root))];
  const snapshots = await Promise.all(
    roots.map(async (root) => (await readGuiSession(root)).session)
  );
  return async (isAlive) => {
    const liveRoots = new Set<string>();
    for (const [id, session] of senders) {
      if (!isAlive(id)) continue;
      senderSessions.set(id, session);
      liveRoots.add(session.root);
    }
    await Promise.all(
      snapshots.map((session) => {
        if (!session || !liveRoots.has(session.workspaceRoot)) return;
        return enqueue(session.workspaceRoot, () =>
          writeGuiSession({
            ...session,
            state: 'open',
            updatedAt: new Date().toISOString(),
          })
        );
      })
    );
  };
}

/** 应用退出前把所有会话标记为关闭 */
export async function closeAllGuiSessions(): Promise<void> {
  for (const id of Array.from(senderSessions.keys())) await closeGuiSessionForSender(id);
  await Promise.all(rootQueues.values());
}

/** 仅供测试：清空内存状态 */
export function resetGuiSessionsForTest(): void {
  senderSessions.clear();
  watchedSenders.clear();
  rootQueues.clear();
}

export function registerSessionHandlers(): void {
  registerWorkspaceHandler(
    'gui-session-publish',
    async (event: { sender: SenderLike }, snapshot: GuiSessionSnapshot | null) => {
      try {
        await publishGuiSession(event.sender, snapshot);
        return { success: true };
      } catch (error) {
        // 会话文件只是给 CLI 的提示信息，写入失败不影响编辑
        console.warn('[gui-session] publish failed:', error);
        return { success: false };
      }
    }
  );
}
