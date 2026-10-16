import { canLeaveWorkspace } from '@/render/utils/workspaceLeaveGuard';
import { createCharacterWorkspaceTab } from '@/render/utils/workspace';
import React, { useState, useEffect, useRef } from 'react';
import { useDebounce } from '../useDebounce';
import styles from '../styles.module.scss';
import type { Character, CharacterRelation } from '../types';
import { estimateAppearanceHeat, inferCharacterCamp } from '../utils';
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
  refreshVersion?: number;
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
}> = React.memo(function CharactersView({
  folderPath,
  content,
  initialSelectedCharacterId = null,
  refreshVersion = 0,
  onCharactersChange,
  onOpenSourceLocation,
  growthLevels,
  onOpenGrowthSheet,
  renderGrowth,
  renderGrowthOverview,
  onOpenCharacter,
  onCreateCharacter,
}) {
  const debouncedContent = useDebounce(content, 300);
  const [selectedCharacterId, setSelectedCharacterId] = useState<number | null>(null);

  const [graphSelectedId, setGraphSelectedId] = useState<number | null>(initialSelectedCharacterId);
  const graphEditorRef = useRef<HTMLDivElement>(null);
  const [propertyEditRequest, setPropertyEditRequest] = useState(0);
  const [relationEditing, setRelationEditing] = useState(false);
  useEffect(
    () => setGraphSelectedId(initialSelectedCharacterId),
    [folderPath, initialSelectedCharacterId]
  );

  // 人物根数据、作品语料、关系与图布局
  const {
    characters,
    setCharacters,
    novelId,
    loadCharactersFromDb,
    handleDelete,
    handleUpdateCharacterAttributes,
  } = useCharacterStore({ folderPath, onCharactersChange });
  useEffect(() => {
    if (novelId !== null && refreshVersion > 0) void loadCharactersFromDb(novelId);
  }, [refreshVersion, novelId, loadCharactersFromDb]);
  const { novelCorpusFiles, novelCorpusLoading, novelCorpusError } = useNovelCorpus(folderPath);
  const relationState = useCharacterRelations({ folderPath, characters });
  const { relations, setRelations, persistRelations, links } = relationState;
  const { characterPositions, handleGraphNodeMouseDown, resetGraphLayout, consumeGraphDrag } =
    useCharacterGraphLayout({
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
  const cardsView = (
    <CharacterListPanel
      characters={characters}
      workPath={folderPath}
      linksCount={links.length}
      aiGenerating={aiGenerating}
      aiStatus={aiStatus}
      onGenerateCharacterGraph={handleGenerateCharacterGraph}
      onDelete={handleDelete}
      editor={listEditor}
    />
  );

  const openCharacter = (id: number) => {
    if (!canLeaveWorkspace(createCharacterWorkspaceTab({ id }))) return;
    if (id === selectedCharacterId && initialSelectedCharacterId !== null) {
      setPropertyEditRequest((request) => request + 1);
    } else if (onOpenCharacter) onOpenCharacter(id);
    else {
      setSelectedCharacterId(id);
      setPropertyEditRequest((request) => request + 1);
    }
  };
  const editRelation = (relation: CharacterRelation) => {
    relationState.startEditRelation(relation);
    graphEditorRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  const graphView = (
    <CharacterGraphPanel
      characters={characters}
      key={folderPath}
      workPath={folderPath}
      links={links}
      draftRelationIds={Object.keys(relationState.noteDrafts.additions)}
      characterPositions={characterPositions}
      selectedCharacterId={graphSelectedId}
      currentCharacterId={initialSelectedCharacterId !== null ? selectedCharacterId : null}
      onSelectCharacter={setGraphSelectedId}
      onOpenCharacter={openCharacter}
      onResetLayout={resetGraphLayout}
      consumeGraphDrag={consumeGraphDrag}
      inspectorRef={graphEditorRef}
      onEditorStateChange={setRelationEditing}
      onGraphNodeMouseDown={handleGraphNodeMouseDown}
      relationSourceId={relationState.relationSourceId}
      onRelationSourceChange={relationState.setRelationSourceId}
      relationTargetId={relationState.relationTargetId}
      onRelationTargetChange={relationState.setRelationTargetId}
      relationTone={relationState.relationTone}
      onRelationToneChange={relationState.setRelationTone}
      relationBaseline={relationState.relationBaseline}
      relationNote={relationState.relationNote}
      onRelationNoteChange={relationState.setRelationNote}
      editingRelationId={relationState.editingRelationId}
      onAddRelation={relationState.handleAddRelation}
      onUpdateRelation={relationState.handleUpdateRelation}
      onDeleteRelation={relationState.handleDeleteRelation}
      onStartEditRelation={editRelation}
      onCancelEditRelation={relationState.cancelEditRelation}
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
        relationEditing={relationEditing}
        relationNoteDrafts={relationState.noteDrafts}
        propertyEditRequest={propertyEditRequest}
        focusedCharacter={focusedCharacter}
        focusedCamp={focusedCamp}
        focusedHeat={focusedHeat}
        focusedTimeline={focusedTimeline}
        focusedTimelineEditedCount={focusedTimelineEditedCount}
        selectedRelations={selectedRelations}
        networkRelations={links}
        characters={characters}
        novelCorpusFileCount={novelCorpusFiles.length}
        novelCorpusFiles={novelCorpusFiles}
        novelCorpusLoading={novelCorpusLoading}
        novelCorpusError={novelCorpusError}
        timeline={timeline}
        currentState={currentState}
        handleUpdateCharacterAttributes={handleUpdateCharacterAttributes}
        graphView={graphView}
        onOpenCharacter={openCharacter}
        growthLevel={resolveGrowthLevel(growthLevels, focusedCharacter)}
        onOpenGrowthSheet={onOpenGrowthSheet}
        onOpenSourceLocation={onOpenSourceLocation}
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
      onOpenCharacter={(id) => (onOpenCharacter ? onOpenCharacter(id) : setSelectedCharacterId(id))}
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
});
