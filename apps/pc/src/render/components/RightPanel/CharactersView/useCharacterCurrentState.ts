import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  Character,
  CharacterCategory,
  CharacterCurrentStateItem,
  CharacterTimelineItem,
} from '../types';
import {
  DEFAULT_CURRENT_STATE_LABELS,
  buildDerivedCurrentStateItems,
  cloneCurrentStateItems,
  createCurrentStateItem,
} from './helpers';

/**
 * 人物当前状态：展示已保存状态或根据最近经历自动推导，支持编辑后写回人物属性。
 */
export function useCharacterCurrentState({
  selectedCharacterId,
  selectedCharacter,
  focusedTimeline,
  handleUpdateCharacterAttributes,
}: {
  selectedCharacterId: number | null;
  selectedCharacter: Character | null;
  focusedTimeline: CharacterTimelineItem[];
  handleUpdateCharacterAttributes: (
    characterId: number,
    patch: {
      category?: CharacterCategory;
      highlightColor?: string;
      highlightFirstMentionOnly?: boolean;
      currentState?: CharacterCurrentStateItem[];
    }
  ) => Promise<void>;
}) {
  const [currentStateEditing, setCurrentStateEditing] = useState(false);
  const [currentStateDraftItems, setCurrentStateDraftItems] = useState<CharacterCurrentStateItem[]>(
    []
  );
  const [currentStateSaving, setCurrentStateSaving] = useState(false);

  // 切换人物时退出当前状态编辑
  useEffect(() => {
    setCurrentStateEditing(false);
  }, [selectedCharacterId]);

  useEffect(() => {
    if (currentStateEditing) return;
    setCurrentStateDraftItems(cloneCurrentStateItems(selectedCharacter?.currentState || []));
  }, [currentStateEditing, selectedCharacter]);

  const derivedCurrentStateItems = useMemo(
    () => buildDerivedCurrentStateItems(selectedCharacter, focusedTimeline),
    [focusedTimeline, selectedCharacter]
  );

  const displayCurrentStateItems =
    selectedCharacter && selectedCharacter.currentState.length > 0
      ? selectedCharacter.currentState
      : derivedCurrentStateItems;

  const handleStartEditCurrentState = useCallback(() => {
    const baseItems =
      selectedCharacter && selectedCharacter.currentState.length > 0
        ? selectedCharacter.currentState
        : derivedCurrentStateItems.length > 0
          ? derivedCurrentStateItems
          : DEFAULT_CURRENT_STATE_LABELS.map((label) => createCurrentStateItem(label, ''));
    setCurrentStateDraftItems(cloneCurrentStateItems(baseItems));
    setCurrentStateEditing(true);
  }, [derivedCurrentStateItems, selectedCharacter]);

  const handleCancelEditCurrentState = useCallback(() => {
    setCurrentStateDraftItems(cloneCurrentStateItems(selectedCharacter?.currentState || []));
    setCurrentStateEditing(false);
  }, [selectedCharacter]);

  const handleCurrentStateDraftChange = useCallback(
    (itemId: string, field: 'label' | 'value', nextValue: string) => {
      setCurrentStateDraftItems((prev) =>
        prev.map((item) => (item.id === itemId ? { ...item, [field]: nextValue } : item))
      );
    },
    []
  );

  const handleAddCurrentStateItem = useCallback(() => {
    setCurrentStateDraftItems((prev) => [...prev, createCurrentStateItem('', '')]);
  }, []);

  const handleRemoveCurrentStateItem = useCallback((itemId: string) => {
    setCurrentStateDraftItems((prev) => prev.filter((item) => item.id !== itemId));
  }, []);

  const handleSaveCurrentState = useCallback(async () => {
    if (!selectedCharacter) return;

    const nextItems = currentStateDraftItems
      .map((item) => ({
        id: item.id,
        label: item.label.trim(),
        value: item.value.trim(),
      }))
      .filter((item) => item.label && item.value);

    setCurrentStateSaving(true);
    try {
      await handleUpdateCharacterAttributes(selectedCharacter.id, {
        currentState: nextItems,
      });
      setCurrentStateEditing(false);
    } finally {
      setCurrentStateSaving(false);
    }
  }, [currentStateDraftItems, handleUpdateCharacterAttributes, selectedCharacter]);

  return {
    currentStateEditing,
    currentStateDraftItems,
    currentStateSaving,
    displayCurrentStateItems,
    handleStartEditCurrentState,
    handleCancelEditCurrentState,
    handleCurrentStateDraftChange,
    handleAddCurrentStateItem,
    handleRemoveCurrentStateItem,
    handleSaveCurrentState,
  };
}

export type CharacterCurrentStateController = ReturnType<typeof useCharacterCurrentState>;
