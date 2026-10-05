import type { ActNode } from '@novel-editor/basic-algorithm';
import type { PlotActBoard } from '../types';

export function createDefaultActBoard(act: ActNode, actIndex: number): PlotActBoard {
  return {
    premise: '',
    goal: '',
    conflict: '',
    twist: '',
    payoff: '',
    structureNodes: [],
    aiSuggestion: '',
    sceneBoards: act.scenes.map((scene, sceneIndex) => ({
      sceneKey: `${actIndex}:${sceneIndex}:${scene.line}`,
      title: scene.title,
      objective: '',
      tension: '',
      outcome: '',
      status: 'draft' as const,
      characters: [],
      beats: [],
      causesScene: null,
      pov: '',
      intensity: 1,
    })),
  };
}

export function mergeActBoard(act: ActNode, actIndex: number, board?: PlotActBoard): PlotActBoard {
  const fallback = createDefaultActBoard(act, actIndex);
  if (!board) return fallback;

  const normalizedScenes = fallback.sceneBoards.map((scene) => {
    const saved = board.sceneBoards.find(
      (item) => item.sceneKey === scene.sceneKey || item.title === scene.title
    );
    if (!saved) return scene;
    return {
      ...scene,
      ...saved,
      characters: Array.isArray(saved.characters) ? saved.characters : [],
      beats: Array.isArray(saved.beats) ? saved.beats : [],
      causesScene: saved.causesScene ?? null,
      pov: saved.pov ?? '',
      intensity: saved.intensity ?? 1,
    };
  });

  const extraScenes = (Array.isArray(board.sceneBoards) ? board.sceneBoards : [])
    .filter(
      (saved) =>
        !fallback.sceneBoards.some(
          (scene) => scene.sceneKey === saved.sceneKey || scene.title === saved.title
        )
    )
    .map((scene) => ({
      ...scene,
      characters: Array.isArray(scene.characters) ? scene.characters : [],
      beats: Array.isArray(scene.beats) ? scene.beats : [],
      causesScene: scene.causesScene ?? null,
      pov: scene.pov ?? '',
      intensity: scene.intensity ?? 1,
    }));

  return {
    premise: board.premise || '',
    goal: board.goal || '',
    conflict: board.conflict || '',
    twist: board.twist || '',
    payoff: board.payoff || '',
    structureNodes: Array.isArray(board.structureNodes) ? board.structureNodes : [],
    aiSuggestion: board.aiSuggestion || '',
    sceneBoards: [...normalizedScenes, ...extraScenes],
  };
}
