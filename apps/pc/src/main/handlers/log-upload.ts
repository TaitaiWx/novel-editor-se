/**
 * 日志上传 IPC Handlers
 *
 * - log-upload-run: 打包日志并上传；未配置地址或失败时保存到「下载」目录
 *
 * 崩溃日志上传没有用户开关（始终由我们处理，见 log-upload/service.ts reportCrash）；
 * 注册时顺带删除旧版开关的持久化文件。
 */
import { ipcMain } from 'electron';
import { removeLegacyLogUploadSettings, runManualLogUpload } from '../log-upload';

export function registerLogUploadHandlers(): void {
  ipcMain.handle('log-upload-run', () => runManualLogUpload());
  void removeLegacyLogUploadSettings();
}
