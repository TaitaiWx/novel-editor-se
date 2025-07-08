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
      ];
      if (validChannels.includes(channel)) {
        return ipcRenderer.invoke(channel, ...args);
      }
      throw new Error(`Unauthorized IPC channel: ${channel}`);
    },
  },
});
