/**
 * 应用内的视频播放器：独立包 @novel-editor/media-player 的薄封装，
 * 只把控制按钮的提示换成应用统一的 Tooltip。其余行为与属性见包的 README。
 */
import React from 'react';
import { VideoPlayer as BaseVideoPlayer, type RenderTooltip } from '@novel-editor/media-player';
import type { VideoPlayerProps } from '@novel-editor/media-player';
import Tooltip from '../Tooltip';

export { formatTime } from '@novel-editor/media-player';
export type { VideoMetadata, VideoPlayerProps } from '@novel-editor/media-player';

const renderTooltip: RenderTooltip = (content, control) => (
  <Tooltip content={content}>{control}</Tooltip>
);

const VideoPlayer: React.FC<VideoPlayerProps> = (props) => (
  <BaseVideoPlayer renderTooltip={renderTooltip} {...props} />
);

export default VideoPlayer;
