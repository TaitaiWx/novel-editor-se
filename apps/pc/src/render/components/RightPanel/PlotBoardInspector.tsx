import React, { useCallback } from 'react';
import type { ActNode } from '@novel-editor/basic-algorithm';
import styles from './styles.module.scss';
import type { PlotActBoard, PlotSceneBoard } from './types';
import { STRUCTURE_NODE_PRESETS } from './constants';
import { SceneBoardCard } from './SceneBoardCard';

interface PlotBoardInspectorProps {
  selectedAct: ActNode | null;
  selectedBoard: PlotActBoard | null;
  aiSuggesting: boolean;
  onUpdateBoard: (updater: (prev: PlotActBoard) => PlotActBoard) => void;
  onToggleStructureNode: (node: string) => void;
  onMoveScene: (sceneKey: string, direction: -1 | 1) => void;
  onGenerateAI: () => void;
  onSceneAiSuggest?: (sceneKey: string) => void;
}

export const PlotBoardInspector: React.FC<PlotBoardInspectorProps> = React.memo(
  ({
    selectedAct,
    selectedBoard,
    aiSuggesting,
    onUpdateBoard,
    onToggleStructureNode,
    onMoveScene,
    onGenerateAI,
    onSceneAiSuggest,
  }) => {
    const handleSceneUpdate = useCallback(
      (sceneKey: string, partial: Partial<PlotSceneBoard>) => {
        onUpdateBoard((prev) => ({
          ...prev,
          sceneBoards: prev.sceneBoards.map((s) =>
            s.sceneKey === sceneKey ? { ...s, ...partial } : s
          ),
        }));
      },
      [onUpdateBoard]
    );

    if (!selectedAct || !selectedBoard) {
      return <div className={styles.emptyHint}>选择一张幕卡查看结构详情</div>;
    }

    return (
      <div className={styles.plotInspector}>
        <div className={styles.sectionHeader}>
          <span>剧情板</span>
          <span className={styles.sectionSubtle}>按幕管理目标、冲突与场景推进</span>
        </div>

        <div className={styles.inspectorTitle} title={selectedAct.title}>
          {selectedAct.title}
        </div>
        <div className={styles.inspectorMeta}>
          {selectedAct.scenes.length > 0
            ? `${selectedAct.scenes[0].title} — ${selectedAct.scenes[selectedAct.scenes.length - 1].title}  ·  ${selectedAct.scenes.length} 场景`
            : `${selectedAct.scenes.length} 场景`}
        </div>

        <div className={styles.inspectorChecklist}>
          <span className={styles.inspectorChip}>目标</span>
          <span className={styles.inspectorChip}>冲突</span>
          <span className={styles.inspectorChip}>转折</span>
          <span className={styles.inspectorChip}>结果</span>
        </div>

        <div className={styles.plotFieldGroup}>
          <label className={styles.plotFieldLabel}>本幕前提</label>
          <textarea
            className={styles.formTextarea}
            rows={2}
            value={selectedBoard.premise}
            onChange={(e) => onUpdateBoard((prev) => ({ ...prev, premise: e.target.value }))}
            placeholder="这一幕开始前，人物与局势处于什么状态？"
          />
        </div>

        <div className={styles.plotFieldGrid}>
          <div className={styles.plotFieldGroup}>
            <label className={styles.plotFieldLabel}>目标</label>
            <textarea
              className={styles.formTextarea}
              rows={2}
              value={selectedBoard.goal}
              onChange={(e) => onUpdateBoard((prev) => ({ ...prev, goal: e.target.value }))}
              placeholder="主角在这一幕要达成什么？"
            />
          </div>
          <div className={styles.plotFieldGroup}>
            <label className={styles.plotFieldLabel}>核心冲突</label>
            <textarea
              className={styles.formTextarea}
              rows={2}
              value={selectedBoard.conflict}
              onChange={(e) => onUpdateBoard((prev) => ({ ...prev, conflict: e.target.value }))}
              placeholder="谁或什么在阻止目标完成？"
            />
          </div>
          <div className={styles.plotFieldGroup}>
            <label className={styles.plotFieldLabel}>转折</label>
            <textarea
              className={styles.formTextarea}
              rows={2}
              value={selectedBoard.twist}
              onChange={(e) => onUpdateBoard((prev) => ({ ...prev, twist: e.target.value }))}
              placeholder="这一幕的意外、揭示或反转是什么？"
            />
          </div>
          <div className={styles.plotFieldGroup}>
            <label className={styles.plotFieldLabel}>结果 / 回收</label>
            <textarea
              className={styles.formTextarea}
              rows={2}
              value={selectedBoard.payoff}
              onChange={(e) => onUpdateBoard((prev) => ({ ...prev, payoff: e.target.value }))}
              placeholder="这一幕结束后留下什么结果、代价或伏笔？"
            />
          </div>
        </div>

        <div className={styles.structureNodeGroup}>
          {STRUCTURE_NODE_PRESETS.map((node) => (
            <button
              key={node}
              className={`${styles.structureNodeChip} ${selectedBoard.structureNodes.includes(node) ? styles.structureNodeChipActive : ''}`}
              onClick={() => onToggleStructureNode(node)}
            >
              {node}
            </button>
          ))}
        </div>

        <div className={styles.aiInlinePanel}>
          <button className={styles.submitButton} disabled={aiSuggesting} onClick={onGenerateAI}>
            {aiSuggesting ? 'AI 生成中...' : 'AI 一键建议'}
          </button>
          <div className={styles.aiInlineResult}>
            {selectedBoard.aiSuggestion || '点击按钮生成这一幕的剧情建议'}
          </div>
        </div>

        <div className={styles.sceneBoardList}>
          {selectedBoard.sceneBoards.length === 0 ? (
            <div className={styles.emptyHint}>当前幕暂无场景，可先在正文里补结构标题</div>
          ) : (
            selectedBoard.sceneBoards.map((sceneBoard, index) => (
              <SceneBoardCard
                key={sceneBoard.sceneKey}
                sceneBoard={sceneBoard}
                index={index}
                canMoveUp={index > 0}
                canMoveDown={index < selectedBoard.sceneBoards.length - 1}
                allSceneKeys={selectedBoard.sceneBoards.map((s) => s.sceneKey)}
                onUpdate={(partial) => handleSceneUpdate(sceneBoard.sceneKey, partial)}
                onMove={(direction) => onMoveScene(sceneBoard.sceneKey, direction)}
                onAiSuggest={onSceneAiSuggest}
                draggable
              />
            ))
          )}
        </div>
      </div>
    );
  }
);
