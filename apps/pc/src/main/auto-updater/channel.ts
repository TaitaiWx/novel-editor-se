/** 更新通道相关的纯函数（不依赖 Electron，便于单测） */
import type { UpdateChannel } from '../auto-updater-state';

/** 根据版本号的预发布标识推断默认通道 */
export function inferDefaultChannel(version: string): UpdateChannel {
  const lowerVersion = version.toLowerCase();
  if (lowerVersion.includes('-alpha.') || lowerVersion.includes('-canary.')) {
    return 'canary';
  }
  if (lowerVersion.includes('-beta.')) {
    return 'beta';
  }
  return 'stable';
}

/**
 * 仅供内部测试的通道覆盖（环境变量）：stable / beta / canary。
 * 用户界面不提供通道选择——通道由安装包版本号决定，灰度比例由服务端元数据（stagingPercentage）决定。
 */
export const UPDATE_CHANNEL_ENV = 'NOVEL_EDITOR_UPDATE_CHANNEL';

/** 读取环境变量覆盖；未设置或非法时返回 null */
export function readUpdateChannelOverride(
  env: NodeJS.ProcessEnv = process.env
): UpdateChannel | null {
  const raw = env[UPDATE_CHANNEL_ENV]?.trim().toLowerCase();
  return raw === 'stable' || raw === 'beta' || raw === 'canary' ? raw : null;
}

/**
 * 实际生效的更新通道：环境变量覆盖 > 版本号推断（alpha/canary → canary，beta → beta，其余 stable）。
 * 持久化状态里旧版用户选择的通道不再生效。
 */
export function resolveUpdateChannel(
  version: string,
  env: NodeJS.ProcessEnv = process.env
): UpdateChannel {
  return readUpdateChannelOverride(env) ?? inferDefaultChannel(version);
}

/** 将应用内通道映射为 electron-updater 的 channel 名 */
export function mapUpdateChannel(channel: UpdateChannel) {
  switch (channel) {
    case 'stable':
      return 'latest';
    case 'beta':
      return 'beta';
    case 'canary':
      return 'alpha';
  }
}

/** 返回当前平台对应的通道元数据文件名（如 latest-mac.yml） */
export function getChannelMetadataFile(
  channel: UpdateChannel,
  platform: NodeJS.Platform = process.platform
) {
  const mappedChannel = mapUpdateChannel(channel);
  const suffix = platform === 'win32' ? '' : platform === 'darwin' ? '-mac' : '-linux';
  return `${mappedChannel}${suffix}.yml`;
}
