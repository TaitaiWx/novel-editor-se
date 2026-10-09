import { ipcMain } from 'electron';
import path from 'node:path';
import { resolveWritingLogRoot } from '@novel-editor/core';
import { getDatabase } from '@novel-editor/store';
import { getVideoWorkspaceResources } from './video/workspace-resources';
import { getWorkspaceRootForSender } from './handlers/session';
import { getPathAccessLeaseRoot } from './path-access';
import { withWorkspaceMutation, withWorkspaceSnapshot } from './workspace-mutation-gate';

// These channels have explicit path arguments. Unknown/dialog-selected resources remain
// wildcard until the operation has a dedicated resource declaration at its commit boundary.
const firstPath = new Set([
  'read-file',
  'read-file-binary',
  'write-file',
  'get-file-info',
  'open-in-system-app',
  'show-item-in-folder',
  'watch-file',
  'unwatch-file',
  'create-file',
  'create-directory',
  'refresh-folder',
  'cleanup-empty-generated-material-directories',
  'delete-file',
  'delete-directory',
  'read-xlsx-data',
  'read-pptx-data',
  'read-docx-data',
  'character-avatar-save',
  'entity-image-save',
  'entity-image-delete',
  'save-analysis-file',
  'project-structure-get',
  'project-structure-set',
]);
const firstPathArray = new Set(['get-file-info-batch', 'get-files-exist']);
const databaseChannels = /^(?:db-|ai-cache-|ai-providers-|ai-models-|ai-proxy-|video-settings-)/;
// Database initialization switches a process-wide connection, so must exclude all admitted I/O.
const switchingDatabase = new Set(['db-init', 'db-init-default', 'db-close']);
// These handlers build/configure their provider synchronously and only return network data
// after the first await. Keep setup protected while releasing before the response wait.
const networkOnly = new Set(['ai-request', 'ai-complete', 'ai-models-test', 'ai-providers-test']);
const usesDatabase = (channel: string) =>
  databaseChannels.test(channel) ||
  channel === 'memory-sync-snapshots' ||
  networkOnly.has(channel) ||
  channel.startsWith('video-task-') ||
  channel === 'ai-image-generate' ||
  channel === 'ai-speech-synthesize';

function databasePath(): string | null {
  try {
    const name = getDatabase().name;
    return typeof name === 'string' && path.isAbsolute(name) ? name : null;
  } catch {
    return null;
  }
}
function absolute(value: unknown): value is string {
  return typeof value === 'string' && !!value && !value.includes('\0') && path.isAbsolute(value);
}
async function resourcesFor(
  channel: string,
  senderId: number | undefined,
  args: unknown[]
): Promise<string[] | undefined> {
  if (switchingDatabase.has(channel)) return undefined;
  if (channel.startsWith('video-task-')) {
    const extraWorkPath =
      channel === 'video-task-submit'
        ? (args[0] as { workPath?: unknown } | undefined)?.workPath
        : undefined;
    if (channel === 'video-task-submit' && !absolute(extraWorkPath)) return undefined;
    return getVideoWorkspaceResources(extraWorkPath).resources;
  }
  const workspace = getWorkspaceRootForSender(senderId);
  const resources = workspace ? [workspace] : [];
  if (firstPath.has(channel)) {
    if (!absolute(args[0])) return undefined;
    resources.push(args[0]);
    if (channel === 'write-file') {
      const logRoot = await resolveWritingLogRoot(args[0], workspace);
      if (logRoot) resources.push(logRoot);
    }
  } else if (firstPathArray.has(channel)) {
    if (!Array.isArray(args[0]) || !args[0].every(absolute)) return undefined;
    resources.push(...args[0]);
  } else if (channel === 'rename-file') {
    if (!absolute(args[0]) || !absolute(args[1])) return undefined;
    resources.push(args[0], args[1]);
  } else if (channel === 'paste-files') {
    if (!Array.isArray(args[0]) || !args[0].every(absolute) || !absolute(args[1])) return undefined;
    resources.push(...args[0], args[1]);
  } else if (channel.startsWith('growth-') || channel === 'memory-sync-snapshots') {
    if (!absolute(args[0])) return undefined;
    resources.push(args[0]);
    if (channel === 'memory-sync-snapshots') {
      const database = databasePath();
      if (!database) return undefined;
      resources.push(database);
    }
  } else if (
    channel.startsWith('video-scene-') ||
    channel.startsWith('scene-audio-') ||
    channel === 'ai-image-generate' ||
    channel === 'ai-speech-synthesize'
  ) {
    const workPath = (args[0] as { workPath?: unknown } | undefined)?.workPath;
    if (!absolute(workPath) && channel !== 'ai-image-generate') return undefined;
    if (absolute(workPath)) resources.push(workPath);
    if (usesDatabase(channel)) {
      const database = databasePath();
      if (!database) return undefined;
      resources.push(database);
    }
  } else if (channel === 'gui-session-publish') {
    const root = (args[0] as { workspaceRoot?: unknown } | null)?.workspaceRoot;
    if (root !== undefined && !absolute(root)) return undefined;
    if (root) resources.push(root);
  } else if (usesDatabase(channel)) {
    const database = databasePath();
    if (!database) return undefined;
    resources.push(database);
    // Folder arguments of database APIs are scopes/metadata or version snapshot sources.
    if (
      channel.includes('by-folder') ||
      channel.startsWith('db-version-') ||
      channel === 'db-export-knowledge-text'
    ) {
      if (absolute(args[0])) resources.push(args[0]);
    }
    if (channel === 'db-novel-create' && absolute(args[1])) resources.push(args[1]);
    if (channel === 'db-novel-get-by-folder' && absolute(args[0])) resources.push(args[0]);
    // File dialogs choose a destination/source only after admission; use wildcard for them.
    if (channel === 'db-export-to-file' || channel === 'db-import-from-file') return undefined;
  } else return undefined;
  // Before the first session publication, authorized directory capabilities still supply
  // a stable cohort for saves/delete/rename queues in that same opened directory.
  for (const resource of [...resources]) {
    const root = getPathAccessLeaseRoot(senderId, resource);
    if (root) resources.push(root);
  }
  return resources.length ? resources : undefined;
}

/** Scoped declarations are admission metadata; handlers still enforce path authorization. */
interface WorkspaceHandlerOptions {
  /** Synchronous lifecycle admission; return a cleanup to release when the operation settles. */
  beforeAdmission?: (
    ...args: Parameters<Parameters<typeof ipcMain.handle>[1]>
  ) => void | (() => void);
}
export function registerWorkspaceHandler(
  channel: Parameters<typeof ipcMain.handle>[0],
  listener: Parameters<typeof ipcMain.handle>[1],
  options: WorkspaceHandlerOptions = {}
): void {
  ipcMain.handle(channel, (event, ...args) => {
    let release: void | (() => void);
    try {
      release = options.beforeAdmission?.(event, ...args);
    } catch (error) {
      return Promise.reject(error);
    }
    const finish = () => release?.();
    if (switchingDatabase.has(channel))
      return withWorkspaceSnapshot(async () => listener(event, ...args)).finally(finish);
    const database = databasePath();
    let resources: string[] | undefined;
    const declared = resourcesFor(channel, event?.sender?.id, args).then((value) => {
      resources = value;
      return { resources: value };
    });
    const invoke = () => {
      // A queued database switch must never let an operation access an undeclared new DB.
      if (resources && usesDatabase(channel) && databasePath() !== database)
        throw new Error('项目数据库已切换，请重新执行此操作');
      return listener(event, ...args);
    };
    if (networkOnly.has(channel))
      return withWorkspaceMutation(() => ({ result: invoke() }), declared)
        .then(({ result }) => result)
        .finally(finish);
    return withWorkspaceMutation(invoke, declared).finally(finish);
  });
}
