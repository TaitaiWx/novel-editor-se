/**
 * AI 服务 / 流式补全 / 场景视频 IPC 类型（与 main/handlers/ai-providers.ts、video.ts 保持一致）
 *
 * Key 只写不读：ai-providers-* / ai-models-* 只返回 configured，绝不返回密钥。
 * 流式片段通过 on('ai-stream-event', (event, payload: AIStreamEvent) => …) 接收，
 * 视频任务变化通过 on('video-task-updated', (event, task: VideoTask) => …) 接收。
 */
import type {
  AICompletePayload,
  AICompleteResult,
  AICapability,
  AIIpcResult,
  AIModelInput,
  AIProviderInfo,
  AIProviderUpdate,
  SceneAudioImportPayload,
  SceneAudioImportResult,
  SpeechSynthesizePayload,
  SpeechSynthesizeResult,
  VideoSceneAnimaticPayload,
  VideoSceneFileRequest,
  VideoSceneLoadResult,
  VideoSceneRef,
  VideoSceneSavePayload,
  VideoSceneSaveResult,
  VideoSettingsInfo,
  VideoTask,
  VideoTaskSubmitPayload,
} from '../../shared/ai';

export type {
  SceneAudioImportPayload,
  SceneAudioImportResult,
  SpeechSynthesizePayload,
  SpeechSynthesizeResult,
  AICompletePayload,
  AICompleteResult,
  AICapability,
  AIIpcResult,
  AIModelInput,
  AIProviderInfo,
  AIProviderUpdate,
  AIStreamEvent,
  SerializedAIError,
  VideoSceneAnimaticPayload,
  VideoSceneFileRequest,
  VideoSceneLoadResult,
  VideoSceneRef,
  VideoSceneSavePayload,
  VideoSceneSaveResult,
  VideoSettingsInfo,
  VideoTask,
  VideoTaskSubmitPayload,
} from '../../shared/ai';
export { AI_STREAM_EVENT, BUILTIN_TEXT_PROVIDER_ID, VIDEO_TASK_EVENT } from '../../shared/ai';

export interface AIInvokeOverloads {
  invoke(channel: 'ai-providers-list'): Promise<AIIpcResult<AIProviderInfo[]>>;
  invoke(channel: 'ai-providers-get', providerId: string): Promise<AIIpcResult<AIProviderInfo>>;
  invoke(
    channel: 'ai-providers-set',
    providerId: string,
    update: AIProviderUpdate
  ): Promise<AIIpcResult<AIProviderInfo>>;
  invoke(
    channel: 'ai-providers-test',
    providerId: string
  ): Promise<AIIpcResult<{ latencyMs: number }>>;
  /** 添加模型（Key 只写；reuseKeyFrom 沿用同一服务商 + 地址的已保存 Key） */
  invoke(channel: 'ai-models-add', input: AIModelInput): Promise<AIIpcResult<AIProviderInfo>>;
  invoke(
    channel: 'ai-models-update',
    id: string,
    update: AIProviderUpdate
  ): Promise<AIIpcResult<AIProviderInfo>>;
  invoke(channel: 'ai-models-remove', id: string): Promise<AIIpcResult<{ removed: boolean }>>;
  /** 设置某个能力的默认模型（null 清除），返回新的模型列表 */
  invoke(
    channel: 'ai-models-set-default',
    capability: AICapability,
    id: string | null
  ): Promise<AIIpcResult<AIProviderInfo[]>>;
  invoke(channel: 'ai-models-test', id: string): Promise<AIIpcResult<{ latencyMs: number }>>;
  invoke(
    channel: 'ai-complete',
    payload: AICompletePayload
  ): Promise<AIIpcResult<AICompleteResult>>;
  invoke(
    channel: 'ai-stream-start',
    payload: AICompletePayload
  ): Promise<AIIpcResult<{ streamId: string }>>;
  invoke(
    channel: 'ai-stream-cancel',
    streamId: string
  ): Promise<AIIpcResult<{ cancelled: boolean }>>;
  invoke(
    channel: 'video-task-submit',
    payload: VideoTaskSubmitPayload
  ): Promise<AIIpcResult<VideoTask>>;
  invoke(
    channel: 'video-task-list',
    filter?: { workPath?: string }
  ): Promise<AIIpcResult<VideoTask[]>>;
  invoke(channel: 'video-task-cancel', taskId: string): Promise<AIIpcResult<VideoTask>>;
  invoke(channel: 'video-task-retry', taskId: string): Promise<AIIpcResult<VideoTask>>;
  invoke(channel: 'video-settings-get'): Promise<AIIpcResult<VideoSettingsInfo>>;
  invoke(
    channel: 'video-settings-set',
    update: Partial<VideoSettingsInfo>
  ): Promise<AIIpcResult<VideoSettingsInfo>>;
  invoke(
    channel: 'video-scene-load',
    scene: VideoSceneRef
  ): Promise<AIIpcResult<VideoSceneLoadResult>>;
  invoke(
    channel: 'video-scene-save',
    payload: VideoSceneSavePayload
  ): Promise<AIIpcResult<VideoSceneSaveResult>>;
  invoke(
    channel: 'video-scene-read-file',
    request: VideoSceneFileRequest
  ): Promise<AIIpcResult<Uint8Array>>;
  invoke(
    channel: 'video-scene-write-animatic',
    payload: VideoSceneAnimaticPayload
  ): Promise<AIIpcResult<{ fileName: string; path: string }>>;
  /** 首帧（采用的候选）/ 预演截图：保存到场景目录，返回相对作品目录的路径 */
  invoke(
    channel: 'video-scene-write-image',
    payload: VideoSceneRef & { kind: 'keyframe' | 'previz'; shotIndex: number; data: Uint8Array }
  ): Promise<AIIpcResult<{ fileName: string; relativePath: string }>>;
  /** 预演视频（3D 预演逐帧导出的 MP4 / WebM）：保存为 镜头N-预演.<ext>，覆盖写入，返回相对作品目录的路径 */
  invoke(
    channel: 'video-scene-write-media',
    payload: VideoSceneRef & {
      kind: 'previz-video';
      shotIndex: number;
      ext: 'mp4' | 'webm';
      data: Uint8Array;
    }
  ): Promise<AIIpcResult<{ fileName: string; relativePath: string }>>;
  /** 对白配音：写入场景目录 镜头N-台词-<id>.mp3|wav（密钥只在主进程） */
  invoke(
    channel: 'ai-speech-synthesize',
    payload: SpeechSynthesizePayload
  ): Promise<AIIpcResult<SpeechSynthesizeResult>>;
  /** 选择本地音频复制进作品（资料/音乐/ 或 资料/音效/），渲染进程不能指定源路径 */
  invoke(
    channel: 'scene-audio-import',
    payload: SceneAudioImportPayload
  ): Promise<AIIpcResult<SceneAudioImportResult>>;
  /** 读取作品内 资料/音乐/ 或 资料/音效/ 下的音频（试听 / 样片混音） */
  invoke(
    channel: 'scene-audio-read',
    payload: { workPath: string; relativePath: string }
  ): Promise<AIIpcResult<Uint8Array>>;
}
