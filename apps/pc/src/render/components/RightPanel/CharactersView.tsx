import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { extractCharacterTimeline } from '@novel-editor/basic-algorithm';
import { useDebounce } from './useDebounce';
import styles from './styles.module.scss';
import type {
  Character,
  CharacterRelation,
  RelationTone,
  CharacterCamp,
  CharacterCategory,
  CharacterTimelineItem,
  PersistedAISettings,
  CharacterGraphAIResult,
} from './types';
import { SETTINGS_STORAGE_KEY, RELATION_TONE_LABELS } from './constants';
import {
  CHARACTER_CATEGORY_LABELS,
  DEFAULT_CHARACTER_HIGHLIGHT_COLOR,
  DEFAULT_CHARACTER_HIGHLIGHT_FIRST_MENTION_ONLY,
  createCharacterTimelineOrderStorageKey,
  createCharacterTimelineStorageKey,
  createRelationStorageKey,
  createGraphLayoutStorageKey,
  getCharacterTimelineOrderKey,
  inferCharacterCategoryFromRole,
  mergeCharacterTimelineItems,
  normalizePersonName,
  parseTimelineOrderKeys,
  splitTextIntoChunks,
  normalizeRelationTone,
  parseCharacterTimelineItems,
  parseCharacterGraphAIResult,
  mergeCharacterGraphResults,
  parseCharacterAttributes,
  mapCharacterRows,
  stringifyCharacterAttributes,
  buildCharacterLinks,
  estimateAppearanceHeat,
  inferCharacterCamp,
  inferRelationStage,
} from './utils';
import { loadLoreEntriesByFolder } from './lore-data';
import { CharacterCard } from './CharacterCard';
import { CharacterGraphPanel } from './CharacterGraphPanel';
import { isImeComposing } from '../../utils/ime';
import type { FileNode, OpenLocalResult } from '../../types/File';
import {
  NOVEL_EDITOR_FILE_SAVED_EVENT,
  type NovelEditorFileSavedDetail,
} from '../../utils/editor-events';

interface TimelineIpcInvoker {
  invoke(channel: 'refresh-folder', folderPath: string): Promise<OpenLocalResult>;
  invoke(channel: 'read-file', filePath: string): Promise<string>;
}

interface NovelCorpusFile {
  path: string;
  label: string;
  content: string;
}

interface TimelineEditorState {
  itemId: string;
  mode: 'edit' | 'create-manual';
  source: CharacterTimelineItem['source'];
  autoKey?: string;
  sourceLabel?: string;
}

const TIMELINE_TEXT_FILE_RE = /\.(md|markdown|txt)$/i;
const NOVEL_CORPUS_READ_CONCURRENCY = 4;

function flattenFileNodes(nodes: FileNode[]): FileNode[] {
  return nodes.flatMap((node) => {
    if (node.type === 'file') return [node];
    return node.children ? flattenFileNodes(node.children) : [];
  });
}

function buildRelativeFileLabel(folderPath: string, filePath: string): string {
  const normalizedFolderPath = folderPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedFilePath = filePath.replace(/\\/g, '/');
  if (normalizedFilePath.startsWith(`${normalizedFolderPath}/`)) {
    return normalizedFilePath.slice(normalizedFolderPath.length + 1);
  }
  const segments = normalizedFilePath.split('/');
  return segments[segments.length - 1] || normalizedFilePath;
}

async function loadNovelCorpusFiles(
  folderPath: string,
  ipc: TimelineIpcInvoker
): Promise<NovelCorpusFile[]> {
  const tree = await ipc.invoke('refresh-folder', folderPath);
  const textFiles = flattenFileNodes(tree.files)
    .filter((node) => node.type === 'file' && TIMELINE_TEXT_FILE_RE.test(node.name))
    .sort((left, right) => left.path.localeCompare(right.path, 'zh-CN', { numeric: true }));

  const corpusFiles: NovelCorpusFile[] = [];
  for (let index = 0; index < textFiles.length; index += NOVEL_CORPUS_READ_CONCURRENCY) {
    const batch = textFiles.slice(index, index + NOVEL_CORPUS_READ_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (file) => {
        const raw = await ipc.invoke('read-file', file.path);
        return {
          path: file.path,
          label: buildRelativeFileLabel(folderPath, file.path),
          content: raw.trim(),
        } satisfies NovelCorpusFile;
      })
    );
    corpusFiles.push(...batchResults.filter((item) => item.content));
  }

  return corpusFiles;
}

export const CharactersView: React.FC<{
  folderPath: string | null;
  content: string;
  initialSelectedCharacterId?: number | null;
  onCharactersChange?: (characters: Character[]) => void;
}> = React.memo(
  ({ folderPath, content, initialSelectedCharacterId = null, onCharactersChange }) => {
    type CharacterCategoryFilter = CharacterCategory | 'all';
    const debouncedContent = useDebounce(content, 300);
    const [characters, setCharacters] = useState<Character[]>([]);
    const [relations, setRelations] = useState<CharacterRelation[]>([]);
    const [novelId, setNovelId] = useState<number | null>(null);
    const [charactersLoaded, setCharactersLoaded] = useState(false);
    const [adding, setAdding] = useState(false);
    const [newName, setNewName] = useState('');
    const [newRole, setNewRole] = useState('');
    const [newCategory, setNewCategory] = useState<CharacterCategory>('major');
    const [newDesc, setNewDesc] = useState('');
    const [newAvatar, setNewAvatar] = useState('');
    const [newHighlightColor, setNewHighlightColor] = useState(DEFAULT_CHARACTER_HIGHLIGHT_COLOR);
    const [newHighlightFirstMentionOnly, setNewHighlightFirstMentionOnly] = useState(
      DEFAULT_CHARACTER_HIGHLIGHT_FIRST_MENTION_ONLY
    );
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
    const [categoryFilter, setCategoryFilter] = useState<CharacterCategoryFilter>('all');
    const [characterSearch, setCharacterSearch] = useState('');
    const [bulkUpdatingCategory, setBulkUpdatingCategory] = useState<CharacterCategory | null>(
      null
    );
    const [novelCorpusFiles, setNovelCorpusFiles] = useState<NovelCorpusFile[]>([]);
    const [novelCorpusLoading, setNovelCorpusLoading] = useState(false);
    const [novelCorpusError, setNovelCorpusError] = useState('');
    const [persistedTimelineItems, setPersistedTimelineItems] = useState<CharacterTimelineItem[]>(
      []
    );
    const [persistedTimelineOrderKeys, setPersistedTimelineOrderKeys] = useState<string[]>([]);
    const [timelineEditor, setTimelineEditor] = useState<TimelineEditorState | null>(null);
    const [timelineDraftTitle, setTimelineDraftTitle] = useState('');
    const [timelineDraftSummary, setTimelineDraftSummary] = useState('');
    const [timelineSaving, setTimelineSaving] = useState(false);
    const [timelineDragIndex, setTimelineDragIndex] = useState<number | null>(null);
    const [timelineDropIndex, setTimelineDropIndex] = useState<number | null>(null);
    const [novelCorpusReloadToken, setNovelCorpusReloadToken] = useState(0);
    const dragCounter = useRef(0);
    const novelCorpusCacheRef = useRef<Map<string, NovelCorpusFile[]>>(new Map());
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

    const loadCharactersFromDb = useCallback(
      async (targetNovelId: number): Promise<Character[]> => {
        const ipc = window.electron?.ipcRenderer;
        if (!ipc) return [];
        const rows = (await ipc.invoke('db-character-list', targetNovelId)) as Array<{
          id: number;
          name: string;
          role: string;
          description: string;
          attributes: string;
        }>;
        const nextCharacters = mapCharacterRows(rows);
        setCharacters(nextCharacters);
        setCharactersLoaded(true);
        return nextCharacters;
      },
      []
    );

    useEffect(() => {
      if (!folderPath || !window.electron?.ipcRenderer) {
        setCharacters([]);
        setNovelId(null);
        setCharactersLoaded(false);
        return;
      }
      let cancelled = false;
      setCharactersLoaded(false);
      (async () => {
        const novel = (await window.electron.ipcRenderer.invoke(
          'db-novel-get-by-folder',
          folderPath
        )) as { id: number } | null;
        if (cancelled || !novel) return;
        const nid = novel.id;
        setNovelId(nid);
        if (cancelled) return;
        await loadCharactersFromDb(nid);
      })();
      return () => {
        cancelled = true;
      };
    }, [folderPath, loadCharactersFromDb]);

    useEffect(() => {
      if (!folderPath || !window.electron?.ipcRenderer) {
        setNovelCorpusFiles([]);
        setNovelCorpusLoading(false);
        setNovelCorpusError('');
        return;
      }

      const cachedCorpusFiles = novelCorpusCacheRef.current.get(folderPath);
      if (cachedCorpusFiles) {
        setNovelCorpusFiles(cachedCorpusFiles);
        setNovelCorpusLoading(false);
        setNovelCorpusError('');
        return;
      }

      let cancelled = false;
      setNovelCorpusLoading(true);
      setNovelCorpusError('');

      void loadNovelCorpusFiles(folderPath, window.electron.ipcRenderer)
        .then((files) => {
          if (cancelled) return;
          novelCorpusCacheRef.current.set(folderPath, files);
          setNovelCorpusFiles(files);
        })
        .catch((error) => {
          if (cancelled) return;
          setNovelCorpusFiles([]);
          setNovelCorpusError(error instanceof Error ? error.message : '作品语料加载失败');
        })
        .finally(() => {
          if (!cancelled) {
            setNovelCorpusLoading(false);
          }
        });

      return () => {
        cancelled = true;
      };
    }, [folderPath, novelCorpusReloadToken]);

    useEffect(() => {
      if (!folderPath || !window.electron?.ipcRenderer) return;

      let cancelled = false;
      const ipc = window.electron.ipcRenderer;
      const normalizedFolderPath = folderPath.replace(/\\/g, '/').replace(/\/+$/, '');

      const handleFileSaved = async (event: Event) => {
        const detail = (event as CustomEvent<NovelEditorFileSavedDetail>).detail;
        const normalizedFilePath = detail?.filePath?.replace(/\\/g, '/');
        if (!normalizedFilePath) return;
        if (!normalizedFilePath.startsWith(`${normalizedFolderPath}/`)) return;
        if (!TIMELINE_TEXT_FILE_RE.test(normalizedFilePath)) return;

        const cachedCorpusFiles = novelCorpusCacheRef.current.get(folderPath);
        if (!cachedCorpusFiles) {
          novelCorpusCacheRef.current.delete(folderPath);
          setNovelCorpusReloadToken((prev) => prev + 1);
          return;
        }

        try {
          const raw = await ipc.invoke('read-file', detail.filePath);
          if (cancelled) return;

          const nextItem: NovelCorpusFile = {
            path: detail.filePath,
            label: buildRelativeFileLabel(folderPath, detail.filePath),
            content: raw.trim(),
          };
          const withoutCurrent = cachedCorpusFiles.filter((item) => item.path !== detail.filePath);
          const nextCorpusFiles = nextItem.content ? [...withoutCurrent, nextItem] : withoutCurrent;
          nextCorpusFiles.sort((left, right) =>
            left.path.localeCompare(right.path, 'zh-CN', { numeric: true })
          );
          novelCorpusCacheRef.current.set(folderPath, nextCorpusFiles);
          setNovelCorpusFiles(nextCorpusFiles);
          setNovelCorpusError('');
        } catch {
          if (cancelled) return;
          novelCorpusCacheRef.current.delete(folderPath);
          setNovelCorpusReloadToken((prev) => prev + 1);
        }
      };

      document.addEventListener(NOVEL_EDITOR_FILE_SAVED_EVENT, handleFileSaved as EventListener);
      return () => {
        cancelled = true;
        document.removeEventListener(
          NOVEL_EDITOR_FILE_SAVED_EVENT,
          handleFileSaved as EventListener
        );
      };
    }, [folderPath]);

    useEffect(() => {
      if (!charactersLoaded) return;
      onCharactersChange?.(characters);
    }, [characters, charactersLoaded, onCharactersChange]);

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
      await ipc.invoke(
        'db-character-create',
        novelId,
        newName.trim(),
        newRole.trim(),
        newDesc.trim(),
        stringifyCharacterAttributes(
          {
            avatar: newAvatar || undefined,
            category: newCategory,
            highlightColor: newHighlightColor,
            highlightFirstMentionOnly: newHighlightFirstMentionOnly,
          },
          newRole.trim()
        )
      );
      await loadCharactersFromDb(novelId);
      setNewName('');
      setNewRole('');
      setNewCategory('major');
      setNewDesc('');
      setNewAvatar('');
      setNewHighlightColor(DEFAULT_CHARACTER_HIGHLIGHT_COLOR);
      setNewHighlightFirstMentionOnly(DEFAULT_CHARACTER_HIGHLIGHT_FIRST_MENTION_ONLY);
      setAdding(false);
    }, [
      loadCharactersFromDb,
      newDesc,
      newAvatar,
      newCategory,
      newHighlightColor,
      newHighlightFirstMentionOnly,
      newName,
      newRole,
      novelId,
    ]);

    const handleDelete = useCallback(
      async (index: number) => {
        const char = characters[index];
        if (!char) return;
        await window.electron?.ipcRenderer?.invoke('db-character-delete', char.id);
        if (novelId !== null) {
          await loadCharactersFromDb(novelId);
        }
      },
      [characters, loadCharactersFromDb, novelId]
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
        if (isImeComposing(e)) return;
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

    const handleUpdateCharacterAttributes = useCallback(
      async (
        characterId: number,
        patch: {
          category?: CharacterCategory;
          highlightColor?: string;
          highlightFirstMentionOnly?: boolean;
        }
      ) => {
        const ipc = window.electron?.ipcRenderer;
        const target = characters.find((item) => item.id === characterId);
        if (!ipc || !target) return;
        await ipc.invoke('db-character-update', characterId, {
          name: target.name,
          role: target.role,
          description: target.description,
          attributes: stringifyCharacterAttributes(
            {
              avatar: target.avatar,
              aliases: target.aliases,
              category: patch.category ?? target.category,
              highlightColor: patch.highlightColor ?? target.highlightColor,
              highlightFirstMentionOnly:
                typeof patch.highlightFirstMentionOnly === 'boolean'
                  ? patch.highlightFirstMentionOnly
                  : target.highlightFirstMentionOnly,
            },
            target.role
          ),
        });
        if (novelId !== null) {
          await loadCharactersFromDb(novelId);
        }
      },
      [characters, loadCharactersFromDb, novelId]
    );

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
    }, [content, folderPath, loadCharactersFromDb, novelId, persistRelations]);

    const selectedCharacter = characters.find((item) => item.id === selectedCharacterId) || null;

    useEffect(() => {
      if (!initialSelectedCharacterId) return;
      if (!characters.some((item) => item.id === initialSelectedCharacterId)) return;
      setSelectedCharacterId(initialSelectedCharacterId);
    }, [characters, initialSelectedCharacterId]);

    useEffect(() => {
      const ipc = window.electron?.ipcRenderer;
      const storageKey =
        selectedCharacterId !== null
          ? createCharacterTimelineStorageKey(novelId, selectedCharacterId)
          : null;
      if (!ipc || !storageKey) {
        setPersistedTimelineItems([]);
        return;
      }

      let cancelled = false;
      void ipc
        .invoke('db-settings-get', storageKey)
        .then((raw) => {
          if (cancelled) return;
          setPersistedTimelineItems(parseCharacterTimelineItems(raw as string | null));
        })
        .catch(() => {
          if (!cancelled) {
            setPersistedTimelineItems([]);
          }
        });

      return () => {
        cancelled = true;
      };
    }, [novelId, selectedCharacterId]);

    useEffect(() => {
      const ipc = window.electron?.ipcRenderer;
      const storageKey =
        selectedCharacterId !== null
          ? createCharacterTimelineOrderStorageKey(novelId, selectedCharacterId)
          : null;
      if (!ipc || !storageKey) {
        setPersistedTimelineOrderKeys([]);
        return;
      }

      let cancelled = false;
      void ipc
        .invoke('db-settings-get', storageKey)
        .then((raw) => {
          if (cancelled) return;
          setPersistedTimelineOrderKeys(parseTimelineOrderKeys(raw as string | null));
        })
        .catch(() => {
          if (!cancelled) {
            setPersistedTimelineOrderKeys([]);
          }
        });

      return () => {
        cancelled = true;
      };
    }, [novelId, selectedCharacterId]);

    useEffect(() => {
      setTimelineEditor(null);
      setTimelineDraftTitle('');
      setTimelineDraftSummary('');
      setTimelineDragIndex(null);
      setTimelineDropIndex(null);
    }, [selectedCharacterId]);

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
        grouped[camp].push({
          ...character,
          heat: estimateAppearanceHeat(debouncedContent, character.name),
        });
      });
      (Object.keys(grouped) as CharacterCamp[]).forEach((camp) => {
        grouped[camp].sort((a, b) => b.heat - a.heat);
      });
      return grouped;
    }, [characters, relations, debouncedContent]);

    const relationStageStats = useMemo(() => {
      const stats = new Map<string, number>();
      relations.forEach((item) => {
        const stage = inferRelationStage(item.note);
        stats.set(stage, (stats.get(stage) || 0) + 1);
      });
      return Array.from(stats.entries()).map(([stage, count]) => ({ stage, count }));
    }, [relations]);

    const focusedTimelineAuto = useMemo(() => {
      if (!selectedCharacter) return [];

      const sourceFiles =
        novelCorpusFiles.length > 0
          ? novelCorpusFiles
          : novelCorpusError && debouncedContent.trim()
            ? [
                {
                  path: '__current__',
                  label: '当前正文',
                  content: debouncedContent.trim(),
                } satisfies NovelCorpusFile,
              ]
            : [];

      return sourceFiles.flatMap((file) =>
        extractCharacterTimeline(file.content, [
          selectedCharacter.name,
          ...(selectedCharacter.aliases || []),
        ]).map((entry) => ({
          id: `${file.path}::${entry.key}`,
          autoKey: `${file.path}::${entry.key}`,
          title: `${file.label} · ${entry.title}`,
          summary: entry.summary,
          source: 'auto' as const,
          mentionCount: entry.mentionCount,
          sourceLabel: file.label,
        }))
      );
    }, [debouncedContent, novelCorpusError, novelCorpusFiles, selectedCharacter]);

    const focusedTimeline = useMemo(
      () =>
        mergeCharacterTimelineItems(
          focusedTimelineAuto,
          persistedTimelineItems,
          persistedTimelineOrderKeys
        ),
      [focusedTimelineAuto, persistedTimelineItems, persistedTimelineOrderKeys]
    );

    const persistCharacterTimelineItems = useCallback(
      async (characterId: number, nextItems: CharacterTimelineItem[]) => {
        const ipc = window.electron?.ipcRenderer;
        const storageKey = createCharacterTimelineStorageKey(novelId, characterId);
        if (!ipc || !storageKey) return;
        await ipc.invoke('db-settings-set', storageKey, JSON.stringify(nextItems));
        if (selectedCharacterId === characterId) {
          setPersistedTimelineItems(nextItems);
        }
      },
      [novelId, selectedCharacterId]
    );

    const persistCharacterTimelineOrderKeys = useCallback(
      async (characterId: number, nextOrderKeys: string[]) => {
        const ipc = window.electron?.ipcRenderer;
        const storageKey = createCharacterTimelineOrderStorageKey(novelId, characterId);
        if (!ipc || !storageKey) return;
        await ipc.invoke('db-settings-set', storageKey, JSON.stringify(nextOrderKeys));
        if (selectedCharacterId === characterId) {
          setPersistedTimelineOrderKeys(nextOrderKeys);
        }
      },
      [novelId, selectedCharacterId]
    );

    const resetTimelineEditor = useCallback(() => {
      setTimelineEditor(null);
      setTimelineDraftTitle('');
      setTimelineDraftSummary('');
    }, []);

    const handleStartEditTimelineItem = useCallback((item: CharacterTimelineItem) => {
      setTimelineEditor({
        itemId: item.id,
        mode: 'edit',
        source: item.source,
        autoKey: item.autoKey,
        sourceLabel: item.sourceLabel,
      });
      setTimelineDraftTitle(item.title);
      setTimelineDraftSummary(item.summary);
    }, []);

    const handleStartCreateManualTimelineItem = useCallback(() => {
      const itemId = `manual-${Date.now()}`;
      setTimelineEditor({
        itemId,
        mode: 'create-manual',
        source: 'manual',
        sourceLabel: '手工整理',
      });
      setTimelineDraftTitle('');
      setTimelineDraftSummary('');
    }, []);

    const hasTimelineOverride = useCallback(
      (item: CharacterTimelineItem) => {
        return persistedTimelineItems.some(
          (saved) => saved.id === item.id || (item.autoKey && saved.autoKey === item.autoKey)
        );
      },
      [persistedTimelineItems]
    );

    const handleSaveTimelineItem = useCallback(async () => {
      if (!selectedCharacter || !timelineEditor) return;

      const title = timelineDraftTitle.trim();
      const summary = timelineDraftSummary.trim();
      if (!title || !summary) return;

      const focusedItem = focusedTimeline.find((item) => item.id === timelineEditor.itemId) || null;
      const nextItem: CharacterTimelineItem = {
        id: timelineEditor.itemId,
        title,
        summary,
        source: timelineEditor.source,
        autoKey: timelineEditor.autoKey || focusedItem?.autoKey,
        mentionCount:
          timelineEditor.source === 'auto' ? (focusedItem?.mentionCount ?? 0) : undefined,
        sourceLabel: timelineEditor.sourceLabel || focusedItem?.sourceLabel,
      };

      const nextPersistedItems = [...persistedTimelineItems];
      const existingIndex = nextPersistedItems.findIndex(
        (item) => item.id === nextItem.id || (nextItem.autoKey && item.autoKey === nextItem.autoKey)
      );

      if (existingIndex >= 0) {
        nextPersistedItems.splice(existingIndex, 1, nextItem);
      } else {
        nextPersistedItems.push(nextItem);
      }

      const nextOrderKeys =
        persistedTimelineOrderKeys.length > 0
          ? [...persistedTimelineOrderKeys]
          : focusedTimeline.map((item) => getCharacterTimelineOrderKey(item));
      const nextOrderKey = getCharacterTimelineOrderKey(nextItem);
      const shouldAppendToOrder =
        timelineEditor.mode === 'create-manual' && !nextOrderKeys.includes(nextOrderKey);
      if (shouldAppendToOrder) {
        nextOrderKeys.push(nextOrderKey);
      }

      setTimelineSaving(true);
      try {
        await persistCharacterTimelineItems(selectedCharacter.id, nextPersistedItems);
        if (shouldAppendToOrder) {
          await persistCharacterTimelineOrderKeys(selectedCharacter.id, nextOrderKeys);
        }
        resetTimelineEditor();
      } finally {
        setTimelineSaving(false);
      }
    }, [
      focusedTimeline,
      persistedTimelineItems,
      persistCharacterTimelineItems,
      persistCharacterTimelineOrderKeys,
      persistedTimelineOrderKeys,
      resetTimelineEditor,
      selectedCharacter,
      timelineDraftSummary,
      timelineDraftTitle,
      timelineEditor,
    ]);

    const handleRestoreAutoTimelineItem = useCallback(
      async (item: CharacterTimelineItem) => {
        if (!selectedCharacter || !item.autoKey) return;
        const nextPersistedItems = persistedTimelineItems.filter(
          (saved) => saved.id !== item.id && saved.autoKey !== item.autoKey
        );
        await persistCharacterTimelineItems(selectedCharacter.id, nextPersistedItems);
        if (timelineEditor?.itemId === item.id) {
          resetTimelineEditor();
        }
      },
      [
        persistedTimelineItems,
        persistCharacterTimelineItems,
        resetTimelineEditor,
        selectedCharacter,
        timelineEditor,
      ]
    );

    const handleDeleteManualTimelineItem = useCallback(
      async (itemId: string) => {
        if (!selectedCharacter) return;
        const nextPersistedItems = persistedTimelineItems.filter((item) => item.id !== itemId);
        const nextOrderKeys = persistedTimelineOrderKeys.filter((key) => key !== itemId);
        await persistCharacterTimelineItems(selectedCharacter.id, nextPersistedItems);
        await persistCharacterTimelineOrderKeys(selectedCharacter.id, nextOrderKeys);
        if (timelineEditor?.itemId === itemId) {
          resetTimelineEditor();
        }
      },
      [
        persistedTimelineItems,
        persistedTimelineOrderKeys,
        persistCharacterTimelineItems,
        persistCharacterTimelineOrderKeys,
        resetTimelineEditor,
        selectedCharacter,
        timelineEditor,
      ]
    );

    const handleTimelineDragStart = useCallback(
      (event: React.DragEvent<HTMLButtonElement>, index: number) => {
        if (timelineEditor) {
          event.preventDefault();
          return;
        }
        setTimelineDragIndex(index);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(index));
      },
      [timelineEditor]
    );

    const handleTimelineDragEnd = useCallback(() => {
      setTimelineDragIndex(null);
      setTimelineDropIndex(null);
    }, []);

    const handleTimelineDragOver = useCallback(
      (event: React.DragEvent<HTMLDivElement>, index: number) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        if (timelineDragIndex === null || timelineDragIndex === index) return;
        setTimelineDropIndex(index);
      },
      [timelineDragIndex]
    );

    const handleTimelineDrop = useCallback(
      async (event: React.DragEvent<HTMLDivElement>, targetIndex: number) => {
        event.preventDefault();
        if (!selectedCharacter || timelineDragIndex === null || timelineDragIndex === targetIndex) {
          setTimelineDragIndex(null);
          setTimelineDropIndex(null);
          return;
        }

        const reordered = [...focusedTimeline];
        const [movedItem] = reordered.splice(timelineDragIndex, 1);
        reordered.splice(targetIndex, 0, movedItem);
        const nextOrderKeys = reordered.map((item) => getCharacterTimelineOrderKey(item));

        await persistCharacterTimelineOrderKeys(selectedCharacter.id, nextOrderKeys);
        setTimelineDragIndex(null);
        setTimelineDropIndex(null);
      },
      [focusedTimeline, persistCharacterTimelineOrderKeys, selectedCharacter, timelineDragIndex]
    );

    const filteredCharacters = useMemo(() => {
      const normalizedSearch = characterSearch.trim().toLowerCase();
      return characters.filter((character) => {
        if (categoryFilter !== 'all' && character.category !== categoryFilter) {
          return false;
        }
        if (!normalizedSearch) {
          return true;
        }
        return `${character.name} ${character.role} ${character.description} ${(character.aliases || []).join(' ')}`
          .toLowerCase()
          .includes(normalizedSearch);
      });
    }, [categoryFilter, characterSearch, characters]);

    const categorizedCharacterEntries = useMemo(() => {
      const grouped: Record<CharacterCategory, Array<{ character: Character; index: number }>> = {
        major: [],
        secondary: [],
      };
      filteredCharacters.forEach((character) => {
        const index = characters.findIndex((item) => item.id === character.id);
        if (index < 0) return;
        grouped[character.category].push({ character, index });
      });
      return grouped;
    }, [characters, filteredCharacters]);

    const handleBulkApplyCategory = useCallback(
      async (nextCategory: CharacterCategory) => {
        const ipc = window.electron?.ipcRenderer;
        if (!ipc || novelId === null || filteredCharacters.length === 0) return;
        setBulkUpdatingCategory(nextCategory);
        try {
          await Promise.all(
            filteredCharacters.map((character) =>
              ipc.invoke('db-character-update', character.id, {
                name: character.name,
                role: character.role,
                description: character.description,
                attributes: stringifyCharacterAttributes(
                  {
                    avatar: character.avatar,
                    aliases: character.aliases,
                    category: nextCategory,
                    highlightColor: character.highlightColor,
                    highlightFirstMentionOnly: character.highlightFirstMentionOnly,
                  },
                  character.role
                ),
              })
            )
          );
          await loadCharactersFromDb(novelId);
        } finally {
          setBulkUpdatingCategory(null);
        }
      },
      [filteredCharacters, loadCharactersFromDb, novelId]
    );

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
            <span className={styles.metricChip}>筛选结果 {filteredCharacters.length}</span>
            <span className={styles.metricChip}>关系 {links.length}</span>
          </div>
          <div className={styles.characterHeroStatus}>
            {aiStatus || '可以从正文直接抽取角色与关系'}
          </div>
        </div>
        <div className={styles.characterToolbar}>
          <input
            value={characterSearch}
            onChange={(event) => setCharacterSearch(event.target.value)}
            placeholder="快速筛选人物、定位、描述或别名"
            className={styles.formInput}
          />
          <div className={styles.filterChipRow}>
            {(
              [
                ['all', '全部'],
                ['major', '主要角色'],
                ['secondary', '次要角色'],
              ] as Array<[CharacterCategoryFilter, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`${styles.filterChip} ${categoryFilter === value ? styles.filterChipActive : ''}`}
                onClick={() => setCategoryFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className={styles.bulkActionRow}>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={filteredCharacters.length === 0 || bulkUpdatingCategory !== null}
              onClick={() => void handleBulkApplyCategory('major')}
            >
              {bulkUpdatingCategory === 'major' ? '批量处理中...' : '批量设为主要角色'}
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={filteredCharacters.length === 0 || bulkUpdatingCategory !== null}
              onClick={() => void handleBulkApplyCategory('secondary')}
            >
              {bulkUpdatingCategory === 'secondary' ? '批量处理中...' : '批量设为次要角色'}
            </button>
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
              onChange={(e) => {
                const nextRole = e.target.value;
                setNewRole(nextRole);
                setNewCategory(inferCharacterCategoryFromRole(nextRole));
              }}
              onKeyDown={handleKeyDown}
              className={styles.formInput}
            />
            <label className={styles.categoryField}>
              <span className={styles.highlightFieldLabel}>人物分类</span>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as CharacterCategory)}
                className={styles.formInput}
              >
                <option value="major">主要角色</option>
                <option value="secondary">次要角色</option>
              </select>
            </label>
            <textarea
              placeholder="角色描述、设定..."
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className={styles.formTextarea}
              rows={3}
            />
            <div className={styles.highlightConfigRow}>
              <label className={styles.highlightColorField}>
                <span className={styles.highlightFieldLabel}>正文高亮颜色</span>
                <input
                  type="color"
                  value={newHighlightColor}
                  onChange={(e) => setNewHighlightColor(e.target.value)}
                  className={styles.colorInput}
                />
              </label>
              <label className={styles.highlightToggle}>
                <input
                  type="checkbox"
                  checked={newHighlightFirstMentionOnly}
                  onChange={(e) => setNewHighlightFirstMentionOnly(e.target.checked)}
                />
                <span>仅在每章第一次出现时高亮</span>
              </label>
            </div>
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
        {characters.length > 0 && filteredCharacters.length === 0 && !adding && (
          <div className={styles.emptyHint}>
            当前筛选条件下没有角色
            <br />
            <span className={styles.hintSub}>可以切换分类筛选，或清空搜索关键词</span>
          </div>
        )}
        <div className={styles.cardsContainer}>
          {(Object.keys(categorizedCharacterEntries) as CharacterCategory[]).map((category) => {
            const entries = categorizedCharacterEntries[category];
            if (entries.length === 0) return null;
            return (
              <div key={category} className={styles.characterCategoryGroup}>
                <div className={styles.characterCategoryHeader}>
                  <span>{CHARACTER_CATEGORY_LABELS[category]}</span>
                  <span className={styles.metricChip}>{entries.length}</span>
                </div>
                {entries.map(({ character, index }) => (
                  <CharacterCard
                    key={character.id}
                    character={character}
                    index={index}
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
              </div>
            );
          })}
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

    const detailMode = initialSelectedCharacterId !== null;
    const focusedCharacter = selectedCharacter;
    const focusedCamp = focusedCharacter ? inferCharacterCamp(focusedCharacter, relations) : null;
    const focusedHeat = focusedCharacter
      ? estimateAppearanceHeat(debouncedContent, focusedCharacter.name)
      : 0;
    const activeCampCount = Object.values(clusteredCharacters).filter(
      (items) => items.length > 0
    ).length;
    const focusedTimelineEditedCount = focusedTimeline.filter((item) =>
      hasTimelineOverride(item)
    ).length;

    if (detailMode) {
      return (
        <div className={styles.objectWorkspace}>
          {focusedCharacter ? (
            <>
              <section className={styles.workspaceHero}>
                <div className={styles.workspaceEyebrow}>人物资料</div>
                <h2 className={styles.workspaceTitle}>{focusedCharacter.name}</h2>
                <p className={styles.workspaceDesc}>
                  {focusedTimeline.length > 0
                    ? `已从整个作品目录中按顺序整理出 ${focusedTimeline.length} 段关键经历，覆盖前期到后期的主要推进。`
                    : focusedCharacter.description || '这个人物还没有补充详细描述。'}
                </p>
                <div className={styles.workspaceMetaRow}>
                  <span className={styles.workspaceChip}>
                    分类 {CHARACTER_CATEGORY_LABELS[focusedCharacter.category]}
                  </span>
                  <span className={styles.workspaceChip}>
                    角色定位 {focusedCharacter.role || '未填写'}
                  </span>
                  <span className={styles.workspaceChip}>阵营 {focusedCamp || 'support'}</span>
                  <span className={styles.workspaceChip}>正文热度 {focusedHeat}</span>
                  <span className={styles.workspaceChip}>关系 {selectedRelations.length}</span>
                  <span className={styles.workspaceChip}>经历节点 {focusedTimeline.length}</span>
                  <span className={styles.workspaceChip}>
                    手工修订 {focusedTimelineEditedCount}
                  </span>
                  <span className={styles.workspaceChip}>作品正文 {novelCorpusFiles.length}</span>
                </div>
              </section>

              <section className={styles.workspaceCardShell}>
                <div className={styles.workspaceCardHeader}>
                  <span className={styles.workspaceSectionTitle}>经历时间线</span>
                  <div className={styles.characterTimelineHeaderActions}>
                    <span className={styles.workspaceListHint}>
                      按整个作品目录的正文顺序自动提取，可拖动左侧手柄重排，也可直接手工修订和补充
                    </span>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={handleStartCreateManualTimelineItem}
                    >
                      新增手工条目
                    </button>
                  </div>
                </div>
                {novelCorpusLoading ? (
                  <div className={styles.workspaceBodyCopy}>正在汇总整个作品目录中的正文内容…</div>
                ) : novelCorpusError ? (
                  <div className={styles.emptyHint}>作品语料加载失败：{novelCorpusError}</div>
                ) : focusedTimeline.length > 0 ? (
                  <div className={styles.characterTimelineList}>
                    {focusedTimeline.map((item, index) => {
                      const isEditing = timelineEditor?.itemId === item.id;
                      const isManualItem = item.source === 'manual';
                      const hasManualRevision = item.source === 'auto' && hasTimelineOverride(item);

                      return (
                        <div
                          key={item.id}
                          className={`${styles.characterTimelineItem} ${
                            timelineDragIndex === index ? styles.characterTimelineDragging : ''
                          } ${timelineDropIndex === index ? styles.characterTimelineDropTarget : ''}`}
                          onDragOver={(event) => handleTimelineDragOver(event, index)}
                          onDrop={(event) => void handleTimelineDrop(event, index)}
                        >
                          <div className={styles.characterTimelineMarker}>
                            <button
                              type="button"
                              className={styles.characterTimelineHandle}
                              title={isEditing ? '编辑中不可拖拽' : '拖拽排序'}
                              aria-label={isEditing ? '编辑中不可拖拽' : '拖拽排序'}
                              draggable={!isEditing}
                              disabled={isEditing}
                              onDragStart={(event) => handleTimelineDragStart(event, index)}
                              onDragEnd={handleTimelineDragEnd}
                            >
                              <span
                                className={styles.characterTimelineHandleDots}
                                aria-hidden="true"
                              >
                                <span className={styles.characterTimelineHandleDot} />
                                <span className={styles.characterTimelineHandleDot} />
                                <span className={styles.characterTimelineHandleDot} />
                                <span className={styles.characterTimelineHandleDot} />
                                <span className={styles.characterTimelineHandleDot} />
                                <span className={styles.characterTimelineHandleDot} />
                              </span>
                            </button>
                            <div className={styles.characterTimelineIndexBadge}>
                              {String(index + 1).padStart(2, '0')}
                            </div>
                          </div>
                          <div className={styles.characterTimelineBody}>
                            <div className={styles.characterTimelineHeader}>
                              <div>
                                <div className={styles.characterTimelineTitleRow}>
                                  <div className={styles.workspaceListTitle}>{item.title}</div>
                                  {isManualItem && (
                                    <span className={styles.characterTimelineManualBadge}>
                                      手工整理
                                    </span>
                                  )}
                                  {hasManualRevision && (
                                    <span className={styles.characterTimelineEditedBadge}>
                                      已手工修订
                                    </span>
                                  )}
                                </div>
                                {item.sourceLabel && (
                                  <div className={styles.characterTimelineSource}>
                                    {item.sourceLabel}
                                  </div>
                                )}
                              </div>
                              <div className={styles.characterTimelineMeta}>
                                {item.source === 'manual'
                                  ? '手工条目'
                                  : `提及 ${item.mentionCount || 0} 次`}
                              </div>
                            </div>
                            {timelineEditor?.itemId === item.id ? (
                              <div className={styles.characterTimelineEditor}>
                                <input
                                  value={timelineDraftTitle}
                                  onChange={(event) => setTimelineDraftTitle(event.target.value)}
                                  placeholder="经历标题，例如：第三卷 · 身份暴露"
                                  className={styles.formInput}
                                />
                                <textarea
                                  value={timelineDraftSummary}
                                  onChange={(event) => setTimelineDraftSummary(event.target.value)}
                                  placeholder="补充这一段经历的真正变化、结果和影响"
                                  className={styles.formTextarea}
                                  rows={4}
                                />
                                <div className={styles.characterTimelineActionRow}>
                                  <button
                                    type="button"
                                    className={styles.submitButton}
                                    disabled={timelineSaving}
                                    onClick={() => void handleSaveTimelineItem()}
                                  >
                                    {timelineSaving ? '保存中...' : '保存修订'}
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.secondaryButton}
                                    onClick={resetTimelineEditor}
                                  >
                                    取消
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className={styles.workspaceListDesc}>{item.summary}</div>
                                <div className={styles.characterTimelineActionRow}>
                                  <button
                                    type="button"
                                    className={styles.secondaryButton}
                                    onClick={() => handleStartEditTimelineItem(item)}
                                  >
                                    手工修订
                                  </button>
                                  {item.source === 'auto' && hasTimelineOverride(item) && (
                                    <button
                                      type="button"
                                      className={styles.secondaryButton}
                                      onClick={() => void handleRestoreAutoTimelineItem(item)}
                                    >
                                      恢复自动
                                    </button>
                                  )}
                                  {item.source === 'manual' && (
                                    <button
                                      type="button"
                                      className={styles.secondaryButton}
                                      onClick={() => void handleDeleteManualTimelineItem(item.id)}
                                    >
                                      删除条目
                                    </button>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className={styles.emptyHint}>
                    整个作品目录里还没有抽取到这个人物的明确经历。
                  </div>
                )}
              </section>

              {focusedCharacter.description && (
                <section className={styles.workspaceCardShell}>
                  <div className={styles.workspaceCardHeader}>
                    <span className={styles.workspaceSectionTitle}>资料摘要</span>
                    <span className={styles.workspaceListHint}>
                      保留资料库中的原始描述，便于后续手工修订
                    </span>
                  </div>
                  <div className={styles.workspaceBodyCopy}>{focusedCharacter.description}</div>
                </section>
              )}

              <section className={styles.workspaceCardShell}>
                <div className={styles.workspaceCardHeader}>
                  <span className={styles.workspaceSectionTitle}>正文高亮</span>
                  <span className={styles.workspaceListHint}>控制角色名在正文中的强调方式</span>
                </div>
                <div className={styles.highlightConfigPanel}>
                  <label className={styles.categoryField}>
                    <span className={styles.highlightFieldLabel}>人物分类</span>
                    <select
                      value={focusedCharacter.category}
                      onChange={(event) =>
                        void handleUpdateCharacterAttributes(focusedCharacter.id, {
                          category: event.target.value as CharacterCategory,
                        })
                      }
                      className={styles.formInput}
                    >
                      <option value="major">主要角色</option>
                      <option value="secondary">次要角色</option>
                    </select>
                  </label>
                  <label className={styles.highlightColorField}>
                    <span className={styles.highlightFieldLabel}>高亮颜色</span>
                    <div className={styles.highlightColorControl}>
                      <input
                        type="color"
                        value={focusedCharacter.highlightColor || DEFAULT_CHARACTER_HIGHLIGHT_COLOR}
                        onChange={(event) =>
                          void handleUpdateCharacterAttributes(focusedCharacter.id, {
                            highlightColor: event.target.value,
                          })
                        }
                        className={styles.colorInput}
                      />
                      <span className={styles.highlightColorValue}>
                        {(
                          focusedCharacter.highlightColor || DEFAULT_CHARACTER_HIGHLIGHT_COLOR
                        ).toUpperCase()}
                      </span>
                    </div>
                  </label>
                  <label className={styles.highlightToggle}>
                    <input
                      type="checkbox"
                      checked={focusedCharacter.highlightFirstMentionOnly !== false}
                      onChange={(event) =>
                        void handleUpdateCharacterAttributes(focusedCharacter.id, {
                          highlightFirstMentionOnly: event.target.checked,
                        })
                      }
                    />
                    <span>仅在每章第一次出现时高亮</span>
                  </label>
                </div>
              </section>

              <section className={styles.workspaceCardShell}>
                <div className={styles.workspaceCardHeader}>
                  <span className={styles.workspaceSectionTitle}>人物关系</span>
                  <span className={styles.workspaceListHint}>围绕当前人物的出场关系</span>
                </div>
                {selectedRelations.length > 0 ? (
                  <div className={styles.workspaceList}>
                    {selectedRelations.map((relation) => {
                      const otherId =
                        relation.sourceId === focusedCharacter.id
                          ? relation.targetId
                          : relation.sourceId;
                      const otherCharacter = characters.find((item) => item.id === otherId);
                      return (
                        <div key={relation.id} className={styles.workspaceListItem}>
                          <div className={styles.workspaceListTitle}>
                            {otherCharacter?.name || '未匹配人物'}
                          </div>
                          <div className={styles.workspaceListDesc}>
                            {relation.label}
                            {relation.note ? ` · ${relation.note}` : ''}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className={styles.emptyHint}>这个人物还没有整理关系。</div>
                )}
              </section>

              <section className={styles.workspaceCardShell}>
                <div className={styles.workspaceCardHeader}>
                  <span className={styles.workspaceSectionTitle}>人物网络</span>
                  <span className={styles.workspaceListHint}>保留当前人物的关系编辑能力</span>
                </div>
                {graphView}
              </section>
            </>
          ) : (
            <div className={styles.emptyHint}>没有找到对应人物，可能已经被删除。</div>
          )}
        </div>
      );
    }

    return (
      <div className={styles.objectWorkspace}>
        <section className={styles.workspaceHero}>
          <div className={styles.workspaceEyebrow}>人物中枢</div>
          <h2 className={styles.workspaceTitle}>人物与关系</h2>
          <p className={styles.workspaceDesc}>
            在这里集中维护出场人物、阵营关系和正文热度，保证章节里的角色关系始终清楚。
          </p>
          <div className={styles.workspaceMetaRow}>
            <span className={styles.workspaceChip}>人物 {characters.length}</span>
            <span className={styles.workspaceChip}>关系 {links.length}</span>
            <span className={styles.workspaceChip}>阵营 {activeCampCount}</span>
          </div>
        </section>
        <section className={styles.workspaceCardShell}>{cardsView}</section>
        <section className={styles.workspaceCardShell}>{graphView}</section>
      </div>
    );
  }
);
