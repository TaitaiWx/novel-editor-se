import React, { useCallback, useMemo, useRef, useState } from 'react';
import type { Character, CharacterCategory } from '../types';
import {
  DEFAULT_CHARACTER_HIGHLIGHT_COLOR,
  DEFAULT_CHARACTER_HIGHLIGHT_FIRST_MENTION_ONLY,
  stringifyCharacterAttributes,
} from '../utils';
import { isImeComposing } from '../../../utils/ime';
import type { CharacterCategoryFilter } from './helpers';

/**
 * 人物列表编辑：新增表单、拖拽排序、分类筛选与批量设置分类。
 */
export function useCharacterListEditor({
  characters,
  setCharacters,
  novelId,
  loadCharactersFromDb,
}: {
  characters: Character[];
  setCharacters: React.Dispatch<React.SetStateAction<Character[]>>;
  novelId: number | null;
  loadCharactersFromDb: (targetNovelId: number) => Promise<Character[]>;
}) {
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
  const [categoryFilter, setCategoryFilter] = useState<CharacterCategoryFilter>('all');
  const [characterSearch, setCharacterSearch] = useState('');
  const [bulkUpdatingCategory, setBulkUpdatingCategory] = useState<CharacterCategory | null>(null);
  const dragCounter = useRef(0);
  const avatarInputRef = useRef<HTMLInputElement>(null);

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
    [dragIndex, setCharacters]
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
                  currentState: character.currentState,
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

  return {
    adding,
    toggleAdding,
    newName,
    setNewName,
    newRole,
    setNewRole,
    newCategory,
    setNewCategory,
    newDesc,
    setNewDesc,
    newAvatar,
    newHighlightColor,
    setNewHighlightColor,
    newHighlightFirstMentionOnly,
    setNewHighlightFirstMentionOnly,
    avatarInputRef,
    handleAvatarSelect,
    handleAdd,
    handleKeyDown,
    dragIndex,
    dropIndex,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    categoryFilter,
    setCategoryFilter,
    characterSearch,
    setCharacterSearch,
    bulkUpdatingCategory,
    filteredCharacters,
    categorizedCharacterEntries,
    handleBulkApplyCategory,
  };
}

export type CharacterListEditor = ReturnType<typeof useCharacterListEditor>;
