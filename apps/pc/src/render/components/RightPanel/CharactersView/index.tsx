import React, { useState, useMemo, useEffect } from 'react';
import { useDebounce } from '../useDebounce';
import styles from '../styles.module.scss';
import type { Character, CharacterCamp } from '../types';
import { estimateAppearanceHeat, inferCharacterCamp, inferRelationStage } from '../utils';
import { CharacterGraphPanel } from '../CharacterGraphPanel';
import { useNovelCorpus } from './useNovelCorpus';
import { useCharacterStore } from './useCharacterStore';
import { useCharacterRelations } from './useCharacterRelations';
import { useCharacterGraphLayout } from './useCharacterGraphLayout';
import { useCharacterGraphAI } from './useCharacterGraphAI';
import { useCharacterListEditor } from './useCharacterListEditor';
import { useCharacterTimeline } from './useCharacterTimeline';
import { useCharacterCurrentState } from './useCharacterCurrentState';
import { CharacterListPanel } from './CharacterListPanel';
import { CharacterDetailWorkspace } from './CharacterDetailWorkspace';
import { CharacterOverview } from './CharacterOverview';

/** 按人物名或别名查找成长卡等级 */
function resolveGrowthLevel(
  growthLevels: Record<string, number> | undefined,
  character: Character | null
): number | null {
  if (!growthLevels || !character) return null;
  for (const key of [character.name, ...(character.aliases ?? [])]) {
    const level = growthLevels[key];
    if (typeof level === 'number') return level;
  }
  return null;
}

export const CharactersView: React.FC<{
  folderPath: string | null;
  content: string;
  initialSelectedCharacterId?: number | null;
  onCharactersChange?: (characters: Character[]) => void;
  onOpenSourceLocation?: (filePath: string, line: number, contentKey?: string) => void;
  /** 角色名 → 成长卡等级（来自 资料/记忆/），用于人物详情中的「成长档案」入口 */
  growthLevels?: Record<string, number>;
  onOpenGrowthSheet?: (characterName: string) => void;
  /** 人物详情「成长档案」分页：嵌入该人物的成长档案 */
  renderGrowth?: (characterName: string) => React.ReactNode;
  /** 人物总览「成长」分页：嵌入成长总览 */
  renderGrowthOverview?: () => React.ReactNode;
  /** 人物总览里打开某个人物（工作区标签） */
  onOpenCharacter?: (characterId: number) => void;
  onCreateCharacter?: () => void;
}> = React.memo(
  ({
    folderPath,
    content,
    initialSelectedCharacterId = null,
    onCharactersChange,
    onOpenSourceLocation,
    growthLevels,
    onOpenGrowthSheet,
    renderGrowth,
    renderGrowthOverview,
    onOpenCharacter,
    onCreateCharacter,
  }) => {
    const debouncedContent = useDebounce(content, 300);
    const [selectedCharacterId, setSelectedCharacterId] = useState<number | null>(null);

    // 人物根数据、作品语料、关系与图布局
    const {
      characters,
      setCharacters,
      novelId,
      loadCharactersFromDb,
      handleDelete,
      handleUpdateCharacterAttributes,
    } = useCharacterStore({ folderPath, onCharactersChange });
    const { novelCorpusFiles, novelCorpusLoading, novelCorpusError } = useNovelCorpus(folderPath);
    const relationState = useCharacterRelations({ folderPath, characters });
    const { relations, setRelations, persistRelations, links } = relationState;
    const { characterPositions, handleGraphNodeMouseDown } = useCharacterGraphLayout({
      folderPath,
      characters,
    });

    // 人物列表编辑（新增、排序、筛选、批量分类）
    const listEditor = useCharacterListEditor({
      characters,
      setCharacters,
      novelId,
      loadCharactersFromDb,
    });

    const { aiGenerating, aiStatus, handleGenerateCharacterGraph } = useCharacterGraphAI({
      content,
      folderPath,
      novelId,
      loadCharactersFromDb,
      setRelations,
      persistRelations,
      setSelectedCharacterId,
    });

    const selectedCharacter = characters.find((item) => item.id === selectedCharacterId) || null;

    useEffect(() => {
      if (!initialSelectedCharacterId) return;
      if (!characters.some((item) => item.id === initialSelectedCharacterId)) return;
      setSelectedCharacterId(initialSelectedCharacterId);
    }, [characters, initialSelectedCharacterId]);

    // 经历时间线与当前状态
    const timeline = useCharacterTimeline({
      novelId,
      selectedCharacterId,
      selectedCharacter,
      debouncedContent,
      novelCorpusFiles,
      novelCorpusError,
      onOpenSourceLocation,
    });
    const { focusedTimeline, hasTimelineOverride } = timeline;

    const currentState = useCharacterCurrentState({
      selectedCharacterId,
      selectedCharacter,
      focusedTimeline,
      handleUpdateCharacterAttributes,
    });

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

    const cardsView = (
      <CharacterListPanel
        characters={characters}
        linksCount={links.length}
        aiGenerating={aiGenerating}
        aiStatus={aiStatus}
        onGenerateCharacterGraph={handleGenerateCharacterGraph}
        onDelete={handleDelete}
        editor={listEditor}
      />
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
        relationSourceId={relationState.relationSourceId}
        onRelationSourceChange={relationState.setRelationSourceId}
        relationTargetId={relationState.relationTargetId}
        onRelationTargetChange={relationState.setRelationTargetId}
        relationTone={relationState.relationTone}
        onRelationToneChange={relationState.setRelationTone}
        relationLabel={relationState.relationLabel}
        onRelationLabelChange={relationState.setRelationLabel}
        relationNote={relationState.relationNote}
        onRelationNoteChange={relationState.setRelationNote}
        editingRelationId={relationState.editingRelationId}
        onAddRelation={relationState.handleAddRelation}
        onUpdateRelation={relationState.handleUpdateRelation}
        onDeleteRelation={relationState.handleDeleteRelation}
        onStartEditRelation={relationState.startEditRelation}
      />
    );

    const detailMode = initialSelectedCharacterId !== null;
    const focusedCharacter = selectedCharacter;
    const focusedCamp = focusedCharacter ? inferCharacterCamp(focusedCharacter, relations) : null;
    const focusedHeat = focusedCharacter
      ? estimateAppearanceHeat(debouncedContent, focusedCharacter.name)
      : 0;
    const focusedTimelineEditedCount = focusedTimeline.filter((item) =>
      hasTimelineOverride(item)
    ).length;

    if (detailMode) {
      return (
        <CharacterDetailWorkspace
          focusedCharacter={focusedCharacter}
          focusedCamp={focusedCamp}
          focusedHeat={focusedHeat}
          focusedTimeline={focusedTimeline}
          focusedTimelineEditedCount={focusedTimelineEditedCount}
          selectedRelations={selectedRelations}
          characters={characters}
          novelCorpusFileCount={novelCorpusFiles.length}
          novelCorpusLoading={novelCorpusLoading}
          novelCorpusError={novelCorpusError}
          timeline={timeline}
          currentState={currentState}
          handleUpdateCharacterAttributes={handleUpdateCharacterAttributes}
          graphView={graphView}
          growthLevel={resolveGrowthLevel(growthLevels, focusedCharacter)}
          onOpenGrowthSheet={onOpenGrowthSheet}
          renderGrowth={renderGrowth}
          workPath={folderPath}
        />
      );
    }

    return (
      <CharacterOverview
        characters={characters}
        levelOf={(character) => resolveGrowthLevel(growthLevels, character)}
        workPath={folderPath}
        onOpenCharacter={(id) =>
          onOpenCharacter ? onOpenCharacter(id) : setSelectedCharacterId(id)
        }
        onCreateCharacter={onCreateCharacter}
        renderGrowthOverview={renderGrowthOverview}
        relationsView={
          <>
            <section className={styles.workspaceCardShell}>{cardsView}</section>
            <section className={styles.workspaceCardShell}>{graphView}</section>
          </>
        }
      />
    );
  }
);
