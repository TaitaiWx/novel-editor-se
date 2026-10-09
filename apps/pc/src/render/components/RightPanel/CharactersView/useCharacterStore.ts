import type { CharacterDesign, MediaItem } from '@novel-editor/core/entity-media';
import type { CharacterVoice } from '@novel-editor/video';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Character, CharacterCategory, CharacterCurrentStateItem } from '../types';
import { mapCharacterRows } from '../utils';

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
  const scopeRef = useRef<{
    folderPath: string | null;
    novelId: number | null;
    loadSequence: number;
    active: boolean;
  } | null>(null);

  const loadCharactersFromDb = useCallback(async (targetNovelId: number): Promise<Character[]> => {
    const ipc = window.electron?.ipcRenderer;
    const scope = scopeRef.current;
    if (!ipc || !scope?.active || scope.novelId !== targetNovelId) return [];
    const sequence = ++scope.loadSequence;
    const rows = (await ipc.invoke('db-character-list', targetNovelId)) as Array<{
      id: number;
      name: string;
      role: string;
      description: string;
      attributes: string;
    }>;
    const nextCharacters = mapCharacterRows(rows);
    if (scope.active && scopeRef.current === scope && scope.loadSequence === sequence) {
      setCharacters(nextCharacters);
      setCharactersLoaded(true);
    }
    return nextCharacters;
  }, []);

  useEffect(() => {
    const scope = { folderPath, novelId: null as number | null, loadSequence: 0, active: true };
    scopeRef.current = scope;
    setCharacters([]);
    setNovelId(null);
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
      scope.novelId = nid;
      setNovelId(nid);
      if (cancelled) return;
      await loadCharactersFromDb(nid);
    })();
    return () => {
      cancelled = true;
      scope.active = false;
    };
  }, [folderPath, loadCharactersFromDb]);

  useEffect(() => {
    if (!charactersLoaded) return;
    onCharactersChange?.(characters);
  }, [characters, charactersLoaded, onCharactersChange]);

  const handleDelete = useCallback(
    async (index: number) => {
      const char = characters[index];
      const scope = scopeRef.current;
      if (!char || !scope?.active || scope.folderPath !== folderPath) return;
      await window.electron?.ipcRenderer?.invoke('db-character-delete', char.id);
      if (novelId !== null && scopeRef.current === scope && scope.active) {
        await loadCharactersFromDb(novelId);
      }
    },
    [characters, folderPath, loadCharactersFromDb, novelId]
  );

  const handleUpdateCharacterAttributes = useCallback(
    async (
      characterId: number,
      patch: {
        category?: CharacterCategory;
        /** 分组名（空字符串清除自定义分组） */
        group?: string;
        highlightColor?: string;
        highlightFirstMentionOnly?: boolean;
        currentState?: CharacterCurrentStateItem[];
        /** 形象图（相对作品目录的路径或 data URL） */
        avatar?: string;
        design?: CharacterDesign;
        designPatch?: Partial<CharacterDesign>;
        designExpected?: Partial<CharacterDesign>;
        media?: MediaItem[];
        voice?: CharacterVoice;
      }
    ) => {
      const ipc = window.electron?.ipcRenderer;
      const scope = scopeRef.current;
      const target = characters.find((item) => item.id === characterId);
      if (!ipc || !target || !scope?.active || scope.folderPath !== folderPath)
        throw new Error('人物已切换或当前无法保存，请重试');
      if (patch.designPatch) {
        try {
          await ipc.invoke(
            'db-character-patch-design',
            characterId,
            patch.designPatch,
            patch.designExpected ?? {}
          );
        } catch (error) {
          if (novelId !== null && scopeRef.current === scope && scope.active)
            await loadCharactersFromDb(novelId);
          throw error;
        }
      } else {
        const {
          designPatch: _designPatch,
          designExpected: _designExpected,
          ...attributePatch
        } = patch;
        await ipc.invoke('db-character-update', characterId, { attributePatch });
      }
      if (novelId !== null && scopeRef.current === scope && scope.active) {
        await loadCharactersFromDb(novelId);
      }
    },
    [characters, folderPath, loadCharactersFromDb, novelId]
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
