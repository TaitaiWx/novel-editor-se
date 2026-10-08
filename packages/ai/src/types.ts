/**
 * Provider 抽象
 *
 * - TextProvider：对话补全（一次性 complete + 流式 stream，均支持 AbortSignal）
 * - VideoProvider：异步视频任务（submitTask → pollTask → fetchResult），任务排队与持久化
 *   由调用方（主进程 + @novel-editor/video 的状态机）负责，Provider 只做协议映射
 * - SpeechProvider：文字转语音（场景视频的对白配音），一次请求返回整段音频字节
 * - MusicProvider：配乐生成的预留接口（尚无内置实现，场景声音的 bgm.source = 'generate' 将来接入）
 *
 * 密钥只出现在 ProviderConfig 中，由主进程 / CLI 在创建 Provider 时注入，绝不回传给渲染进程。
 */
import type { SerializedAIError } from './errors';
import type { FetchLike, RetryPolicy } from './http';

export type ProviderKind = 'text' | 'video' | 'image' | 'speech';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  /** 覆盖 Provider 默认模型 */
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface CompletionResult {
  text: string;
  model?: string;
  finishReason?: string;
  usage?: TokenUsage;
}

export type StreamChunk =
  | { type: 'delta'; text: string }
  | { type: 'done'; finishReason?: string; usage?: TokenUsage; model?: string };

export interface CallOptions {
  signal?: AbortSignal;
}

export interface TextProvider {
  readonly id: string;
  readonly kind: 'text';
  complete(request: CompletionRequest, options?: CallOptions): Promise<CompletionResult>;
  /** 逐段产出文本；取消时抛出 kind = 'aborted' 的 AIError */
  stream(request: CompletionRequest, options?: CallOptions): AsyncIterable<StreamChunk>;
  /** 连通性测试：成功 resolve，失败抛出 AIError */
  testConnection(options?: CallOptions): Promise<void>;
}

export interface VideoGenerationRequest {
  prompt: string;
  model?: string;
  durationSec?: number;
  /** 例如 16:9 / 9:16 / 1:1 */
  aspectRatio?: string;
  /** 例如 720p / 768p / 1080p */
  resolution?: string;
  /** 首帧参考图：http(s) URL 或 data URL（base64） */
  firstFrameImage?: string;
  /** 尾帧（首尾帧夹住动作，模型支持时） */
  lastFrameImage?: string;
  /** 人物参考图（三视图 / 主要形象图，保持人物一致；模型支持时） */
  referenceImages?: readonly string[];
  seed?: number;
  watermark?: boolean;
  /**
   * 是否让模型同时生成声音（对白 / 音效 / 环境声）。只映射到公开文档支持的厂商
   * （Seedance：`generate_audio`）；不支持的厂商忽略。缺省时不发送，沿用厂商默认
   */
  withAudio?: boolean;
}

export type VideoRemoteState = 'queued' | 'running' | 'succeeded' | 'failed';

export interface VideoPollResult {
  state: VideoRemoteState;
  /** 0-100（厂商不提供时为空） */
  progress?: number;
  /** 部分厂商在轮询结果中直接给出下载地址 */
  resultUrl?: string;
  error?: SerializedAIError;
}

export interface VideoResult {
  url: string;
  /** 下载地址过期时间（epoch ms，未知为空） */
  expiresAt?: number;
}

export interface VideoProvider {
  readonly id: string;
  readonly kind: 'video';
  /** 提交生成任务，返回厂商任务 id。默认不重试，避免重复扣费 */
  submitTask(
    request: VideoGenerationRequest,
    options?: CallOptions
  ): Promise<{ remoteTaskId: string }>;
  pollTask(remoteTaskId: string, options?: CallOptions): Promise<VideoPollResult>;
  /** 取得成片下载地址（签名地址可能过期，每次下载前重新获取） */
  fetchResult(remoteTaskId: string, options?: CallOptions): Promise<VideoResult>;
  /** 取消排队中的任务（厂商不支持时抛出 bad-request） */
  cancelTask?(remoteTaskId: string, options?: CallOptions): Promise<void>;
  testConnection(options?: CallOptions): Promise<void>;
}

/** 图片生成（人物形象 / 三视图 / 服装 / 设定图）的请求 */
export interface ImageGenerationRequest {
  prompt: string;
  model?: string;
  /** 画面比例，例如 1:1 / 3:4 / 16:9 */
  aspectRatio?: string;
  /** 一次生成的张数（1–4，作者从中挑选） */
  count?: number;
  /** 参考图（data URL 或 http(s) 地址）：保持人物 / 画风一致 */
  referenceImages?: readonly string[];
  seed?: number;
}

export interface GeneratedImage {
  /** base64（不含 data: 前缀）；厂商只返回地址时为空 */
  base64?: string;
  url?: string;
  mimeType: string;
}

export interface ImageGenerationResult {
  images: GeneratedImage[];
  model: string;
}

export interface ImageProvider {
  readonly id: string;
  readonly kind: 'image';
  /** 同步生成（通常 10–60 秒）。默认不重试，避免重复扣费 */
  generate(request: ImageGenerationRequest, options?: CallOptions): Promise<ImageGenerationResult>;
  /** 是否支持参考图（不支持时调用方只用文字描述） */
  readonly supportsReferences: boolean;
  testConnection(options?: CallOptions): Promise<void>;
}

/** 人物声音（与 @novel-editor/video 的 CharacterVoice 一致） */
export interface SpeechVoice {
  /** 厂商音色 id；不填时按性别取默认音色 */
  providerVoiceId?: string;
  gender?: 'male' | 'female' | 'neutral';
  age?: string;
  timbre?: string;
}

export type SpeechFormat = 'mp3' | 'wav';

export interface SpeechRequest {
  text: string;
  /** BCP-47，例如 zh-CN / en-US */
  language: string;
  voice?: SpeechVoice;
  /** 情绪（映射到厂商支持的情绪 / 朗读指令） */
  emotion?: string;
  format?: SpeechFormat;
  model?: string;
}

export interface SpeechResult {
  data: Uint8Array;
  mimeType: string;
  format: SpeechFormat;
  /** 厂商返回或可从文件头推算时给出 */
  durationSec?: number;
}

export interface SpeechProvider {
  readonly id: string;
  readonly kind: 'speech';
  /** 合成一句台词。默认不重试，避免重复扣费 */
  synthesize(request: SpeechRequest, options?: CallOptions): Promise<SpeechResult>;
  testConnection(options?: CallOptions): Promise<void>;
}

/**
 * 配乐生成（预留，尚无内置实现）：给一段描述与时长，返回整段音乐。
 * 接入时在注册表里新增 kind 'music'，主进程把结果写入 <作品>/资料/音乐/，场景声音的 bgm.path 指向它。
 */
export interface MusicRequest {
  prompt: string;
  durationSec: number;
  /** 例如 calm / tense / epic */
  mood?: string;
  model?: string;
}

export interface MusicProvider {
  readonly id: string;
  readonly kind: 'music';
  generate(
    request: MusicRequest,
    options?: CallOptions
  ): Promise<{ data: Uint8Array; mimeType: string }>;
  testConnection(options?: CallOptions): Promise<void>;
}

export type AnyProvider = TextProvider | VideoProvider | ImageProvider | SpeechProvider;

/** 创建 Provider 所需的配置（密钥由主进程 / CLI 注入） */
export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** 配音服务：未指定声音的台词使用的默认声音（厂商的 voice id） */
  voice?: string;
  timeoutMs?: number;
  retry?: RetryPolicy;
  fetch?: FetchLike;
  /** 测试注入：替换重试等待 */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** Provider 的静态描述（设置中心 / CLI 列表展示用，不含任何密钥） */
export interface ProviderDescriptor {
  id: string;
  kind: ProviderKind;
  label: string;
  description: string;
  defaultBaseUrl: string;
  defaultModel: string;
  /** 推荐模型（可手动输入其他） */
  models: readonly string[];
  /** CLI 读取密钥的环境变量名 */
  envKey: string;
  docsUrl?: string;
  /** 视频服务：公开文档支持「生成声音」（请求里的 withAudio 会被映射） */
  supportsAudio?: boolean;
}
