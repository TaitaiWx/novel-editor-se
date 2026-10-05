/** 自动更新相关常量 */

export const UPDATE_REPO = {
  owner: 'TaitaiWx',
  repo: 'novel-editor-se',
};
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** 新版本连续启动失败多少次后提示可回退 */
export const MAX_FAILED_UPDATED_LAUNCHES = 2;
/** 回滚缓存最多保留的安装包数量 */
export const MAX_ROLLBACK_CACHE_ENTRIES = 2;
/** 下载回滚安装包的超时（5 分钟，足够覆盖大文件慢网场景） */
export const ROLLBACK_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
/** 国内镜像地址（GitHub API 不可达时的备用源） */
export const MIRROR_BASE_URL = 'https://dl.wayintech.net/novel-editor/latest';
/** 更新检查使用的镜像源（generic provider） */
export const MIRROR_UPDATE_URL = 'https://dl.wayintech.net/novel-editor/latest';
/** 更新检查失败后的最大退避间隔（30 分钟） */
export const MAX_BACKOFF_MS = 30 * 60 * 1000;
/** 更新检查随机抖动范围（0~30 分钟），避免所有客户端同时请求 */
export const CHECK_JITTER_MS = 30 * 60 * 1000;
export const NETWORK_PROBE_TIMEOUT_MS = 4_000;
export const NETWORK_RECOVERY_INTERVAL_MS = 15_000;
export const DOWNLOAD_STALL_TIMEOUT_MS = 30_000;
/** 首次更新检查延迟（秒），让渲染进程先完成启动再检查更新 */
export const FIRST_CHECK_DELAY_MS = 10_000;
/** 下载失败后自动重试的上限 */
export const MAX_DOWNLOAD_RETRIES = 3;
