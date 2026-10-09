import { useCallback, useRef } from 'react';
import {
  type AssistantArtifactGenerationStatus,
  createAssistantGenerationStatusStorageKey,
} from '@/render/utils/assistantGeneration';
import type {
  AssistantScopeTarget,
  AssistantScopedCharacter,
  AssistantScopedLore,
  AssistantScopedMaterial,
} from '@/render/app/types';
import type { CharacterGraphAIResult } from '@/render/components/RightPanel/types';
import {
  DEFAULT_CHARACTER_HIGHLIGHT_COLOR,
  DEFAULT_CHARACTER_HIGHLIGHT_FIRST_MENTION_ONLY,
  inferCharacterCategoryFromRole,
  mapCharacterRows,
  mergeCharacterGraphResults,
  normalizePersonName,
  parseCharacterAttributes,
  parseCharacterGraphAIResult,
  splitTextIntoChunks,
  stringifyCharacterAttributes,
} from '@/render/components/RightPanel/utils';
import { createAssistantArtifactStorageKey } from '@/render/utils/workspace';
import { loadLoreEntriesByFolder } from '@/render/components/RightPanel/lore-data';
import { selectChunksForAiAnalysis } from '@/render/app/aiGeneration';
import type { WorkspaceState } from './state/useWorkspaceState';
import type { AiSessionState } from './state/useAiSessionState';
import type { EntitiesState } from './state/useEntitiesState';
import type { UiState } from './state/useUiState';
import type { WorkspaceDerivedState } from './useWorkspaceDerivedState';
import type { AppSettingsActions } from './useAppSettingsActions';
import type { WorkspaceCreationApi } from './useWorkspaceCreation';
import type { TabActions } from './useTabActions';
import type { ProjectLoaderApi } from './useProjectLoader';
import type { ScopedContentReader } from './useScopedContentReader';
import { useScopedLoreMaterialGeneration } from './useScopedLoreMaterialGeneration';

export type UseScopedAssistantGenerationContext = Pick<
  WorkspaceState,
  'filesRef' | 'workScopePathRef'
> &
  Pick<
    AiSessionState,
    | 'setAssistantCharacterGenerationStatus'
    | 'setAssistantScopedCharacters'
    | 'setAssistantScopedLoreEntries'
    | 'setAssistantScopedMaterials'
  > &
  Pick<
    EntitiesState,
    | 'bumpWorkspaceCharactersVersion'
    | 'bumpWorkspaceLoreVersion'
    | 'setWorkspaceCharacters'
    | 'setWorkspaceLoreEntries'
  > &
  Pick<UiState, 'toast'> &
  Pick<WorkspaceDerivedState, 'currentAssistantScope'> &
  Pick<AppSettingsActions, 'ensurePersistedAiReady'> &
  Pick<WorkspaceCreationApi, 'getCurrentNovelId'> &
  Pick<TabActions, 'openFileInTab'> &
  Pick<ProjectLoaderApi, 'refreshCurrentFolder'> &
  Pick<ScopedContentReader, 'resolveScopeTargetContext'>;

/**
 * 按作用域（作品 / 卷 / 章）生成助手上下文（人物、设定、资料）并持久化
 */
export function useScopedAssistantGeneration(ctx: UseScopedAssistantGenerationContext) {
  const {
    bumpWorkspaceCharactersVersion,
    bumpWorkspaceLoreVersion,
    currentAssistantScope,
    ensurePersistedAiReady,
    filesRef,
    workScopePathRef,
    getCurrentNovelId,
    openFileInTab,
    refreshCurrentFolder,
    resolveScopeTargetContext,
    setAssistantCharacterGenerationStatus,
    setAssistantScopedCharacters,
    setAssistantScopedLoreEntries,
    setAssistantScopedMaterials,
    setWorkspaceCharacters,
    setWorkspaceLoreEntries,
    toast,
  } = ctx;

  // 始终指向最新的当前作用域：异步生成返回时据此判断结果是否属于用户正在查看的面板，
  // 避免闭包中过期的作用域让旧结果写入已切换的新作用域
  const currentAssistantScopeRef = useRef(currentAssistantScope);
  currentAssistantScopeRef.current = currentAssistantScope;
  const isViewingScope = useCallback((scope: AssistantScopeTarget) => {
    const current = currentAssistantScopeRef.current;
    return Boolean(current && current.kind === scope.kind && current.path === scope.path);
  }, []);

  const persistScopedAssistantArtifacts = useCallback(
    async (
      scope: AssistantScopeTarget,
      payload: {
        characters?: AssistantScopedCharacter[];
        lore?: AssistantScopedLore[];
        materials?: AssistantScopedMaterial[];
      }
    ) => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) return;

      const jobs: Promise<unknown>[] = [];
      if (payload.characters) {
        const key = createAssistantArtifactStorageKey('characters', scope.kind, scope.path);
        if (key) {
          jobs.push(ipc.invoke('db-settings-set', key, JSON.stringify(payload.characters)));
        }
      }
      if (payload.lore) {
        const key = createAssistantArtifactStorageKey('lore', scope.kind, scope.path);
        if (key) {
          jobs.push(ipc.invoke('db-settings-set', key, JSON.stringify(payload.lore)));
        }
      }
      if (payload.materials) {
        const key = createAssistantArtifactStorageKey('materials', scope.kind, scope.path);
        if (key) {
          jobs.push(ipc.invoke('db-settings-set', key, JSON.stringify(payload.materials)));
        }
      }
      await Promise.all(jobs);
    },
    []
  );

  const persistScopedAssistantGenerationStatus = useCallback(
    async (
      scope: AssistantScopeTarget,
      artifact: 'characters' | 'lore' | 'materials',
      payload: Omit<AssistantArtifactGenerationStatus, 'artifact' | 'scopeKind' | 'scopePath'>
    ) => {
      const ipc = window.electron?.ipcRenderer;
      const key = createAssistantGenerationStatusStorageKey(artifact, scope.kind, scope.path);
      if (!ipc || !key) return;

      const totalSteps = Math.max(0, Math.floor(payload.totalSteps));
      const completedSteps = Math.min(
        Math.max(0, Math.floor(payload.completedSteps)),
        totalSteps || 0
      );
      const nextStatus = {
        ...payload,
        artifact,
        scopeKind: scope.kind,
        scopePath: scope.path,
        scopeLabel: payload.scopeLabel || scope.label,
        totalSteps,
        completedSteps,
        resultCount: Math.max(0, Math.floor(payload.resultCount)),
        libraryCount: Math.max(0, Math.floor(payload.libraryCount)),
        createdCount: Math.max(0, Math.floor(payload.createdCount)),
        updatedCount: Math.max(0, Math.floor(payload.updatedCount)),
        startedAt: payload.startedAt,
        finishedAt: payload.finishedAt ?? null,
      } satisfies AssistantArtifactGenerationStatus;

      if (artifact === 'characters' && isViewingScope(scope)) {
        setAssistantCharacterGenerationStatus(nextStatus);
      }

      await ipc.invoke('db-settings-set', key, JSON.stringify(nextStatus));
    },
    [isViewingScope, setAssistantCharacterGenerationStatus]
  );

  const handleGenerateScopedCharacters = useCallback(
    async (scope: AssistantScopeTarget) => {
      const ipc = window.electron?.ipcRenderer;
      const folder = workScopePathRef.current;
      if (!ipc || !folder) return;
      const persistedSettings = await ensurePersistedAiReady();
      if (!persistedSettings) return;
      const startedAt = new Date().toISOString();

      try {
        toast.info(`正在为${scope.label}生成人物上下文...`, 1800);
        const { content, label } = await resolveScopeTargetContext(scope);
        const novelId = await getCurrentNovelId();
        const contextTokens = persistedSettings.ai.contextTokens || 128000;
        const approxChunkChars = Math.max(4000, Math.min(12000, Math.floor(contextTokens * 0.08)));
        const chunks = selectChunksForAiAnalysis(splitTextIntoChunks(content, approxChunkChars));
        const loreEntries = await loadLoreEntriesByFolder(folder);
        const chunkResults: CharacterGraphAIResult[] = [];
        const totalSteps = chunks.length + 2;

        await persistScopedAssistantGenerationStatus(scope, 'characters', {
          state: 'running',
          scopeLabel: scope.label,
          message:
            chunks.length > 0
              ? `正在分析 ${scope.label}，共 ${chunks.length} 段正文`
              : `正在分析 ${scope.label}`,
          totalSteps,
          completedSteps: 0,
          resultCount: 0,
          libraryCount: 0,
          createdCount: 0,
          updatedCount: 0,
          startedAt,
          finishedAt: null,
        });

        for (let index = 0; index < chunks.length; index += 1) {
          const response = (await ipc.invoke('ai-request', {
            prompt:
              '请从给定正文片段中抽取当前作用域最重要的人物上下文。必须严格返回 JSON 对象，格式为 {"characters":[{"name":"","role":"","description":"","aliases":[]}],"relations":[{"source":"","target":"","label":"","tone":"ally|rival|family|mentor|other","note":""}],"summary":""}。没有内容也必须返回空数组，不要输出 Markdown，不要解释。',
            systemPrompt:
              '你是创作助手的人物上下文引擎。你只保留当前作用域里真正重要、可供继续写作引用的人物。',
            context: [
              `生成范围: ${label}`,
              loreEntries.length > 0
                ? `项目设定参考:\n${loreEntries.map((item) => `${item.title}: ${item.summary}`).join('\n')}`
                : '',
              `正文片段 ${index + 1}/${chunks.length}:\n${chunks[index]}`,
            ]
              .filter(Boolean)
              .join('\n\n'),
          })) as { ok: boolean; text?: string; error?: string };
          if (!response.ok) throw new Error(response.error || 'AI 生成人物上下文失败');
          const parsed = parseCharacterGraphAIResult(response.text || '');
          if (parsed) {
            chunkResults.push(parsed);
          }

          await persistScopedAssistantGenerationStatus(scope, 'characters', {
            state: 'running',
            scopeLabel: scope.label,
            message:
              index + 1 < chunks.length
                ? `正在分析 ${scope.label} · 第 ${index + 1}/${chunks.length} 段`
                : `正在整理 ${scope.label} 的人物结果`,
            totalSteps,
            completedSteps: index + 1,
            resultCount: 0,
            libraryCount: 0,
            createdCount: 0,
            updatedCount: 0,
            startedAt,
            finishedAt: null,
          });
        }

        const merged = mergeCharacterGraphResults(chunkResults);
        const normalizedCharacters = merged.characters
          .map((item) => ({
            name: item.name.trim(),
            role: item.role?.trim() || '',
            description: item.description?.trim() || '',
            aliases: Array.from(
              new Set((item.aliases || []).map((alias) => alias.trim()).filter(Boolean))
            ),
          }))
          .filter((item) => item.name);
        const nextCharacters = merged.characters
          .map((item) => ({
            name: item.name.trim(),
            role: item.role?.trim() || '',
            description: item.description?.trim() || '',
          }))
          .filter((item) => item.name);
        let createdCount = 0;
        let updatedCount = 0;
        let libraryCount = 0;

        if (novelId) {
          await persistScopedAssistantGenerationStatus(scope, 'characters', {
            state: 'running',
            scopeLabel: scope.label,
            message: `正在把 ${scope.label} 的人物结果同步到角色库`,
            totalSteps,
            completedSteps: Math.max(0, totalSteps - 1),
            resultCount: nextCharacters.length,
            libraryCount: 0,
            createdCount: 0,
            updatedCount: 0,
            startedAt,
            finishedAt: null,
          });

          const existingRows = (await ipc.invoke('db-character-list', novelId)) as Array<{
            id: number;
            name: string;
            role: string;
            description: string;
            attributes: string;
          }>;
          const existingByName = new Map<string, (typeof existingRows)[number]>();
          existingRows.forEach((row) => {
            existingByName.set(normalizePersonName(row.name), row);
            const attrs = parseCharacterAttributes(row.attributes, row.role);
            (attrs.aliases || []).forEach((alias) =>
              existingByName.set(normalizePersonName(alias), row)
            );
          });

          for (const character of normalizedCharacters) {
            const normalizedName = normalizePersonName(character.name);
            const matched = existingByName.get(normalizedName);
            if (matched) {
              await ipc.invoke('db-character-update', matched.id, {
                ...(character.role ? { role: character.role } : {}),
                ...(character.description ? { description: character.description } : {}),
                appendAliases: character.aliases || [],
              });
              updatedCount += 1;
            } else {
              await ipc.invoke(
                'db-character-create',
                novelId,
                character.name,
                character.role,
                character.description,
                stringifyCharacterAttributes(
                  {
                    aliases: character.aliases,
                    category: inferCharacterCategoryFromRole(character.role),
                    highlightColor: DEFAULT_CHARACTER_HIGHLIGHT_COLOR,
                    highlightFirstMentionOnly: DEFAULT_CHARACTER_HIGHLIGHT_FIRST_MENTION_ONLY,
                  },
                  character.role
                )
              );
              createdCount += 1;
            }
          }

          const refreshedRows = (await ipc.invoke('db-character-list', novelId)) as Array<{
            id: number;
            name: string;
            role: string;
            description: string;
            attributes: string;
          }>;
          libraryCount = refreshedRows.length;
          setWorkspaceCharacters(mapCharacterRows(refreshedRows));
          bumpWorkspaceCharactersVersion();
        }

        await persistScopedAssistantArtifacts(scope, { characters: nextCharacters });
        if (isViewingScope(scope)) {
          setAssistantScopedCharacters(nextCharacters);
        }

        const finishedAt = new Date().toISOString();
        const generationState = nextCharacters.length > 0 ? 'success' : 'empty';
        const generationMessage = novelId
          ? nextCharacters.length > 0
            ? `已为 ${scope.label} 提取 ${nextCharacters.length} 项人物上下文，并同步到角色库`
            : `已分析 ${scope.label}，但没有识别到可用人物`
          : nextCharacters.length > 0
            ? `已为 ${scope.label} 提取 ${nextCharacters.length} 项人物上下文，但当前项目未关联角色库`
            : `已分析 ${scope.label}，但没有识别到可用人物`;

        await persistScopedAssistantGenerationStatus(scope, 'characters', {
          state: generationState,
          scopeLabel: scope.label,
          message: generationMessage,
          totalSteps,
          completedSteps: totalSteps,
          resultCount: nextCharacters.length,
          libraryCount,
          createdCount,
          updatedCount,
          startedAt,
          finishedAt,
        });

        if (nextCharacters.length > 0) {
          if (novelId) {
            toast.success(
              `已为${scope.label}生成人物上下文：识别 ${nextCharacters.length} 项，角色库现有 ${libraryCount} 人`
            );
          } else {
            toast.warning(
              `已为${scope.label}生成人物上下文 ${nextCharacters.length} 项，但当前项目未关联角色库`
            );
          }
        } else {
          toast.warning(`已分析${scope.label}，但没有识别到可用人物`);
        }
      } catch (error) {
        toast.error(
          `AI 生成人物上下文失败: ${error instanceof Error ? error.message : '未知错误'}`
        );
        // 先提示用户，再尽力持久化失败状态；持久化本身失败（如数据库不可用）时不再向外抛出
        await persistScopedAssistantGenerationStatus(scope, 'characters', {
          state: 'error',
          scopeLabel: scope.label,
          message:
            error instanceof Error
              ? `为 ${scope.label} 生成人物上下文失败：${error.message}`
              : `为 ${scope.label} 生成人物上下文失败`,
          totalSteps: 0,
          completedSteps: 0,
          resultCount: 0,
          libraryCount: 0,
          createdCount: 0,
          updatedCount: 0,
          startedAt,
          finishedAt: new Date().toISOString(),
        }).catch((persistError) => {
          console.error('Failed to persist generation status:', persistError);
        });
      }
    },
    [
      workScopePathRef,
      ensurePersistedAiReady,
      toast,
      resolveScopeTargetContext,
      getCurrentNovelId,
      persistScopedAssistantGenerationStatus,
      persistScopedAssistantArtifacts,
      isViewingScope,
      setWorkspaceCharacters,
      bumpWorkspaceCharactersVersion,
      setAssistantScopedCharacters,
    ]
  );

  const { handleGenerateScopedLore, handleGenerateScopedMaterials } =
    useScopedLoreMaterialGeneration({
      bumpWorkspaceLoreVersion,
      ensurePersistedAiReady,
      filesRef,
      workScopePathRef,
      isViewingScope,
      openFileInTab,
      persistScopedAssistantArtifacts,
      refreshCurrentFolder,
      resolveScopeTargetContext,
      setAssistantScopedLoreEntries,
      setAssistantScopedMaterials,
      setWorkspaceLoreEntries,
      toast,
    });

  return {
    persistScopedAssistantArtifacts,
    persistScopedAssistantGenerationStatus,
    handleGenerateScopedCharacters,
    handleGenerateScopedLore,
    handleGenerateScopedMaterials,
  };
}

export type ScopedAssistantGenerationApi = ReturnType<typeof useScopedAssistantGeneration>;
