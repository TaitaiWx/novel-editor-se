/**
 * AI / 视频 IPC 协议（主进程与渲染进程共用的类型与通道名）
 *
 * 安全约定：渲染进程永远拿不到 API Key 明文——只能写入（ai-providers-set），
 * 读取时只返回 configured: true / false。
 */
import type { AIErrorKind, ChatMessage, ProviderKind, SerializedAIError } from '@novel-editor/ai';
import type { VideoTask } from '@novel-editor/video';

export const AI_STREAM_EVENT = 'ai-stream-event';
export const VIDEO_TASK_EVENT = 'video-task-updated';

/** 设置中心「AI 服务」列表的一行（不含任何密钥） */
export interface AIProviderInfo {
  id: string;
  kind: ProviderKind;
  label: string;
  description: string;
  defaultBaseUrl: string;
  defaultModel: string;
  models: readonly string[];
  docsUrl?: string;
  /** 已保存 API Key */
  configured: boolean;
  /** 密钥是否由系统钥匙串加密保存（false = 系统不支持加密，以受限权限文件保存） */
  secureStorage: boolean;
  enabled: boolean;
  baseUrl: string;
  model: string;
  /** 视频服务：每秒单价（作者自行填写，用于费用预估） */
  pricePerSecond?: number;
  currency?: 'CNY' | 'USD';
}

/** 写入 Provider 配置；apiKey 只写不读，clearKey 删除已保存的 Key */
export interface AIProviderUpdate {
  apiKey?: string;
  clearKey?: boolean;
  enabled?: boolean;
  baseUrl?: string;
  model?: string;
  pricePerSecond?: number | null;
  currency?: 'CNY' | 'USD';
}

export type AIIpcResult<T> = { ok: true; data: T } | { ok: false; error: SerializedAIError };

export interface AICompletePayload {
  /** 省略时使用设置中心的默认 AI（openai-compatible） */
  providerId?: string;
  messages?: ChatMessage[];
  /** 兼容旧版 ai-request 的写法：prompt + systemPrompt + context */
  prompt?: string;
  systemPrompt?: string;
  context?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AICompleteResult {
  text: string;
  model?: string;
  finishReason?: string;
}

/** ai-stream-event 推送的事件 */
export type AIStreamEvent =
  | { streamId: string; type: 'delta'; text: string }
  | { streamId: string; type: 'done'; finishReason?: string; model?: string }
  | { streamId: string; type: 'error'; error: SerializedAIError };

export interface VideoTaskSubmitPayload {
  providerId: string;
  model?: string;
  /** 作品根目录（绝对路径，主进程校验） */
  workPath: string;
  chapter: string;
  scene: string;
  shotIndex: number;
  prompt: string;
  durationSec?: number;
  aspectRatio?: string;
  resolution?: string;
  firstFrameImage?: string;
}

export interface VideoSettingsInfo {
  maxConcurrent: number;
  dailyLimit?: number;
  perTaskLimit?: number;
}

/** 场景视频工作区：定位一个场景目录（<作品>/资料/视频/<章>/<场景>/） */
export interface VideoSceneRef {
  /** 作品根目录（绝对路径，主进程校验） */
  workPath: string;
  chapter: string;
  scene: string;
}

/** video-scene-load 的返回：分镜工作区状态（没有保存过时为 null）与目录内的文件 */
export interface VideoSceneLoadResult {
  /** 场景目录（绝对路径，可能尚不存在） */
  dir: string;
  /** 分镜.json 的内容（由渲染进程校验与迁移） */
  state: unknown;
  /** 目录内的文件名（镜头N-vX.mp4、样片-*.mp4 等，不含子目录） */
  files: string[];
}

export interface VideoSceneSavePayload extends VideoSceneRef {
  /** 分镜工作区状态（JSON 可序列化，写入 分镜.json） */
  state: unknown;
  /** 可选：同时写入 分镜.md */
  markdown?: string;
}

export interface VideoSceneSaveResult {
  dir: string;
  /** 分镜.json 的绝对路径 */
  jsonPath: string;
  /** 写入了 分镜.md 时为其绝对路径 */
  markdownPath?: string;
}

export interface VideoSceneFileRequest extends VideoSceneRef {
  /** 场景目录内的文件名（只允许 镜头N-vX.mp4 / 样片-*.mp4|webm） */
  fileName: string;
}

export interface VideoSceneAnimaticPayload extends VideoSceneRef {
  ext: 'mp4' | 'webm';
  data: Uint8Array;
}

export type { AIErrorKind, SerializedAIError, VideoTask };
