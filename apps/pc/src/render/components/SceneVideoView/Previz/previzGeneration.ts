/**
 * 「生成预演」：有可用的文本服务时用预演提示词（@novel-editor/ai/prompts buildPrevizPrompt）请求 AI，
 * 校验后得到 PrevizScript；没有配置 AI、AI 失败或返回无法识别时用确定性的默认脚本（人物站成一排 + 缓慢推近）。
 *
 * 提示词列出可用的动作片段（内置 + 作品动作库），AI 按 id 引用；AI 写了 motion.generate 时，
 * 配置了动作生成服务（MotionProvider）就生成 BVH 存进动作库并改为引用，否则提示暂用姿势代替。
 */
import { resolvePrevizMotionRequests, type MotionProvider } from '@novel-editor/ai/motion';
import { buildPrevizPrompt, parsePrevizResponse } from '@novel-editor/ai/prompts';
import { defaultPrevizScript, type PrevizScript, type PrevizShotSize } from '@novel-editor/video';
import type { MotionClipEntry } from './useMotionLibrary';

type Ipc = NonNullable<Window['electron']>['ipcRenderer'];

/** 生成动作的文件名：generated-<描述的哈希>.bvh（只用 ASCII） */
export function generatedMotionFileName(description: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < description.length; i += 1) {
    hash ^= description.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `generated-${hash.toString(16).padStart(8, '0')}.bvh`;
}

export interface PrevizCharacterBrief {
  name: string;
  appearance?: string;
}

export interface PrevizModelChoice {
  providerId: string;
  model: string;
}

export interface GeneratePrevizInput {
  action: string;
  shotTitle: string;
  characters: readonly PrevizCharacterBrief[];
  shotSize: PrevizShotSize;
  durationSec: number;
  aspectRatio: string;
  cameraNote?: string;
  location?: string;
  /** null = 没有可用的 AI */
  model: PrevizModelChoice | null;
  /** 可用的动作片段（无法解析的不要传） */
  motionClips?: readonly MotionClipEntry[];
  /** 动作生成服务（目前没有内置实现，测试 / 将来的服务注入） */
  motionProvider?: MotionProvider | null;
  /** 把生成的 BVH 存进动作库，返回片段 id */
  saveMotion?: (fileName: string, data: string) => Promise<string>;
}

export interface GeneratePrevizResult {
  script: PrevizScript;
  source: 'ai' | 'default';
  notes: string[];
}

export function defaultScriptFor(
  input: Pick<GeneratePrevizInput, 'characters' | 'shotSize' | 'durationSec'>
): PrevizScript {
  return defaultPrevizScript({
    characters: input.characters.map((item) => item.name),
    shotSize: input.shotSize,
    durationSec: input.durationSec,
  });
}

function fallback(input: GeneratePrevizInput, notes: string[]): GeneratePrevizResult {
  return { script: defaultScriptFor(input), source: 'default', notes };
}

export async function generatePrevizScript(
  ipc: Ipc | undefined,
  input: GeneratePrevizInput
): Promise<GeneratePrevizResult> {
  if (!ipc || !input.model) {
    return fallback(input, ['没有配置 AI，使用默认走位（人物站成一排，镜头缓慢推近）']);
  }
  const prompt = buildPrevizPrompt({
    action: input.action,
    shotTitle: input.shotTitle,
    characters: input.characters,
    shotSize: input.shotSize,
    durationSec: input.durationSec,
    aspectRatio: input.aspectRatio,
    cameraNote: input.cameraNote,
    location: input.location,
    motionClips: input.motionClips,
    canGenerateMotion: Boolean(input.motionProvider),
  });
  try {
    const result = await ipc.invoke('ai-complete', {
      providerId: input.model.providerId,
      model: input.model.model || undefined,
      messages: prompt.messages,
      temperature: prompt.temperature,
      maxTokens: prompt.maxTokens,
    });
    if (!result.ok) {
      return fallback(input, [`AI 生成失败（${result.error.message}），已使用默认走位`]);
    }
    const parsed = parsePrevizResponse(result.data.text, {
      characters: input.characters.map((item) => item.name),
      durationSec: input.durationSec,
      shotSize: input.shotSize,
      availableClips: (input.motionClips ?? []).map((clip) => clip.id),
    });
    if (!parsed.ok) {
      return fallback(input, [`AI 返回的预演无法识别（${parsed.errors[0]}），已使用默认走位`]);
    }
    const saveMotion = input.saveMotion;
    const motions = await resolvePrevizMotionRequests(parsed.script, input.motionProvider, {
      save: saveMotion
        ? ({ description, bvh }) => saveMotion(generatedMotionFileName(description), bvh)
        : undefined,
    });
    return { script: motions.script, source: 'ai', notes: [...parsed.warnings, ...motions.notes] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fallback(input, [`AI 生成失败（${message}），已使用默认走位`]);
  }
}
