import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import styles from './styles.module.scss';
import type {
  Character,
  CharacterRelation,
  RelationTone,
  CharacterCamp,
  PersistedAISettings,
  CharacterGraphAIResult,
} from './types';
import { SETTINGS_STORAGE_KEY, RELATION_TONE_LABELS } from './constants';
import {
  createRelationStorageKey,
  createGraphLayoutStorageKey,
  normalizePersonName,
  splitTextIntoChunks,
  normalizeRelationTone,
  parseCharacterGraphAIResult,
  mergeCharacterGraphResults,
  parseCharacterAttributes,
  mapCharacterRows,
  buildCharacterLinks,
  estimateAppearanceHeat,
  inferCharacterCamp,
  inferRelationStage,
} from './utils';
import { loadLoreEntriesByFolder } from './lore-data';
import { CharacterCard } from './CharacterCard';
import { CharacterGraphPanel } from './CharacterGraphPanel';
import { VerticalSplit } from './VerticalSplit';

export const CharactersView: React.FC<{ folderPath: string | null; content: string }> = React.memo(
  ({ folderPath, content }) => {
    const [characters, setCharacters] = useState<Character[]>([]);
    const [relations, setRelations] = useState<CharacterRelation[]>([]);
    const [novelId, setNovelId] = useState<number | null>(null);
    const [adding, setAdding] = useState(false);
    const [newName, setNewName] = useState('');
    const [newRole, setNewRole] = useState('');
    const [newDesc, setNewDesc] = useState('');
    const [newAvatar, setNewAvatar] = useState('');
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [dropIndex, setDropIndex] = useState<number | null>(null);
    const [selectedCharacterId, setSelectedCharacterId] = useState<number | null>(null);
    const [relationSourceId, setRelationSourceId] = useState<number | ''>('');
    const [relationTargetId, setRelationTargetId] = useState<number | ''>('');
    const [relationLabel, setRelationLabel] = useState('');
    const [relationTone, setRelationTone] = useState<RelationTone>('ally');
    const [relationNote, setRelationNote] = useState('');
    const [editingRelationId, setEditingRelationId] = useState<string | null>(null);
    const [graphLayout, setGraphLayout] = useState<Record<number, { x: number; y: number }>>({});
    const [aiGenerating, setAiGenerating] = useState(false);
    const [aiStatus, setAiStatus] = useState('');
    const dragCounter = useRef(0);
    const graphDraggingRef = useRef<{
      id: number;
      offsetX: number;
      offsetY: number;
      rect: DOMRect;
    } | null>(null);
    const avatarInputRef = useRef<HTMLInputElement>(null);

    const links = useMemo(
      () =>
        relations.length > 0
          ? relations
          : buildCharacterLinks(characters).map((item, index) => ({
              id: `generated-${index}`,
              sourceId: item.sourceId,
              targetId: item.targetId,
              label: item.label,
              tone: 'other' as RelationTone,
              note: '',
            })),
      [relations, characters]
    );
    const defaultCharacterPositions = useMemo(() => {
      const centerX = 180;
      const centerY = 118;
      const radiusX = 118;
      const radiusY = 78;
      return characters.map((character, index) => {
        const angle = (Math.PI * 2 * index) / Math.max(characters.length, 1) - Math.PI / 2;
        return {
          character,
          x: centerX + Math.cos(angle) * radiusX,
          y: centerY + Math.sin(angle) * radiusY,
        };
      });
    }, [characters]);
    const characterPositions = useMemo(
      () =>
        defaultCharacterPositions.map((item) => {
          const saved = graphLayout[item.character.id];
          return saved ? { ...item, x: saved.x, y: saved.y } : item;
        }),
      [defaultCharacterPositions, graphLayout]
    );

    const persistRelations = useCallback(
      async (nextRelations: CharacterRelation[]) => {
        const key = createRelationStorageKey(folderPath);
        const ipc = window.electron?.ipcRenderer;
        if (!key || !ipc) return;
        await ipc.invoke('db-settings-set', key, JSON.stringify(nextRelations));
      },
      [folderPath]
    );

    useEffect(() => {
      if (!folderPath || !window.electron?.ipcRenderer) {
        setCharacters([]);
        setNovelId(null);
        return;
      }
      let cancelled = false;
      (async () => {
        const novel = (await window.electron.ipcRenderer.invoke(
          'db-novel-get-by-folder',
          folderPath
        )) as { id: number } | null;
        if (cancelled || !novel) return;
        const nid = novel.id;
        setNovelId(nid);
        const rows = (await window.electron.ipcRenderer.invoke('db-character-list', nid)) as Array<{
          id: number;
          name: string;
          role: string;
          description: string;
          attributes: string;
        }>;
        if (cancelled) return;
        setCharacters(mapCharacterRows(rows));
      })();
      return () => {
        cancelled = true;
      };
    }, [folderPath]);

    useEffect(() => {
      const loadRelations = async () => {
        const key = createRelationStorageKey(folderPath);
        const ipc = window.electron?.ipcRenderer;
        if (!key || !ipc) {
          setRelations([]);
          return;
        }
        try {
          const raw = await ipc.invoke('db-settings-get', key);
          setRelations(raw ? (JSON.parse(raw as string) as CharacterRelation[]) : []);
        } catch {
          setRelations([]);
        }
      };
      loadRelations();
    }, [folderPath]);

    useEffect(() => {
      const loadLayout = async () => {
        const key = createGraphLayoutStorageKey(folderPath);
        const ipc = window.electron?.ipcRenderer;
        if (!key || !ipc) {
          setGraphLayout({});
          return;
        }
        try {
          const raw = await ipc.invoke('db-settings-get', key);
          setGraphLayout(
            raw ? (JSON.parse(raw as string) as Record<number, { x: number; y: number }>) : {}
          );
        } catch {
          setGraphLayout({});
        }
      };
      loadLayout();
    }, [folderPath]);

    const persistGraphLayout = useCallback(
      async (nextLayout: Record<number, { x: number; y: number }>) => {
        const key = createGraphLayoutStorageKey(folderPath);
        const ipc = window.electron?.ipcRenderer;
        if (!key || !ipc) return;
        await ipc.invoke('db-settings-set', key, JSON.stringify(nextLayout));
      },
      [folderPath]
    );

    const handleAvatarSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => setNewAvatar(reader.result as string);
      reader.readAsDataURL(file);
    }, []);

    const handleAdd = useCallback(async () => {
      if (!newName.trim() || novelId === null) return;
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) return;
      const attrs = newAvatar ? JSON.stringify({ avatar: newAvatar }) : '{}';
      const result = (await ipc.invoke(
        'db-character-create',
        novelId,
        newName.trim(),
        newRole.trim(),
        newDesc.trim(),
        attrs
      )) as { lastInsertRowid: number | bigint };
      const newId = Number(result.lastInsertRowid);
      setCharacters((prev) => [
        ...prev,
        {
          id: newId,
          name: newName.trim(),
          role: newRole.trim(),
          description: newDesc.trim(),
          avatar: newAvatar || undefined,
        },
      ]);
      setNewName('');
      setNewRole('');
      setNewDesc('');
      setNewAvatar('');
      setAdding(false);
    }, [newName, newRole, newDesc, newAvatar, novelId]);

    const handleDelete = useCallback(
      async (index: number) => {
        const char = characters[index];
        if (!char) return;
        await window.electron?.ipcRenderer?.invoke('db-character-delete', char.id);
        setCharacters((prev) => prev.filter((_, i) => i !== index));
      },
      [characters]
    );

    const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>, index: number) => {
      setDragIndex(index);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
      const target = e.currentTarget;
      requestAnimationFrame(() => {
        target.style.opacity = '0.5';
      });
    }, []);

    const handleDragEnd = useCallback((e: React.DragEvent<HTMLDivElement>) => {
      e.currentTarget.style.opacity = '1';
      setDragIndex(null);
      setDropIndex(null);
      dragCounter.current = 0;
    }, []);

    const handleDragOver = useCallback(
      (e: React.DragEvent<HTMLDivElement>, index: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragIndex === null || dragIndex === index) return;
        setDropIndex(index);
      },
      [dragIndex]
    );

    const handleDragEnter = useCallback(
      (e: React.DragEvent<HTMLDivElement>, index: number) => {
        e.preventDefault();
        dragCounter.current += 1;
        if (dragIndex === null || dragIndex === index) return;
        setDropIndex(index);
      },
      [dragIndex]
    );

    const handleDragLeave = useCallback(() => {
      dragCounter.current -= 1;
      if (dragCounter.current <= 0) {
        setDropIndex(null);
        dragCounter.current = 0;
      }
    }, []);

    const handleDrop = useCallback(
      async (e: React.DragEvent<HTMLDivElement>, targetIndex: number) => {
        e.preventDefault();
        dragCounter.current = 0;
        if (dragIndex === null || dragIndex === targetIndex) {
          setDragIndex(null);
          setDropIndex(null);
          return;
        }
        setCharacters((prev) => {
          const updated = [...prev];
          const [moved] = updated.splice(dragIndex, 1);
          updated.splice(targetIndex, 0, moved);
          const ids = updated.map((c) => c.id);
          window.electron?.ipcRenderer?.invoke('db-character-reorder', ids);
          return updated;
        });
        setDragIndex(null);
        setDropIndex(null);
      },
      [dragIndex]
    );

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleAdd();
        }
      },
      [handleAdd]
    );

    const toggleAdding = useCallback(() => {
      setAdding((prev) => !prev);
    }, []);

    const handleAddRelation = useCallback(async () => {
      if (
        relationSourceId === '' ||
        relationTargetId === '' ||
        relationSourceId === relationTargetId
      )
        return;
      const nextRelations = [
        ...relations,
        {
          id: `${Date.now()}`,
          sourceId: relationSourceId,
          targetId: relationTargetId,
          label: relationLabel.trim() || RELATION_TONE_LABELS[relationTone],
          tone: relationTone,
          note: relationNote.trim(),
        },
      ];
      setRelations(nextRelations);
      setRelationLabel('');
      setRelationNote('');
      await persistRelations(nextRelations);
      setEditingRelationId(null);
    }, [
      relationSourceId,
      relationTargetId,
      relationLabel,
      relationTone,
      relationNote,
      relations,
      persistRelations,
    ]);

    const startEditRelation = useCallback((relation: CharacterRelation) => {
      setEditingRelationId(relation.id);
      setRelationSourceId(relation.sourceId);
      setRelationTargetId(relation.targetId);
      setRelationTone(relation.tone);
      setRelationLabel(relation.label);
      setRelationNote(relation.note);
    }, []);

    const handleUpdateRelation = useCallback(async () => {
      if (!editingRelationId) return;
      if (
        relationSourceId === '' ||
        relationTargetId === '' ||
        relationSourceId === relationTargetId
      )
        return;
      const nextRelations = relations.map((item) =>
        item.id === editingRelationId
          ? {
              ...item,
              sourceId: relationSourceId,
              targetId: relationTargetId,
              tone: relationTone,
              label: relationLabel.trim() || RELATION_TONE_LABELS[relationTone],
              note: relationNote.trim(),
            }
          : item
      );
      setRelations(nextRelations);
      await persistRelations(nextRelations);
      setEditingRelationId(null);
    }, [
      editingRelationId,
      relationSourceId,
      relationTargetId,
      relationTone,
      relationLabel,
      relationNote,
      relations,
      persistRelations,
    ]);

    const handleGraphNodeMouseDown = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>, id: number) => {
        const parent = (event.currentTarget.parentElement as HTMLElement) || null;
        if (!parent) return;
        const rect = parent.getBoundingClientRect();
        const current = characterPositions.find((item) => item.character.id === id);
        if (!current) return;
        graphDraggingRef.current = {
          id,
          offsetX: event.clientX - (rect.left + current.x),
          offsetY: event.clientY - (rect.top + current.y),
          rect,
        };
        const onMouseMove = (moveEvent: MouseEvent) => {
          const dragging = graphDraggingRef.current;
          if (!dragging || dragging.id !== id) return;
          const x = Math.min(
            Math.max(28, moveEvent.clientX - dragging.rect.left - dragging.offsetX),
            dragging.rect.width - 28
          );
          const y = Math.min(
            Math.max(24, moveEvent.clientY - dragging.rect.top - dragging.offsetY),
            dragging.rect.height - 24
          );
          setGraphLayout((prev) => ({ ...prev, [id]: { x, y } }));
        };
        const onMouseUp = () => {
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
          graphDraggingRef.current = null;
          setGraphLayout((prev) => {
            void persistGraphLayout(prev);
            return prev;
          });
        };
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      },
      [characterPositions, persistGraphLayout]
    );

    const handleDeleteRelation = useCallback(
      async (relationId: string) => {
        const nextRelations = relations.filter((item) => item.id !== relationId);
        setRelations(nextRelations);
        await persistRelations(nextRelations);
      },
      [relations, persistRelations]
    );

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
          const attrs = parseCharacterAttributes(row.attributes);
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
            const prevAttrs = parseCharacterAttributes(matched.attributes);
            const nextAttributes = JSON.stringify({
              ...prevAttrs,
              aliases: Array.from(new Set([...(prevAttrs.aliases || []), ...nextAliases])),
            });
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
              JSON.stringify({ aliases: nextAliases })
            )) as { lastInsertRowid: number | bigint };
            const createdId = Number(created.lastInsertRowid);
            nameToId.set(normalized, createdId);
            nextAliases.forEach((alias) => nameToId.set(normalizePersonName(alias), createdId));
          }
        }

        const refreshedRows = (await ipc.invoke('db-character-list', novelId)) as Array<{
          id: number;
          name: string;
          role: string;
          description: string;
          attributes: string;
        }>;
        setCharacters(mapCharacterRows(refreshedRows));

        const nextRelations: CharacterRelation[] = merged.relations
          .map((relation, index) => {
            const sourceId = nameToId.get(normalizePersonName(relation.source));
            const targetId = nameToId.get(normalizePersonName(relation.target));
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
    }, [content, folderPath, novelId, persistRelations]);

    const selectedCharacter = characters.find((item) => item.id === selectedCharacterId) || null;
    const selectedRelations = selectedCharacter
      ? links.filter(
          (item) => item.sourceId === selectedCharacter.id || item.targetId === selectedCharacter.id
        )
      : links;
    const clusteredCharacters = useMemo(() => {
      const grouped: Record<CharacterCamp, Array<Character & { heat: number }>> = {
        protagonist: [],
        antagonist: [],
        support: [],
      };
      characters.forEach((character) => {
        const camp = inferCharacterCamp(character, relations);
        grouped[camp].push({ ...character, heat: estimateAppearanceHeat(content, character.name) });
      });
      (Object.keys(grouped) as CharacterCamp[]).forEach((camp) => {
        grouped[camp].sort((a, b) => b.heat - a.heat);
      });
      return grouped;
    }, [characters, relations, content]);

    const relationStageStats = useMemo(() => {
      const stats = new Map<string, number>();
      relations.forEach((item) => {
        const stage = inferRelationStage(item.note);
        stats.set(stage, (stats.get(stage) || 0) + 1);
      });
      return Array.from(stats.entries()).map(([stage, count]) => ({ stage, count }));
    }, [relations]);

    const cardsView = (
      <div className={styles.charactersList}>
        <div className={styles.sectionHeader}>
          <span>角色列表</span>
          <div className={styles.actionGroup}>
            <button
              className={styles.addButton}
              onClick={handleGenerateCharacterGraph}
              disabled={aiGenerating}
            >
              {aiGenerating ? 'AI 生成中...' : 'AI 生成人物图'}
            </button>
            <button className={styles.addButton} onClick={toggleAdding}>
              {adding ? '取消' : '+ 添加'}
            </button>
          </div>
        </div>
        <div className={styles.characterHeroCard}>
          <div className={styles.characterHeroTitle}>人物总览</div>
          <div className={styles.characterHeroDesc}>
            人物会自动按阵营与出场热度分组，关系变化也会形成阶段对照。
          </div>
          <div className={styles.metricRow}>
            <span className={styles.metricChip}>人物 {characters.length}</span>
            <span className={styles.metricChip}>关系 {links.length}</span>
          </div>
          <div className={styles.characterHeroStatus}>
            {aiStatus || '可以从正文直接抽取角色与关系'}
          </div>
        </div>
        {adding && (
          <div className={styles.addForm}>
            <div className={styles.avatarPickerRow}>
              <div
                className={styles.avatarPicker}
                onClick={() => avatarInputRef.current?.click()}
                title="点击选择角色图片"
              >
                {newAvatar ? (
                  <img src={newAvatar} alt="avatar" className={styles.avatarPreview} />
                ) : (
                  <span className={styles.avatarPlaceholder}>+</span>
                )}
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarSelect}
                style={{ display: 'none' }}
              />
              <span className={styles.avatarHint}>角色头像</span>
            </div>
            <input
              placeholder="角色名称"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleKeyDown}
              className={styles.formInput}
              autoFocus
            />
            <input
              placeholder="角色定位 (主角/配角/反派...)"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              onKeyDown={handleKeyDown}
              className={styles.formInput}
            />
            <textarea
              placeholder="角色描述、设定..."
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className={styles.formTextarea}
              rows={3}
            />
            <button className={styles.submitButton} onClick={handleAdd}>
              确认添加
            </button>
          </div>
        )}
        {characters.length === 0 && !adding && (
          <div className={styles.emptyHint}>
            暂无角色
            <br />
            <span className={styles.hintSub}>可以手动创建，也可以直接让 AI 从正文生成图谱</span>
          </div>
        )}
        <div className={styles.cardsContainer}>
          {characters.map((c, i) => (
            <CharacterCard
              key={c.id}
              character={c}
              index={i}
              dragIndex={dragIndex}
              dropIndex={dropIndex}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onDelete={handleDelete}
            />
          ))}
          {dropIndex !== null && dragIndex !== null && dropIndex >= characters.length && (
            <div className={styles.dropIndicator} />
          )}
        </div>
      </div>
    );

    const graphView = (
      <CharacterGraphPanel
        characters={characters}
        content={content}
        links={links}
        characterPositions={characterPositions}
        clusteredCharacters={clusteredCharacters}
        relationStageStats={relationStageStats}
        selectedCharacterId={selectedCharacterId}
        onSelectCharacter={setSelectedCharacterId}
        selectedCharacter={selectedCharacter}
        selectedRelations={selectedRelations}
        onGraphNodeMouseDown={handleGraphNodeMouseDown}
        relationSourceId={relationSourceId}
        onRelationSourceChange={setRelationSourceId}
        relationTargetId={relationTargetId}
        onRelationTargetChange={setRelationTargetId}
        relationTone={relationTone}
        onRelationToneChange={setRelationTone}
        relationLabel={relationLabel}
        onRelationLabelChange={setRelationLabel}
        relationNote={relationNote}
        onRelationNoteChange={setRelationNote}
        editingRelationId={editingRelationId}
        onAddRelation={handleAddRelation}
        onUpdateRelation={handleUpdateRelation}
        onDeleteRelation={handleDeleteRelation}
        onStartEditRelation={startEditRelation}
      />
    );

    return <VerticalSplit top={cardsView} bottom={graphView} initialTopHeight={280} />;
  }
);
