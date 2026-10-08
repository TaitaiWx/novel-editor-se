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
  /** 视频服务支持「生成声音」 */
  supportsAudio?: boolean;
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
  /**
   * 作者自己添加的服务（可改名 / 删除）：文本为 OpenAI 兼容（custom-text-<n>），
   * 视频 / 图片 / 语音沿用某个内置厂商实现（custom-video-<n> / custom-image-<n> / custom-speech-<n>）
   */
  custom?: boolean;
  /** 自定义视频 / 图片 / 语音服务沿用的厂商实现（内置服务 id，例如 seedance-video） */
  vendor?: string;
  /** 文本服务：是默认写作 AI（续写、分镜、预演、灵感、推演、ai-request 省略 providerId 时使用） */
  isDefaultText?: boolean;
  /** 默认写作 AI 是作者在设置中心选定的（false / 缺省 = 未选择，沿用内置默认） */
  defaultTextChosen?: boolean;
  /**
   * 文本服务的生成参数（每个文本服务都有；内置默认的值来自设置中心 JSON，其余在 ai-providers.json）：
   * 温度 / 单次回复长度（同时是请求 max_tokens 的上限）/ 上下文长度（续写等按它决定上下文预算）
   */
  temperature?: number;
  maxTokens?: number;
  contextTokens?: number;
  /** 配音服务：未指定声音的台词使用的默认声音 */
  voice?: string;
}

/**
 * ai-providers-add-custom：添加一个自己的服务（Key 可同时写入，只写不读）
 * - kind 省略或为 text：OpenAI 兼容文本 AI，baseUrl 必填
 * - kind 为 video / image / speech：vendor 必填（同类内置服务的 id），baseUrl 省略时用该厂商的默认地址
 */
export interface AICustomProviderInput {
  kind?: ProviderKind;
  vendor?: string;
  label: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  /** 视频服务：每秒单价 */
  pricePerSecond?: number;
  /** 语音服务：默认声音 */
  voice?: string;
}

/** 旧名称（只添加文本 AI 时的写法） */
export type AICustomTextInput = AICustomProviderInput;

export const BUILTIN_TEXT_PROVIDER_ID = 'openai-compatible';

/** 写入 Provider 配置；apiKey 只写不读，clearKey 删除已保存的 Key */
export interface AIProviderUpdate {
  apiKey?: string;
  clearKey?: boolean;
  enabled?: boolean;
  baseUrl?: string;
  model?: string;
  pricePerSecond?: number | null;
  currency?: 'CNY' | 'USD';
  /** 只对自己添加的服务有效：改名 */
  label?: string;
  /** 文本服务参数（null 恢复默认） */
  temperature?: number | null;
  maxTokens?: number | null;
  contextTokens?: number | null;
  /** 配音服务的默认声音（空字符串恢复默认） */
  voice?: string;
}

export type AIIpcResult<T> = { ok: true; data: T } | { ok: false; error: SerializedAIError };

export interface AICompletePayload {
  /** 省略时使用默认写作 AI（设置中心选定的文本 AI；未选择时为内置 openai-compatible） */
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
  /** 配音服务；省略时用第一个已配置的配音服务 */
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

export type { AIErrorKind, SerializedAIError, VideoTask };
