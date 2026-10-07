/**
 * 预演动作的生成：文本模型在预演脚本里写了 motion: { generate: '描述' }（没有 tracks）时，把描述变成关节轨迹。
 *
 * 不使用任何动作文件，轨迹格式与脚本里的 motion.tracks 完全相同（@novel-editor/video PrevizMotionTracks）：
 * 1. 配置了动作生成服务（MotionProvider，扩展点，目前没有内置实现）时交给它：
 *    generateMotion({ description, durationSec, joints }) → { tracks, rootBob?, lean?, loop? }
 * 2. 否则用文本模型追加一次请求（complete 回调，提示词 prompts/previz-motion.ts buildMotionPrompt）
 * 3. 相同描述只生成一次；结果经 validateMotionTracks 校验 / 夹值后写回脚本（描述保留，有 tracks 后不再生成）
 * 生成失败的请求保留 generate（引擎回退到 pose），并给出提示。不修改传入的脚本。
 */
import {
  PREVIZ_JOINTS,
  PREVIZ_MAX_DURATION,
  validateMotionTracks,
  type PrevizJoint,
  type PrevizMotionTracks,
  type PrevizScript,
} from '@novel-editor/video';
import { toAIError } from './errors';
import { buildMotionPrompt, parseMotionResponse } from './prompts/previz-motion';
import type { CallOptions, ChatMessage } from './types';

export interface MotionGenerationRequest {
  /** 动作描述（作者语言即可，由服务自行理解） */
  description: string;
  durationSec: number;
  /** 可驱动的关节（预演木偶的关节 id），轨迹的键只能用这些 */
  joints: readonly PrevizJoint[];
}

/** 动作生成服务：文字描述 → 关节轨迹（与预演脚本 motion.tracks 同一格式） */
export interface MotionProvider {
  readonly id: string;
  readonly kind: 'motion';
  generateMotion(
    request: MotionGenerationRequest,
    options?: CallOptions
  ): Promise<PrevizMotionTracks>;
}

/** 追加请求：把消息交给文本模型，返回回复文本 */
export type MotionCompletion = (
  request: { messages: ChatMessage[]; temperature: number; maxTokens: number },
  options?: CallOptions
) => Promise<string>;

export interface ResolveMotionOptions {
  provider?: MotionProvider | null;
  complete?: MotionCompletion | null;
  signal?: AbortSignal;
}

export interface ResolveMotionResult {
  script: PrevizScript;
  /** 生成成功的描述 */
  generated: string[];
  notes: string[];
}

export interface PendingMotionRequest {
  figure: number;
  key: number;
  description: string;
  durationSec: number;
}

const MIN_MOTION_SEC = 1;

/** 脚本里所有待生成的动作（关键帧有 generate 但没有 tracks） */
export function pendingMotionRequests(script: PrevizScript): PendingMotionRequest[] {
  const list: PendingMotionRequest[] = [];
  script.figures.forEach((track, figure) => {
    track.keys.forEach((key, index) => {
      const description = key.motion?.generate?.trim();
      if (!description || key.motion?.tracks) return;
      const next = track.keys[index + 1];
      const span = (next ? next.t : script.durationSec) - key.t;
      const durationSec = Math.min(PREVIZ_MAX_DURATION, Math.max(MIN_MOTION_SEC, span));
      list.push({ figure, key: index, description, durationSec });
    });
  });
  return list;
}

async function generateOne(
  request: PendingMotionRequest,
  script: PrevizScript,
  options: ResolveMotionOptions
): Promise<PrevizMotionTracks> {
  const call = { signal: options.signal };
  if (options.provider) {
    const raw = await options.provider.generateMotion(
      { description: request.description, durationSec: request.durationSec, joints: PREVIZ_JOINTS },
      call
    );
    const checked = validateMotionTracks(raw);
    if (!checked.ok) throw new Error(checked.errors[0]);
    return checked.motion;
  }
  const complete = options.complete as MotionCompletion;
  const track = script.figures[request.figure];
  const prompt = buildMotionPrompt({
    description: request.description,
    durationSec: request.durationSec,
    figure: track.name,
    pose: track.keys[request.key].pose,
  });
  const text = await complete(
    { messages: prompt.messages, temperature: prompt.temperature, maxTokens: prompt.maxTokens },
    call
  );
  const parsed = parseMotionResponse(text);
  if (!parsed.ok) throw new Error(parsed.errors[0]);
  return parsed.motion;
}

/**
 * 把脚本里的 motion.generate 变成关节轨迹：有 provider 用 provider，否则用 complete 追加请求；
 * 两者都没有时原样返回，并提示哪些动作暂用姿势代替。
 */
export async function resolvePrevizMotionRequests(
  script: PrevizScript,
  options: ResolveMotionOptions = {}
): Promise<ResolveMotionResult> {
  const requests = pendingMotionRequests(script);
  if (!requests.length) return { script, generated: [], notes: [] };
  if (!options.provider && !options.complete) {
    const names = [...new Set(requests.map((item) => item.description))];
    return {
      script,
      generated: [],
      notes: [`没有可用的 AI 生成动作，「${names.join('」「')}」暂用姿势代替`],
    };
  }
  const next: PrevizScript = {
    ...script,
    figures: script.figures.map((track) => ({
      ...track,
      keys: track.keys.map((key) => ({ ...key })),
    })),
  };
  const notes: string[] = [];
  const generated: string[] = [];
  /** 相同描述只请求一次：描述 → 轨迹（null = 失败） */
  const byDescription = new Map<string, PrevizMotionTracks | null>();
  for (const request of requests) {
    let motion = byDescription.get(request.description);
    if (motion === undefined) {
      motion = null;
      try {
        motion = await generateOne(request, script, options);
        generated.push(request.description);
      } catch (error) {
        if (options.signal?.aborted) throw toAIError(error);
        notes.push(
          `动作「${request.description}」生成失败（${toAIError(error).message}），暂用姿势代替`
        );
      }
      byDescription.set(request.description, motion);
    }
    if (motion) {
      const key = next.figures[request.figure].keys[request.key];
      key.motion = { ...key.motion, ...motion };
    }
  }
  return { script: next, generated, notes };
}
