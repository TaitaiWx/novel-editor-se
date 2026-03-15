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
  channelVersion: string | null;
  rolloutPercentage: number | null;
  rolloutBucket: number;
  rolloutEligible: boolean | null;
  rollbackAvailable: boolean;
  rollbackVersion: string | null;
  pendingVersion: string | null;
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
    invoke(channel: 'update-set-channel', nextChannel: UpdateChannel): Promise<UpdateStatus>;
    invoke(channel: 'update-install'): Promise<void>;
    invoke(channel: 'update-rollback'): Promise<{ version: string; installerPath: string }>;
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, listener: (...args: any[]) => void): void;
    removeAllListeners(channel: string): void;
  };
}
