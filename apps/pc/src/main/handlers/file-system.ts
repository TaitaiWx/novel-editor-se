import { registerWorkspaceHandler } from '../workspace-ipc';
/**
 * File System IPC Handlers
 *
 * Handles: file read/write, directory operations, file watching, clipboard paths
 *
 * 纯文件逻辑统一由 @novel-editor/core 实现（与 CLI 共用同一套代码），
 * 这里只保留 Electron 专属能力（dialog / shell / clipboard / app 路径 / fs.watch 推送）
 * 并负责保持 IPC 通道名、参数与返回结构不变。
 */
import { ipcMain, dialog, clipboard as electronClipboard, shell, BrowserWindow } from 'electron';
import { watch, existsSync } from 'fs';
import { readFile, lstat, readdir } from 'fs/promises';
import path from 'path';
import {
  cleanupEmptyWorkMaterialDirectories,
  createDirectory,
  createFile,
  deleteDirectory,
  deleteFile,
  ensureSeededDirectory,
  getFileInfo,
  getFileInfoBatch,
  filterInternalDataTree,
  isCoreError,
  isStoryFile,
  pastePaths,
  readFileBinary,
  buildFileTree,
  GENERATED_MATERIAL_ROOT_NAME,
  loadProjectFromConfig,
  migrateLegacyProjectMaterials,
  readProjectLayout,
  readTextFileWithEncoding,
  recordStoryFileSave,
  resolveWritingLogRoot,
  WRITING_LOG_FILE,
  PROJECT_META_DIR,
  renamePath,
  saveTextFile,
} from '@novel-editor/core';
import { exportPreparedProject } from '../project-export';
import { requestRendererPreparation } from '../renderer-preparation';
import { getNativeBinding } from '../native-binding';
import { backupDatabaseFile } from '@novel-editor/store';
import { createKeyedSerialQueue } from '../keyed-serial-queue';
import { addRecentFolder } from '../recent-folders';
import { getSampleDataPaths, syncSampleData, takeSampleUpgradeNotice } from '../sample-data';
import { getWorkspaceRootForSender, moveGuiSessionRoot, drainGuiSessionRoot } from './session';
import { checkFilesExist } from './files-exist';
import {
  assertWorkspaceRename,
  beginPathMutation,
  assertNoPathMutation,
  movePathAccess,
  absolutePath,
  assertPathAccess,
  assertDirectoryAccess,
  assertUserDataPath,
  assertWritablePath,
  assertMutableTree,
  childPath,
  grantPathAccess,
  grantDroppedPathAccess,
} from '../path-access';
import { getRecentFolders } from '../recent-folders';

// ─── Types ──────────────────────────────────────────────────────────────────

export type { FileNode } from '@novel-editor/core';

// ─── Helpers ────────────────────────────────────────────────────────────────

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 外部链接白名单：只允许 http(s) 与 mailto，拒绝 file: / javascript: 等 */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * 通用 write-file 不允许写入软件内部数据（core internal-data：成长档案 JSON、分镜状态、提示词记录、
 * .novel-editor/）与由它们派生的只读摘要；这些文件只能经专用 IPC（growth-* / video-scene-* 等）写入
 */
export function assertWritableByRenderer(filePath: unknown, workspaceRoot: string | null): void {
  assertUserDataPath(filePath, workspaceRoot);
}

/** 示例数据：用户文档目录下的副本，以及随应用分发的种子目录 */
/** 读取保存前的文件内容；文件不存在（新建）时返回 null */
async function readPreviousContent(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * 读取文件夹树，并附带 `ne init` 项目结构（作品根目录与作品列表，没有配置时为 null），
 * 渲染进程据此按「作品 / 卷 / 章」展示正文，与 CLI 的 `ne novel list` / `ne chapter list` 同一口径
 */
async function readAuthorizedProjectLayout(senderId: number | undefined, folderPath: string) {
  const configPath = path.join(folderPath, '.novel-editor', 'config.json');
  await assertPathAccess(senderId, configPath);
  if (!existsSync(configPath)) return null;
  const config = await loadProjectFromConfig(configPath);
  await assertDirectoryAccess(senderId, config.novelsPath);
  const project = await readProjectLayout(folderPath);
  if (project) {
    for (const novel of project.novels) {
      await assertDirectoryAccess(senderId, path.join(project.novelsPath, novel));
      await assertPathAccess(
        senderId,
        path.join(project.novelsPath, novel, GENERATED_MATERIAL_ROOT_NAME),
        true
      );
    }
  }
  return project;
}

async function readWorkspaceTree(folderPath: string, senderId: number | undefined) {
  // Validate migration paths before the legacy migration can move material folders.
  let project = await readAuthorizedProjectLayout(senderId, folderPath).catch((error: unknown) => {
    console.warn('[project] 读取项目配置失败，按普通文件夹展示:', errorMessage(error));
    return null;
  });
  if (project) {
    await assertPathAccess(senderId, path.join(folderPath, GENERATED_MATERIAL_ROOT_NAME), true);
    await migrateLegacyProjectMaterials(folderPath)
      .then((result) => {
        if (result.migrated) console.info(`[project] 已把项目资料移入作品: ${result.to}`);
      })
      .catch((error: unknown) =>
        console.warn('[project] 迁移项目资料失败，保留在原处:', errorMessage(error))
      );
    project = await readAuthorizedProjectLayout(senderId, folderPath);
  }
  // Do not traverse symlink directories merely to display a tree; individual approved links may still be opened.
  const files = existsSync(folderPath)
    ? await buildFileTree(folderPath, {
        includeHidden: false,
        sort: 'none',
        includeSize: false,
        followSymlinks: false,
        skipUnreadable: true,
      })
    : [];
  return { path: folderPath, files: filterInternalDataTree(files, folderPath), project };
}

function isStructuralContainer(target: string, root: string | null): boolean {
  return !path
    .relative(root ?? path.parse(target).root, target)
    .split(path.sep)
    .some((part) => part === GENERATED_MATERIAL_ROOT_NAME || part === '.novel-editor');
}

async function assertReadableTree(senderId: number | undefined, target: string): Promise<void> {
  await assertPathAccess(senderId, target);
  const info = await lstat(target);
  if (info.isSymbolicLink()) throw new Error('不能整体操作包含符号链接的目录');
  if (info.isDirectory()) {
    for (const entry of await readdir(target))
      await assertReadableTree(senderId, path.join(target, entry));
  }
}

async function assertCopyTree(
  senderId: number | undefined,
  source: string,
  dest: string,
  root: string | null
): Promise<void> {
  await assertPathAccess(senderId, source);
  assertUserDataPath(source, root);
  await assertWritablePath(senderId, dest, root);
  const info = await lstat(source);
  // fs.cp preserves links: reject them instead of importing references outside the workspace.
  if (info.isSymbolicLink()) throw new Error('不能复制符号链接');
  if (info.isDirectory()) {
    for (const entry of await readdir(source))
      await assertCopyTree(senderId, path.join(source, entry), path.join(dest, entry), root);
  }
}

// ─── File watchers ──────────────────────────────────────────────────────────

const fileWatchers = new Map<string, { close: () => void }>();

// ─── Register handlers ─────────────────────────────────────────────────────

/** write-file 按文件路径串行 */
const writeQueue = createKeyedSerialQueue();

/** Await every already accepted text write before snapshot or shutdown. */
export async function drainFileWrites(): Promise<void> {
  while (writeQueue.size() > 0) await writeQueue.drain(() => true);
}

export function registerFileSystemHandlers(): void {
  ipcMain.on('authorize-dropped-paths', (event, values: unknown) => {
    try {
      if (!Array.isArray(values) || values.length > 10000) throw new Error('无效的路径列表');
      for (const value of values) grantDroppedPathAccess(event.sender, value);
      event.returnValue = true;
    } catch {
      event.returnValue = false;
    }
  });
  registerWorkspaceHandler('open-local-folder', async (event) => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择要打开的文件夹',
    });
    if (!result.canceled && result.filePaths.length > 0) {
      const folderPath = result.filePaths[0];
      await grantPathAccess(event.sender, folderPath, true);
      addRecentFolder(folderPath);
      return readWorkspaceTree(folderPath, event?.sender?.id);
    }
    return null;
  });

  registerWorkspaceHandler('read-file', async (event, filePath: string, encoding?: string) => {
    try {
      await assertPathAccess(event?.sender?.id, filePath);
      return await readTextFileWithEncoding(filePath, encoding);
    } catch {
      throw new Error(`Failed to read file: ${filePath}`);
    }
  });

  registerWorkspaceHandler('read-file-binary', async (event, filePath: string) => {
    try {
      await assertPathAccess(event?.sender?.id, filePath);
      return await readFileBinary(filePath);
    } catch {
      throw new Error(`Failed to read binary file: ${filePath}`);
    }
  });

  registerWorkspaceHandler(
    'write-file',
    async (event: { sender?: { id: number } }, filePath: string, content: string) => {
      // 纵深防御：内部数据与派生摘要只由各自的专用 IPC 写入（直接用 fs），通用 write-file 一律拒绝
      absolutePath(filePath);

      if (typeof content !== 'string') throw new Error('无效的文件内容');
      // 正文文件保存前读取旧内容，用于计算写作日志的字数增量（只读当前文件，不扫描项目）
      const trackWriting = isStoryFile(filePath);
      // 同一文件的「读旧内容 → 写入」串行执行：并发保存时后发起的内容必须最后落盘
      await writeQueue(path.resolve(filePath), async () => {
        await assertWritablePath(
          event?.sender?.id,
          filePath,
          getWorkspaceRootForSender(event?.sender?.id)
        );
        const previousContent = trackWriting ? await readPreviousContent(filePath) : null;
        try {
          await saveTextFile(filePath, content);
        } catch {
          throw new Error(`Failed to write file: ${filePath}`);
        }
        if (trackWriting) {
          // Keep log writes in the same queue: deletion must also wait for metadata that could recreate a folder.
          await Promise.resolve()
            .then(async () => {
              const workspaceRoot = getWorkspaceRootForSender(event?.sender?.id);
              const logRoot = await resolveWritingLogRoot(filePath, workspaceRoot);
              if (logRoot)
                await assertPathAccess(
                  event?.sender?.id,
                  path.join(logRoot, PROJECT_META_DIR, WRITING_LOG_FILE),
                  true
                );
              return recordStoryFileSave({
                path: filePath,
                previousContent,
                content,
                workspaceRoot,
              });
            })
            .then((results) => {
              for (const result of results) {
                if (result.error)
                  console.warn('[writing-log] record failed:', result.error.message);
              }
            })
            .catch((error) => console.warn('[writing-log] record failed:', errorMessage(error)));
        }
      });
      return { success: true };
    },
    {
      beforeAdmission: (_event, filePath) => {
        absolutePath(filePath);
        assertNoPathMutation(filePath);
      },
    }
  );

  registerWorkspaceHandler('get-file-info', async (event, filePath: string) => {
    try {
      await assertPathAccess(event?.sender?.id, filePath);
      return await getFileInfo(filePath);
    } catch {
      throw new Error(`Failed to get file info: ${filePath}`);
    }
  });

  registerWorkspaceHandler('get-file-info-batch', async (event, filePaths: unknown) => {
    if (!Array.isArray(filePaths) || filePaths.length > 10000) throw new Error('无效的路径列表');
    const approved = await Promise.all(
      filePaths.map((item) => assertPathAccess(event?.sender?.id, item))
    );
    return getFileInfoBatch(approved);
  });

  // 批量判断候选路径是否存在（只回答工作区内的绝对路径，见 files-exist.ts）
  registerWorkspaceHandler('get-files-exist', async (event, filePaths: unknown) => {
    const results = await checkFilesExist(filePaths, getWorkspaceRootForSender(event?.sender?.id));
    return Promise.all(
      (filePaths as string[]).map(async (item, index) => {
        try {
          await assertPathAccess(event?.sender?.id, item);
          return results[index];
        } catch {
          return null;
        }
      })
    );
  });

  registerWorkspaceHandler('open-in-system-app', async (event, filePath: string) => {
    try {
      await assertPathAccess(event?.sender?.id, filePath);
      const errorMessage = await shell.openPath(filePath);
      if (errorMessage) throw new Error(errorMessage);
      return { success: true };
    } catch (error) {
      throw new Error(`无法打开文件: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  // 在访达 / 资源管理器 / 文件管理器中显示（项目菜单）：只接受已存在的绝对路径
  registerWorkspaceHandler('show-item-in-folder', async (event, targetPath: unknown) => {
    if (typeof targetPath !== 'string' || !path.isAbsolute(targetPath) || !existsSync(targetPath)) {
      throw new Error('路径不存在');
    }
    await assertPathAccess(event?.sender?.id, targetPath);
    shell.showItemInFolder(path.normalize(targetPath));
    return { success: true };
  });

  // 打开外部链接（Markdown 实时预览中 ⌘/Ctrl + 点击）：只允许 http(s) / mailto
  registerWorkspaceHandler('open-external-url', async (_event, url: unknown) => {
    if (typeof url !== 'string' || !isSafeExternalUrl(url)) {
      throw new Error('不支持打开该链接');
    }
    await shell.openExternal(url);
    return { success: true };
  });

  registerWorkspaceHandler('watch-file', async (event, filePath: string) => {
    await assertPathAccess(event?.sender?.id, filePath);
    const key = `${event.sender.id}:${path.resolve(filePath)}`;
    if (fileWatchers.has(key)) return;
    try {
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      // Atomic saves replace the inode. Watching the parent keeps subsequent saves observable.
      const watcher = watch(path.dirname(filePath), (_eventType, name) => {
        if (name && name.toString() !== path.basename(filePath)) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (!event.sender.isDestroyed?.()) event.sender.send('file-changed', filePath);
        }, 500);
      });
      const close = () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        watcher.close();
        fileWatchers.delete(key);
      };
      watcher.on('error', close);
      event.sender.once?.('destroyed', close);
      fileWatchers.set(key, { close });
    } catch {
      // 监视不是核心功能
    }
  });

  registerWorkspaceHandler('unwatch-file', async (event, filePath: string) => {
    await assertPathAccess(event?.sender?.id, filePath);
    fileWatchers.get(`${event.sender.id}:${path.resolve(filePath)}`)?.close();
  });

  registerWorkspaceHandler('create-file', async (event, folderPath: string, fileName: string) => {
    const filePath = childPath(folderPath, fileName);
    await assertWritablePath(
      event?.sender?.id,
      filePath,
      getWorkspaceRootForSender(event?.sender?.id)
    );
    try {
      await createFile(filePath);
      return { success: true, filePath };
    } catch (error) {
      const reason =
        isCoreError(error) && error.code === 'ALREADY_EXISTS' ? '文件已存在' : errorMessage(error);
      throw new Error(`Failed to create file: ${reason}`);
    }
  });

  registerWorkspaceHandler(
    'create-directory',
    async (event, folderPath: string, dirName: string) => {
      const dirPath = childPath(folderPath, dirName);
      await assertWritablePath(
        event?.sender?.id,
        dirPath,
        getWorkspaceRootForSender(event?.sender?.id)
      );
      try {
        await createDirectory(dirPath);
        return { success: true, dirPath };
      } catch (error) {
        const reason =
          isCoreError(error) && error.code === 'ALREADY_EXISTS'
            ? '目录已存在'
            : errorMessage(error);
        throw new Error(`Failed to create directory: ${reason}`);
      }
    }
  );

  registerWorkspaceHandler('refresh-folder', async (event, folderPath: string) => {
    try {
      const target = absolutePath(folderPath);
      if (getRecentFolders().some((recent) => path.resolve(recent) === target))
        await grantPathAccess(event.sender, target, true);
      await assertDirectoryAccess(event?.sender?.id, target);
      return await readWorkspaceTree(folderPath, event?.sender?.id);
    } catch {
      throw new Error(`Failed to refresh folder: ${folderPath}`);
    }
  });

  registerWorkspaceHandler(
    'cleanup-empty-generated-material-directories',
    async (event, folderPath: string) => {
      try {
        await assertDirectoryAccess(event?.sender?.id, folderPath);
        await readAuthorizedProjectLayout(event?.sender?.id, folderPath);
        await assertPathAccess(
          event?.sender?.id,
          path.join(folderPath, GENERATED_MATERIAL_ROOT_NAME),
          true
        );
        const removed = await cleanupEmptyWorkMaterialDirectories(folderPath);
        return { success: true, removed };
      } catch {
        throw new Error(`Failed to cleanup generated material directories: ${folderPath}`);
      }
    }
  );

  registerWorkspaceHandler(
    'delete-file',
    async (event, filePath: string) => {
      const release = beginPathMutation(filePath);
      try {
        await assertMutableTree(
          event?.sender?.id,
          filePath,
          getWorkspaceRootForSender(event?.sender?.id)
        );
        await writeQueue.drain((key) => key === path.resolve(filePath));
        await deleteFile(filePath);
        return { success: true };
      } catch {
        throw new Error(`Failed to delete file: ${filePath}`);
      } finally {
        release();
      }
    },
    { beforeAdmission: (_event, source) => beginPathMutation(source) }
  );

  registerWorkspaceHandler(
    'delete-directory',
    async (event, dirPath: string) => {
      const release = beginPathMutation(dirPath);
      try {
        const root = getWorkspaceRootForSender(event?.sender?.id);
        await assertWritablePath(event?.sender?.id, dirPath, root);
        if (isStructuralContainer(dirPath, root))
          await assertReadableTree(event?.sender?.id, dirPath);
        else await assertMutableTree(event?.sender?.id, dirPath, root);
        const rootPath = path.resolve(dirPath);
        await writeQueue.drain(
          (key) => key === rootPath || key.startsWith(`${rootPath}${path.sep}`)
        );
        await deleteDirectory(dirPath);
        return { success: true };
      } catch {
        throw new Error(`Failed to delete directory: ${dirPath}`);
      } finally {
        release();
      }
    },
    { beforeAdmission: (_event, source) => beginPathMutation(source) }
  );

  registerWorkspaceHandler(
    'rename-file',
    async (event, oldPath: string, newPath: string) => {
      const release = beginPathMutation(oldPath);
      try {
        const root = getWorkspaceRootForSender(event?.sender?.id);
        const workspaceRename = await assertWorkspaceRename(event?.sender?.id, oldPath, newPath);
        await assertWritablePath(event?.sender?.id, oldPath, root);
        // Structural containers carry their complete material subtree; renaming material paths directly remains guarded.
        const container = isStructuralContainer(oldPath, root);
        if (container) await assertReadableTree(event?.sender?.id, oldPath);
        else await assertMutableTree(event?.sender?.id, oldPath, root);
        if (workspaceRename) assertUserDataPath(newPath, null);
        else await assertWritablePath(event?.sender?.id, newPath, root);
        if (!container && !workspaceRename)
          await assertCopyTree(event?.sender?.id, oldPath, newPath, root);
        // A structural container cannot be moved into a protected material subtree.
        if (container && !isStructuralContainer(newPath, root))
          throw new Error('不能移动到内部资料目录');
        const sourcePath = path.resolve(oldPath);
        await writeQueue.drain(
          (key) => key === sourcePath || key.startsWith(`${sourcePath}${path.sep}`)
        );
        if (workspaceRename) await drainGuiSessionRoot(path.resolve(oldPath));
        await renamePath(oldPath, newPath);
        if (workspaceRename) {
          movePathAccess(path.resolve(oldPath), path.resolve(newPath));
          moveGuiSessionRoot(path.resolve(oldPath), path.resolve(newPath));
          addRecentFolder(newPath);
        }
        return { success: true, newPath };
      } catch {
        throw new Error(`Failed to rename: ${oldPath}`);
      } finally {
        release();
      }
    },
    { beforeAdmission: (_event, source) => beginPathMutation(source) }
  );

  registerWorkspaceHandler(
    'paste-files',
    async (event, sourcePaths: string[], targetDir: string) => {
      try {
        if (!Array.isArray(sourcePaths) || sourcePaths.length > 10000)
          throw new Error('无效的路径列表');
        await assertWritablePath(
          event?.sender?.id,
          targetDir,
          getWorkspaceRootForSender(event?.sender?.id)
        );
        for (const source of sourcePaths) {
          const src = absolutePath(source);
          await assertCopyTree(
            event?.sender?.id,
            src,
            path.join(targetDir, path.basename(src)),
            getWorkspaceRootForSender(event?.sender?.id)
          );
        }
        const results = await pastePaths(sourcePaths, targetDir);
        return { success: true, results };
      } catch (error) {
        throw new Error(errorMessage(error));
      }
    }
  );

  registerWorkspaceHandler('read-clipboard-file-paths', (event): string[] => {
    const approve = (paths: string[]) => {
      for (const item of paths) {
        try {
          grantDroppedPathAccess(event.sender, item);
        } catch {
          /* missing clipboard entry */
        }
      }
      return paths;
    };
    try {
      if (process.platform === 'darwin') {
        const plistStr = electronClipboard.read('NSFilenamesPboardType');
        if (plistStr) {
          const paths: string[] = [];
          const regex = /<string>([^<]+)<\/string>/g;
          let match;
          while ((match = regex.exec(plistStr)) !== null) {
            if (match[1] && match[1].startsWith('/')) paths.push(match[1]);
          }
          if (paths.length > 0) return approve(paths);
        }
        const formats = electronClipboard.availableFormats();
        if (formats.some((f) => f.includes('file-url'))) {
          const fileUrl = electronClipboard.read('public.file-url');
          if (fileUrl?.startsWith('file://')) {
            const filePath = decodeURIComponent(new URL(fileUrl).pathname);
            return approve([filePath]);
          }
        }
      }
      if (process.platform === 'win32') {
        const text = electronClipboard.readText();
        if (text) {
          const lines = text
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l.length > 0 && (l.startsWith('/') || /^[A-Za-z]:\\/.test(l)));
          if (lines.length > 0) return approve(lines);
        }
      }
    } catch {
      // 静默降级
    }
    return [];
  });

  registerWorkspaceHandler('get-default-data-path', async (event) => {
    try {
      await syncSampleData();
      const { userSamplePath, sourcePath } = getSampleDataPaths();
      const folder = await ensureSeededDirectory(userSamplePath, sourcePath);
      await grantPathAccess(event.sender, folder, true);
      return folder;
    } catch {
      throw new Error('Failed to get default data path');
    }
  });

  registerWorkspaceHandler('open-sample-data', async (event) => {
    // 先完成版本同步（旧版副本会被备份并替换为新版），再确保目录存在
    await syncSampleData();
    const { userSamplePath, sourcePath } = getSampleDataPaths();
    const folder = await ensureSeededDirectory(userSamplePath, sourcePath);
    await grantPathAccess(event.sender, folder, true);
    return folder;
  });

  registerWorkspaceHandler('sample-data-take-upgrade-notice', async () => {
    await syncSampleData();
    return takeSampleUpgradeNotice();
  });

  ipcMain.handle('export-project', async (event, folderPath: string) => {
    await assertPathAccess(event?.sender?.id, folderPath);
    if (!existsSync(folderPath)) {
      return { success: false, error: '项目目录不存在' };
    }
    const result = await dialog.showOpenDialog({
      title: '选择导出位置',
      buttonLabel: '导出到此处',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    try {
      const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
      const senders = new Map(windows.map((window) => [window.webContents.id, window.webContents]));
      senders.set(event.sender.id, event.sender);
      const destPath = await exportPreparedProject(folderPath, result.filePaths[0], {
        prepare: [...senders.values()].map(
          (sender) => () => requestRendererPreparation(sender, 'export')
        ),
        drain: async () => {
          await drainFileWrites();
          await assertReadableTree(event.sender.id, folderPath);
        },
        backupDatabase: (source, destination, roots) =>
          backupDatabaseFile(source, destination, getNativeBinding(), roots),
      });
      if (!destPath) return { success: false, error: '导出已取消：请先保存所有窗口中的修改' };
      await grantPathAccess(event.sender, destPath, true, false);
      return { success: true, destPath };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
  });
}
