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
  MotionLibraryImportResult,
  MotionLibraryListResult,
  MotionLibraryRef,
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
  MotionLibraryEntry,
  MotionLibraryImportResult,
  MotionLibraryListResult,
  MotionLibraryRef,
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
  /** 作品动作库：列出 <作品>/资料/动作库/*.bvh */
  invoke(
    channel: 'motion-library-list',
    ref: MotionLibraryRef
  ): Promise<AIIpcResult<MotionLibraryListResult>>;
  /** 读取动作库里的一个 .bvh（≤ 5MB） */
  invoke(
    channel: 'motion-library-read',
    request: MotionLibraryRef & { fileName: string }
  ): Promise<AIIpcResult<string>>;
  /** 导入 / 保存 .bvh 到动作库（同名自动加序号，不覆盖） */
  invoke(
    channel: 'motion-library-import',
    request: MotionLibraryRef & { fileName: string; data: string }
  ): Promise<AIIpcResult<MotionLibraryImportResult>>;
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
}
