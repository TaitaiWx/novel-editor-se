/**
 * AI / 视频 IPC 协议（主进程与渲染进程共用的类型与通道名）
 *
 * 安全约定：渲染进程永远拿不到 API Key 明文——只能写入（ai-models-add / ai-models-update），
 * 读取时只返回 configured: true / false。
 */
import type { AIErrorKind, ChatMessage, ProviderKind, SerializedAIError } from '@novel-editor/ai';
import type { VideoTask } from '@novel-editor/video';
import type { AICapability } from './ai-models';

export const AI_STREAM_EVENT = 'ai-stream-event';
export const VIDEO_TASK_EVENT = 'video-task-updated';

/**
 * 设置中心「AI」模型列表的一行，也是各功能模型选择器的选项（不含任何密钥）。
 * 一行 = 一个模型配置：能力（kind / capability）+ 协议实现（vendor）+ 接口地址 + 模型 + 显示名称（label）
 */
export interface AIProviderInfo {
  /** 模型 id（旧版内置服务保持旧 id，例如 grok、seedance-video；新添加的为 text-<n> 等） */
  id: string;
  kind: ProviderKind;
  /** 同 kind（文本 / 图片 / 视频 / 语音） */
  capability: AICapability;
  /** 协议实现（注册表里的 Provider id，例如 openai-compatible、grok、seedance-video） */
  vendor: string;
  /** 显示名称（默认「服务商 · 模型」） */
  label: string;
  /** 服务商预设 key（ai-models.ts AI_MODEL_PRESETS） */
  preset?: string;
  /** 服务商名称（预设名称；没有预设时为协议实现的名称） */
  providerLabel: string;
  description: string;
  defaultBaseUrl: string;
  defaultModel: string;
  /** 推荐模型 */
  models: readonly string[];
  docsUrl?: string;
  /** 视频：支持「生成声音」 */
  supportsAudio?: boolean;
  /** 已保存 API Key */
  configured: boolean;
  /** 密钥是否由系统钥匙串加密保存（false = 系统不支持加密，以受限权限文件保存） */
  secureStorage: boolean;
  enabled: boolean;
  /** 实际使用的接口地址（没有填写时为协议默认） */
  baseUrl: string;
  /** 实际使用的模型（没有填写时为协议默认） */
  model: string;
  /** 这个能力的默认模型（每个能力一个；功能里省略模型时使用） */
  isDefault: boolean;
  /** 同 isDefault（只在文本模型上；旧字段名） */
  isDefaultText?: boolean;
  /** 视频：每秒单价（作者自行填写，用于费用预估） */
  pricePerSecond?: number;
  currency?: 'CNY' | 'USD';
  /** 文本：温度 / 单次回复长度（同时是请求 max_tokens 的上限）/ 上下文长度 */
  temperature?: number;
  maxTokens?: number;
  contextTokens?: number;
  /** 语音：未指定声音的台词使用的默认声音 */
  voice?: string;
}

/** ai-models-add：添加一个模型（Key 只写不读；reuseKeyFrom 沿用另一个模型已保存的 Key，由主进程复制） */
export interface AIModelInput {
  capability: AICapability;
  vendor: string;
  preset?: string;
  /** 显示名称；省略时为「服务商 · 模型」 */
  label?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  /** 同一服务商 + 同一接口地址、已保存 Key 的模型 id */
  reuseKeyFrom?: string;
  enabled?: boolean;
  temperature?: number;
  maxTokens?: number;
  contextTokens?: number;
  pricePerSecond?: number;
  voice?: string;
}

/** 旧版内置文本 AI 的 id（迁移后仍是一条模型的 id） */
export const BUILTIN_TEXT_PROVIDER_ID = 'openai-compatible';

/** 写入模型配置；apiKey 只写不读，clearKey 删除已保存的 Key */
export interface AIProviderUpdate {
  apiKey?: string;
  clearKey?: boolean;
  enabled?: boolean;
  baseUrl?: string;
  model?: string;
  pricePerSecond?: number | null;
  currency?: 'CNY' | 'USD';
  /** 显示名称 */
  label?: string;
  /** 服务商预设（必须与模型的能力、协议一致） */
  preset?: string;
  /** 文本参数（null 恢复默认） */
  temperature?: number | null;
  maxTokens?: number | null;
  contextTokens?: number | null;
  /** 语音的默认声音（空字符串恢复默认） */
  voice?: string;
}

export type AIIpcResult<T> = { ok: true; data: T } | { ok: false; error: SerializedAIError };

export interface AICompletePayload {
  /** 文本模型 id；省略时使用默认文本模型 */
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
  /** 作品内的首帧图（相对作品目录，提交时由主进程读取；优先于 firstFrameImage） */
  firstFramePath?: string;
  /** 作品内的人物参考图（三视图 / 主要形象图，相对作品目录，最多 4 张） */
  referencePaths?: string[];
  /** 生成与画面同步的声音（只对支持的视频服务生效，缺省沿用厂商默认） */
  withAudio?: boolean;
}

export interface VideoSettingsInfo {
  maxConcurrent: number;
  dailyLimit?: number;
  perTaskLimit?: number;
  /** 场景视频新场景的默认配音语言（BCP-47，例如 zh-CN） */
  voiceLanguage?: string;
}

/** ai-speech-synthesize：为一句对白生成配音，写入场景目录（镜头N-台词-<id>.mp3|wav） */
export interface SpeechSynthesizePayload {
  /** 作品根目录（绝对路径，主进程校验） */
  workPath: string;
  chapter: string;
  scene: string;
  shotIndex: number;
  /** 对白 id（只允许 [A-Za-z0-9_-]） */
  lineId: string;
  text: string;
  /** BCP-47 */
  language: string;
  /** 语音模型 id；省略时用默认语音模型 */
  providerId?: string;
  model?: string;
  emotion?: string;
  voice?: {
    providerVoiceId?: string;
    gender?: 'male' | 'female' | 'neutral';
    age?: string;
    timbre?: string;
  };
  format?: 'mp3' | 'wav';
}

export interface SpeechSynthesizeResult {
  /** 场景目录内的文件名 */
  fileName: string;
  /** 相对作品目录的路径 */
  relativePath: string;
  mimeType: string;
  durationSec?: number;
  providerId: string;
}

/** scene-audio-import：选择本地音频文件，复制到 <作品>/资料/音乐/（配乐 / 环境音）或 资料/音效/ */
export interface SceneAudioImportPayload {
  workPath: string;
  kind: 'bgm' | 'ambience' | 'sfx';
}

export interface SceneAudioImportResult {
  /** 作者取消选择时为 true（其余字段为空） */
  canceled: boolean;
  fileName?: string;
  /** 相对作品目录的路径 */
  relativePath?: string;
  size?: number;
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

export type { AIErrorKind, SerializedAIError, VideoTask, AICapability };
