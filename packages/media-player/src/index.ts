/**
 * @novel-editor/media-player
 *
 * 自绘的 React 视频播放器与配套纯函数：可插拔播放引擎（原生 / hls.js / mpegts.js）、清晰度、
 * 播放速度、字幕、画中画、截图、录制。样式为 SCSS Module，由使用方的构建工具（Vite 等）处理；详见 README。
 */
export { default as VideoPlayer, default } from './VideoPlayer';
export type { VideoMetadata, VideoPlayerHandle, VideoPlayerProps } from './playerTypes';
export type { PlayerControls } from './ControlBar';
export type { RenderTooltip, TooltipContext } from './ControlButton';
export { SEEK_STEP_SECONDS, timeRangesToArray } from './ProgressBar';
export { clampTime, formatTime, frameWidth, ratioFromPointer } from './format';
export {
  AUDIO_PROBE_MIN_PLAYED_SECONDS,
  clampVolume,
  detectAudioTrack,
  nextAudioTrackState,
  playedSeconds,
  type AudioProbeTarget,
  type AudioTrackState,
} from './audio';
// 播放源与引擎
export {
  AUTO_QUALITY,
  PlayerError,
  type EngineAttachOptions,
  type EngineLevel,
  type MediaEngine,
  type MediaEngineFactory,
  type MediaQuality,
  type MediaSourceType,
  type PlayerErrorCode,
  type PlayerSource,
  type PlayerSource as MediaSourceDescriptor,
} from './engines/types';
export {
  detectSourceType,
  extensionOfUrl,
  initialQualityId,
  normalizeSource,
  resolvePlayback,
  sortedQualities,
  type ResolvedSourceType,
} from './engines/detect';
export { defaultEngines, selectEngine } from './engines';
export { attachNative, canPlayNatively, nativeEngine } from './engines/native';
export { createHlsEngine, hlsLevels, type HlsEngineOptions } from './engines/hls';
export { createFlvEngine, type FlvEngineOptions } from './engines/flv';
export { qualityOptionsFor, type QualityOption } from './useMediaEngine';
// 截图 / 录制 / 字幕 / 快捷键 / 能力检测
export { captureFrame, downloadBlob, mediaFileName, type ScreenshotMeta } from './screenshot';
export {
  RECORDER_MIME_CANDIDATES,
  nextRecordingStatus,
  pickRecorderMimeType,
  recordingExtension,
  startRecordingSession,
  type RecordingEvent,
  type RecordingMeta,
  type RecordingResult,
  type RecordingStatus,
} from './recorder';
export { applyCaptionMode, defaultCaptionIndex, type PlayerTrack } from './captions';
export { PLAYBACK_RATES, keyAction, stepPlaybackRate, type PlayerKeyAction } from './keyboard';
export {
  getFullscreenElement,
  supportsElementFullscreen,
  supportsPictureInPicture,
  supportsRecording,
  supportsScreenshot,
} from './features';
