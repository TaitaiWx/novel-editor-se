/**
 * 「关于小说编辑器」相关的共享类型与纯函数（主进程与渲染进程共用，不依赖 Electron / DOM）
 */

/** 应用内展示名称 */
export const APP_DISPLAY_NAME = '小说编辑器';

/** 仓库地址（与 apps/pc/package.json 的 repository 字段保持一致，单测会校验） */
export const REPOSITORY_URL = 'https://github.com/TaitaiWx/novel-editor-se';

/** 当前安装包所属的发布通道（由版本号预发布标识推断） */
export type ReleaseChannel = 'stable' | 'beta' | 'alpha';

/** 自动更新订阅的通道（与 auto-updater 的 UpdateChannel 一致） */
export type AboutUpdateChannel = 'stable' | 'beta' | 'canary';

/** 可在系统文件管理器中打开的目录 */
export type AboutDirectoryKey = 'userData' | 'logs' | 'sampleData';

/** 可在浏览器中打开的外部链接 */
export type AboutLinkKey = 'repository' | 'releaseNotes' | 'issues';

export interface AboutDirectory {
  key: AboutDirectoryKey;
  label: string;
  path: string;
}

export interface AboutRuntimeInfo {
  electron: string;
  chrome: string;
  node: string;
  v8: string;
  platform: string;
  arch: string;
  osRelease: string;
  isPackaged: boolean;
}

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
  updateChannel: AboutUpdateChannel;
  rollout: AboutRolloutInfo;
  deviceId: string;
  /** 首次运行时间（device-id 文件创建时间，ISO 字符串）；无法获取时为 null */
  firstRunAt: string | null;
  runtime: AboutRuntimeInfo;
  directories: AboutDirectory[];
  links: Record<AboutLinkKey, string>;
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

/** 根据仓库地址与版本号生成外部链接 */
export function buildAboutLinks(version: string): Record<AboutLinkKey, string> {
  return {
    repository: REPOSITORY_URL,
    releaseNotes: `${REPOSITORY_URL}/releases/tag/v${version}`,
    issues: `${REPOSITORY_URL}/issues`,
  };
}

/** 灰度分组的可读描述 */
export function describeRollout(rollout: AboutRolloutInfo): string {
  const bucket = `分桶 ${rollout.bucket}`;
  if (rollout.percentage === null || rollout.eligible === null) {
    return `${bucket} · 当前为全量发布`;
  }
  return `${bucket} · 灰度 ${rollout.percentage}% · ${rollout.eligible ? '已命中' : '未命中'}`;
}

/** 本地化的日期时间（固定 zh-CN，避免受系统区域影响） */
export function formatAboutDate(iso: string | null): string {
  if (!iso) return '未知';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '未知';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 操作系统的可读描述，如 macOS 24.6.0 (arm64) */
export function describeOs(runtime: AboutRuntimeInfo): string {
  const name = PLATFORM_LABELS[runtime.platform] ?? runtime.platform;
  return `${name} ${runtime.osRelease} (${runtime.arch})`;
}

/** 生成用于问题反馈的纯文本诊断信息 */
export function formatAboutDiagnostics(info: AboutInfo): string {
  const { runtime, rollout } = info;
  const lines = [
    `${info.appName} 诊断信息`,
    `版本: ${info.version}（${RELEASE_CHANNEL_LABELS[info.releaseChannel]}）`,
    `更新通道: ${info.updateChannel}${rollout.canaryEnrolled ? '（已加入金丝雀计划）' : ''}`,
    `灰度分组: ${describeRollout(rollout)}`,
    `设备 ID: ${info.deviceId}`,
    `首次运行: ${formatAboutDate(info.firstRunAt)}`,
    `操作系统: ${describeOs(runtime)}`,
    `Electron: ${runtime.electron}`,
    `Chromium: ${runtime.chrome}`,
    `Node.js: ${runtime.node}`,
    `V8: ${runtime.v8}`,
    `安装方式: ${runtime.isPackaged ? '安装包' : '开发模式'}`,
  ];
  return lines.join('\n');
}
