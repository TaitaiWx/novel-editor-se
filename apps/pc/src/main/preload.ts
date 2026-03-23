import { contextBridge, ipcRenderer } from 'electron';

// ── MessagePort 转发 ────────────────────────────────────────
// 将 main process 通过 webContents.postMessage 发来的 MessagePort
// 从隔离的 preload 世界转发到渲染进程的 main world。
// 这是 Electron contextIsolation 下传递 MessagePort 的官方模式。
ipcRenderer.on('port-transfer', (event, channelName: string) => {
  window.postMessage(
    { type: 'port-transfer', channelName },
    '*',
    event.ports as unknown as MessagePort[]
  );
});

// Electron 28 + contextIsolation: File.path 在 preload 特权上下文中仍可用，
// 但在隔离的渲染进程中为空。在 capture 阶段拦截 drop 事件提取路径。
let lastDroppedPaths: string[] = [];
document.addEventListener(
  'drop',
  (e) => {
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      lastDroppedPaths = Array.from(files)
        .map((f) => (f as File & { path: string }).path)
        .filter(Boolean);
    }
  },
  { capture: true }
);

contextBridge.exposeInMainWorld('electron', {
  getLastDroppedPaths: (): string[] => {
    const paths = lastDroppedPaths;
    lastDroppedPaths = [];
    return paths;
  },
  ipcRenderer: {
    invoke: (channel: string, ...args: any[]) => {
      const validChannels = [
        'open-local-folder',
        'read-file',
        'read-file-binary',
        'read-xlsx-data',
        'write-file',
        'get-file-info',
        'get-default-data-path',
        'get-recent-folders',
        'get-last-folder',
        'add-recent-folder',
        'app-cache-clear',
        'open-sample-data',
        'get-changelog',
        'check-just-updated',
        'create-file',
        'create-directory',
        'refresh-folder',
        'window-minimize',
        'window-maximize',
        'window-close',
        'window-is-maximized',
        'app-quit',
        'dev-tools-toggle',
        'window-toggle-fullscreen',
        'get-shortcuts',
        'get-app-version',
        'get-device-id',
        'update-check',
        'update-status',
        'update-download',
        'update-install',
        'update-set-channel',
        'update-rollback',
        'delete-file',
        'delete-directory',
        'rename-file',
        'paste-files',
        'read-clipboard-file-paths',
        // SQLite 数据库
        'db-init',
        'db-init-default',
        'db-close',
        'db-novel-create',
        'db-novel-list',
        'db-novel-get',
        'db-novel-get-by-folder',
        'db-novel-update',
        'db-novel-delete',
        'db-character-create',
        'db-character-list',
        'db-character-update',
        'db-character-reorder',
        'db-character-delete',
        'db-outline-list-by-folder',
        'db-outline-replace-by-folder',
        'db-outline-clear-by-folder',
        'db-outline-reorder-by-folder',
        'db-outline-version-list-by-folder',
        'db-outline-version-create-by-folder',
        'db-outline-version-apply-by-folder',
        'db-outline-version-update',
        'db-outline-version-delete',
        'db-story-idea-card-list-by-folder',
        'db-story-idea-card-create-by-folder',
        'db-story-idea-card-update',
        'db-story-idea-card-delete',
        'db-story-idea-output-list',
        'db-story-idea-output-replace-by-folder',
        'db-story-idea-output-update',
        'db-story-idea-output-select',
        'db-story-idea-output-delete',
        'db-world-setting-list-by-folder',
        'db-world-setting-create-by-folder',
        'db-world-setting-bulk-create-by-folder',
        'db-world-setting-update',
        'db-world-setting-delete',
        'db-stats-record',
        'db-stats-range',
        'db-stats-today',
        'db-settings-get',
        'db-settings-set',
        'db-settings-all',
        // AI 缓存
        'ai-cache-get',
        'ai-cache-set',
        'ai-cache-delete',
        'ai-cache-get-by-type',
        'ai-cache-clear-by-type',
        'ai-cache-cleanup',
        'ai-cache-touch-keys',
        'ai-request',
        'db-export',
        'db-import',
        'db-export-to-file',
        'db-import-from-file',
        // SQLite 版本快照
        'db-version-create',
        'db-version-start-create',
        'db-version-job-status',
        'db-version-list',
        'db-version-delete',
        'db-version-rename',
        'db-version-get-file-content',
        'db-version-restore-file',
        // 文件导入
        'import-file',
        'import-structured-file',
        // 文档导出
        'export-to-word',
        'export-project-to-word',
        'export-to-pptx',
        // 项目导出
        'export-project',
        // 外部编辑 & 文件监视
        'open-in-system-app',
        'watch-file',
        'unwatch-file',
        // PPT 预览
        'read-pptx-data',
        // Word 预览
        'read-docx-data',
        // PPT 美化
        'beautify-pptx',
        // AI 助手
        'save-analysis-file',
        'open-ai-assistant-window',
        'open-right-panel-window',
        'ai-window-request-open-file',
        'ai-window-request-open-settings',
        'ai-window-apply-fix',
        'ai-save-session-state',
      ];
      if (validChannels.includes(channel)) {
        return ipcRenderer.invoke(channel, ...args);
      }
      throw new Error(`Unauthorized IPC channel: ${channel}`);
    },
    on: (channel: string, listener: (...args: any[]) => void) => {
      const validChannels = [
        'shortcut-new-file',
        'shortcut-open-folder',
        'shortcut-save-file',
        'shortcut-save-as-file',
        'menu-export-project',
        'settings-updated',
        'update-available',
        'update-not-available',
        'update-download-progress',
        'update-downloaded',
        'update-state-changed',
        'update-rollback-available',
        'file-changed',
        'open-file-from-ai',
        'open-settings-from-ai',
        'ai-apply-fix-request',
        'right-panel-window-closed',
      ];
      if (validChannels.includes(channel)) {
        ipcRenderer.on(channel, listener);
        // 返回 disposer，避免 contextBridge 代理导致 removeListener 无法匹配引用
        return () => {
          ipcRenderer.removeListener(channel, listener);
        };
      } else {
        throw new Error(`Unauthorized IPC channel: ${channel}`);
      }
    },
    removeListener: (channel: string, listener: (...args: any[]) => void) => {
      const validChannels = [
        'shortcut-new-file',
        'shortcut-open-folder',
        'shortcut-save-file',
        'shortcut-save-as-file',
        'menu-export-project',
        'settings-updated',
        'update-available',
        'update-not-available',
        'update-download-progress',
        'update-downloaded',
        'update-state-changed',
        'update-rollback-available',
        'file-changed',
      ];
      if (validChannels.includes(channel)) {
        ipcRenderer.removeListener(channel, listener);
      } else {
        throw new Error(`Unauthorized IPC channel: ${channel}`);
      }
    },
    removeAllListeners: (channel: string) => {
      const validChannels = [
        'shortcut-new-file',
        'shortcut-open-folder',
        'shortcut-save-file',
        'shortcut-save-as-file',
        'menu-export-project',
        'settings-updated',
        'update-available',
        'update-not-available',
        'update-download-progress',
        'update-downloaded',
        'update-state-changed',
        'update-rollback-available',
      ];
      if (validChannels.includes(channel)) {
        ipcRenderer.removeAllListeners(channel);
      } else {
        throw new Error(`Unauthorized IPC channel: ${channel}`);
      }
    },
  },
});
