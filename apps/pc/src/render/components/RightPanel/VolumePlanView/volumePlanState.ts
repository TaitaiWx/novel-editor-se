/**
 * 卷纲的持久化状态（纯函数）：作者覆盖层的存储格式、旧版剧情板迁移、当前卷的定位
 *
 * 存储：settings 表 `novel-editor:volume-plan:<卷目录>`，内容是 VolumePlanState 的 JSON。
 * 旧版「剧情板」（`novel-editor:plot-board:<作品目录>`，按幕保存前提 / 目标 / 冲突……）
 * 在该卷第一次打开时迁移为幕说明与场景节拍改写，旧数据保持不动。
 */
import {
  compareChapterFileNames,
  compareVolumeDirNames,
  parseChapterFileName,
} from '@novel-editor/core/story-layout';
import type {
  VolumeOutline,
  VolumePlanOverlay,
  VolumeStructureId,
} from '@novel-editor/basic-algorithm';
import type { PersistedOutlineScopeInput } from '@/render/types/electron-api';

export const VOLUME_PLAN_STORAGE_PREFIX = 'novel-editor:volume-plan:';

export function createVolumePlanStorageKey(volumePath: string | null): string | null {
  return volumePath ? `${VOLUME_PLAN_STORAGE_PREFIX}${volumePath}` : null;
}

export type VolumePlanGeneratedBy = 'ai' | 'template';

export interface VolumePlanState extends Required<VolumePlanOverlay> {
  version: 1;
  /** 「这一卷想写什么？」 */
  intent: string;
  /** 作者选择的结构；null 表示自动（有幕标记按标记，否则按章数挑模板） */
  structure: VolumeStructureId | null;
  generatedBy: VolumePlanGeneratedBy | null;
  generatedAt: string | null;
}

export const EMPTY_VOLUME_PLAN: VolumePlanState = {
  version: 1,
  intent: '',
  structure: null,
  beatEdits: {},
  beatOrder: {},
  suggestions: {},
  actNotes: {},
  generatedBy: null,
  generatedAt: null,
};

const STRUCTURES: VolumeStructureId[] = ['markers', 'three-act', 'kishotenketsu', 'hero-journey'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

function stringListRecord(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) return {};
  const result: Record<string, string[]> = {};
  Object.entries(value).forEach(([key, list]) => {
    if (!Array.isArray(list)) return;
    const items = list.filter((item): item is string => typeof item === 'string');
    if (items.length > 0) result[key] = items;
  });
  return result;
}

/** 容错解析：任何字段缺失或类型不对都回退为默认值；解析失败返回 null */
export function parseVolumePlanState(raw: unknown): VolumePlanState | null {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  if (!isRecord(data)) return null;
  const structure = STRUCTURES.find((id) => id === data.structure) ?? null;
  const generatedBy =
    data.generatedBy === 'ai' || data.generatedBy === 'template' ? data.generatedBy : null;
  return {
    version: 1,
    intent: typeof data.intent === 'string' ? data.intent : '',
    structure,
    beatEdits: stringRecord(data.beatEdits),
    beatOrder: stringListRecord(data.beatOrder),
    suggestions: stringListRecord(data.suggestions),
    actNotes: stringRecord(data.actNotes),
    generatedBy,
    generatedAt: typeof data.generatedAt === 'string' ? data.generatedAt : null,
  };
}

/** 旧版剧情板中有用的字段（其余字段如状态、POV、强度、因果链不再保留） */
interface LegacySceneBoard {
  title?: unknown;
  objective?: unknown;
  outcome?: unknown;
  beats?: unknown;
}

const LEGACY_ACT_FIELDS: Array<[string, string]> = [
  ['premise', '前提'],
  ['goal', '目标'],
  ['conflict', '冲突'],
  ['twist', '转折'],
  ['payoff', '结果'],
];

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 把旧版剧情板（按幕标题匹配）迁移为覆盖层：
 * - 幕的 前提 / 目标 / 冲突 / 转折 / 结果 → 幕说明（「目标：…；冲突：…」）
 * - 场景的 目标 → 结果 → 该场景节拍的改写；场景内的节拍列表 → 该章的建议节拍
 * 没有任何可迁移内容时返回 null
 */
export function migrateLegacyPlotBoards(
  raw: unknown,
  outline: VolumeOutline
): Pick<VolumePlanState, 'actNotes' | 'beatEdits' | 'suggestions'> | null {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  if (!isRecord(data)) return null;
  const boards = Object.entries(data).filter((entry): entry is [string, Record<string, unknown>] =>
    isRecord(entry[1])
  );
  const actNotes: Record<string, string> = {};
  const beatEdits: Record<string, string> = {};
  const suggestions: Record<string, string[]> = {};

  outline.acts.forEach((act) => {
    const board = boards.find(([key]) => key.endsWith(`:${act.title}`))?.[1];
    if (!board) return;
    const note = LEGACY_ACT_FIELDS.map(([field, label]) => {
      const value = text(board[field]);
      return value ? `${label}：${value}` : '';
    })
      .filter(Boolean)
      .join('；');
    if (note) actNotes[act.key] = note;

    const scenes = Array.isArray(board.sceneBoards)
      ? (board.sceneBoards as LegacySceneBoard[])
      : [];
    act.chapters.forEach((chapter) =>
      chapter.beats.forEach((beat) => {
        const scene = scenes.find((item) => isRecord(item) && text(item.title) === beat.title);
        if (!beat.title || !scene) return;
        const edit = [text(scene.objective), text(scene.outcome)].filter(Boolean).join(' → ');
        if (edit) beatEdits[beat.key] = edit;
        const extra = Array.isArray(scene.beats)
          ? scene.beats.map(text).filter((item) => item.length > 0)
          : [];
        if (extra.length > 0) {
          suggestions[chapter.path] = [...(suggestions[chapter.path] || []), ...extra];
        }
      })
    );
  });

  const empty =
    Object.keys(actNotes).length === 0 &&
    Object.keys(beatEdits).length === 0 &&
    Object.keys(suggestions).length === 0;
  return empty ? null : { actNotes, beatEdits, suggestions };
}

/** 拖拽排序后的节拍顺序：只替换本段涉及的 key，同一章其他段落的顺序保持不变 */
export function mergeBeatOrder(
  previous: string[] | undefined,
  segmentKeys: string[],
  sourceKey: string,
  targetKey: string
): string[] | null {
  const from = segmentKeys.indexOf(sourceKey);
  const to = segmentKeys.indexOf(targetKey);
  if (from < 0 || to < 0 || from === to) return null;
  const next = [...segmentKeys];
  const [moving] = next.splice(from, 1);
  next.splice(to, 0, moving);
  const others = (previous || []).filter((key) => !segmentKeys.includes(key));
  return [...others, ...next];
}

// ─── 当前卷的定位 ─────────────────────────────────────────────────────────

export interface VolumeTarget {
  /** 读取章节的目录（卷目录；作品级作用域时为作品目录） */
  volumePath: string;
  /** 显示名称 */
  label: string;
  /** 当前打开的章节（用编辑器里未保存的内容替换磁盘内容） */
  activePath: string | null;
}

function normalize(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

function baseName(value: string): string {
  const parts = normalize(value).split('/');
  return parts[parts.length - 1] || value;
}

export function dirName(value: string): string {
  const normalized = value.replace(/[\\/]+$/, '');
  const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  return index > 0 ? normalized.slice(0, index) : normalized;
}

/**
 * 卷纲作用于哪一卷：打开章节时是章节所在目录，选中卷时是该卷，作品级作用域时是整部作品
 */
export function resolveVolumeTarget(
  scope: PersistedOutlineScopeInput | null,
  workPath: string | null,
  workLabel = '整部作品'
): VolumeTarget | null {
  if (!scope) return null;
  if (scope.kind === 'chapter') {
    const volumePath = dirName(scope.path);
    const isWorkRoot = Boolean(workPath) && normalize(volumePath) === normalize(workPath ?? '');
    return {
      volumePath,
      label: isWorkRoot ? workLabel : baseName(volumePath),
      activePath: scope.path,
    };
  }
  if (scope.kind === 'volume') {
    return { volumePath: scope.path, label: baseName(scope.path), activePath: null };
  }
  return { volumePath: scope.path, label: workLabel, activePath: null };
}

/** 章节显示标题：「001-启程.md」→「启程」 */
export function chapterTitleFromPath(filePath: string): string {
  return parseChapterFileName(baseName(filePath)).title || baseName(filePath);
}

/** 卷内章节排序：先按所在子目录（卷名序号），再按章节序号 */
export function compareChapterPaths(left: string, right: string, root: string): number {
  const rel = (value: string) => {
    const normalized = normalize(value);
    const prefix = `${normalize(root)}/`;
    return (normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized).split(
      '/'
    );
  };
  const a = rel(left);
  const b = rel(right);
  const depth = Math.min(a.length, b.length) - 1;
  for (let i = 0; i < depth; i += 1) {
    if (a[i] !== b[i]) return compareVolumeDirNames(a[i], b[i]);
  }
  if (a.length !== b.length) return a.length - b.length;
  return compareChapterFileNames(a[a.length - 1], b[b.length - 1]);
}
