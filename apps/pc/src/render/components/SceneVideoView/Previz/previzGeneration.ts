/**
 * 「生成预演」：有可用的文本服务时用预演提示词（@novel-editor/ai/prompts buildPrevizPrompt）请求 AI，
 * 校验后得到 PrevizScript；没有配置 AI、AI 失败或返回无法识别时用确定性的默认脚本（人物站成一排 + 缓慢推近）。
 */
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
    return { script: parsed.script, source: 'ai', notes: parsed.warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fallback(input, [`AI 生成失败（${message}），已使用默认走位`]);
  }
}
