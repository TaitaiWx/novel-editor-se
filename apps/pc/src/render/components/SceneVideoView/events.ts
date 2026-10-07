/**
 * 打开「场景视频」工作区的请求（编辑器文件栏按钮 / 应用菜单 / 快捷键 / 卷纲场景条目）
 *
 * 发起方只派发事件，由 hooks/useSceneVideoEntry 统一解析场景来源并打开标签；
 * 带上的场景正文（例如选中的文字）作为「种子」暂存在内存中，标签首次打开且还没有保存过分镜时使用。
 */

export const OPEN_SCENE_VIDEO_EVENT = 'novel-editor:open-scene-video';

export interface OpenSceneVideoDetail {
  /** 章节文件绝对路径；省略时用当前打开的章节 */
  chapterPath?: string;
  /** 场景名（例如「第一场 清晨的青石镇」）；省略时由选区 / 光标推断 */
  scene?: string;
  /** 场景在章节中的行号（1-based，卷纲条目带上） */
  line?: number;
}

export function requestOpenSceneVideo(detail: OpenSceneVideoDetail = {}): void {
  window.dispatchEvent(new CustomEvent(OPEN_SCENE_VIDEO_EVENT, { detail }));
}

export interface SceneVideoSeed {
  sourceText: string;
  origin: 'selection' | 'scene-block' | 'chapter';
}

/** 种子按标签路径暂存（同一会话内有效；重启后从 分镜.json 或章节正文恢复） */
const seeds = new Map<string, SceneVideoSeed>();
const MAX_SEEDS = 20;

export function setSceneVideoSeed(tabPath: string, seed: SceneVideoSeed): void {
  seeds.delete(tabPath);
  seeds.set(tabPath, seed);
  while (seeds.size > MAX_SEEDS) {
    const oldest = seeds.keys().next().value;
    if (oldest === undefined) break;
    seeds.delete(oldest);
  }
}

export function getSceneVideoSeed(tabPath: string): SceneVideoSeed | null {
  return seeds.get(tabPath) ?? null;
}

export function clearSceneVideoSeed(tabPath: string): void {
  seeds.delete(tabPath);
}
