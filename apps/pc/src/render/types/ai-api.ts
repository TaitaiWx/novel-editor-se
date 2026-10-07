/**
 * AI 服务 / 流式补全 / 场景视频 IPC 类型（与 main/handlers/ai-providers.ts、video.ts 保持一致）
 *
 * Key 只写不读：ai-providers-* 只返回 configured，绝不返回密钥。
 * 流式片段通过 on('ai-stream-event', (event, payload: AIStreamEvent) => …) 接收，
 * 视频任务变化通过 on('video-task-updated', (event, task: VideoTask) => …) 接收。
 */
import type {
  AICompletePayload,
  AICompleteResult,
  AIIpcResult,
  AIProviderInfo,
  AIProviderUpdate,
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
  AICompletePayload,
  AICompleteResult,
  AIIpcResult,
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
export { AI_STREAM_EVENT, VIDEO_TASK_EVENT } from '../../shared/ai';

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
}
