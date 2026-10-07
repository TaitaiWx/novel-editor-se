/**
 * 「AI 生成分镜」：有可用的文本服务时用分镜提示词（@novel-editor/ai/prompts）请求 AI 并校验结果；
 * 没有配置 AI 或 AI 失败时按段落 / 句子确定性拆分，保证离线也能得到可编辑的分镜。
 */
import { buildStoryboardPrompt, parseStoryboardResponse } from '@novel-editor/ai/prompts';
import type { AspectRatio, Shot } from '@novel-editor/video';
import { splitSceneIntoShots, type NamedCharacter } from './sceneSource';
import type { SceneVideoState } from './sceneVideoState';

type Ipc = NonNullable<Window['electron']>['ipcRenderer'];

export interface CharacterBrief extends NamedCharacter {
  /** 外貌 / 一句话简介（保持各镜头人物描述一致） */
  appearance?: string;
}

export interface GenerateStoryboardInput {
  state: SceneVideoState;
  /** 可用的文本服务；null 表示没有配置 AI */
  textProviderId: string | null;
  characters: readonly CharacterBrief[];
}

export interface GenerateStoryboardResult {
  shots: Shot[];
  source: 'ai' | 'fallback';
  /** AI 结果的提示（字段被修正等）或 AI 失败的原因 */
  notes: string[];
}

function fallback(input: GenerateStoryboardInput, notes: string[]): GenerateStoryboardResult {
  const { state } = input;
  const shots = splitSceneIntoShots(state.sourceText, {
    durationSec: state.shotDurationSec,
    characters: input.characters,
    location: state.location || undefined,
  });
  return { shots, source: 'fallback', notes };
}

export async function generateStoryboard(
  ipc: Ipc | undefined,
  input: GenerateStoryboardInput
): Promise<GenerateStoryboardResult> {
  const { state } = input;
  if (!state.sourceText.trim()) return { shots: [], source: 'fallback', notes: [] };
  if (!ipc || !input.textProviderId) return fallback(input, []);

  const people = new Set(state.characters);
  const prompt = buildStoryboardPrompt({
    sceneText: state.sourceText,
    sceneTitle: `${state.chapter} · ${state.scene}`,
    characters: input.characters
      .filter((item) => people.has(item.name))
      .map((item) => ({ name: item.name, appearance: item.appearance })),
    location: state.location || undefined,
    style: state.style || undefined,
    aspectRatio: state.aspectRatio as AspectRatio,
    // 对白按这一场的配音语言提取（AI 同时给出说话人与可选音效）
    language: state.audio?.language,
  });
  try {
    const result = await ipc.invoke('ai-complete', {
      providerId: input.textProviderId,
      messages: prompt.messages,
      temperature: prompt.temperature,
      maxTokens: prompt.maxTokens,
    });
    if (!result.ok) {
      return fallback(input, [`AI 生成失败（${result.error.message}），已按段落拆分`]);
    }
    const parsed = parseStoryboardResponse(result.data.text, {
      aspectRatio: state.aspectRatio,
      style: state.style || undefined,
    });
    if (!parsed.ok) {
      return fallback(input, [`AI 返回的分镜无法识别（${parsed.errors[0]}），已按段落拆分`]);
    }
    const shots = parsed.storyboard.shots.map((shot) =>
      state.location && !shot.location ? { ...shot, location: state.location } : shot
    );
    return { shots, source: 'ai', notes: parsed.warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fallback(input, [`AI 生成失败（${message}），已按段落拆分`]);
  }
}
