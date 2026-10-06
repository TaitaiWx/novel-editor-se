/**
 * 「关于小说编辑器」相关的共享类型与纯函数（主进程与渲染进程共用，不依赖 Electron / DOM）
 *
 * 关于窗口只展示：图标 + 名称 + 版本、运行时间、设备 ID、上传日志。
 * 运行环境、数据目录等诊断信息不在界面展示，统一写进日志包的 diagnostics.json（见 main/log-upload）。
 */

/** 应用内展示名称 */
export const APP_DISPLAY_NAME = '小说编辑器';

/** 当前安装包所属的发布通道（由版本号预发布标识推断） */
export type ReleaseChannel = 'stable' | 'beta' | 'alpha';

/** 自动更新订阅的通道（与 auto-updater 的 UpdateChannel 一致） */
export type AboutUpdateChannel = 'stable' | 'beta' | 'canary';

export interface AboutRolloutInfo {
  /** 当前设备所在灰度分桶（0~99） */
  bucket: number;
  /** 最近一次检查到的灰度比例；全量发布或尚未检查时为 null */
  percentage: number | null;
  /** 是否命中当前灰度比例；不适用时为 null */
  eligible: boolean | null;
  /** 是否加入了金丝雀（canary）更新计划 */
  canaryEnrolled: boolean;
}

export interface AboutInfo {
  appName: string;
  productName: string;
  version: string;
  releaseChannel: ReleaseChannel;
  /** 更新通道与灰度分组（设置中心「更新」分组使用，关于窗口不展示） */
  updateChannel: AboutUpdateChannel;
  rollout: AboutRolloutInfo;
  deviceId: string;
  /** 首次运行时间（device-id 文件创建时间，ISO 字符串）；无法获取时为 null */
  firstRunAt: string | null;
  /** 本次启动时间（主进程启动时刻，ISO 字符串），用于计算「本次已运行」 */
  startedAt: string;
}

export const RELEASE_CHANNEL_LABELS: Record<ReleaseChannel, string> = {
  stable: '正式版',
  beta: '测试版',
  alpha: '金丝雀版',
};

export const UPDATE_CHANNEL_LABELS: Record<AboutUpdateChannel, string> = {
  stable: '正式版（stable）',
  beta: '测试版（beta）',
  canary: '金丝雀（canary）',
};

export const PLATFORM_LABELS: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
};

/** 由版本号推断发布通道：-alpha./-canary. → alpha，-beta. → beta，其余为 stable */
export function inferReleaseChannel(version: string): ReleaseChannel {
  const lower = version.toLowerCase();
  if (lower.includes('-alpha.') || lower.includes('-canary.')) return 'alpha';
  if (lower.includes('-beta.')) return 'beta';
  return 'stable';
}

/** 灰度分组的可读描述 */
export function describeRollout(rollout: AboutRolloutInfo): string {
  const bucket = `分桶 ${rollout.bucket}`;
  if (rollout.percentage === null || rollout.eligible === null) {
    return `${bucket} · 当前为全量发布`;
  }
  return `${bucket} · 灰度 ${rollout.percentage}% · ${rollout.eligible ? '已命中' : '未命中'}`;
}

function parseDate(iso: string | null): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 本地日期（固定 yyyy-MM-dd，避免受系统区域影响） */
export function formatAboutDay(iso: string | null): string {
  const date = parseDate(iso);
  if (!date) return '未知';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 本地日期时间（yyyy-MM-dd HH:mm） */
export function formatAboutDate(iso: string | null): string {
  const date = parseDate(iso);
  if (!date) return '未知';
  return `${formatAboutDay(iso)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** 运行时长：不到 1 分钟 / 13 分钟 / 2 小时 13 分 / 3 天 2 小时 */
export function formatUptime(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60_000);
  if (totalMinutes < 1) return '不到 1 分钟';
  if (totalMinutes < 60) return `${totalMinutes} 分钟`;
  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) return minutes ? `${totalHours} 小时 ${minutes} 分` : `${totalHours} 小时`;
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours ? `${days} 天 ${hours} 小时` : `${days} 天`;
}

/** 关于窗口的运行时间行：「首次运行 2026-03-17 · 本次已运行 2 小时 13 分」 */
export function formatRunningSummary(
  firstRunAt: string | null,
  startedAt: string,
  now: number
): string {
  const started = parseDate(startedAt);
  const uptime = started ? formatUptime(now - started.getTime()) : '未知';
  return `首次运行 ${formatAboutDay(firstRunAt)} · 本次已运行 ${uptime}`;
}

/** 操作系统的可读描述，如 macOS 24.6.0 (arm64) */
export function describeOs(platform: string, osRelease: string, arch: string): string {
  const name = PLATFORM_LABELS[platform] ?? platform;
  return `${name} ${osRelease} (${arch})`;
}
