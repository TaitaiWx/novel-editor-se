import { extractActs } from '@novel-editor/basic-algorithm';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  PersistedOutlineVersionRow,
  StoryIdeaCardRow,
  StoryIdeaOutputRow,
} from '@/render/types/electron-api';
import {
  buildStoryIdeaSnapshot,
  buildOutlineTreeFromIdeaOutput,
  buildStoryIdeaExtractPrompt,
  buildStoryIdeaOutputsPrompt,
  buildStoryIdeaRelatedTermsPrompt,
  buildStoryIdeaSeedPrompt,
  buildStoryIdeaTermPoolFromCards,
  buildStoryIdeaVersionName,
  createEmptyStoryIdeaTermPool,
  draftToStoryIdeaUpdatePayload,
  mergeStoryIdeaTermPool,
  parseStoryIdeaTermPool,
  parseStoryIdeaOutputsResponse,
  parseStoryIdeaRelatedTermsResponse,
  parseStoryIdeaSeedResponse,
  replaceStoryIdeaTermRandomly,
  serializeStoryIdeaTermPool,
  type StoryIdeaTermPoolState,
  type StoryIdeaTermPoolSource,
  type StoryIdeaTermSection,
  type StoryIdeaCardDraft,
  type StoryIdeaGenerationConfig,
} from './story-idea';
import { createActBoardKey, createPlotStorageKey, mergeActBoard } from './utils';

function createStoryIdeaTermPoolKey(folderPath: string | null): string | null {
  return folderPath ? `novel-editor:story-idea-term-pool:${folderPath}` : null;
}

export function useStoryIdeaCards(
  folderPath: string | null,
  content: string,
  dbReady: boolean,
  aiReady: boolean,
  currentLine?: number
) {
  const [cards, setCards] = useState<StoryIdeaCardRow[]>([]);
  const [outputs, setOutputs] = useState<StoryIdeaOutputRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [outputsLoading, setOutputsLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [outlineVersions, setOutlineVersions] = useState<PersistedOutlineVersionRow[]>([]);
  const [customTermPool, setCustomTermPool] = useState<StoryIdeaTermPoolState>(
    createEmptyStoryIdeaTermPool()
  );

  const loadCards = useCallback(async () => {
    if (!folderPath || !dbReady) {
      setCards([]);
      return;
    }
    setLoading(true);
    try {
      const rows = (await window.electron.ipcRenderer.invoke(
        'db-story-idea-card-list-by-folder',
        folderPath
      )) as StoryIdeaCardRow[];
      setCards(rows);
      setStatusMessage('');
    } catch (error) {
      setCards([]);
      setStatusMessage(error instanceof Error ? error.message : '加载三签创意卡失败');
    } finally {
      setLoading(false);
    }
  }, [dbReady, folderPath]);

  useEffect(() => {
    void loadCards();
  }, [loadCards]);

  const loadOutlineVersions = useCallback(async () => {
    if (!folderPath || !dbReady) {
      setOutlineVersions([]);
      return;
    }
    try {
      const rows = (await window.electron.ipcRenderer.invoke(
        'db-outline-version-list-by-folder',
        folderPath
      )) as PersistedOutlineVersionRow[];
      setOutlineVersions(rows);
    } catch {
      setOutlineVersions([]);
    }
  }, [dbReady, folderPath]);

  useEffect(() => {
    void loadOutlineVersions();
  }, [loadOutlineVersions]);

  const loadCustomTermPool = useCallback(async () => {
    const key = createStoryIdeaTermPoolKey(folderPath);
    const ipc = window.electron?.ipcRenderer;
    if (!key || !ipc) {
      setCustomTermPool(createEmptyStoryIdeaTermPool());
      return;
    }
    try {
      const raw = (await ipc.invoke('db-settings-get', key)) as string | null;
      setCustomTermPool(parseStoryIdeaTermPool(raw));
    } catch {
      setCustomTermPool(createEmptyStoryIdeaTermPool());
    }
  }, [folderPath]);

  useEffect(() => {
    void loadCustomTermPool();
  }, [loadCustomTermPool]);

  const loadOutputs = useCallback(async (cardId: number | null) => {
    if (!cardId) {
      setOutputs([]);
      return;
    }
    setOutputsLoading(true);
    try {
      const rows = (await window.electron.ipcRenderer.invoke(
        'db-story-idea-output-list',
        cardId
      )) as StoryIdeaOutputRow[];
      setOutputs(rows);
    } catch (error) {
      setOutputs([]);
      setStatusMessage(error instanceof Error ? error.message : '加载三签候选失败');
    } finally {
      setOutputsLoading(false);
    }
  }, []);

  const historicalTermPool = useMemo(() => buildStoryIdeaTermPoolFromCards(cards), [cards]);
  const termPool = useMemo(
    () => mergeStoryIdeaTermPool(historicalTermPool, customTermPool),
    [customTermPool, historicalTermPool]
  );

  const acts = useMemo(
    () =>
      extractActs(content.trim()).map((act, index) => ({
        index,
        title: act.title?.trim() || `第 ${index + 1} 幕`,
        act,
      })),
    [content]
  );

  const suggestedBoardActIndex = useMemo(() => {
    if (acts.length === 0) return 0;
    if (typeof currentLine !== 'number' || currentLine <= 0) return 0;
    for (let index = acts.length - 1; index >= 0; index -= 1) {
      if (currentLine >= acts[index].act.line) {
        return index;
      }
    }
    return 0;
  }, [acts, currentLine]);

  const saveCustomTermPool = useCallback(
    async (nextPool: StoryIdeaTermPoolState) => {
      const key = createStoryIdeaTermPoolKey(folderPath);
      const ipc = window.electron?.ipcRenderer;
      if (!key || !ipc) return;
      await ipc.invoke('db-settings-set', key, serializeStoryIdeaTermPool(nextPool));
      setCustomTermPool(nextPool);
    },
    [folderPath]
  );

  const addTermsToPool = useCallback(
    async (
      section: StoryIdeaTermSection,
      terms: string[],
      source: StoryIdeaTermPoolSource = 'manual'
    ) => {
      const nextPool = mergeStoryIdeaTermPool(customTermPool, {
        [section]: terms.map((term) => ({ term, sources: [source] })),
      });
      await saveCustomTermPool(nextPool);
      setStatusMessage(
        `已把 ${nextPool[section].length} 个${section === 'theme' ? '题眼签' : section === 'conflict' ? '冲突签' : '变形签'}词沉淀到词池`
      );
      return nextPool[section];
    },
    [customTermPool, saveCustomTermPool]
  );

  const createCard = useCallback(
    async (draft: StoryIdeaCardDraft) => {
      if (!folderPath || !dbReady) {
        setStatusMessage('项目数据库尚未就绪，无法创建三签创意卡');
        return null;
      }
      const payload = draftToStoryIdeaUpdatePayload(draft);
      const result = (await window.electron.ipcRenderer.invoke(
        'db-story-idea-card-create-by-folder',
        folderPath,
        {
          title: payload.title,
          premise: payload.premise,
          tagsJson: payload.tags_json,
          source: payload.source,
          status: payload.status,
          themeSeed: payload.theme_seed,
          conflictSeed: payload.conflict_seed,
          twistSeed: payload.twist_seed,
          protagonistWish: payload.protagonist_wish,
          coreObstacle: payload.core_obstacle,
          ironyOrGap: payload.irony_or_gap,
          escalationPath: payload.escalation_path,
          payoffHint: payload.payoff_hint,
          selectedLogline: payload.selected_logline,
          selectedDirection: payload.selected_direction,
          note: payload.note,
        }
      )) as { lastInsertRowid?: number | bigint };
      await loadCards();
      const createdId = Number(result.lastInsertRowid || 0);
      const created = cards.find((item) => item.id === createdId) || null;
      setStatusMessage('已创建三签创意卡');
      return createdId > 0 ? createdId : created?.id || null;
    },
    [cards, dbReady, folderPath, loadCards]
  );

  const updateCard = useCallback(async (cardId: number, fields: Record<string, unknown>) => {
    await window.electron.ipcRenderer.invoke('db-story-idea-card-update', cardId, fields);
    setCards((prev) =>
      prev.map((card) =>
        card.id === cardId
          ? {
              ...card,
              ...fields,
              updated_at: new Date().toISOString(),
            }
          : card
      )
    );
  }, []);

  const deleteCard = useCallback(async (cardId: number) => {
    await window.electron.ipcRenderer.invoke('db-story-idea-card-delete', cardId);
    setCards((prev) => prev.filter((card) => card.id !== cardId));
    setOutputs([]);
    setStatusMessage('已删除三签创意卡');
  }, []);

  const replaceOutputs = useCallback(
    async (
      cardId: number,
      type: StoryIdeaOutputRow['type'],
      nextOutputs: Array<{ content: string; metaJson?: string; isSelected?: boolean }>
    ) => {
      if (!folderPath || !dbReady) {
        setStatusMessage('项目数据库尚未就绪，无法保存三签候选');
        return;
      }
      await window.electron.ipcRenderer.invoke(
        'db-story-idea-output-replace-by-folder',
        folderPath,
        cardId,
        type,
        nextOutputs
      );
      await loadOutputs(cardId);
    },
    [dbReady, folderPath, loadOutputs]
  );

  const selectOutput = useCallback(
    async (card: StoryIdeaCardRow, output: StoryIdeaOutputRow) => {
      await window.electron.ipcRenderer.invoke('db-story-idea-output-select', output.id);
      setOutputs((prev) =>
        prev.map((item) =>
          item.type === output.type ? { ...item, is_selected: item.id === output.id ? 1 : 0 } : item
        )
      );

      if (output.type === 'logline') {
        await updateCard(card.id, { selected_logline: output.content, status: 'shortlisted' });
      }
      if (output.type === 'outline_direction') {
        await updateCard(card.id, {
          selected_direction: output.content,
          status: card.status === 'draft' ? 'exploring' : card.status,
        });
      }
    },
    [updateCard]
  );

  const deleteOutput = useCallback(
    async (outputId: number, cardId: number) => {
      await window.electron.ipcRenderer.invoke('db-story-idea-output-delete', outputId);
      await loadOutputs(cardId);
    },
    [loadOutputs]
  );

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
    [aiReady, content, loadCards, updateCard]
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
    [aiReady, content, loadCards, updateCard]
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
    [aiReady, content, dbReady, folderPath, loadCards, loadOutputs, replaceOutputs, updateCard]
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
    [addTermsToPool, aiReady, content]
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
    [requestRelatedTerms, termPool]
  );

  const promoteToOutline = useCallback(
    async (card: StoryIdeaCardRow, draft: StoryIdeaCardDraft, output: StoryIdeaOutputRow) => {
      if (!folderPath || !dbReady) {
        setStatusMessage('项目数据库尚未就绪，无法转成大纲草案');
        return false;
      }
      const entries = buildOutlineTreeFromIdeaOutput(draft, output);
      if (entries.length === 0) {
        setStatusMessage('当前大纲方向没有可用的结构化内容');
        return false;
      }
      setWorking(true);
      try {
        await window.electron.ipcRenderer.invoke(
          'db-outline-replace-by-folder',
          folderPath,
          entries
        );
        await window.electron.ipcRenderer.invoke(
          'db-outline-version-create-by-folder',
          folderPath,
          {
            name: buildStoryIdeaVersionName(draft),
            source: 'manual',
            note: `三签创作法转大纲：${draft.selectedLogline || output.content}`,
            storyIdeaCardId: card.id,
            storyIdeaSnapshotJson: JSON.stringify(buildStoryIdeaSnapshot(draft, output)),
            entries,
          }
        );
        await updateCard(card.id, {
          selected_direction: output.content,
          selected_logline: draft.selectedLogline,
          status: 'promoted_to_outline',
        });
        await loadCards();
        await loadOutlineVersions();
        setStatusMessage('已转成当前入库大纲，并保存为版本快照');
        return true;
      } finally {
        setWorking(false);
      }
    },
    [dbReady, folderPath, loadCards, loadOutlineVersions, updateCard]
  );

  const pushSceneHookToBoard = useCallback(
    async (card: StoryIdeaCardRow, output: StoryIdeaOutputRow, actIndex: number) => {
      if (!folderPath || !dbReady) {
        setStatusMessage('项目数据库尚未就绪，无法送入情节板');
        return false;
      }
      if (acts.length === 0) {
        setStatusMessage('正文中未检测到幕结构，暂时无法送入情节板');
        return false;
      }
      if (actIndex < 0 || actIndex >= acts.length) {
        setStatusMessage('请先选择要送入的目标幕');
        return false;
      }

      const ipc = window.electron?.ipcRenderer;
      const storageKey = createPlotStorageKey(folderPath);
      if (!ipc || !storageKey) {
        setStatusMessage('情节板存储不可用');
        return false;
      }

      const act = acts[actIndex].act;
      const raw = (await ipc.invoke('db-settings-get', storageKey)) as string | null;
      const boards = raw ? (JSON.parse(raw) as Record<string, any>) : {};
      const boardKey = createActBoardKey(act, actIndex);
      const board = mergeActBoard(act, actIndex, boards[boardKey]);
      const meta = (() => {
        try {
          return JSON.parse(output.meta_json) as { focus?: string };
        } catch {
          return {};
        }
      })();
      const title = output.content.replace(/[:：].*$/, '').slice(0, 20) || `灵感场景 ${Date.now()}`;
      const sceneBoards = [
        ...board.sceneBoards,
        {
          sceneKey: `idea:${card.id}:${output.id}`,
          title,
          objective: meta.focus || card.premise || '验证这条三签灵感是否成立',
          tension: output.content,
          outcome: '',
          status: 'draft' as const,
          characters: [],
          beats: [output.content],
          causesScene: null,
          pov: '',
          intensity: 3,
        },
      ];

      boards[boardKey] = {
        ...board,
        premise: board.premise || card.premise,
        sceneBoards,
      };

      await ipc.invoke('db-settings-set', storageKey, JSON.stringify(boards));
      await updateCard(card.id, { status: 'promoted_to_board' });
      await loadCards();
      setStatusMessage(`已把该 scene hook 送入情节板（${acts[actIndex].title}）`);
      return true;
    },
    [acts, dbReady, folderPath, loadCards, updateCard]
  );

  const outputsByType = useMemo(
    () => ({
      logline: outputs.filter((item) => item.type === 'logline'),
      scene_hook: outputs.filter((item) => item.type === 'scene_hook'),
      outline_direction: outputs.filter((item) => item.type === 'outline_direction'),
    }),
    [outputs]
  );

  return {
    cards,
    outputs,
    outlineVersions,
    termPool,
    acts,
    suggestedBoardActIndex,
    outputsByType,
    loading,
    outputsLoading,
    working,
    statusMessage,
    loadCards,
    loadOutputs,
    createCard,
    updateCard,
    deleteCard,
    replaceOutputs,
    selectOutput,
    deleteOutput,
    addTermsToPool,
    extractIdeaSeedsFromContent,
    generateIdeaSeeds,
    generateIdeaOutputs,
    requestRelatedTerms,
    redrawIdeaTermRandomly,
    promoteToOutline,
    pushSceneHookToBoard,
  };
}
