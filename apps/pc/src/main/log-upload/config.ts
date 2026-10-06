/**
 * 日志上传配置
 *
 * 上传地址优先读取环境变量 NOVEL_EDITOR_LOG_UPLOAD_URL，其次使用 LOG_UPLOAD_URL 常量。
 * 目前还没有服务端，常量默认为空：「上传日志」会把日志包保存到「下载」目录，崩溃日志只保存在本地。
 * 服务端接口约定见 docs/log-upload.md
 */

/** 内置上传地址（服务端上线后填写，例如 https://logs.example.com/v1/log-bundles） */
export const LOG_UPLOAD_URL = '';

/** 单次请求超时 */
export const LOG_UPLOAD_TIMEOUT_MS = 20_000;
/** 失败后的重试次数（网络错误、超时、5xx、429） */
export const LOG_UPLOAD_RETRIES = 1;
/** 重试前等待 */
export const LOG_UPLOAD_RETRY_DELAY_MS = 1_000;

/** 单个日志文件最多打包末尾这么多字节（更早的内容截掉） */
export const MAX_LOG_FILE_BYTES = 2 * 1024 * 1024;
/** 所有日志文件合计上限（未压缩） */
export const MAX_TOTAL_LOG_BYTES = 12 * 1024 * 1024;
/** 自动更新状态文件超过该大小时不打包 */
export const MAX_STATE_FILE_BYTES = 64 * 1024;
/** 压缩后的日志包上限（与服务端约定一致） */
export const MAX_BUNDLE_BYTES = 20 * 1024 * 1024;

/** 崩溃日志包最多保留几个 */
export const MAX_CRASH_BUNDLES = 5;
/** 崩溃自动上传的最小间隔 */
export const CRASH_UPLOAD_INTERVAL_MS = 10 * 60 * 1000;

/** 当前生效的上传地址；未配置时返回 null */
export function getLogUploadEndpoint(env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env.NOVEL_EDITOR_LOG_UPLOAD_URL?.trim();
  const url = fromEnv || LOG_UPLOAD_URL.trim();
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}
