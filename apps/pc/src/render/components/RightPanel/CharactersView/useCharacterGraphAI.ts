import React, { useCallback, useState } from 'react';
import type {
  Character,
  CharacterGraphAIResult,
  CharacterRelation,
  PersistedAISettings,
} from '../types';
import { RELATION_TONE_LABELS, SETTINGS_STORAGE_KEY } from '../constants';
import {
  DEFAULT_CHARACTER_HIGHLIGHT_COLOR,
  DEFAULT_CHARACTER_HIGHLIGHT_FIRST_MENTION_ONLY,
  inferCharacterCategoryFromRole,
  mergeCharacterGraphResults,
  normalizePersonName,
  normalizeRelationTone,
  parseCharacterAttributes,
  parseCharacterGraphAIResult,
  splitTextIntoChunks,
  stringifyCharacterAttributes,
} from '../utils';
import { loadLoreEntriesByFolder } from '../lore-data';

/**
 * AI 生成人物图谱：切分正文逐段抽取人物与关系，合并后同步到数据库。
 */
export function useCharacterGraphAI({
  content,
  folderPath,
  novelId,
  loadCharactersFromDb,
  setRelations,
  persistRelations,
  setSelectedCharacterId,
}: {
  content: string;
  folderPath: string | null;
  novelId: number | null;
  loadCharactersFromDb: (targetNovelId: number) => Promise<Character[]>;
  setRelations: React.Dispatch<React.SetStateAction<CharacterRelation[]>>;
  persistRelations: (nextRelations: CharacterRelation[]) => Promise<void>;
  setSelectedCharacterId: React.Dispatch<React.SetStateAction<number | null>>;
}) {
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiStatus, setAiStatus] = useState('');

  const handleGenerateCharacterGraph = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc || !folderPath || !novelId) return;
    if (!content.trim()) {
      setAiStatus('正文为空，无法生成角色图谱');
      return;
    }
    setAiGenerating(true);
    setAiStatus('正在读取 AI 配置并切分正文...');
    try {
      const settingsRaw = await ipc.invoke('db-settings-get', SETTINGS_STORAGE_KEY);
      const settings = settingsRaw
        ? (JSON.parse(settingsRaw as string) as { ai?: PersistedAISettings })
        : { ai: undefined };
      const contextTokens = settings.ai?.contextTokens || 128000;
      const approxChunkChars = Math.max(4000, Math.min(12000, Math.floor(contextTokens * 0.08)));
      const chunks = splitTextIntoChunks(content, approxChunkChars).slice(0, 12);
      const loreEntries = await loadLoreEntriesByFolder(folderPath);
      const chunkResults: CharacterGraphAIResult[] = [];

      for (let index = 0; index < chunks.length; index += 1) {
        setAiStatus(`正在分析人物片段 ${index + 1}/${chunks.length}...`);
        const response = (await ipc.invoke('ai-request', {
          prompt:
            '请从给定正文片段中抽取人物与关系。必须严格返回 JSON 对象，格式为 {"characters":[{"name":"","role":"","description":"","aliases":[]}],"relations":[{"source":"","target":"","label":"","tone":"ally|rival|family|mentor|other","note":""}],"summary":""}。没有内容也必须返回空数组，不要输出 Markdown，不要解释。',
          systemPrompt:
            '你是小说人物设计引擎。你的任务是稳定抽取人物图谱，输出必须可被 JSON.parse 直接解析。角色名要用正文里的实际称呼，关系只保留明确证据。',
          context: [
            loreEntries.length > 0
              ? `设定集参考:\n${loreEntries.map((item) => `${item.title}: ${item.summary}`).join('\n')}`
              : '',
            `正文片段 ${index + 1}/${chunks.length}:\n${chunks[index]}`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        })) as { ok: boolean; text?: string; error?: string };

        if (!response.ok) throw new Error(response.error || `片段 ${index + 1} 解析失败`);
        const parsed = parseCharacterGraphAIResult(response.text || '');
        if (parsed) chunkResults.push(parsed);
      }

      const merged = mergeCharacterGraphResults(chunkResults);
      if (merged.characters.length === 0) {
        setAiStatus('未识别出足够明确的人物，建议补更多正文后再试');
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
      for (const row of existingRows) {
        existingByName.set(normalizePersonName(row.name), row);
        const attrs = parseCharacterAttributes(row.attributes, row.role);
        (attrs.aliases || []).forEach((alias) =>
          existingByName.set(normalizePersonName(alias), row)
        );
      }
      const nameToId = new Map<string, number>();

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
          const nextAttributes = stringifyCharacterAttributes(
            {
              ...prevAttrs,
              aliases: Array.from(new Set([...(prevAttrs.aliases || []), ...nextAliases])),
            },
            nextRole
          );
          await ipc.invoke('db-character-update', matched.id, {
            name: matched.name,
            role: nextRole,
            description: nextDescription,
            attributes: nextAttributes,
          });
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
          nameToId.set(normalized, createdId);
          nextAliases.forEach((alias) => nameToId.set(normalizePersonName(alias), createdId));
        }
      }

      await loadCharactersFromDb(novelId);

      // 关系端点解析：优先本次 AI 结果的名称/别名，其次回退到数据库中已有人物的正名与旧别名
      const resolvePersonId = (name: string) => {
        const normalized = normalizePersonName(name);
        return nameToId.get(normalized) ?? existingByName.get(normalized)?.id;
      };
      const nextRelations: CharacterRelation[] = merged.relations
        .map((relation, index) => {
          const sourceId = resolvePersonId(relation.source);
          const targetId = resolvePersonId(relation.target);
          if (!sourceId || !targetId || sourceId === targetId) return null;
          const tone = normalizeRelationTone(relation.tone);
          return {
            id: `ai-${Date.now()}-${index}`,
            sourceId,
            targetId,
            label: relation.label?.trim() || RELATION_TONE_LABELS[tone],
            tone,
            note: relation.note?.trim() || '',
          };
        })
        .filter((item): item is CharacterRelation => Boolean(item));

      setRelations(nextRelations);
      await persistRelations(nextRelations);
      setSelectedCharacterId(nameToId.values().next().value || null);
      setAiStatus(
        `已同步 ${merged.characters.length} 个人物、${nextRelations.length} 条关系${merged.summary ? `，${merged.summary}` : ''}`
      );
    } catch (error) {
      setAiStatus(error instanceof Error ? error.message : '人物图谱生成失败');
    } finally {
      setAiGenerating(false);
    }
  }, [content, folderPath, loadCharactersFromDb, novelId, persistRelations]);

  return { aiGenerating, aiStatus, handleGenerateCharacterGraph };
}
