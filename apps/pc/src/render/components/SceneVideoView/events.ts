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

// ─── 从资料打开：单击 资料/视频/<章>/<场景>/分镜.json 直接打开这一场的画布 ─────────

const STORYBOARD_FILE_RE =
  /[\\/]\u8d44\u6599[\\/]\u89c6\u9891[\\/][^\\/]+[\\/][^\\/]+[\\/]\u5206\u955c\.json$/;

export function isSceneStoryboardFile(filePath: string): boolean {
  return STORYBOARD_FILE_RE.test(filePath);
}

/** <作品>/资料/视频/… 中「资料/视频」之前的作品目录（\u8d44\u6599 = 资料，\u89c6\u9891 = 视频） */
const WORK_OF_SCENE_FILE_RE = /^(.*?)[\\/]\u8d44\u6599[\\/]\u89c6\u9891[\\/]/;
const ABSOLUTE_PATH_RE = /^([a-zA-Z]:[\\/]|[\\/])/;

/**
 * 分镜.json 里记录的章节与场景；内容不完整时返回 null（按普通文件打开）。
 * chapterPath 一般是绝对路径；随示例作品集分发的分镜写的是相对作品目录的路径
 * （例如 第一卷-离乡/001-启程.md），此时按 stateFile 所在的作品目录解析。
 */
export function sceneVideoTargetFromStoryboard(
  raw: string,
  stateFile?: string
): { chapterPath: string; scene: string } | null {
  try {
    const data = JSON.parse(raw) as { chapterPath?: unknown; scene?: unknown };
    let chapterPath = typeof data.chapterPath === 'string' ? data.chapterPath.trim() : '';
    const scene = typeof data.scene === 'string' ? data.scene.trim() : '';
    if (!chapterPath || !scene) return null;
    if (!ABSOLUTE_PATH_RE.test(chapterPath)) {
      const work = stateFile ? WORK_OF_SCENE_FILE_RE.exec(stateFile)?.[1] : undefined;
      if (!work || chapterPath.split(/[\\/]/).includes('..')) return null;
      const separator = work.includes('\\') && !work.includes('/') ? '\\' : '/';
      chapterPath = [work, ...chapterPath.split(/[\\/]+/).filter(Boolean)].join(separator);
    }
    return { chapterPath, scene };
  } catch {
    return null;
  }
}
