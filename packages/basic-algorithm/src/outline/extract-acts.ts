import { extractOutline } from './extract-outline';
import type { ActNode, SceneNode } from './types';

/**
 * 幕/场景的正则
 */
const RE_ACT = /^(第[一二三四五六七八九十百千万零〇\d]+幕)\s*(.*)/;
const RE_SCENE = /^(第[一二三四五六七八九十百千万零〇\d]+场)\s*(.*)/;

/** Chapters per auto-generated act when no explicit act/scene markers exist */
const CHAPTERS_PER_ACT = 10;

/**
 * 从文本中提取幕/场景结构
 * 支持 "第X幕" → "第X场" 层级关系
 * 当未检测到幕/场景标记时，自动从章节标题生成幕结构
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

  // Fallback: if no explicit act/scene markers, generate from chapter headings
  if (acts.length === 0) {
    return generateActsFromChapters(text);
  }

  return acts;
}

/**
 * 当正文没有"第X幕/第X场"标记时，从章节标题自动生成幕结构。
 * 每 CHAPTERS_PER_ACT 个章节归为一幕，每个章节作为一个场景。
 */
function generateActsFromChapters(text: string): ActNode[] {
  const headings = extractOutline(text, { enableHeuristic: false });
  if (headings.length === 0) return [];

  const textLines = text.split('\n');
  const acts: ActNode[] = [];
  const totalActs = Math.ceil(headings.length / CHAPTERS_PER_ACT);

  for (let actIdx = 0; actIdx < totalActs; actIdx++) {
    const start = actIdx * CHAPTERS_PER_ACT;
    const end = Math.min(start + CHAPTERS_PER_ACT, headings.length);
    const chapterSlice = headings.slice(start, end);

    const scenes: SceneNode[] = chapterSlice.map((heading, j) => {
      // Extract preview: first non-empty line after the heading
      let preview = '';
      for (let li = heading.line; li < textLines.length && li < heading.line + 5; li++) {
        const line = textLines[li]?.trim();
        if (line && line !== heading.text) {
          preview = line.length > 80 ? line.slice(0, 80) + '…' : line;
          break;
        }
      }
      return {
        title: heading.text,
        line: heading.line,
        preview,
      };
    });

    const firstTitle = chapterSlice[0].text;
    const lastTitle = chapterSlice[chapterSlice.length - 1].text;
    const actTitle = totalActs === 1 ? '全篇' : `第${actIdx + 1}幕`;

    acts.push({
      title: actTitle,
      line: chapterSlice[0].line,
      scenes,
    });
  }

  return acts;
}
