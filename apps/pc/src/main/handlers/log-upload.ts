/**
 * 日志上传 IPC Handlers
 *
 * - log-upload-run:           打包日志并上传；未配置地址或失败时保存到「下载」目录
 * - log-upload-get-settings:  读取「崩溃时自动上传日志」开关与是否配置了上传地址
 * - log-upload-set-settings:  修改开关（只接受已知字段）
 */
import { ipcMain } from 'electron';
import type { LogUploadSettingsState } from '../../shared/log-upload';
import {
  getLogUploadEndpoint,
  loadLogUploadSettings,
  runManualLogUpload,
  saveLogUploadSettings,
} from '../log-upload';

async function getSettingsState(): Promise<LogUploadSettingsState> {
  const settings = await loadLogUploadSettings();
  return { ...settings, endpointConfigured: getLogUploadEndpoint() !== null };
}

export function registerLogUploadHandlers(): void {
  ipcMain.handle('log-upload-run', () => runManualLogUpload());
  ipcMain.handle('log-upload-get-settings', () => getSettingsState());
  ipcMain.handle('log-upload-set-settings', async (_event, patch: unknown) => {
    await saveLogUploadSettings(patch);
    return getSettingsState();
  });
}
