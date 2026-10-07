/**
 * 引擎选择：按顺序找第一个声明处理该格式的引擎；都不处理时，浏览器能原生播放就交给原生，否则报不支持。
 * 默认顺序：hls.js → mpegts.js → 原生。使用方可通过 `engines` 属性替换或追加（例如接入 dash.js）。
 */
import { createFlvEngine } from './flv';
import { createHlsEngine } from './hls';
import { canPlayNatively, nativeEngine, unsupportedError } from './native';
import type { ResolvedSourceType } from './detect';
import type { MediaEngineFactory } from './types';

let cachedDefaults: MediaEngineFactory[] | null = null;

/** 默认引擎（hls.js、mpegts.js 只在用到时才加载） */
export function defaultEngines(): MediaEngineFactory[] {
  if (!cachedDefaults) cachedDefaults = [createHlsEngine(), createFlvEngine(), nativeEngine];
  return cachedDefaults;
}

/** 选出处理该格式的引擎；没有时返回 null */
export function selectEngine(
  type: ResolvedSourceType,
  engines: readonly MediaEngineFactory[],
  video: Pick<HTMLVideoElement, 'canPlayType'>
): MediaEngineFactory | null {
  const found = engines.find((engine) => engine.handles(type));
  if (found) return found;
  return canPlayNatively(video, type) ? nativeEngine : null;
}

export { unsupportedError };
