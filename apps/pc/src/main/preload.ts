import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel: string, ...args: any[]) => {
      const validChannels = [
        'open-local-folder',
        'read-file',
        'write-file',
        'get-file-info',
        'get-default-data-path',
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
        'update-download',
        'update-install',
        'delete-file',
        'delete-directory',
        'rename-file',
        // SQLite 数据库
        'db-init',
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
        'db-stats-record',
        'db-stats-range',
        'db-stats-today',
        'db-settings-get',
        'db-settings-set',
        'db-settings-all',
        'db-export',
        'db-import',
        'db-export-to-file',
        'db-import-from-file',
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
        'update-available',
        'update-not-available',
        'update-download-progress',
        'update-downloaded',
      ];
      if (validChannels.includes(channel)) {
        ipcRenderer.on(channel, listener);
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
        'update-available',
        'update-not-available',
        'update-download-progress',
        'update-downloaded',
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
        'update-available',
        'update-not-available',
        'update-download-progress',
        'update-downloaded',
      ];
      if (validChannels.includes(channel)) {
        ipcRenderer.removeAllListeners(channel);
      } else {
        throw new Error(`Unauthorized IPC channel: ${channel}`);
      }
    },
  },
});
