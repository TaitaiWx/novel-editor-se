/**
 * 原生引擎：直接把地址交给 `<video>`（mp4 / webm / mov，以及 Safari 的原生 HLS）。
 */
import type { MediaEngine, MediaEngineFactory } from './types';
import { PlayerError } from './types';
import type { ResolvedSourceType } from './detect';

/** 各格式对应的 MIME（用于 canPlayType） */
export const NATIVE_MIME: Partial<Record<ResolvedSourceType, string>> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  hls: 'application/vnd.apple.mpegurl',
  dash: 'application/dash+xml',
  mpegts: 'video/mp2t',
  flv: 'video/x-flv',
};

/** 浏览器是否声称能原生播放该格式（canPlayType 为 maybe / probably） */
export function canPlayNatively(
  video: Pick<HTMLVideoElement, 'canPlayType'>,
  type: ResolvedSourceType
) {
  const mime = NATIVE_MIME[type];
  if (!mime || typeof video.canPlayType !== 'function') return false;
  return video.canPlayType(mime) !== '';
}

/** 把地址接到 video 上，destroy 时清空（释放解码器与网络连接） */
export function attachNative(video: HTMLVideoElement, url: string): MediaEngine {
  let destroyed = false;
  video.src = url;
  return {
    kind: 'native',
    levels: () => [],
    currentLevel: () => 'auto',
    setLevel: () => undefined,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      // 只清掉自己设置的地址；已经被别的引擎换掉时不动
      if (video.getAttribute('src') === url) {
        video.removeAttribute('src');
        try {
          video.load();
        } catch {
          // 部分环境（测试 DOM）没有实现 load
        }
      }
    },
  };
}

/** 原生引擎工厂：mp4 / webm / mov 总是交给它；其他格式只在浏览器声明支持时由选择逻辑转交 */
export const nativeEngine: MediaEngineFactory = {
  kind: 'native',
  handles: (type) => type === 'mp4' || type === 'webm' || type === 'mov',
  attach: (video, { url }) => attachNative(video, url),
};

/** 不支持的格式：提示安装对应引擎或自定义 engines */
export function unsupportedError(type: ResolvedSourceType): PlayerError {
  return new PlayerError('unsupported', `当前浏览器不支持播放 ${type.toUpperCase()} 格式`);
}
