/**
 * 日志上传的共享类型与纯函数（主进程与渲染进程共用，不依赖 Electron / DOM）
 *
 * 服务端接口约定见 docs/log-upload.md
 */

/** 上传原因：manual = 用户在关于窗口点击「上传日志」；crash = 崩溃 / 未捕获异常时自动上传 */
export type LogUploadReason = 'manual' | 'crash';

/** 服务端响应约定 */
export interface LogUploadResponse {
  ok: boolean;
  ticketId?: string;
}

/** 「上传日志」的结果 */
export type LogUploadResult =
  | {
      status: 'uploaded';
      /** 服务端返回的工单编号（可选） */
      ticketId: string | null;
      bytes: number;
    }
  | {
      /** 未配置上传地址或上传失败：已保存到「下载」目录 */
      status: 'saved';
      fileName: string;
      filePath: string;
      /** 上传失败的原因；未配置上传地址时为 null */
      uploadError: string | null;
      bytes: number;
    }
  | { status: 'failed'; error: string };

/**
 * 崩溃时是否上传日志包：始终由我们处理，用户没有开关。
 * 只有配置了上传地址时才上传；否则（或上传失败时）只保存在 userData/crash-reports/。
 */
export function shouldUploadCrashReport(endpoint: string | null | undefined): endpoint is string {
  return typeof endpoint === 'string' && endpoint.length > 0;
}

/** 旧版「崩溃时自动上传日志」开关的持久化文件名（已废弃，启动后删除，内容被忽略） */
export const LEGACY_LOG_UPLOAD_SETTINGS_FILE = 'log-upload-settings.json';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 日志包文件名：novel-editor-logs-<yyyyMMdd-HHmmss>-<deviceId 前 8 位>.zip */
export function buildLogBundleFileName(date: Date, deviceId: string): string {
  const stamp =
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}` +
    `-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  const shortId = deviceId.replace(/[^0-9a-zA-Z]/g, '').slice(0, 8) || 'unknown';
  return `novel-editor-logs-${stamp}-${shortId}.zip`;
}

/** 界面上展示的结果文案 */
export function describeLogUploadResult(result: LogUploadResult): string {
  if (result.status === 'uploaded') {
    return result.ticketId ? `日志已上传（编号 ${result.ticketId}）` : '日志已上传';
  }
  if (result.status === 'saved') {
    return `日志已打包到 下载/${result.fileName}，可发送给我们`;
  }
  return `日志打包失败：${result.error}`;
}
