import type { ActNode, SceneNode } from './types';

/**
 * 幕/场景的正则
 */
const RE_ACT = /^(第[一二三四五六七八九十百千万零〇\d]+幕)\s*(.*)/;
const RE_SCENE = /^(第[一二三四五六七八九十百千万零〇\d]+场)\s*(.*)/;

/**
 * 从文本中提取幕/场景结构
 * 支持 "第X幕" → "第X场" 层级关系
 */
export function extractActs(text: string): ActNode[] {
  if (!text) return [];

  const lines = text.split('\n');
  const acts: ActNode[] = [];
  let currentAct: ActNode | null = null;
  let currentScene: SceneNode | null = null;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;

    const lineNum = i + 1;

    // 检测幕
    const actMatch = trimmed.match(RE_ACT);
    if (actMatch) {
      currentAct = {
        title: (actMatch[1] + ' ' + (actMatch[2] || '')).trim(),
        line: lineNum,
        scenes: [],
      };
      acts.push(currentAct);
      currentScene = null;
      continue;
    }

    // 检测场景
    const sceneMatch = trimmed.match(RE_SCENE);
    if (sceneMatch) {
      currentScene = {
        title: (sceneMatch[1] + ' ' + (sceneMatch[2] || '')).trim(),
        line: lineNum,
        preview: '',
      };
      if (currentAct) {
        currentAct.scenes.push(currentScene);
      } else {
        // 没有幕时创建默认幕
        currentAct = {
          title: '默认幕',
          line: lineNum,
          scenes: [currentScene],
        };
        acts.push(currentAct);
      }
      continue;
    }

    // 为当前场景填充预览文本
    if (currentScene && !currentScene.preview && trimmed.length > 0) {
      currentScene.preview = trimmed.length > 80 ? trimmed.slice(0, 80) + '…' : trimmed;
    }
  }

  return acts;
}
