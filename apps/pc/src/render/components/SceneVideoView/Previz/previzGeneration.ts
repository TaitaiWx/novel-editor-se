/**
 * 「生成预演」：有可用的文本服务时用预演提示词（@novel-editor/ai/prompts buildPrevizPrompt）请求 AI，
 * 校验后得到 PrevizScript；没有配置 AI、AI 失败或返回无法识别时用确定性的默认脚本（人物站成一排 + 缓慢推近）。
 *
 * 动作由 AI 实时生成：姿势覆盖不了的动作，AI 直接在脚本里写关节轨迹（motion.tracks）；只写了 motion.generate（描述）时，
 * 配置了动作生成服务（MotionProvider）就交给它，否则用同一个模型对每个不同的描述追加一次 ai-complete 请求，
 * 生成的轨迹写回脚本（随 分镜.json 保存，之后不再生成）。
 */
import {
  resolvePrevizMotionRequests,
  type MotionCompletion,
  type MotionProvider,
} from '@novel-editor/ai/motion';
import { buildPrevizPrompt, parsePrevizResponse } from '@novel-editor/ai/prompts';
import { defaultPrevizScript, type PrevizScript, type PrevizShotSize } from '@novel-editor/video';

type Ipc = NonNullable<Window['electron']>['ipcRenderer'];

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
  /** 动作生成服务（文字 → 关节轨迹；目前没有内置实现，测试 / 将来的服务注入） */
  motionProvider?: MotionProvider | null;
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

/** 追加请求：用同一个模型把动作描述写成关节轨迹 */
function motionCompletion(ipc: Ipc, model: PrevizModelChoice): MotionCompletion {
  return async (request) => {
    const result = await ipc.invoke('ai-complete', {
      providerId: model.providerId,
      model: model.model || undefined,
      messages: request.messages,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
    });
    if (!result.ok) throw new Error(result.error.message);
    return result.data.text;
  };
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
    });
    if (!parsed.ok) {
      return fallback(input, [`AI 返回的预演无法识别（${parsed.errors[0]}），已使用默认走位`]);
    }
    const motions = await resolvePrevizMotionRequests(parsed.script, {
      provider: input.motionProvider,
      complete: motionCompletion(ipc, input.model),
    });
    return { script: motions.script, source: 'ai', notes: [...parsed.warnings, ...motions.notes] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fallback(input, [`AI 生成失败（${message}），已使用默认走位`]);
  }
}
