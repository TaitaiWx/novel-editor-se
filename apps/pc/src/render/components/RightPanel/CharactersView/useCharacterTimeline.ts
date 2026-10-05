import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { extractCharacterTimeline } from '@novel-editor/basic-algorithm';
import type { Character, CharacterTimelineItem } from '../types';
import {
  createCharacterTimelineOrderStorageKey,
  createCharacterTimelineStorageKey,
  getCharacterTimelineOrderKey,
  mergeCharacterTimelineItems,
  parseCharacterTimelineItems,
  parseTimelineOrderKeys,
} from '../utils';
import {
  stripTimelineFileExtension,
  type NovelCorpusFile,
  type TimelineEditorState,
} from './helpers';

/**
 * 人物经历时间线：自动抽取 + 手工修订/补充 + 拖拽排序，修订与顺序持久化到设置表。
 */
export function useCharacterTimeline({
  novelId,
  selectedCharacterId,
  selectedCharacter,
  debouncedContent,
  novelCorpusFiles,
  novelCorpusError,
  onOpenSourceLocation,
}: {
  novelId: number | null;
  selectedCharacterId: number | null;
  selectedCharacter: Character | null;
  debouncedContent: string;
  novelCorpusFiles: NovelCorpusFile[];
  novelCorpusError: string;
  onOpenSourceLocation?: (filePath: string, line: number, contentKey?: string) => void;
}) {
  const [persistedTimelineItems, setPersistedTimelineItems] = useState<CharacterTimelineItem[]>([]);
  const [persistedTimelineOrderKeys, setPersistedTimelineOrderKeys] = useState<string[]>([]);
  const [timelineEditor, setTimelineEditor] = useState<TimelineEditorState | null>(null);
  const [timelineDraftChapterLabel, setTimelineDraftChapterLabel] = useState('');
  const [timelineDraftTitle, setTimelineDraftTitle] = useState('');
  const [timelineDraftSummary, setTimelineDraftSummary] = useState('');
  const [timelineSaving, setTimelineSaving] = useState(false);
  const [timelineDragIndex, setTimelineDragIndex] = useState<number | null>(null);
  const [timelineDropIndex, setTimelineDropIndex] = useState<number | null>(null);

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
    setTimelineDraftChapterLabel('');
    setTimelineDraftTitle('');
    setTimelineDraftSummary('');
    setTimelineDragIndex(null);
    setTimelineDropIndex(null);
  }, [selectedCharacterId]);

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
      extractCharacterTimeline(
        file.content,
        [selectedCharacter.name, ...(selectedCharacter.aliases || [])],
        {
          fallbackChapterLabel: stripTimelineFileExtension(file.label),
        }
      ).map((entry) => ({
        id: `${file.path}::${entry.key}`,
        autoKey: `${file.path}::${entry.key}`,
        title: entry.title,
        summary: entry.summary,
        source: 'auto' as const,
        chapterLabel: entry.chapterLabel,
        chapterNumber: entry.chapterNumber,
        sourcePath: file.path,
        startLine: entry.startLine,
        endLine: entry.endLine,
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
    setTimelineDraftChapterLabel('');
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
    setTimelineDraftChapterLabel(item.chapterLabel || '');
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
    setTimelineDraftChapterLabel('');
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
    const chapterLabel = timelineDraftChapterLabel.trim();
    if (!title || !summary) return;

    const focusedItem = focusedTimeline.find((item) => item.id === timelineEditor.itemId) || null;
    const nextItem: CharacterTimelineItem = {
      id: timelineEditor.itemId,
      title,
      summary,
      source: timelineEditor.source,
      autoKey: timelineEditor.autoKey || focusedItem?.autoKey,
      chapterLabel: chapterLabel || focusedItem?.chapterLabel,
      chapterNumber: focusedItem?.chapterNumber,
      sourcePath: focusedItem?.sourcePath,
      startLine: focusedItem?.startLine,
      endLine: focusedItem?.endLine,
      mentionCount: timelineEditor.source === 'auto' ? (focusedItem?.mentionCount ?? 0) : undefined,
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
    timelineDraftChapterLabel,
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

  const handleOpenTimelineSource = useCallback(
    (item: CharacterTimelineItem) => {
      if (!onOpenSourceLocation || !item.sourcePath || !item.startLine) return;
      if (item.sourcePath.startsWith('__')) {
        onOpenSourceLocation(item.sourcePath, item.startLine, item.autoKey || item.id);
        return;
      }
      onOpenSourceLocation(item.sourcePath, item.startLine, item.autoKey || item.id);
    },
    [onOpenSourceLocation]
  );

  return {
    focusedTimeline,
    timelineEditor,
    timelineDraftChapterLabel,
    setTimelineDraftChapterLabel,
    timelineDraftTitle,
    setTimelineDraftTitle,
    timelineDraftSummary,
    setTimelineDraftSummary,
    timelineSaving,
    timelineDragIndex,
    timelineDropIndex,
    resetTimelineEditor,
    handleStartEditTimelineItem,
    handleStartCreateManualTimelineItem,
    hasTimelineOverride,
    handleSaveTimelineItem,
    handleRestoreAutoTimelineItem,
    handleDeleteManualTimelineItem,
    handleTimelineDragStart,
    handleTimelineDragEnd,
    handleTimelineDragOver,
    handleTimelineDrop,
    handleOpenTimelineSource,
  };
}

export type CharacterTimelineController = ReturnType<typeof useCharacterTimeline>;
