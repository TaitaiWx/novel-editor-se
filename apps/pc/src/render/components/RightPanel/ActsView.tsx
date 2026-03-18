import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { extractActs, type ActNode } from '@novel-editor/basic-algorithm';
import styles from './styles.module.scss';
import type { PlotActBoard, PlotSceneBoard } from './types';
import { STRUCTURE_NODE_PRESETS, PLOT_STATUS_LABELS, ACT_COLORS } from './constants';
import { createPlotStorageKey, createActBoardKey, mergeActBoard } from './utils';
import { VerticalSplit } from './VerticalSplit';

export const ActsView: React.FC<{
  content: string;
  onScrollToLine?: (line: number) => void;
  folderPath: string | null;
}> = React.memo(({ content, onScrollToLine, folderPath }) => {
  const [activeAct, setActiveAct] = useState<number | null>(null);
  const [activeScene, setActiveScene] = useState<string | null>(null);
  const [plotBoards, setPlotBoards] = useState<Record<string, PlotActBoard>>({});
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [sceneDragKey, setSceneDragKey] = useState<string | null>(null);

  const acts: ActNode[] = useMemo(() => extractActs(content), [content]);

  useEffect(() => {
    const loadBoards = async () => {
      const key = createPlotStorageKey(folderPath);
      const ipc = window.electron?.ipcRenderer;
      if (!key || !ipc) {
        setPlotBoards({});
        return;
      }
      try {
        const raw = await ipc.invoke('db-settings-get', key);
        setPlotBoards(raw ? (JSON.parse(raw as string) as Record<string, PlotActBoard>) : {});
      } catch {
        setPlotBoards({});
      }
    };
    loadBoards();
  }, [folderPath]);

  const persistPlotBoards = useCallback(
    async (nextBoards: Record<string, PlotActBoard>) => {
      const key = createPlotStorageKey(folderPath);
      const ipc = window.electron?.ipcRenderer;
      if (!key || !ipc) return;
      await ipc.invoke('db-settings-set', key, JSON.stringify(nextBoards));
    },
    [folderPath]
  );

  const handleActClick = useCallback(
    (actIdx: number, line: number) => {
      setActiveAct((prev) => (prev === actIdx ? null : actIdx));
      onScrollToLine?.(line);
    },
    [onScrollToLine]
  );

  const handleSceneClick = useCallback(
    (e: React.MouseEvent, sceneKey: string, line: number) => {
      e.stopPropagation();
      setActiveScene((prev) => (prev === sceneKey ? null : sceneKey));
      onScrollToLine?.(line);
    },
    [onScrollToLine]
  );

  if (!content) {
    return <div className={styles.emptyHint}>打开文件后查看幕剧结构</div>;
  }

  if (acts.length === 0) {
    return (
      <div className={styles.emptyHint}>
        未检测到幕剧结构
        <br />
        <span className={styles.hintSub}>支持格式: 第一幕、第一场、## ACT I 等</span>
      </div>
    );
  }

  const selectedActIndex = activeAct !== null ? activeAct : acts.length > 0 ? 0 : null;
  const selectedAct = selectedActIndex !== null ? acts[selectedActIndex] || null : null;
  const selectedBoardKey =
    selectedAct && selectedActIndex !== null
      ? createActBoardKey(selectedAct, selectedActIndex)
      : null;
  const selectedBoard =
    selectedAct && selectedActIndex !== null
      ? mergeActBoard(
          selectedAct,
          selectedActIndex,
          selectedBoardKey ? plotBoards[selectedBoardKey] : undefined
        )
      : null;

  const updateSelectedBoard = async (updater: (prev: PlotActBoard) => PlotActBoard) => {
    if (!selectedAct || selectedActIndex === null) return;
    const boardKey = createActBoardKey(selectedAct, selectedActIndex);
    const currentBoard = mergeActBoard(selectedAct, selectedActIndex, plotBoards[boardKey]);
    const nextBoard = updater(currentBoard);
    const nextBoards = { ...plotBoards, [boardKey]: nextBoard };
    setPlotBoards(nextBoards);
    await persistPlotBoards(nextBoards);
  };

  const toggleStructureNode = async (node: string) => {
    await updateSelectedBoard((prev) => ({
      ...prev,
      structureNodes: prev.structureNodes.includes(node)
        ? prev.structureNodes.filter((item) => item !== node)
        : [...prev.structureNodes, node],
    }));
  };

  const moveScene = async (sceneKey: string, direction: -1 | 1) => {
    await updateSelectedBoard((prev) => {
      const index = prev.sceneBoards.findIndex((item) => item.sceneKey === sceneKey);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.sceneBoards.length) return prev;
      const next = [...prev.sceneBoards];
      const [moving] = next.splice(index, 1);
      next.splice(target, 0, moving);
      return { ...prev, sceneBoards: next };
    });
  };

  const reorderSceneByKey = async (sourceKey: string, targetKey: string) => {
    await updateSelectedBoard((prev) => {
      const sourceIndex = prev.sceneBoards.findIndex((item) => item.sceneKey === sourceKey);
      const targetIndex = prev.sceneBoards.findIndex((item) => item.sceneKey === targetKey);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return prev;
      const next = [...prev.sceneBoards];
      const [moving] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moving);
      return { ...prev, sceneBoards: next };
    });
  };

  const generateAISuggestion = async () => {
    if (!selectedAct || !selectedBoard) return;
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    setAiSuggesting(true);
    try {
      const response = (await ipc.invoke('ai-request', {
        prompt: `请为「${selectedAct.title}」输出剧情板建议，要求包含：1) 本幕目标 2) 冲突 3) 转折 4) 结果回收 5) 每个场景的一句推进建议。`,
        systemPrompt: '你是专业剧情策划编辑，请输出清晰、可执行、简洁的中文建议。',
        context: [
          `正文片段:\n${content.slice(0, 1800)}`,
          `当前剧情板:\n目标: ${selectedBoard.goal}\n冲突: ${selectedBoard.conflict}\n转折: ${selectedBoard.twist}\n结果: ${selectedBoard.payoff}`,
          `场景列表:\n${selectedBoard.sceneBoards.map((item) => `- ${item.title}`).join('\n')}`,
        ].join('\n\n'),
      })) as { ok: boolean; text?: string; error?: string };
      await updateSelectedBoard((prev) => ({
        ...prev,
        aiSuggestion: response.ok
          ? response.text || 'AI 未返回内容'
          : response.error || 'AI 请求失败',
      }));
    } finally {
      setAiSuggesting(false);
    }
  };

  const cardsView = (
    <div className={styles.storyBoardWrap}>
      <div className={styles.storyBoardHeader}>
        <span>横向结构卡编排</span>
        <span className={styles.sectionSubtle}>拖拽卡片可重排，颜色条用于节奏对照</span>
      </div>
      <div className={styles.storyBoardScroller}>
        {acts.map((act, actIdx) => {
          const color = ACT_COLORS[actIdx % ACT_COLORS.length];
          const isActActive = activeAct === actIdx;
          const boardKey = createActBoardKey(act, actIdx);
          const board = mergeActBoard(act, actIdx, plotBoards[boardKey]);
          const sceneCount = board.sceneBoards.length;
          const completeCount = board.sceneBoards.filter((item) => item.status === 'done').length;
          return (
            <div
              key={actIdx}
              className={`${styles.storyActCard} ${isActActive ? styles.storyActCardActive : ''}`}
              onClick={() => handleActClick(actIdx, act.line)}
              style={{ borderTopColor: color }}
            >
              <div className={styles.storyActTop}>
                <span className={styles.storyActTitle}>{act.title}</span>
                <span className={styles.storyActMeta}>
                  {completeCount}/{sceneCount}
                </span>
              </div>
              {act.scenes.length > 0 && (
                <div className={styles.storyActRange}>
                  {act.scenes[0].title} — {act.scenes[act.scenes.length - 1].title}
                </div>
              )}
              <div className={styles.storyTempoTrack}>
                {board.sceneBoards.length === 0 ? (
                  <span className={styles.storyTempoEmpty}>暂无场景</span>
                ) : (
                  board.sceneBoards.map((sceneBoard, index) => {
                    const sceneKey = `${actIdx}-${index}`;
                    const sceneLine = act.scenes[index]?.line || act.line;
                    const isSceneActive = activeScene === sceneKey;
                    const statusClass =
                      sceneBoard.status === 'done'
                        ? styles.tempoDone
                        : sceneBoard.status === 'ready'
                          ? styles.tempoReady
                          : styles.tempoDraft;
                    return (
                      <button
                        key={sceneBoard.sceneKey}
                        className={`${styles.storySceneChip} ${isSceneActive ? styles.storySceneChipActive : ''} ${statusClass}`}
                        draggable={isActActive}
                        onDragStart={() => setSceneDragKey(sceneBoard.sceneKey)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={async () => {
                          if (sceneDragKey) {
                            await reorderSceneByKey(sceneDragKey, sceneBoard.sceneKey);
                            setSceneDragKey(null);
                          }
                        }}
                        onClick={(e) => handleSceneClick(e, sceneKey, sceneLine)}
                      >
                        <span>{index + 1}</span>
                        <em>{sceneBoard.title}</em>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const inspectorView = (
    <div className={styles.plotInspector}>
      <div className={styles.sectionHeader}>
        <span>剧情板</span>
        <span className={styles.sectionSubtle}>按幕管理目标、冲突与场景推进</span>
      </div>
      {selectedAct && selectedBoard ? (
        <>
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
              onChange={(e) =>
                updateSelectedBoard((prev) => ({ ...prev, premise: e.target.value }))
              }
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
                onChange={(e) => updateSelectedBoard((prev) => ({ ...prev, goal: e.target.value }))}
                placeholder="主角在这一幕要达成什么？"
              />
            </div>
            <div className={styles.plotFieldGroup}>
              <label className={styles.plotFieldLabel}>核心冲突</label>
              <textarea
                className={styles.formTextarea}
                rows={2}
                value={selectedBoard.conflict}
                onChange={(e) =>
                  updateSelectedBoard((prev) => ({ ...prev, conflict: e.target.value }))
                }
                placeholder="谁或什么在阻止目标完成？"
              />
            </div>
            <div className={styles.plotFieldGroup}>
              <label className={styles.plotFieldLabel}>转折</label>
              <textarea
                className={styles.formTextarea}
                rows={2}
                value={selectedBoard.twist}
                onChange={(e) =>
                  updateSelectedBoard((prev) => ({ ...prev, twist: e.target.value }))
                }
                placeholder="这一幕的意外、揭示或反转是什么？"
              />
            </div>
            <div className={styles.plotFieldGroup}>
              <label className={styles.plotFieldLabel}>结果 / 回收</label>
              <textarea
                className={styles.formTextarea}
                rows={2}
                value={selectedBoard.payoff}
                onChange={(e) =>
                  updateSelectedBoard((prev) => ({ ...prev, payoff: e.target.value }))
                }
                placeholder="这一幕结束后留下什么结果、代价或伏笔？"
              />
            </div>
          </div>

          <div className={styles.inspectorText}>
            下面把每一场拆成目标、张力和结果，用来做真正的情节推进管理。
          </div>

          <div className={styles.structureNodeGroup}>
            {STRUCTURE_NODE_PRESETS.map((node) => (
              <button
                key={node}
                className={`${styles.structureNodeChip} ${selectedBoard.structureNodes.includes(node) ? styles.structureNodeChipActive : ''}`}
                onClick={() => toggleStructureNode(node)}
              >
                {node}
              </button>
            ))}
          </div>

          <div className={styles.aiInlinePanel}>
            <button
              className={styles.submitButton}
              disabled={aiSuggesting}
              onClick={generateAISuggestion}
            >
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
              selectedBoard.sceneBoards.map((sceneBoard) => (
                <div key={sceneBoard.sceneKey} className={styles.sceneBoardCard}>
                  <div className={styles.sceneBoardHeader}>
                    <div className={styles.sceneBoardTitle}>{sceneBoard.title}</div>
                    <div className={styles.sceneHeaderActions}>
                      <button
                        className={styles.sceneMoveButton}
                        onClick={() => moveScene(sceneBoard.sceneKey, -1)}
                        title="上移"
                      >
                        ↑
                      </button>
                      <button
                        className={styles.sceneMoveButton}
                        onClick={() => moveScene(sceneBoard.sceneKey, 1)}
                        title="下移"
                      >
                        ↓
                      </button>
                      <select
                        className={styles.sceneStatusSelect}
                        value={sceneBoard.status}
                        onChange={(e) =>
                          updateSelectedBoard((prev) => ({
                            ...prev,
                            sceneBoards: prev.sceneBoards.map((item) =>
                              item.sceneKey === sceneBoard.sceneKey
                                ? { ...item, status: e.target.value as PlotSceneBoard['status'] }
                                : item
                            ),
                          }))
                        }
                      >
                        {(Object.keys(PLOT_STATUS_LABELS) as PlotSceneBoard['status'][]).map(
                          (status) => (
                            <option key={status} value={status}>
                              {PLOT_STATUS_LABELS[status]}
                            </option>
                          )
                        )}
                      </select>
                    </div>
                  </div>
                  <div className={styles.plotFieldGrid}>
                    <div className={styles.plotFieldGroup}>
                      <label className={styles.plotFieldLabel}>场景目标</label>
                      <textarea
                        className={styles.formTextarea}
                        rows={2}
                        value={sceneBoard.objective}
                        onChange={(e) =>
                          updateSelectedBoard((prev) => ({
                            ...prev,
                            sceneBoards: prev.sceneBoards.map((item) =>
                              item.sceneKey === sceneBoard.sceneKey
                                ? { ...item, objective: e.target.value }
                                : item
                            ),
                          }))
                        }
                        placeholder="这一场推进什么信息、行动或人物状态？"
                      />
                    </div>
                    <div className={styles.plotFieldGroup}>
                      <label className={styles.plotFieldLabel}>张力来源</label>
                      <textarea
                        className={styles.formTextarea}
                        rows={2}
                        value={sceneBoard.tension}
                        onChange={(e) =>
                          updateSelectedBoard((prev) => ({
                            ...prev,
                            sceneBoards: prev.sceneBoards.map((item) =>
                              item.sceneKey === sceneBoard.sceneKey
                                ? { ...item, tension: e.target.value }
                                : item
                            ),
                          }))
                        }
                        placeholder="冲突、信息差、误会、压迫感来自哪里？"
                      />
                    </div>
                  </div>
                  <div className={styles.plotFieldGroup}>
                    <label className={styles.plotFieldLabel}>场景结果</label>
                    <textarea
                      className={styles.formTextarea}
                      rows={2}
                      value={sceneBoard.outcome}
                      onChange={(e) =>
                        updateSelectedBoard((prev) => ({
                          ...prev,
                          sceneBoards: prev.sceneBoards.map((item) =>
                            item.sceneKey === sceneBoard.sceneKey
                              ? { ...item, outcome: e.target.value }
                              : item
                          ),
                        }))
                      }
                      placeholder="结尾状态、代价、悬念或下一步推进点"
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      ) : (
        <div className={styles.emptyHint}>选择一张情节卡查看结构详情</div>
      )}
    </div>
  );

  return <VerticalSplit top={cardsView} bottom={inspectorView} initialTopHeight={320} />;
});
