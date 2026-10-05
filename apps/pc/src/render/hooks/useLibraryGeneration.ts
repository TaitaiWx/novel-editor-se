import { useCallback } from 'react';
import type { AIGenerationScope } from '@/render/app/types';
import {
  DEFAULT_CHARACTER_HIGHLIGHT_COLOR,
  DEFAULT_CHARACTER_HIGHLIGHT_FIRST_MENTION_ONLY,
  createRelationStorageKey,
  inferCharacterCategoryFromRole,
  mapCharacterRows,
  mergeCharacterGraphResults,
  normalizePersonName,
  parseCharacterAttributes,
  parseCharacterGraphAIResult,
  splitTextIntoChunks,
  stringifyCharacterAttributes,
} from '@/render/components/RightPanel/utils';
import type { FileNode } from '@/render/types';
import {
  buildLoreDedupKey,
  loadLoreEntriesByFolder,
} from '@/render/components/RightPanel/lore-data';
import {
  buildUniqueMarkdownName,
  findNodeInTree,
  isMaterialLikeName,
} from '@/render/app/fileTreeUtils';
import {
  getAIGenerationScopeLabel,
  parseLoreGenerationResult,
  parseMaterialGenerationResult,
  selectChunksForAiAnalysis,
} from '@/render/app/aiGeneration';
import type { AppState } from './useAppState';
import type { AppSettingsActions } from './useAppSettingsActions';
import type { WorkspaceCreationApi } from './useWorkspaceCreation';
import type { ProjectLoaderApi } from './useProjectLoader';
import type { ScopedContentReader } from './useScopedContentReader';

export type UseLibraryGenerationContext = Pick<
  AppState,
  | 'bumpWorkspaceCharactersVersion'
  | 'bumpWorkspaceLoreVersion'
  | 'filesRef'
  | 'folderPathRef'
  | 'setWorkspaceCharacters'
  | 'setWorkspaceLoreEntries'
  | 'toast'
> &
  Pick<AppSettingsActions, 'ensurePersistedAiReady'> &
  Pick<WorkspaceCreationApi, 'getCurrentNovelId'> &
  Pick<ProjectLoaderApi, 'refreshCurrentFolder'> &
  Pick<ScopedContentReader, 'resolveAIGenerationContext'>;

/**
 * AI 生成并同步人物库 / 设定库 / 资料库
 */
export function useLibraryGeneration(ctx: UseLibraryGenerationContext) {
  const {
    bumpWorkspaceCharactersVersion,
    bumpWorkspaceLoreVersion,
    ensurePersistedAiReady,
    filesRef,
    folderPathRef,
    getCurrentNovelId,
    refreshCurrentFolder,
    resolveAIGenerationContext,
    setWorkspaceCharacters,
    setWorkspaceLoreEntries,
    toast,
  } = ctx;

  const handleGenerateCharacters = useCallback(
    async (scope: AIGenerationScope) => {
      const ipc = window.electron?.ipcRenderer;
      const folder = folderPathRef.current;
      if (!ipc || !folder) return;
      const persistedSettings = await ensurePersistedAiReady();
      if (!persistedSettings) return;
      const novelId = await getCurrentNovelId();
      if (!novelId) return;

      try {
        toast.info(`正在从${getAIGenerationScopeLabel(scope)}生成人物图谱...`, 1800);
        const { content, label } = await resolveAIGenerationContext(scope);
        const contextTokens = persistedSettings.ai.contextTokens || 128000;
        const approxChunkChars = Math.max(4000, Math.min(12000, Math.floor(contextTokens * 0.08)));
        const chunks = selectChunksForAiAnalysis(splitTextIntoChunks(content, approxChunkChars));
        const loreEntries = await loadLoreEntriesByFolder(folder);
        const chunkResults = [];

        for (let index = 0; index < chunks.length; index += 1) {
          const response = (await ipc.invoke('ai-request', {
            prompt:
              '请从给定正文片段中抽取人物与关系。必须严格返回 JSON 对象，格式为 {"characters":[{"name":"","role":"","description":"","aliases":[]}],"relations":[{"source":"","target":"","label":"","tone":"ally|rival|family|mentor|other","note":""}],"summary":""}。没有内容也必须返回空数组，不要输出 Markdown，不要解释。',
            systemPrompt:
              '你是小说人物设计引擎。你的任务是稳定抽取人物图谱，输出必须可被 JSON.parse 直接解析。角色名要用正文里的实际称呼，关系只保留明确证据。',
            context: [
              `生成范围: ${label}`,
              loreEntries.length > 0
                ? `设定集参考:\n${loreEntries.map((item) => `${item.title}: ${item.summary}`).join('\n')}`
                : '',
              `正文片段 ${index + 1}/${chunks.length}:\n${chunks[index]}`,
            ]
              .filter(Boolean)
              .join('\n\n'),
          })) as { ok: boolean; text?: string; error?: string };
          if (!response.ok) throw new Error(response.error || 'AI 生成人物失败');
          const parsed = parseCharacterGraphAIResult(response.text || '');
          if (parsed) {
            chunkResults.push(parsed);
          }
        }

        const merged = mergeCharacterGraphResults(chunkResults);
        if (merged.characters.length === 0) {
          toast.warning('AI 没有识别出足够明确的人物');
          return;
        }

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

        const nameToId = new Map<string, number>();
        let createdCount = 0;
        let updatedCount = 0;
        for (const character of merged.characters) {
          const normalized = normalizePersonName(character.name);
          const matched = existingByName.get(normalized);
          const nextRole = character.role?.trim() || matched?.role || '';
          const nextDescription = character.description?.trim() || matched?.description || '';
          const nextAliases = Array.from(
            new Set((character.aliases || []).map((item) => item.trim()).filter(Boolean))
          );

          if (matched) {
            const prevAttrs = parseCharacterAttributes(matched.attributes, nextRole);
            await ipc.invoke('db-character-update', matched.id, {
              name: matched.name,
              role: nextRole,
              description: nextDescription,
              attributes: stringifyCharacterAttributes(
                {
                  ...prevAttrs,
                  aliases: Array.from(new Set([...(prevAttrs.aliases || []), ...nextAliases])),
                },
                nextRole
              ),
            });
            updatedCount += 1;
            nameToId.set(normalized, matched.id);
            nextAliases.forEach((alias) => nameToId.set(normalizePersonName(alias), matched.id));
          } else {
            const created = (await ipc.invoke(
              'db-character-create',
              novelId,
              character.name.trim(),
              nextRole,
              nextDescription,
              stringifyCharacterAttributes(
                {
                  aliases: nextAliases,
                  category: inferCharacterCategoryFromRole(nextRole),
                  highlightColor: DEFAULT_CHARACTER_HIGHLIGHT_COLOR,
                  highlightFirstMentionOnly: DEFAULT_CHARACTER_HIGHLIGHT_FIRST_MENTION_ONLY,
                },
                nextRole
              )
            )) as { lastInsertRowid: number | bigint };
            const createdId = Number(created.lastInsertRowid);
            createdCount += 1;
            nameToId.set(normalized, createdId);
            nextAliases.forEach((alias) => nameToId.set(normalizePersonName(alias), createdId));
          }
        }

        const nextRelations = merged.relations
          .map((relation, index) => {
            const sourceId = nameToId.get(normalizePersonName(relation.source));
            const targetId = nameToId.get(normalizePersonName(relation.target));
            if (!sourceId || !targetId || sourceId === targetId) return null;
            return {
              id: `ai-${Date.now()}-${index}`,
              sourceId,
              targetId,
              label: relation.label?.trim() || '关系',
              tone:
                relation.tone === 'ally' ||
                relation.tone === 'rival' ||
                relation.tone === 'family' ||
                relation.tone === 'mentor'
                  ? relation.tone
                  : 'other',
              note: relation.note?.trim() || '',
            };
          })
          .filter(Boolean) as Array<{
          id: string;
          sourceId: number;
          targetId: number;
          label: string;
          tone: 'ally' | 'rival' | 'family' | 'mentor' | 'other';
          note: string;
        }>;

        const relationKey = createRelationStorageKey(folder);
        if (relationKey) {
          await ipc.invoke('db-settings-set', relationKey, JSON.stringify(nextRelations));
        }
        const refreshedRows = (await ipc.invoke('db-character-list', novelId)) as Array<{
          id: number;
          name: string;
          role: string;
          description: string;
          attributes: string;
        }>;
        setWorkspaceCharacters(mapCharacterRows(refreshedRows));
        bumpWorkspaceCharactersVersion();
        toast.success(
          `AI 已同步人物：新增 ${createdCount}，更新 ${updatedCount}，关系 ${nextRelations.length}`
        );
      } catch (error) {
        toast.error(`AI 生成人物失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [ensurePersistedAiReady, getCurrentNovelId, resolveAIGenerationContext, toast]
  );

  const handleGenerateLoreEntries = useCallback(
    async (scope: AIGenerationScope) => {
      const ipc = window.electron?.ipcRenderer;
      const folder = folderPathRef.current;
      if (!ipc || !folder) return;
      const persistedSettings = await ensurePersistedAiReady();
      if (!persistedSettings) return;

      try {
        toast.info(`正在从${getAIGenerationScopeLabel(scope)}提炼设定...`, 1800);
        const { content, label } = await resolveAIGenerationContext(scope);
        const response = (await ipc.invoke('ai-request', {
          prompt:
            '请从给定内容中提炼可长期复用的设定条目。必须严格返回 JSON 对象，格式为 {"entries":[{"category":"world|faction|system|term","title":"","summary":"","tags":[""]}]}。只保留长期有效设定，不要输出章节剧情总结，不要 Markdown。',
          systemPrompt:
            '你是小说设定编辑。你需要从正文中抽取可复用的世界观、势力、规则、术语条目，并用简洁中文概括。',
          context: `生成范围: ${label}\n\n作品内容:\n${content.slice(0, 90000)}`,
        })) as { ok: boolean; text?: string; error?: string };
        if (!response.ok) throw new Error(response.error || 'AI 生成设定失败');
        const drafts = parseLoreGenerationResult(response.text || '');
        if (drafts.length === 0) {
          toast.warning('AI 没有生成可导入的设定条目');
          return;
        }

        const existingEntries = await loadLoreEntriesByFolder(folder);
        const existingByKey = new Map(
          existingEntries.map((item) => [buildLoreDedupKey(item), item])
        );
        let createdCount = 0;
        let updatedCount = 0;

        for (const draft of drafts) {
          const matched = existingByKey.get(buildLoreDedupKey(draft));
          if (matched) {
            if (!matched.summary.trim() && draft.summary.trim()) {
              await ipc.invoke('db-world-setting-update', matched.id, {
                content: draft.summary,
                tags: JSON.stringify(draft.tags || []),
              });
              updatedCount += 1;
            }
            continue;
          }
          await ipc.invoke(
            'db-world-setting-create-by-folder',
            folder,
            draft.category,
            draft.title,
            draft.summary,
            JSON.stringify(draft.tags || [])
          );
          createdCount += 1;
        }

        const nextEntries = await loadLoreEntriesByFolder(folder);
        setWorkspaceLoreEntries(nextEntries);
        bumpWorkspaceLoreVersion();
        toast.success(`AI 已提炼设定：新增 ${createdCount}，补全 ${updatedCount}`);
      } catch (error) {
        toast.error(`AI 生成设定失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [ensurePersistedAiReady, resolveAIGenerationContext, toast]
  );

  const handleGenerateMaterials = useCallback(
    async (scope: AIGenerationScope) => {
      const ipc = window.electron?.ipcRenderer;
      const folder = folderPathRef.current;
      if (!ipc || !folder) return;
      const persistedSettings = await ensurePersistedAiReady();
      if (!persistedSettings) return;

      try {
        toast.info(`正在从${getAIGenerationScopeLabel(scope)}生成资料条目...`, 1800);
        const { content, label } = await resolveAIGenerationContext(scope);
        const response = (await ipc.invoke('ai-request', {
          prompt:
            '请根据给定作品内容，生成适合沉淀到资料库的资料条目。必须严格返回 JSON 对象，格式为 {"materials":[{"title":"","summary":"","kind":"reference|scene|character|setting|research","relatedChapter":"","keywords":[""]}]}。资料条目应是可继续扩写的研究/参考笔记，不要输出 Markdown。',
          systemPrompt:
            '你是长篇创作资料编辑。你的任务是把作品内容中值得长期保留的参考资料、场景资料、人物资料、设定资料整理成短条目。',
          context: `生成范围: ${label}\n\n作品内容:\n${content.slice(0, 90000)}`,
        })) as { ok: boolean; text?: string; error?: string };
        if (!response.ok) throw new Error(response.error || 'AI 生成资料失败');
        const drafts = parseMaterialGenerationResult(response.text || '');
        if (drafts.length === 0) {
          toast.warning('AI 没有生成可落库的资料条目');
          return;
        }

        let createdMaterialRoot = false;
        const existingMaterialRoot = filesRef.current.find(
          (node) => node.type === 'directory' && isMaterialLikeName(node.name)
        );
        const defaultMaterialRoot =
          existingMaterialRoot?.path ??
          ((createdMaterialRoot = true),
          (
            (await ipc.invoke('create-directory', folder, '资料')) as {
              success: boolean;
              dirPath: string;
            }
          ).dirPath);
        const existingAiMaterialRoot = findNodeInTree(
          filesRef.current,
          `${defaultMaterialRoot.replace(/[\\/]+$/, '')}/AI资料`
        );
        let createdAiMaterialRoot = false;
        const aiMaterialRoot =
          existingAiMaterialRoot?.type === 'directory'
            ? existingAiMaterialRoot.path
            : ((createdAiMaterialRoot = true),
              (
                (await ipc.invoke('create-directory', defaultMaterialRoot, 'AI资料')) as {
                  success: boolean;
                  dirPath: string;
                }
              ).dirPath);

        const existingNames = new Set(
          ((findNodeInTree(filesRef.current, aiMaterialRoot)?.children || []) as FileNode[])
            .filter((node): node is FileNode & { type: 'file' } => node.type === 'file')
            .map((node) => node.name)
        );

        let writtenCount = 0;
        for (const draft of drafts) {
          const fileName = buildUniqueMarkdownName(draft.title, existingNames);
          const created = (await ipc.invoke('create-file', aiMaterialRoot, fileName)) as {
            success: boolean;
            filePath: string;
          };
          if (!created.success || !created.filePath) continue;
          const body = [
            `# ${draft.title}`,
            '',
            `类型：${draft.kind}`,
            draft.relatedChapter ? `关联章节：${draft.relatedChapter}` : '',
            draft.keywords.length > 0 ? `关键词：${draft.keywords.join('、')}` : '',
            '',
            draft.summary,
          ]
            .filter(Boolean)
            .join('\n');
          await ipc.invoke('write-file', created.filePath, body);
          writtenCount += 1;
        }

        if (writtenCount === 0) {
          if (createdAiMaterialRoot) {
            await ipc.invoke('delete-directory', aiMaterialRoot);
          }
          if (createdMaterialRoot) {
            await ipc.invoke('delete-directory', defaultMaterialRoot);
          }
          toast.warning('资料条目未成功落盘，已取消创建空目录');
          return;
        }

        await refreshCurrentFolder();
        toast.success(`AI 已生成 ${writtenCount} 条资料笔记`);
      } catch (error) {
        toast.error(`AI 生成资料失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [ensurePersistedAiReady, resolveAIGenerationContext, refreshCurrentFolder, toast]
  );

  return {
    handleGenerateCharacters,
    handleGenerateLoreEntries,
    handleGenerateMaterials,
  };
}

export type LibraryGenerationApi = ReturnType<typeof useLibraryGeneration>;
