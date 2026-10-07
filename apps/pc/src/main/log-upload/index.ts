/**
 * 日志上传：关于窗口「上传日志」与崩溃自动上传（接口约定见 docs/log-upload.md）
 */
import { app } from 'electron';
import { installCrashHooks } from './crash-hooks';
import { reportCrash } from './service';

export { getLogUploadEndpoint } from './config';
export { runManualLogUpload, reportCrash, prepareLogBundle } from './service';
export { removeLegacyLogUploadSettings } from './settings';

/** 应用启动早期调用：安装崩溃钩子（E2E / 烟雾测试模式下跳过） */
export function setupCrashLogUpload(): void {
  installCrashHooks({
    processLike: process,
    appLike: app,
    report: (crash) => reportCrash(crash),
  });
}
