/**
 * @novel-editor/media-player
 *
 * 自绘的 React 视频播放器（不依赖第三方播放器）与配套纯函数。
 * 样式为 SCSS Module，由使用方的构建工具（Vite 等）处理；详见 README。
 */
export { default as VideoPlayer, default } from './VideoPlayer';
export type { VideoMetadata, VideoPlayerProps } from './VideoPlayer';
export type { RenderTooltip } from './ControlButton';
export { SEEK_STEP_SECONDS } from './ProgressBar';
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
