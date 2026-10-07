import type { CharacterDesign, MediaItem } from '@novel-editor/core/entity-media';
import { useCallback, useEffect, useState } from 'react';
import type { Character, CharacterCategory, CharacterCurrentStateItem } from '../types';
import { mapCharacterRows, stringifyCharacterAttributes } from '../utils';

/**
 * 人物根数据：按作品目录加载人物列表，提供删除与属性更新能力。
 */
export function useCharacterStore({
  folderPath,
  onCharactersChange,
}: {
  folderPath: string | null;
  onCharactersChange?: (characters: Character[]) => void;
}) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [novelId, setNovelId] = useState<number | null>(null);
  const [charactersLoaded, setCharactersLoaded] = useState(false);

  const loadCharactersFromDb = useCallback(async (targetNovelId: number): Promise<Character[]> => {
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
  }, []);

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
      if (cancelled) return;
      if (!novel) {
        // 目录没有对应作品记录：清空上一个项目遗留的人物与 novelId，避免后续操作作用到旧项目
        setCharacters([]);
        setNovelId(null);
        setCharactersLoaded(true);
        return;
      }
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
    if (!charactersLoaded) return;
    onCharactersChange?.(characters);
  }, [characters, charactersLoaded, onCharactersChange]);

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

  const handleUpdateCharacterAttributes = useCallback(
    async (
      characterId: number,
      patch: {
        category?: CharacterCategory;
        highlightColor?: string;
        highlightFirstMentionOnly?: boolean;
        currentState?: CharacterCurrentStateItem[];
        /** 形象图（相对作品目录的路径或 data URL） */
        avatar?: string;
        design?: CharacterDesign;
        media?: MediaItem[];
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
            avatar: patch.avatar ?? target.avatar,
            design: patch.design ?? target.design,
            media: patch.media ?? target.media,
            aliases: target.aliases,
            category: patch.category ?? target.category,
            highlightColor: patch.highlightColor ?? target.highlightColor,
            highlightFirstMentionOnly:
              typeof patch.highlightFirstMentionOnly === 'boolean'
                ? patch.highlightFirstMentionOnly
                : target.highlightFirstMentionOnly,
            currentState: patch.currentState ?? target.currentState,
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

  return {
    characters,
    setCharacters,
    novelId,
    loadCharactersFromDb,
    handleDelete,
    handleUpdateCharacterAttributes,
  };
}
