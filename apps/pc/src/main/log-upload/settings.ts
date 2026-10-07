/**
 * 旧版日志上传设置清理
 *
 * 旧版本在设置中心提供「崩溃时自动上传日志」开关，持久化在 userData/log-upload-settings.json。
 * 现在崩溃日志上传始终由我们处理（只在配置了上传地址时上传，否则只保存在本地），
 * 该文件的内容被忽略；启动后尽力删除，失败也不影响任何功能。
 */
import { app } from 'electron';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { LEGACY_LOG_UPLOAD_SETTINGS_FILE } from '../../shared/log-upload';

export async function removeLegacyLogUploadSettings(): Promise<void> {
  try {
    await rm(path.join(app.getPath('userData'), LEGACY_LOG_UPLOAD_SETTINGS_FILE), { force: true });
  } catch {
    // userData 不可用或无权限时忽略
  }
}
