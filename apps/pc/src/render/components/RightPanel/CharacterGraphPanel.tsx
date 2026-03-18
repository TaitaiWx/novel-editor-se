import React from 'react';
import styles from './styles.module.scss';
import type { Character, CharacterRelation, RelationTone, CharacterCamp } from './types';
import { RELATION_TONE_LABELS, CAMP_LABELS } from './constants';
import { estimateAppearanceHeat } from './utils';

interface CharacterGraphPanelProps {
  characters: Character[];
  content: string;
  links: CharacterRelation[];
  characterPositions: Array<{ character: Character; x: number; y: number }>;
  clusteredCharacters: Record<CharacterCamp, Array<Character & { heat: number }>>;
  relationStageStats: Array<{ stage: string; count: number }>;
  selectedCharacterId: number | null;
  onSelectCharacter: (id: number | null) => void;
  selectedCharacter: Character | null;
  selectedRelations: CharacterRelation[];
  onGraphNodeMouseDown: (e: React.MouseEvent<HTMLButtonElement>, id: number) => void;
  relationSourceId: number | '';
  onRelationSourceChange: (id: number | '') => void;
  relationTargetId: number | '';
  onRelationTargetChange: (id: number | '') => void;
  relationTone: RelationTone;
  onRelationToneChange: (tone: RelationTone) => void;
  relationLabel: string;
  onRelationLabelChange: (label: string) => void;
  relationNote: string;
  onRelationNoteChange: (note: string) => void;
  editingRelationId: string | null;
  onAddRelation: () => void;
  onUpdateRelation: () => void;
  onDeleteRelation: (id: string) => void;
  onStartEditRelation: (relation: CharacterRelation) => void;
}

export const CharacterGraphPanel: React.FC<CharacterGraphPanelProps> = React.memo(
  ({
    characters,
    content,
    links,
    characterPositions,
    clusteredCharacters,
    relationStageStats,
    selectedCharacterId,
    onSelectCharacter,
    selectedCharacter,
    selectedRelations,
    onGraphNodeMouseDown,
    relationSourceId,
    onRelationSourceChange,
    relationTargetId,
    onRelationTargetChange,
    relationTone,
    onRelationToneChange,
    relationLabel,
    onRelationLabelChange,
    relationNote,
    onRelationNoteChange,
    editingRelationId,
    onAddRelation,
    onUpdateRelation,
    onDeleteRelation,
    onStartEditRelation,
  }) => {
    if (characters.length === 0) {
      return (
        <div className={styles.graphPanel}>
          <div className={styles.sectionHeader}>
            <span>人物图谱</span>
            <span className={styles.sectionSubtle}>可拖拽、可编辑、可由 AI 回填</span>
          </div>
          <div className={styles.emptyHint}>添加角色后生成图谱视图</div>
        </div>
      );
    }

    return (
      <div className={styles.graphPanel}>
        <div className={styles.sectionHeader}>
          <span>人物图谱</span>
          <span className={styles.sectionSubtle}>可拖拽、可编辑、可由 AI 回填</span>
        </div>
        <div className={styles.clusterBoard}>
          {(Object.keys(CAMP_LABELS) as CharacterCamp[]).map((camp) => (
            <div key={camp} className={styles.clusterCard}>
              <div className={styles.clusterCardHeader}>
                <span>{CAMP_LABELS[camp]}</span>
                <span className={styles.clusterCount}>{clusteredCharacters[camp].length}</span>
              </div>
              <div className={styles.clusterMemberList}>
                {clusteredCharacters[camp].length === 0 ? (
                  <span className={styles.clusterEmpty}>暂无</span>
                ) : (
                  clusteredCharacters[camp].slice(0, 6).map((character) => (
                    <button
                      key={character.id}
                      className={styles.clusterMemberChip}
                      onClick={() => onSelectCharacter(character.id)}
                    >
                      <span>{character.name}</span>
                      <em>热度 {character.heat}</em>
                    </button>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
        <div className={styles.graphCanvas}>
          <svg className={styles.graphEdges} viewBox="0 0 360 240" preserveAspectRatio="none">
            {links.map((link) => {
              const source = characterPositions.find((item) => item.character.id === link.sourceId);
              const target = characterPositions.find((item) => item.character.id === link.targetId);
              if (!source || !target) return null;
              const isSelected =
                selectedCharacterId !== null &&
                (link.sourceId === selectedCharacterId || link.targetId === selectedCharacterId);
              return (
                <g key={link.id}>
                  <line
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    stroke={isSelected ? 'rgba(108, 188, 255, 0.72)' : 'rgba(86, 156, 214, 0.35)'}
                    strokeWidth={isSelected ? '2.2' : '1.5'}
                  />
                  <text
                    x={(source.x + target.x) / 2}
                    y={(source.y + target.y) / 2 - 6}
                    textAnchor="middle"
                    className={styles.graphEdgeLabel}
                  >
                    {link.label}
                  </text>
                </g>
              );
            })}
          </svg>
          {characterPositions.map(({ character, x, y }) => (
            <button
              key={character.id}
              className={`${styles.graphNode} ${selectedCharacterId === character.id ? styles.graphNodeActive : ''}`}
              style={{ left: `${x}px`, top: `${y}px` }}
              onClick={() => onSelectCharacter(character.id)}
              onMouseDown={(e) => onGraphNodeMouseDown(e, character.id)}
            >
              <span className={styles.graphNodeTitle}>{character.name}</span>
              <span className={styles.graphNodeMeta}>
                {character.role || '待设定'} · 热度{' '}
                {estimateAppearanceHeat(content, character.name)}
              </span>
            </button>
          ))}
        </div>
        <div className={styles.stageBoard}>
          <div className={styles.stageBoardTitle}>关系阶段变化</div>
          {relationStageStats.length === 0 ? (
            <div className={styles.clusterEmpty}>
              关系备注里加入"前期/中期/后期"等词会自动归档阶段
            </div>
          ) : (
            <div className={styles.stageTrack}>
              {relationStageStats.map((item) => (
                <div key={item.stage} className={styles.stageItem}>
                  <div className={styles.stageName}>{item.stage}</div>
                  <div className={styles.stageBar}>
                    <span style={{ width: `${Math.min(100, 12 + item.count * 22)}%` }} />
                  </div>
                  <div className={styles.stageCount}>{item.count} 条关系</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className={styles.graphInspector}>
          <div className={styles.graphInspectorTitle}>
            {selectedCharacter ? `${selectedCharacter.name} 的关系` : '关系编辑器'}
          </div>
          <div className={styles.graphFormGrid}>
            <select
              className={styles.formInput}
              value={relationSourceId}
              onChange={(e) => onRelationSourceChange(Number(e.target.value) || '')}
            >
              <option value="">关系起点</option>
              {characters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name}
                </option>
              ))}
            </select>
            <select
              className={styles.formInput}
              value={relationTargetId}
              onChange={(e) => onRelationTargetChange(Number(e.target.value) || '')}
            >
              <option value="">关系终点</option>
              {characters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.graphFormGrid}>
            <select
              className={styles.formInput}
              value={relationTone}
              onChange={(e) => onRelationToneChange(e.target.value as RelationTone)}
            >
              {(Object.keys(RELATION_TONE_LABELS) as RelationTone[]).map((tone) => (
                <option key={tone} value={tone}>
                  {RELATION_TONE_LABELS[tone]}
                </option>
              ))}
            </select>
            <input
              className={styles.formInput}
              value={relationLabel}
              onChange={(e) => onRelationLabelChange(e.target.value)}
              placeholder="关系名称，例如：互相试探"
            />
          </div>
          <textarea
            className={styles.formTextarea}
            rows={2}
            value={relationNote}
            onChange={(e) => onRelationNoteChange(e.target.value)}
            placeholder="补充这段关系的背景、隐含张力或变化"
          />
          <button
            className={styles.submitButton}
            onClick={editingRelationId ? onUpdateRelation : onAddRelation}
          >
            {editingRelationId ? '保存关系修改' : '添加关系连线'}
          </button>
          <div className={styles.relationList}>
            {selectedRelations.length === 0 ? (
              <div className={styles.emptyHint}>暂无关系，先添加一条连线</div>
            ) : (
              selectedRelations.map((relation) => {
                const source = characters.find((item) => item.id === relation.sourceId);
                const target = characters.find((item) => item.id === relation.targetId);
                return (
                  <div key={relation.id} className={styles.relationCard}>
                    <div className={styles.relationCardHeader}>
                      <span className={styles.relationNames}>
                        {source?.name || '未知'} → {target?.name || '未知'}
                      </span>
                      {!relation.id.startsWith('generated-') && (
                        <div className={styles.inlineActions}>
                          <button
                            className={styles.deleteInlineButton}
                            onClick={() => onStartEditRelation(relation)}
                          >
                            编辑
                          </button>
                          <button
                            className={styles.deleteInlineButton}
                            onClick={() => onDeleteRelation(relation.id)}
                          >
                            删除
                          </button>
                        </div>
                      )}
                    </div>
                    {!relation.id.startsWith('generated-') && (
                      <button
                        className={styles.relationEditZone}
                        onDoubleClick={() => onStartEditRelation(relation)}
                        title="双击快速编辑"
                      >
                        双击快速编辑
                      </button>
                    )}
                    <div className={styles.relationMetaRow}>
                      <span className={styles.relationTone}>
                        {RELATION_TONE_LABELS[relation.tone]}
                      </span>
                      <span className={styles.relationLabel}>{relation.label}</span>
                    </div>
                    {relation.note && <div className={styles.relationNote}>{relation.note}</div>}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    );
  }
);
