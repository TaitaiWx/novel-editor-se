/**
 * 应用内的媒体播放器：独立包 @novel-editor/media-player 的薄封装。音频与视频是同一个组件：
 * VideoPlayer（kind 自动）与 AudioPlayer（kind="audio"）共用同一套引擎、控制条、快捷键，只是画面区域不同。
 * - 控制按钮的提示换成应用统一的 Tooltip；全屏时挂到播放器内部（挂到 body 的提示在全屏时看不见）
 * - 截图 / 录制结果走主进程「另存为」（media-save-generated），而不是浏览器下载
 * 其余行为与属性见包的 README。
 */
import React, { forwardRef, useCallback } from 'react';
import {
  MediaPlayer as BaseMediaPlayer,
  type RenderTooltip,
  type VideoPlayerHandle,
  type VideoPlayerProps,
} from '@novel-editor/media-player';
import Tooltip from '../Tooltip';
import { useOptionalToast } from '../Toast';
import { saveGeneratedMedia } from '../../utils/mediaExport';

export { formatTime } from '@novel-editor/media-player';
export type {
  MediaKind,
  VideoMetadata,
  VideoPlayerHandle,
  VideoPlayerProps,
} from '@novel-editor/media-player';

const renderTooltip: RenderTooltip = (content, control, context) => (
  <Tooltip content={content} portalContainer={context.container}>
    {control}
  </Tooltip>
);

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>((props, ref) => {
  const toast = useOptionalToast();
  // 保存结果：成功提示位置；取消返回 false（播放器不再提示「已截图」）；失败抛出由播放器提示
  const save = useCallback(
    async (blob: Blob, fileName: string): Promise<boolean> => {
      const result = await saveGeneratedMedia(blob, fileName);
      if (result.error) throw new Error(result.error);
      if (result.saved) toast?.success(`已保存到 ${result.filePath ?? ''}`, 5000);
      return result.saved;
    },
    [toast]
  );
  const onScreenshot = useCallback(
    (blob: Blob, meta: { fileName: string }) => save(blob, meta.fileName),
    [save]
  );
  const onRecording = useCallback(
    (blob: Blob, meta: { fileName: string }) => save(blob, meta.fileName),
    [save]
  );
  return (
    <BaseMediaPlayer
      ref={ref}
      renderTooltip={renderTooltip}
      onScreenshot={onScreenshot}
      onRecording={onRecording}
      {...props}
    />
  );
});

VideoPlayer.displayName = 'VideoPlayer';

/** 音频：同一个播放器，固定使用音频界面（封面 + 真实波形 + 常显控制条） */
export const AudioPlayer = forwardRef<VideoPlayerHandle, Omit<VideoPlayerProps, 'kind'>>(
  (props, ref) => <VideoPlayer ref={ref} {...props} kind="audio" />
);

AudioPlayer.displayName = 'AudioPlayer';

export default VideoPlayer;
