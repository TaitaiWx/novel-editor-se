import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { extractActs, type ActNode } from '@novel-editor/basic-algorithm';
import styles from './styles.module.scss';
import type { PlotActBoard, PlotSceneBoard, StorylineLayoutMode } from './types';
import { createPlotStorageKey, createActBoardKey, mergeActBoard } from './utils';
import { LAYOUT_MODE_LABELS, LAYOUT_MODE_KEYS, ACT_COLORS } from './constants';
import { PlotBoardInspector } from './PlotBoardInspector';
import { SwimlaneTimeline } from './SwimlaneTimeline';
import { CausalChainView } from './CausalChainView';

export const ActsView: React.FC<{
  content: string;
  onScrollToLine?: (line: number, contentKey?: string) => void;
  folderPath: string | null;
}> = React.memo(({ content, onScrollToLine, folderPath }) => {
  // ── State ──────────────────────────────────────────────────────────────────
  const [activeAct, setActiveAct] = useState<number | null>(null);
  const [activeScene, setActiveScene] = useState<string | null>(null);
  const [plotBoards, setPlotBoards] = useState<Record<string, PlotActBoard>>({});
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [sceneDragKey, setSceneDragKey] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<StorylineLayoutMode>('board');

  // ── Derived data (useMemo — single source of truth) ────────────────────────
  const acts: ActNode[] = useMemo(() => extractActs(content), [content]);

  const selectedActIndex = useMemo(
    () => (activeAct !== null ? activeAct : acts.length > 0 ? 0 : null),
    [activeAct, acts.length]
  );

  const selectedAct = useMemo(
    () => (selectedActIndex !== null ? acts[selectedActIndex] || null : null),
    [selectedActIndex, acts]
  );

  const selectedBoardKey = useMemo(
    () =>
      selectedAct && selectedActIndex !== null
        ? createActBoardKey(selectedAct, selectedActIndex)
        : null,
    [selectedAct, selectedActIndex]
  );

  const selectedBoard = useMemo(
    () =>
      selectedAct && selectedActIndex !== null
        ? mergeActBoard(
            selectedAct,
            selectedActIndex,
            selectedBoardKey ? plotBoards[selectedBoardKey] : undefined
          )
        : null,
    [selectedAct, selectedActIndex, selectedBoardKey, plotBoards]
  );

  // ── Refs (stable closure access for async callbacks) ───────────────────────
  const selectedActRef = useRef(selectedAct);
  selectedActRef.current = selectedAct;
  const selectedActIndexRef = useRef(selectedActIndex);
  selectedActIndexRef.current = selectedActIndex;
  const plotBoardsRef = useRef(plotBoards);
  plotBoardsRef.current = plotBoards;
  const selectedBoardRef = useRef(selectedBoard);
  selectedBoardRef.current = selectedBoard;

  // ── Effects ────────────────────────────────────────────────────────────────
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

  // ── Callbacks ──────────────────────────────────────────────────────────────
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

  const handleSceneClickByKey = useCallback(
    (sceneKey: string) => {
      setActiveScene((prev) => (prev === sceneKey ? null : sceneKey));
      const actIdx = activeAct ?? 0;
      const act = acts[actIdx];
      if (!act) return;
      const boardKey = createActBoardKey(act, actIdx);
      const board = mergeActBoard(act, actIdx, plotBoards[boardKey]);
      const sceneIdx = board.sceneBoards.findIndex((s) => s.sceneKey === sceneKey);
      const sceneLine = act.scenes[sceneIdx]?.line ?? act.line;
      onScrollToLine?.(sceneLine);
    },
    [activeAct, acts, plotBoards, onScrollToLine]
  );

  const updateSelectedBoard = useCallback(
    async (updater: (prev: PlotActBoard) => PlotActBoard) => {
      const act = selectedActRef.current;
      const actIndex = selectedActIndexRef.current;
      if (!act || actIndex === null) return;
      const boardKey = createActBoardKey(act, actIndex);
      const currentBoard = mergeActBoard(act, actIndex, plotBoardsRef.current[boardKey]);
      const nextBoard = updater(currentBoard);
      const nextBoards = { ...plotBoardsRef.current, [boardKey]: nextBoard };
      setPlotBoards(nextBoards);
      await persistPlotBoards(nextBoards);
    },
    [persistPlotBoards]
  );

  const handleSceneUpdate = useCallback(
    (sceneKey: string, partial: Partial<PlotSceneBoard>) => {
      void updateSelectedBoard((prev) => ({
        ...prev,
        sceneBoards: prev.sceneBoards.map((s) =>
          s.sceneKey === sceneKey ? { ...s, ...partial } : s
        ),
      }));
    },
    [updateSelectedBoard]
  );

  const handleToggleStructureNode = useCallback(
    (node: string) => {
      void updateSelectedBoard((prev) => ({
        ...prev,
        structureNodes: prev.structureNodes.includes(node)
          ? prev.structureNodes.filter((item) => item !== node)
          : [...prev.structureNodes, node],
      }));
    },
    [updateSelectedBoard]
  );

  const handleMoveScene = useCallback(
    (sceneKey: string, direction: -1 | 1) => {
      void updateSelectedBoard((prev) => {
        const index = prev.sceneBoards.findIndex((item) => item.sceneKey === sceneKey);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= prev.sceneBoards.length) return prev;
        const next = [...prev.sceneBoards];
        const [moving] = next.splice(index, 1);
        next.splice(target, 0, moving);
        return { ...prev, sceneBoards: next };
      });
    },
    [updateSelectedBoard]
  );

  const handleSceneDragReorder = useCallback(
    (sourceKey: string, targetKey: string) => {
      void updateSelectedBoard((prev) => {
        const sourceIndex = prev.sceneBoards.findIndex((item) => item.sceneKey === sourceKey);
        const targetIndex = prev.sceneBoards.findIndex((item) => item.sceneKey === targetKey);
        if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return prev;
        const next = [...prev.sceneBoards];
        const [moving] = next.splice(sourceIndex, 1);
        next.splice(targetIndex, 0, moving);
        return { ...prev, sceneBoards: next };
      });
    },
    [updateSelectedBoard]
  );

  const handleSceneDrop = useCallback(
    (targetKey: string) => {
      const sourceKey = sceneDragKey;
      if (!sourceKey) return;
      handleSceneDragReorder(sourceKey, targetKey);
      setSceneDragKey(null);
    },
    [sceneDragKey, handleSceneDragReorder]
  );

  const handleGenerateAI = useCallback(async () => {
    const act = selectedActRef.current;
    const board = selectedBoardRef.current;
    if (!act || !board) return;
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    setAiSuggesting(true);
    try {
      const response = (await ipc.invoke('ai-request', {
        prompt: `请为「${act.title}」输出剧情板建议，要求包含：
1) 本幕目标
2) 核心冲突
3) 转折点
4) 结果回收
5) 每个场景的推进建议（含目标、张力来源、结果）
6) 每个场景的情绪强度评估(1-5)
7) 场景之间的因果关系推荐`,
        systemPrompt:
          '你是专业剧情策划编辑，请输出清晰、可执行、简洁的中文建议。使用结构化格式输出。',
        context: [
          `正文片段:\n${content.slice(0, 2400)}`,
          `当前剧情板:\n前提: ${board.premise}\n目标: ${board.goal}\n冲突: ${board.conflict}\n转折: ${board.twist}\n结果: ${board.payoff}`,
          `场景列表:\n${board.sceneBoards.map((item, i) => `${i + 1}. ${item.title} [目标:${item.objective || '未填'}] [状态:${item.status}]`).join('\n')}`,
        ].join('\n\n'),
      })) as { ok: boolean; text?: string; error?: string };
      void updateSelectedBoard((prev) => ({
        ...prev,
        aiSuggestion: response.ok
          ? response.text || 'AI 未返回内容'
          : response.error || 'AI 请求失败',
      }));
    } finally {
      setAiSuggesting(false);
    }
  }, [content, updateSelectedBoard]);

  const handleSceneAiSuggest = useCallback(
    async (sceneKey: string) => {
      const act = selectedActRef.current;
      const board = selectedBoardRef.current;
      if (!act || !board) return;
      const scene = board.sceneBoards.find((s) => s.sceneKey === sceneKey);
      if (!scene) return;
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) return;

      const response = (await ipc.invoke('ai-request', {
        prompt: `请为场景「${scene.title}」补充：
1) 场景目标（如果为空）
2) 张力/冲突来源
3) 场景结果
4) 3-5个关键节拍(beat)
5) 情绪强度评估(1-5)`,
        systemPrompt: '你是专业剧情策划编辑，输出简洁的中文建议。',
        context: `所属幕: ${act.title}\n场景: ${scene.title}\n当前目标: ${scene.objective || '空'}\n当前冲突: ${scene.tension || '空'}`,
      })) as { ok: boolean; text?: string; error?: string };

      if (response.ok && response.text) {
        handleSceneUpdate(sceneKey, {
          outcome: scene.outcome || response.text.slice(0, 100),
        });
      }
    },
    [handleSceneUpdate]
  );

  const handleSceneDragStart = useCallback((key: string) => setSceneDragKey(key), []);

  // ── Early returns (ALL hooks are above — React Rules of Hooks satisfied) ──
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

  // ── Render visualization based on layout mode ──
  const renderVisualization = () => {
    if (!selectedBoard || selectedActIndex === null) return null;

    switch (layoutMode) {
      case 'timeline':
        return (
          <SwimlaneTimeline
            board={selectedBoard}
            actIndex={selectedActIndex}
            activeScene={activeScene}
            onSceneClick={handleSceneClickByKey}
            onSceneUpdate={handleSceneUpdate}
            onSceneDragReorder={handleSceneDragReorder}
          />
        );
      case 'causal':
        return (
          <CausalChainView
            board={selectedBoard}
            activeScene={activeScene}
            onSceneClick={handleSceneClickByKey}
            onSceneUpdate={handleSceneUpdate}
          />
        );
      case 'board':
      default:
        return (
          <PlotBoardInspector
            selectedAct={selectedAct}
            selectedBoard={selectedBoard}
            aiSuggesting={aiSuggesting}
            onUpdateBoard={updateSelectedBoard}
            onToggleStructureNode={handleToggleStructureNode}
            onMoveScene={handleMoveScene}
            onGenerateAI={handleGenerateAI}
            onSceneAiSuggest={handleSceneAiSuggest}
          />
        );
    }
  };

  return (
    <div className={styles.actsViewRoot}>
      {/* ── Layout mode switcher ── */}
      <div className={styles.layoutModeSwitcher}>
        {LAYOUT_MODE_KEYS.map((mode) => (
          <button
            key={mode}
            className={`${styles.layoutModeButton} ${layoutMode === mode ? styles.layoutModeActive : ''}`}
            onClick={() => setLayoutMode(mode)}
          >
            {mode === 'board' && '▦'}
            {mode === 'timeline' && '≡'}
            {mode === 'causal' && '⟠'}
            <span>{LAYOUT_MODE_LABELS[mode]}</span>
          </button>
        ))}
      </div>

      {/* ── Act selector strip ── */}
      <div className={styles.actSelectorStrip}>
        {acts.map((act, idx) => {
          const color = ACT_COLORS[idx % ACT_COLORS.length];
          const isActive = selectedActIndex === idx;
          const boardKey = createActBoardKey(act, idx);
          const board = mergeActBoard(act, idx, plotBoards[boardKey]);
          const doneCount = board.sceneBoards.filter((s) => s.status === 'done').length;
          const total = board.sceneBoards.length;

          return (
            <button
              key={idx}
              className={`${styles.actSelectorChip} ${isActive ? styles.actSelectorActive : ''}`}
              style={{ '--act-color': color } as React.CSSProperties}
              onClick={() => handleActClick(idx, act.line)}
            >
              <span className={styles.actSelectorDot} style={{ background: color }} />
              <span className={styles.actSelectorLabel}>{act.title}</span>
              <span className={styles.actSelectorProgress}>
                {doneCount}/{total}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Main visualization area ── */}
      <div className={styles.actsVisualizationArea}>{renderVisualization()}</div>
    </div>
  );
});
