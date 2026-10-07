/**
 * 动作生成服务（MotionProvider）扩展点：文字描述 → 骨骼动作（BVH）。
 *
 * 面向「文字 → 动作」模型（MDM / MotionGPT / T2M-GPT 等，输出 BVH 或可转为 BVH 的关节旋转），目前没有内置实现。
 * 接入方式：实现 MotionProvider（协议映射 + 把模型输出转成 BVH 文本），在调用方（渲染进程的预演弹窗经主进程 IPC，
 * 或 CLI）把它传给 resolvePrevizMotionRequests：
 * 1. 文本模型写预演脚本时，没有合适的动作片段就在关键帧写 motion: { generate: '描述' }；
 * 2. resolvePrevizMotionRequests 收集这些请求（相同描述只请求一次），时长取到下一关键帧的间隔，
 *    调 provider.generateMotion，用 @novel-editor/video 的 parseBvh + retargetBvh 校验能驱动木偶；
 * 3. save 回调把 BVH 存进作品动作库（<作品>/资料/动作库/*.bvh）并返回片段 id，脚本里的引用改为 motion.clip。
 * 生成失败的请求保留 generate（引擎回退到 pose），并给出提示。
 */
import {
  MANNEQUIN_SKELETON,
  PREVIZ_MAX_DURATION,
  parseBvh,
  retargetBvh,
  type MannequinSkeleton,
  type MotionClip,
  type PrevizScript,
} from '@novel-editor/video';
import { toAIError } from './errors';
import type { CallOptions } from './types';

export interface MotionGenerationRequest {
  /** 动作描述（作者语言即可，由服务自行理解） */
  description: string;
  durationSec: number;
  /** 目标骨架：mannequin-v1（Hips / Spine / Neck / Head / LeftArm … 的 CMU / Mixamo 式命名即可重定向） */
  skeleton: MannequinSkeleton;
}

export interface MotionGenerationResult {
  format: 'bvh';
  data: string;
}

export interface MotionProvider {
  readonly id: string;
  readonly kind: 'motion';
  generateMotion(
    request: MotionGenerationRequest,
    options?: CallOptions
  ): Promise<MotionGenerationResult>;
}

export interface GeneratedMotionClip {
  /** 写进脚本的片段 id */
  clipId: string;
  description: string;
  bvh: string;
  clip: MotionClip;
}

export interface ResolveMotionOptions {
  /**
   * 保存生成的 BVH（例如写入作品动作库）并返回片段 id；省略时用 gen:<序号>（只在内存里）。
   * 抛错时该请求视为失败。
   */
  save?: (input: { description: string; bvh: string; index: number }) => Promise<string>;
  signal?: AbortSignal;
}

export interface ResolveMotionResult {
  script: PrevizScript;
  generated: GeneratedMotionClip[];
  notes: string[];
}

const MIN_MOTION_SEC = 1;

/** 脚本里所有待生成的动作（关键帧有 generate 但没有 clip） */
export function pendingMotionRequests(
  script: PrevizScript
): { figure: number; key: number; description: string; durationSec: number }[] {
  const list: { figure: number; key: number; description: string; durationSec: number }[] = [];
  script.figures.forEach((track, figure) => {
    track.keys.forEach((key, index) => {
      const description = key.motion?.generate?.trim();
      if (!description || key.motion?.clip) return;
      const next = track.keys[index + 1];
      const span = (next ? next.t : script.durationSec) - key.t;
      const durationSec = Math.min(PREVIZ_MAX_DURATION, Math.max(MIN_MOTION_SEC, span));
      list.push({ figure, key: index, description, durationSec });
    });
  });
  return list;
}

/**
 * 用动作生成服务补全脚本里的 motion.generate 请求。没有服务时原样返回，并提示哪些动作暂用姿势代替。
 * 不修改传入的脚本。
 */
export async function resolvePrevizMotionRequests(
  script: PrevizScript,
  provider: MotionProvider | null | undefined,
  options: ResolveMotionOptions = {}
): Promise<ResolveMotionResult> {
  const requests = pendingMotionRequests(script);
  if (!requests.length) return { script, generated: [], notes: [] };
  if (!provider) {
    const names = [...new Set(requests.map((item) => item.description))];
    return {
      script,
      generated: [],
      notes: [`没有配置动作生成服务，「${names.join('」「')}」暂用姿势代替`],
    };
  }
  const next: PrevizScript = {
    ...script,
    figures: script.figures.map((track) => ({
      ...track,
      keys: track.keys.map((key) => ({ ...key })),
    })),
  };
  const generated: GeneratedMotionClip[] = [];
  const notes: string[] = [];
  /** 相同描述只请求一次：描述 → 片段 id（null = 失败） */
  const byDescription = new Map<string, string | null>();
  for (const request of requests) {
    let clipId = byDescription.get(request.description);
    if (clipId === undefined) {
      clipId = null;
      try {
        const result = await provider.generateMotion(
          {
            description: request.description,
            durationSec: request.durationSec,
            skeleton: MANNEQUIN_SKELETON,
          },
          { signal: options.signal }
        );
        if (result.format !== 'bvh' || typeof result.data !== 'string') {
          throw new Error('动作生成服务返回的不是 BVH');
        }
        const index = generated.length + 1;
        // 先校验能驱动木偶，再保存
        const probe = retargetBvh(parseBvh(result.data), {
          id: `gen:${index}`,
          name: request.description,
          source: 'generated',
        });
        const id = options.save
          ? await options.save({ description: request.description, bvh: result.data, index })
          : `gen:${index}`;
        generated.push({
          clipId: id,
          description: request.description,
          bvh: result.data,
          clip: { ...probe, id },
        });
        clipId = id;
      } catch (error) {
        if (options.signal?.aborted) throw toAIError(error);
        notes.push(
          `动作「${request.description}」生成失败（${toAIError(error).message}），暂用姿势代替`
        );
      }
      byDescription.set(request.description, clipId);
    }
    if (clipId) {
      const key = next.figures[request.figure].keys[request.key];
      key.motion = { ...key.motion, clip: clipId };
    }
  }
  return { script: next, generated, notes };
}
