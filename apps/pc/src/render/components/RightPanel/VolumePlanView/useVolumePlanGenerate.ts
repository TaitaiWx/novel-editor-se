import { useCallback, useState } from 'react';
import {
  buildTemplatePlan,
  buildVolumePlanPrompt,
  deriveVolumeOutline,
  getStructureLabel,
  parseVolumePlanResponse,
  type GeneratedVolumePlan,
  type VolumeChapterSource,
  type VolumeOutline,
  type VolumeStructureId,
} from '@novel-editor/basic-algorithm';
import { structureOptions } from './PlanToolbar';
import type { VolumePlanGeneratedBy, VolumePlanState } from './volumePlanState';

interface AiResponse {
  ok: boolean;
  text?: string;
  error?: string;
}

function isAiResponse(value: unknown): value is AiResponse {
  return typeof value === 'object' && value !== null && 'ok' in value;
}

/** 一个卷纲方案：某种结构下的分段、每段说明与空白章建议 */
export interface VolumePlanVariant {
  structure: VolumeStructureId;
  label: string;
  outline: VolumeOutline;
  plan: GeneratedVolumePlan;
  by: VolumePlanGeneratedBy;
}

export const VOLUME_VARIANT_COUNT = 3;

/** 方案的结构：当前结构优先，其余按固定顺序补足 3 个 */
export function pickVariantStructures(
  current: VolumeStructureId,
  hasMarkers: boolean,
  count = VOLUME_VARIANT_COUNT
): VolumeStructureId[] {
  const options = structureOptions(hasMarkers);
  return [current, ...options.filter((id) => id !== current)].slice(0, count);
}

/** 方案卡片的预览：每段「标题：说明」 */
export function describeVariant(variant: VolumePlanVariant): string[] {
  return variant.outline.acts.map((act) => {
    const note = variant.plan.actNotes[act.key] || act.hint;
    return note ? `${act.title}：${note}` : act.title;
  });
}

/**
 * 「生成卷纲」：一次给出几种结构的方案（当前结构 + 另外两种），作者挑一个采用。
 * 开启 AI 时每个方案并行走 ai-request，失败 / 无法解析的方案回退到结构模板；未开启 AI 时全部用模板。
 * 采用后写入结构、幕说明与建议节拍，作者的改写保持不变
 */
export function useVolumePlanGenerate({
  chapters,
  currentStructure,
  hasMarkers,
  intent,
  characters,
  aiReady,
  update,
}: {
  chapters: VolumeChapterSource[];
  currentStructure: VolumeStructureId;
  hasMarkers: boolean;
  intent: string;
  characters: string[];
  aiReady: boolean;
  update: (updater: (prev: VolumePlanState) => VolumePlanState) => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [variants, setVariants] = useState<VolumePlanVariant[]>([]);

  const planFor = useCallback(
    async (
      outline: VolumeOutline
    ): Promise<{ plan: GeneratedVolumePlan; by: VolumePlanGeneratedBy; note: string }> => {
      const ipc = window.electron?.ipcRenderer;
      if (aiReady && ipc) {
        const response = await ipc
          .invoke('ai-request', buildVolumePlanPrompt(outline, intent, characters))
          .catch((error: unknown) => ({
            ok: false,
            error: error instanceof Error ? error.message : 'AI 请求失败',
          }));
        if (isAiResponse(response) && response.ok && response.text) {
          const plan = parseVolumePlanResponse(response.text, outline);
          if (plan) return { plan, by: 'ai', note: '' };
          return {
            plan: buildTemplatePlan(outline, intent),
            by: 'template',
            note: 'AI 返回的格式无法识别',
          };
        }
        const reason = isAiResponse(response) ? response.error : '';
        return {
          plan: buildTemplatePlan(outline, intent),
          by: 'template',
          note: `AI 暂不可用${reason ? `（${reason}）` : ''}`,
        };
      }
      return { plan: buildTemplatePlan(outline, intent), by: 'template', note: '' };
    },
    [aiReady, characters, intent]
  );

  /** 生成几个方案；返回给作者看的结果说明 */
  const generate = useCallback(async (): Promise<string> => {
    setGenerating(true);
    try {
      const structures = pickVariantStructures(currentStructure, hasMarkers);
      const results = await Promise.all(
        structures.map(async (structure) => {
          const outline = deriveVolumeOutline(chapters, { structure });
          const { plan, by, note } = await planFor(outline);
          return {
            variant: { structure, label: getStructureLabel(structure), outline, plan, by },
            note,
          };
        })
      );
      setVariants(results.map((item) => item.variant));
      const note = results.find((item) => item.note)?.note;
      const fromAi = results.some((item) => item.variant.by === 'ai');
      return note
        ? `${note}，部分方案按结构模板生成，选一个采用`
        : `${fromAi ? 'AI ' : ''}给出 ${results.length} 个方案，选一个采用`;
    } finally {
      setGenerating(false);
    }
  }, [chapters, currentStructure, hasMarkers, planFor]);

  const apply = useCallback(
    (structure: VolumeStructureId): string => {
      const variant = variants.find((item) => item.structure === structure);
      if (!variant) return '';
      update((prev) => ({
        ...prev,
        structure: variant.structure,
        actNotes: variant.plan.actNotes,
        suggestions: variant.plan.suggestions,
        generatedBy: variant.by,
        generatedAt: new Date().toISOString(),
      }));
      setVariants([]);
      return `已采用「${variant.label}」方案`;
    },
    [update, variants]
  );

  return { generate, generating, variants, apply, dismiss: () => setVariants([]) };
}
