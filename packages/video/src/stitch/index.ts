/**
 * @novel-editor/video/stitch
 *
 * 渲染进程专用：把分镜镜头（已生成视频 / 首帧图 / 占位卡）拼成样片并用 WebCodecs 导出。
 * 依赖 DOM / OffscreenCanvas / WebCodecs，不要在主进程或 CLI 中引入。
 */
export * from './types';
export * from './timeline';
export * from './render';
export * from './renderer';
export * from './codecs';
export * from './muxer';
export * from './encoder';
export * from './video-source';
export * from './animatic';
