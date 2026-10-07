/**
 * @novel-editor/video/stitch
 *
 * 渲染进程专用：把分镜镜头（已生成视频 / 首帧图 / 占位卡）拼成样片并用 WebCodecs 导出。
 * 素材自带的声音会保留：按与画面相同的片段起点 / 时长混音（audio-plan / audio-mix），
 * 用 AAC（MP4）或 Opus（WebM）编码写入同一个文件（audio-codecs / audio-encode）。
 * 场景声音（对白配音、音效、背景音乐循环 + 淡入淡出 + 对白时压低、环境音）由 audio-scene-plan 纯函数规划。
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
export * from './audio-plan';
export * from './audio-scene-plan';
export * from './audio-codecs';
export * from './audio-mix';
export * from './audio-encode';
export * from './frames';
