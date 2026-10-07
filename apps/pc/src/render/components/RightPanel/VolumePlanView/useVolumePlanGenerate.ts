import { useCallback, useState } from 'react';
import {
  buildTemplatePlan,
  buildVolumePlanPrompt,
  parseVolumePlanResponse,
  type GeneratedVolumePlan,
  type VolumeOutline,
} from '@novel-editor/basic-algorithm';
import type { VolumePlanGeneratedBy, VolumePlanState } from './volumePlanState';

interface AiResponse {
  ok: boolean;
  text?: string;
  error?: string;
}

function isAiResponse(value: unknown): value is AiResponse {
  return typeof value === 'object' && value !== null && 'ok' in value;
}

/**
 * 「生成卷纲」：开启 AI 时走现有的 ai-request 通道，失败或返回无法解析时回退到结构模板；
 * 未开启 AI 时直接用结构模板确定性生成。结果写入幕说明与建议节拍，作者的改写保持不变
 */
export function useVolumePlanGenerate({
  outline,
  intent,
  characters,
  aiReady,
  update,
}: {
  outline: VolumeOutline;
  intent: string;
  characters: string[];
  aiReady: boolean;
  update: (updater: (prev: VolumePlanState) => VolumePlanState) => void;
}) {
  const [generating, setGenerating] = useState(false);

  /** 返回给作者看的结果说明 */
  const generate = useCallback(async (): Promise<string> => {
    setGenerating(true);
    let plan: GeneratedVolumePlan | null = null;
    let by: VolumePlanGeneratedBy = 'template';
    let note = '';
    try {
      const ipc = window.electron?.ipcRenderer;
      if (aiReady && ipc) {
        const response = await ipc
          .invoke('ai-request', buildVolumePlanPrompt(outline, intent, characters))
          .catch((error: unknown) => ({
            ok: false,
            error: error instanceof Error ? error.message : 'AI 请求失败',
          }));
        if (isAiResponse(response) && response.ok && response.text) {
          plan = parseVolumePlanResponse(response.text, outline);
          if (plan) by = 'ai';
          else note = 'AI 返回的格式无法识别，已按结构模板生成';
        } else {
          const reason = isAiResponse(response) ? response.error : '';
          note = `AI 暂不可用${reason ? `（${reason}）` : ''}，已按结构模板生成`;
        }
      }
      if (!plan) plan = buildTemplatePlan(outline, intent);
      const generated = plan;
      update((prev) => ({
        ...prev,
        actNotes: generated.actNotes,
        suggestions: generated.suggestions,
        generatedBy: by,
        generatedAt: new Date().toISOString(),
      }));
      return (
        note || (by === 'ai' ? '已用 AI 生成卷纲' : `已按「${outline.structureLabel}」生成卷纲`)
      );
    } finally {
      setGenerating(false);
    }
  }, [aiReady, characters, intent, outline, update]);

  return { generate, generating };
}
