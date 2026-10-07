import { extractOutline } from './extract-outline';
import type { ActNode, SceneNode, StructureClassifier } from './types';
import { isDirectiveLine, sceneContainerTitle } from './novel-markers';

/**
 * 幕/场景的正则
 */
const RE_ACT =
  /^(\u7b2c[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07\u96f6\u3007\d]+\u5e55)\s*(.*)/;
const RE_SCENE =
  /^(\u7b2c[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07\u96f6\u3007\d]+\u573a)\s*(.*)/;

/** Chapters per auto-generated act when no explicit act/scene markers exist */
const CHAPTERS_PER_ACT = 10;

/**
 * 从文本中提取幕/场景结构
 * 支持 "第X幕" → "第X场" 层级关系
 * 当未检测到幕/场景标记时，自动从章节标题生成幕结构
 */
export interface ExtractActsOptions {
  /** 结构行识别器（作者配置的规则）；传入时幕 / 场按它判断，标题为整行 */
  classify?: StructureClassifier;
}

/** 一行的幕 / 场标题；不是时为 null */
function markerTitle(
  trimmed: string,
  kind: 'act' | 'scene',
  classify: StructureClassifier | undefined
): string | null {
  if (classify) return classify(trimmed) === kind ? trimmed : null;
  const match = trimmed.match(kind === 'act' ? RE_ACT : RE_SCENE);
  return match ? (match[1] + ' ' + (match[2] || '')).trim() : null;
}

export function extractActs(text: string, options: ExtractActsOptions = {}): ActNode[] {
  const { classify } = options;
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
    const actTitle = markerTitle(trimmed, 'act', classify);
    if (actTitle !== null) {
      currentAct = {
        title: actTitle,
        line: lineNum,
        scenes: [],
      };
      acts.push(currentAct);
      currentScene = null;
      continue;
    }

    // 检测场景：「第X场」标题，或小说格式的场景容器 :::scene{title=…}
    const sceneTitle = markerTitle(trimmed, 'scene', classify);
    const containerTitle = sceneTitle !== null ? null : sceneContainerTitle(trimmed);
    if (sceneTitle !== null || containerTitle !== null) {
      currentScene = {
        title: sceneTitle ?? containerTitle ?? '',
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

    // 其他指令行（:::、::video 等）不作为预览
    if (isDirectiveLine(trimmed)) continue;

    // 为当前场景填充预览文本
    if (currentScene && !currentScene.preview && trimmed.length > 0) {
      currentScene.preview = trimmed.length > 80 ? trimmed.slice(0, 80) + '…' : trimmed;
    }
  }

  // Fallback: if no explicit act/scene markers, generate from chapter headings
  if (acts.length === 0) {
    return generateActsFromChapters(text, lines, classify);
  }

  return acts;
}

/**
 * 当正文没有"第X幕/第X场"标记时，从章节标题自动生成幕结构。
 * 每 CHAPTERS_PER_ACT 个章节归为一幕，每个章节作为一个场景。
 */
function generateActsFromChapters(
  text: string,
  lines: string[],
  classify: StructureClassifier | undefined
): ActNode[] {
  const headings = extractOutline(text, { enableHeuristic: false, classify });
  if (headings.length === 0) return [];

  const acts: ActNode[] = [];
  const totalActs = Math.ceil(headings.length / CHAPTERS_PER_ACT);

  for (let actIdx = 0; actIdx < totalActs; actIdx++) {
    const start = actIdx * CHAPTERS_PER_ACT;
    const end = Math.min(start + CHAPTERS_PER_ACT, headings.length);
    const chapterSlice = headings.slice(start, end);

    const scenes: SceneNode[] = chapterSlice.map((heading, _j) => {
      // Extract preview: first non-empty line after the heading
      let preview = '';
      for (let li = heading.line; li < lines.length && li < heading.line + 5; li++) {
        const line = lines[li]?.trim();
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

    const actTitle = totalActs === 1 ? '全篇' : `第${actIdx + 1}幕`;

    acts.push({
      title: actTitle,
      line: chapterSlice[0].line,
      scenes,
    });
  }

  return acts;
}
