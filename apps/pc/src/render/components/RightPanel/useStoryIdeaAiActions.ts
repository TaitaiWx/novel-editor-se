import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { StoryIdeaCardRow, StoryIdeaOutputRow } from '@/render/types/electron-api';
import {
  buildStoryIdeaExtractPrompt,
  buildStoryIdeaOutputsPrompt,
  buildStoryIdeaRelatedTermsPrompt,
  buildStoryIdeaSeedPrompt,
  draftToStoryIdeaUpdatePayload,
  mergeStoryIdeaTermPool,
  parseStoryIdeaOutputsResponse,
  parseStoryIdeaRelatedTermsResponse,
  parseStoryIdeaSeedResponse,
  replaceStoryIdeaTermRandomly,
  type StoryIdeaTermPoolEntry,
  type StoryIdeaTermPoolSource,
  type StoryIdeaTermPoolState,
  type StoryIdeaTermSection,
  type StoryIdeaCardDraft,
  type StoryIdeaGenerationConfig,
} from './story-idea';

interface UseStoryIdeaAiActionsOptions {
  folderPath: string | null;
  content: string;
  dbReady: boolean;
  aiReady: boolean;
  termPool: StoryIdeaTermPoolState;
  setWorking: Dispatch<SetStateAction<boolean>>;
  setStatusMessage: Dispatch<SetStateAction<string>>;
  loadCards: () => Promise<void>;
  loadOutputs: (cardId: number | null) => Promise<void>;
  updateCard: (cardId: number, fields: Record<string, unknown>) => Promise<void>;
  replaceOutputs: (
    cardId: number,
    type: StoryIdeaOutputRow['type'],
    nextOutputs: Array<{ content: string; metaJson?: string; isSelected?: boolean }>
  ) => Promise<void>;
  addTermsToPool: (
    section: StoryIdeaTermSection,
    terms: string[],
    source?: StoryIdeaTermPoolSource
  ) => Promise<StoryIdeaTermPoolEntry[]>;
}

/**
 * 三签创意卡的 AI 动作：补签、正文提炼、生成候选、相关签词与随机重抽
 * 从 useStoryIdeaCards 拆出，回调实现与依赖保持不变
 */
export function useStoryIdeaAiActions({
  folderPath,
  content,
  dbReady,
  aiReady,
  termPool,
  setWorking,
  setStatusMessage,
  loadCards,
  loadOutputs,
  updateCard,
  replaceOutputs,
  addTermsToPool,
}: UseStoryIdeaAiActionsOptions) {
  const generateIdeaSeeds = useCallback(
    async (
      card: StoryIdeaCardRow,
      draft: StoryIdeaCardDraft,
      config?: StoryIdeaGenerationConfig
    ) => {
      if (!aiReady) {
        setStatusMessage('请先配置并开启 AI，再使用三签补签');
        return false;
      }
      setWorking(true);
      try {
        const response = (await window.electron.ipcRenderer.invoke('ai-request', {
          prompt: buildStoryIdeaSeedPrompt(draft, content, config),
          systemPrompt:
            '你是小说创意编辑。你只输出严格 JSON，不要额外解释。请把故事点子压缩成可写、可比较、可继续扩展的字段。',
          maxTokens: 2048,
          temperature: 0.9,
        })) as { ok: boolean; text?: string; error?: string };

        if (!response.ok || !response.text) {
          setStatusMessage(response.error || 'AI 补签失败');
          return false;
        }

        const parsed = parseStoryIdeaSeedResponse(response.text);
        if (!parsed) {
          setStatusMessage('AI 返回内容无法解析为三签字段');
          return false;
        }

        await updateCard(card.id, {
          ...draftToStoryIdeaUpdatePayload({ ...draft, ...parsed, source: 'ai' }),
          source: 'ai',
          status: 'exploring',
        });
        await loadCards();
        setStatusMessage('已完成三签补签');
        return true;
      } finally {
        setWorking(false);
      }
    },
    [aiReady, content, loadCards, setStatusMessage, setWorking, updateCard]
  );

  const extractIdeaSeedsFromContent = useCallback(
    async (
      card: StoryIdeaCardRow,
      draft: StoryIdeaCardDraft,
      config?: StoryIdeaGenerationConfig
    ) => {
      if (!content.trim()) {
        setStatusMessage('当前没有正文内容，无法提炼三签');
        return false;
      }
      if (!aiReady) {
        setStatusMessage('请先配置并开启 AI，再从正文提炼三签');
        return false;
      }
      setWorking(true);
      try {
        const response = (await window.electron.ipcRenderer.invoke('ai-request', {
          prompt: buildStoryIdeaExtractPrompt(content, config),
          systemPrompt:
            '你是小说创意编辑。你只输出严格 JSON，不要额外解释。请从正文里抽出可供创作的签词，而不是长段总结。',
          maxTokens: 2048,
          temperature: 0.8,
        })) as { ok: boolean; text?: string; error?: string };

        if (!response.ok || !response.text) {
          setStatusMessage(response.error || '从正文提炼三签失败');
          return false;
        }

        const parsed = parseStoryIdeaSeedResponse(response.text);
        if (!parsed) {
          setStatusMessage('AI 返回内容无法解析为签词结果');
          return false;
        }

        await updateCard(card.id, {
          ...draftToStoryIdeaUpdatePayload({
            ...draft,
            ...parsed,
            source: 'ai',
            status: 'exploring',
          }),
          source: 'ai',
          status: 'exploring',
        });
        await loadCards();
        setStatusMessage('已从当前正文提炼三签');
        return true;
      } finally {
        setWorking(false);
      }
    },
    [aiReady, content, loadCards, setStatusMessage, setWorking, updateCard]
  );

  const generateIdeaOutputs = useCallback(
    async (
      card: StoryIdeaCardRow,
      draft: StoryIdeaCardDraft,
      config?: StoryIdeaGenerationConfig
    ) => {
      if (!folderPath || !dbReady) {
        setStatusMessage('项目数据库尚未就绪，无法生成候选');
        return false;
      }
      if (!aiReady) {
        setStatusMessage('请先配置并开启 AI，再生成候选');
        return false;
      }
      setWorking(true);
      try {
        const response = (await window.electron.ipcRenderer.invoke('ai-request', {
          prompt: buildStoryIdeaOutputsPrompt(draft, content, config),
          systemPrompt:
            '你是小说策划编辑。你只输出严格 JSON，不要额外解释。输出应偏向可写、可比选、能直接推进到大纲。',
          maxTokens: 4096,
          temperature: 1,
        })) as { ok: boolean; text?: string; error?: string };

        if (!response.ok || !response.text) {
          setStatusMessage(response.error || 'AI 生成候选失败');
          return false;
        }

        const parsed = parseStoryIdeaOutputsResponse(response.text);
        if (!parsed) {
          setStatusMessage('AI 返回内容无法解析为候选结果');
          return false;
        }

        await replaceOutputs(card.id, 'logline', parsed.loglines);
        await replaceOutputs(card.id, 'scene_hook', parsed.sceneHooks);
        await replaceOutputs(card.id, 'outline_direction', parsed.outlineDirections);
        await updateCard(card.id, {
          status: 'exploring',
          selected_logline: parsed.loglines[0]?.content || card.selected_logline,
          selected_direction: parsed.outlineDirections[0]?.content || card.selected_direction,
        });
        await loadCards();
        await loadOutputs(card.id);
        setStatusMessage('已生成一句话卖点、场景钩子和大纲方向');
        return true;
      } finally {
        setWorking(false);
      }
    },
    [
      aiReady,
      content,
      dbReady,
      folderPath,
      loadCards,
      loadOutputs,
      replaceOutputs,
      setStatusMessage,
      setWorking,
      updateCard,
    ]
  );

  const requestRelatedTerms = useCallback(
    async (
      draft: StoryIdeaCardDraft,
      section: StoryIdeaTermSection,
      config?: StoryIdeaGenerationConfig
    ) => {
      if (!aiReady) {
        setStatusMessage('请先配置并开启 AI，再随机提相关签词');
        return null;
      }
      setWorking(true);
      try {
        const response = (await window.electron.ipcRenderer.invoke('ai-request', {
          prompt: buildStoryIdeaRelatedTermsPrompt(draft, section, content, config),
          systemPrompt:
            '你是小说创意编辑。你只输出严格 JSON，不要额外解释。你的任务是返回一组可供抽取的相关签词。',
          maxTokens: 1024,
          temperature: 1,
        })) as { ok: boolean; text?: string; error?: string };

        if (!response.ok || !response.text) {
          setStatusMessage(response.error || 'AI 随机提词失败');
          return null;
        }

        const terms = parseStoryIdeaRelatedTermsResponse(response.text);
        if (!terms || terms.length === 0) {
          setStatusMessage('AI 返回内容无法解析为相关签词');
          return null;
        }

        await addTermsToPool(section, terms, 'ai');
        setStatusMessage(
          `已为${section === 'theme' ? '题眼签' : section === 'conflict' ? '冲突签' : '变形签'}补入 ${terms.length} 个相关签词`
        );
        return terms;
      } finally {
        setWorking(false);
      }
    },
    [addTermsToPool, aiReady, content, setStatusMessage, setWorking]
  );

  const redrawIdeaTermRandomly = useCallback(
    async (
      draft: StoryIdeaCardDraft,
      section: StoryIdeaTermSection,
      config?: StoryIdeaGenerationConfig
    ) => {
      let nextDraft = replaceStoryIdeaTermRandomly(draft, section, termPool[section]);
      if (!nextDraft) {
        const terms = await requestRelatedTerms(draft, section, config);
        if (!terms || terms.length === 0) {
          return null;
        }
        nextDraft = replaceStoryIdeaTermRandomly(
          draft,
          section,
          mergeStoryIdeaTermPool(termPool, {
            [section]: terms.map((term) => ({ term, sources: ['ai'] })),
          })[section]
        );
      }
      if (nextDraft) {
        setStatusMessage(
          `已为${section === 'theme' ? '题眼签' : section === 'conflict' ? '冲突签' : '变形签'}随机重抽一签`
        );
      }
      return nextDraft;
    },
    [requestRelatedTerms, setStatusMessage, termPool]
  );

  return {
    generateIdeaSeeds,
    extractIdeaSeedsFromContent,
    generateIdeaOutputs,
    requestRelatedTerms,
    redrawIdeaTermRandomly,
  };
}
