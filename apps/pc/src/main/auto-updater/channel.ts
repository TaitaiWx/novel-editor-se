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
