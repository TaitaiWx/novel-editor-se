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

export type { AIErrorKind, SerializedAIError, VideoTask };
