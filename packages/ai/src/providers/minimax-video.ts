/**
 * MiniMax（海螺）视频生成 Provider
 *
 * 接口（依据 platform.minimax.cn 公开文档，2026-10 核对；2026-10-08 再次核对地址与模型名：
 * https://platform.minimax.cn/docs/api-reference/video-generation-t2v 列出
 * MiniMax-Hailuo-2.3 / MiniMax-Hailuo-02 / T2V-01-Director / T2V-01，国际站文档同样四个）：
 * - 提交：POST {base}/v1/video_generation
 *     { model, prompt, duration?, resolution?, first_frame_image?, prompt_optimizer? } → { task_id, base_resp }
 * - 查询：GET  {base}/v1/query/video_generation?task_id=
 *     → { task_id, status: Preparing|Queueing|Processing|Success|Fail, file_id?, base_resp }
 * - 取文件：GET {base}/v1/files/retrieve?file_id= → { file: { download_url }, base_resp }
 * - 鉴权：Authorization: Bearer <key>
 * - 业务错误以 HTTP 200 + base_resp.status_code ≠ 0 返回：
 *     1002 限流 / 1004、2049 鉴权 / 1008 余额不足 / 1026、1027 内容安全 / 2013 参数错误
 *
 * 假设（文档未写明，集中在常量里便于修正）：
 * - 默认地址为国内站 https://api.minimax.cn（国际站 https://api.minimax.io，可在设置中心改）
 * - duration 只接受 6 / 10 秒，这里就近取值；resolution 只接受 512P / 768P / 1080P（2026-10-09 用真实 Key 验证），
 *   按高度就近映射（480p → 512P，720p → 768P），无法识别时不发送（沿用模型默认）；
 *   512P 只在提供首帧（图生视频）时可用，文生视频最低 768P
 * - 文档未提供取消接口，cancelTask 不实现（调用方只在本地标记取消）
 * - 声音：公开文档的视频生成接口没有声音相关参数，`withAudio` 不映射（忽略）；
 *   成片若自带音轨，按原始字节下载落盘，不转码，音轨原样保留
 */
import { AIError, type AIErrorKind } from '../errors';
import { createHttpClient, NO_RETRY } from '../http';
import type {
  CallOptions,
  ProviderConfig,
  VideoGenerationRequest,
  VideoPollResult,
  VideoProvider,
  VideoResult,
} from '../types';

export const MINIMAX_VIDEO_DEFAULTS = {
  baseUrl: 'https://api.minimax.cn',
  model: 'MiniMax-Hailuo-02',
  models: ['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-02', 'T2V-01-Director', 'T2V-01'],
  timeoutMs: 60_000,
} as const;

export const MINIMAX_ENDPOINTS = {
  submit: '/v1/video_generation',
  query: '/v1/query/video_generation',
  retrieveFile: '/v1/files/retrieve',
} as const;

const STATUS_CODE_KINDS: Record<number, AIErrorKind> = {
  1000: 'server',
  1001: 'timeout',
  1002: 'rate-limit',
  1004: 'auth',
  1008: 'quota',
  1013: 'server',
  1026: 'content-safety',
  1027: 'content-safety',
  1039: 'rate-limit',
  2013: 'bad-request',
  2049: 'auth',
};

interface BaseResp {
  status_code?: number;
  status_msg?: string;
}

interface SubmitResponse {
  task_id?: string;
  base_resp?: BaseResp;
}

interface QueryResponse {
  task_id?: string;
  status?: string;
  file_id?: string | number;
  base_resp?: BaseResp;
}

interface RetrieveResponse {
  file?: { download_url?: string; file_id?: string | number };
  base_resp?: BaseResp;
}

/** base_resp.status_code ≠ 0 时转换为 AIError */
export function minimaxBaseRespError(base: BaseResp | undefined): AIError | null {
  const code = base?.status_code;
  if (code === undefined || code === 0) return null;
  return new AIError({
    kind: STATUS_CODE_KINDS[code] ?? 'unknown',
    message: base?.status_msg || `MiniMax 返回错误码 ${code}`,
    code: String(code),
    providerId: 'minimax-video',
  });
}

function assertOk(base: BaseResp | undefined): void {
  const error = minimaxBaseRespError(base);
  if (error) throw error;
}

/** 主体参考图上限（H3 文档为最多 9 张；为控制请求体大小只带前 4 张） */
export const MINIMAX_REFERENCE_LIMIT = 4;

/** MiniMax 只支持 6 / 10 秒 */
/** 分辨率 → MiniMax 支持的 512P / 768P / 1080P（按高度就近取值；512P 只用于有首帧的图生视频） */
export function normalizeMinimaxResolution(
  resolution: string | undefined,
  hasFirstFrame = false
): string | undefined {
  const match = resolution?.trim().match(/^(\d{3,4})\s*p$/i);
  if (!match) return undefined;
  const height = Number(match[1]);
  if (height <= 600) return hasFirstFrame ? '512P' : '768P';
  if (height <= 900) return '768P';
  return '1080P';
}

export function normalizeMinimaxDuration(durationSec: number | undefined): number | undefined {
  if (durationSec === undefined || !Number.isFinite(durationSec)) return undefined;
  return durationSec > 8 ? 10 : 6;
}

/** 构造提交请求体（导出供测试做请求映射快照） */
/** 支持人物参考（subject_reference）的模型：S2V 系列 */
export function minimaxSupportsSubjectReference(model: string): boolean {
  return /^S2V/i.test(model.trim());
}

/** 「param 'x' is incompatible with model …」/「param 'x' … only supported …」里的字段名；不是这类错误时为 null */
export function incompatibleMinimaxParam(message: string): string | null {
  const match = /param '([a-z_]+)'[^.]*(incompatible|only support|not support)/i.exec(message);
  return match ? match[1] : null;
}

export function buildMinimaxSubmitBody(
  request: VideoGenerationRequest,
  defaultModel: string
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model?.trim() || defaultModel,
    prompt: request.prompt.slice(0, 2000),
    prompt_optimizer: true,
  };
  const duration = normalizeMinimaxDuration(request.durationSec);
  if (duration !== undefined) body.duration = duration;
  const resolution = normalizeMinimaxResolution(
    request.resolution,
    Boolean(request.firstFrameImage)
  );
  if (resolution) body.resolution = resolution;
  if (request.firstFrameImage) body.first_frame_image = request.firstFrameImage;
  if (request.lastFrameImage) body.last_frame_image = request.lastFrameImage;
  // 人物参考（主体参考 / subject reference）只有 S2V 系列支持；2026-10-09 用真实 Key 验证：
  // Hailuo-02 报「param 'subject_reference' is incompatible with model MiniMax-Hailuo-02」
  const references = (request.referenceImages ?? []).slice(0, MINIMAX_REFERENCE_LIMIT);
  if (references.length > 0 && minimaxSupportsSubjectReference(String(body.model))) {
    body.subject_reference = [{ type: 'character', image: references }];
  }
  return body;
}

export function mapMinimaxStatus(status: string | undefined): VideoPollResult['state'] {
  switch ((status ?? '').toLowerCase()) {
    case 'success':
      return 'succeeded';
    case 'fail':
    case 'failed':
      return 'failed';
    case 'processing':
      return 'running';
    default:
      // Preparing / Queueing / 未知状态按排队处理，继续轮询
      return 'queued';
  }
}

export function createMinimaxVideoProvider(config: ProviderConfig): VideoProvider {
  const id = 'minimax-video';
  const apiKey = config.apiKey?.trim() ?? '';
  if (!apiKey) {
    throw new AIError({
      kind: 'not-configured',
      message: '未配置 MiniMax API Key',
      providerId: id,
    });
  }
  const model = config.model?.trim() || MINIMAX_VIDEO_DEFAULTS.model;
  const client = createHttpClient({
    providerId: id,
    baseUrl: config.baseUrl?.trim() || MINIMAX_VIDEO_DEFAULTS.baseUrl,
    headers: { Authorization: `Bearer ${apiKey}` },
    fetch: config.fetch,
    timeoutMs: config.timeoutMs ?? MINIMAX_VIDEO_DEFAULTS.timeoutMs,
    retry: config.retry,
    sleep: config.sleep,
  });

  const query = async (remoteTaskId: string, call: CallOptions): Promise<QueryResponse> => {
    const json = await client.json<QueryResponse>('GET', MINIMAX_ENDPOINTS.query, undefined, {
      signal: call.signal,
      query: { task_id: remoteTaskId },
    });
    return json;
  };

  return {
    id,
    kind: 'video',
    async submitTask(request, call = {}) {
      const body = buildMinimaxSubmitBody(request, model);
      let json: SubmitResponse;
      // 模型不支持某个可选参数时去掉它重新提交（最多 3 次；参数错误说明任务没有创建，不会重复扣费）
      for (let attempt = 0; ; attempt += 1) {
        try {
          json = await client.json<SubmitResponse>('POST', MINIMAX_ENDPOINTS.submit, body, {
            signal: call.signal,
            retry: NO_RETRY,
          });
          assertOk(json.base_resp);
          break;
        } catch (error) {
          const field = error instanceof AIError ? incompatibleMinimaxParam(error.message) : null;
          const optional = field && !['model', 'prompt'].includes(field) && field in body;
          if (!optional || attempt >= 2) throw error;
          delete body[field];
        }
      }
      if (!json.task_id) {
        throw new AIError({
          kind: 'invalid-response',
          message: 'MiniMax 没有返回 task_id',
          providerId: id,
        });
      }
      return { remoteTaskId: String(json.task_id) };
    },
    async pollTask(remoteTaskId, call = {}): Promise<VideoPollResult> {
      const json = await query(remoteTaskId, call);
      const state = mapMinimaxStatus(json.status);
      if (state === 'failed') {
        const error =
          minimaxBaseRespError(json.base_resp) ??
          new AIError({ kind: 'unknown', message: 'MiniMax 视频生成失败', providerId: id });
        return { state, error: error.toJSON() };
      }
      assertOk(json.base_resp);
      return { state };
    },
    async fetchResult(remoteTaskId, call = {}): Promise<VideoResult> {
      const queried = await query(remoteTaskId, call);
      assertOk(queried.base_resp);
      if (mapMinimaxStatus(queried.status) !== 'succeeded' || !queried.file_id) {
        throw new AIError({
          kind: 'bad-request',
          message: 'MiniMax 任务尚未完成，无法下载',
          providerId: id,
          retryable: true,
        });
      }
      const file = await client.json<RetrieveResponse>(
        'GET',
        MINIMAX_ENDPOINTS.retrieveFile,
        undefined,
        { signal: call.signal, query: { file_id: String(queried.file_id) } }
      );
      assertOk(file.base_resp);
      const url = file.file?.download_url;
      if (!url) {
        throw new AIError({
          kind: 'invalid-response',
          message: 'MiniMax 没有返回下载地址',
          providerId: id,
        });
      }
      return { url };
    },
    async testConnection(call = {}) {
      // 查询一个不存在的任务：鉴权失败会返回 1004 / 2049，其他错误码说明 Key 可用
      const json = await client.json<QueryResponse>('GET', MINIMAX_ENDPOINTS.query, undefined, {
        signal: call.signal,
        retry: NO_RETRY,
        query: { task_id: '0' },
      });
      const error = minimaxBaseRespError(json.base_resp);
      if (error && (error.kind === 'auth' || error.kind === 'quota')) throw error;
    },
  };
}
