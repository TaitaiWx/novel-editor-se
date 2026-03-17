/**
 * Electron API 类型定义
 */

import type { FileInfo, OpenLocalResult, ShortcutInfo } from './File';

export type UpdateChannel = 'stable' | 'beta' | 'canary';

export interface UpdateStatus {
  channel: UpdateChannel;
  channelFile: string;
  currentVersion: string;
  checking: boolean;
  updateReady: boolean;
  availableVersion: string | null;
  downloadedVersion: string | null;
  downloadPercent: number | null;
  rollbackAvailable: boolean;
  rollbackVersion: string | null;
  lastError: string | null;
}

export interface ElectronAPI {
  ipcRenderer: {
    invoke(channel: 'open-local-folder'): Promise<OpenLocalResult | null>;
    invoke(channel: 'read-file', filePath: string): Promise<string>;
    invoke(channel: 'read-file', filePath: string, encoding: string): Promise<string>;
    invoke(channel: 'write-file', filePath: string, content: string): Promise<{ success: boolean }>;
    invoke(channel: 'get-file-info', filePath: string): Promise<FileInfo>;
    invoke(channel: 'get-default-data-path'): Promise<string>;
    invoke(channel: 'get-recent-folders'): Promise<string[]>;
    invoke(channel: 'get-last-folder'): Promise<string | null>;
    invoke(channel: 'add-recent-folder', folderPath: string): Promise<void>;
    invoke(channel: 'open-sample-data'): Promise<string>;
    invoke(channel: 'get-changelog'): Promise<string>;
    invoke(
      channel: 'check-just-updated'
    ): Promise<{ updated: boolean; fromVersion: string | null; toVersion: string }>;
    invoke(
      channel: 'create-file',
      folderPath: string,
      fileName: string
    ): Promise<{ success: boolean; filePath: string }>;
    invoke(
      channel: 'create-directory',
      folderPath: string,
      dirName: string
    ): Promise<{ success: boolean; dirPath: string }>;
    invoke(channel: 'refresh-folder', folderPath: string): Promise<OpenLocalResult>;
    invoke(channel: 'window-minimize'): Promise<void>;
    invoke(channel: 'window-maximize'): Promise<void>;
    invoke(channel: 'window-close'): Promise<void>;
    invoke(channel: 'window-is-maximized'): Promise<boolean>;
    invoke(channel: 'app-quit'): Promise<void>;
    invoke(channel: 'dev-tools-toggle'): Promise<void>;
    invoke(channel: 'window-toggle-fullscreen'): Promise<void>;
    invoke(channel: 'get-shortcuts'): Promise<ShortcutInfo[]>;
    invoke(channel: 'get-app-version'): Promise<string>;
    invoke(channel: 'update-check'): Promise<void>;
    invoke(channel: 'update-status'): Promise<UpdateStatus>;
    invoke(channel: 'update-install'): Promise<void>;
    invoke(channel: 'update-set-channel', updateChannel: UpdateChannel): Promise<UpdateStatus>;
    invoke(channel: 'update-rollback'): Promise<{ version: string; installerPath: string }>;
    invoke(
      channel: 'paste-files',
      sourcePaths: string[],
      targetDir: string
    ): Promise<{ success: boolean; results: { source: string; dest: string }[] }>;
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, listener: (...args: any[]) => void): void;
    removeAllListeners(channel: string): void;
  };
}
