import { withWorkspaceLease } from './workspace-lock';
/**
 * 写作日志（stats today / history 的数据来源）
 *
 * 存储位置：<project>/.novel-editor/writing-log.json
 * 记录方式：CLI（含 daemon）与 GUI 共用本模块，对项目内的正文文件执行写入时追加一条按天聚合的记录：
 *   - CLI：file write / chapter create 等写入类命令（recordProjectWrites）
 *   - GUI：主进程 write-file 每次成功保存正文文件时（recordStoryFileSave，按保存前后的字数差计入）
 * 只统计正文文件（.md/.markdown/.txt），排除 `资料/`（AI 生成资料、记忆库）与 `.novel-editor/` 元数据目录。
 *
 * 写作时长为估算值：同一天内两次写入间隔不超过 ACTIVE_GAP_MS 时，把间隔计为活跃时间。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isStoryFile, pathExists } from './fs-ops';
import { isGeneratedMaterialPath } from './material';
import { findProjectRoot, getConfigPath, isInside, PROJECT_META_DIR } from './project';
import { isProjectDocumentPath } from './story-layout';
import { analyzeContentStats } from './text-stats';

export const WRITING_LOG_FILE = 'writing-log.json';
const ACTIVE_GAP_MS = 10 * 60 * 1000;
const MAX_FILES_PER_DAY = 200;

export interface WritingDay {
  date: string;
  /** 新增字数（只统计增长部分） */
  added: number;
  /** 删除字数 */
  removed: number;
  /** 净增字数 */
  net: number;
  /** 写入次数 */
  writes: number;
  /** 当天写过的文件（相对项目根） */
  files: string[];
  firstAt: string | null;
  lastAt: string | null;
  /** 估算写作时长（毫秒） */
  activeMs: number;
}

export interface WritingLog {
  schemaVersion: 1;
  days: Record<string, WritingDay>;
}

export interface WriteEvent {
  /** 被写入文件的绝对路径 */
  path: string;
  previousChars: number;
  chars: number;
  at?: Date;
}

export function getWritingLogPath(projectRoot: string): string {
  return path.join(projectRoot, PROJECT_META_DIR, WRITING_LOG_FILE);
}

/** 本地时区日期 key（YYYY-MM-DD） */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function emptyDay(date: string): WritingDay {
  return {
    date,
    added: 0,
    removed: 0,
    net: 0,
    writes: 0,
    files: [],
    firstAt: null,
    lastAt: null,
    activeMs: 0,
  };
}

export async function readWritingLog(projectRoot: string): Promise<WritingLog> {
  try {
    const raw = JSON.parse(await readFile(getWritingLogPath(projectRoot), 'utf-8')) as WritingLog;
    if (raw && typeof raw.days === 'object') return { schemaVersion: 1, days: raw.days };
  } catch {
    // 文件不存在或损坏时视为空日志
  }
  return { schemaVersion: 1, days: {} };
}

async function saveWritingLog(projectRoot: string, log: WritingLog): Promise<void> {
  const target = getWritingLogPath(projectRoot);
  await mkdir(path.dirname(target), { recursive: true });
  // 先写临时文件再重命名，避免中断导致日志损坏
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(log, null, 2)}\n`, 'utf-8');
  await rename(temp, target);
}

/**
 * 同一进程内按项目串行化日志的读-改-写，避免并发保存（GUI 多个标签同时自动保存）互相覆盖。
 * 跨进程（CLI 与 GUI 同时写）仍可能丢失极少量记录，统计场景可以接受。
 */
const writeQueues = new Map<string, Promise<void>>();

function enqueue(projectRoot: string, task: () => Promise<void>): Promise<void> {
  const key = path.resolve(projectRoot);
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  writeQueues.set(key, next);
  void next
    .catch(() => undefined)
    .then(() => {
      if (writeQueues.get(key) === next) writeQueues.delete(key);
    });
  return next;
}

/** 记录一批写入事件（同一次命令的多个文件只读写一次日志） */
export async function recordWrites(projectRoot: string, events: WriteEvent[]): Promise<void> {
  return withWorkspaceLease(
    async () => {
      if (events.length === 0) return;
      await enqueue(projectRoot, () => applyWrites(projectRoot, events));
    },
    { resources: [projectRoot] }
  );
}

async function applyWrites(projectRoot: string, events: WriteEvent[]): Promise<void> {
  const log = await readWritingLog(projectRoot);
  for (const event of events) {
    const at = event.at ?? new Date();
    const key = toDateKey(at);
    const day = log.days[key] ?? emptyDay(key);
    const delta = event.chars - event.previousChars;
    if (delta >= 0) day.added += delta;
    else day.removed += -delta;
    day.net += delta;
    day.writes += 1;
    const relative = path.relative(projectRoot, event.path).split(path.sep).join('/');
    if (!day.files.includes(relative) && day.files.length < MAX_FILES_PER_DAY) {
      day.files.push(relative);
    }
    if (day.lastAt) {
      const gap = at.getTime() - new Date(day.lastAt).getTime();
      if (gap > 0 && gap <= ACTIVE_GAP_MS) day.activeMs += gap;
    }
    day.firstAt = day.firstAt ?? at.toISOString();
    day.lastAt = at.toISOString();
    log.days[key] = day;
  }
  await saveWritingLog(projectRoot, log);
}

/**
 * 是否为需要计入写作日志的正文文件：正文扩展名，不在 `资料/` 与 `.novel-editor/` 中，
 * 且不是项目文档（根目录下的欢迎使用.md、README.md 等，见 `isProjectDocumentPath`）。
 * `configured` 表示项目根有 `.novel-editor/config.json`，此时根目录下的文档都不算正文（与 GUI 正文树一致）。
 */
export function isTrackedStoryPath(
  filePath: string,
  projectRoot: string,
  options: { configured?: boolean } = {}
): boolean {
  if (!isStoryFile(filePath)) return false;
  if (isInside(path.join(projectRoot, PROJECT_META_DIR), filePath)) return false;
  const absFile = path.resolve(filePath);
  const absRoot = path.resolve(projectRoot);
  if (isProjectDocumentPath(absFile, absRoot, { configured: options.configured === true })) {
    return false;
  }
  return !isGeneratedMaterialPath(absFile, absRoot);
}

/**
 * 解析写入事件所属的写作日志根目录：
 * 1. 向上查找 `ne init` 创建的项目（.novel-editor/config.json）
 * 2. 找不到时回退到 fallbackRoot（GUI 当前打开的文件夹），前提是文件位于其中
 */
export async function resolveWritingLogRoot(
  filePath: string,
  fallbackRoot?: string | null
): Promise<string | null> {
  const projectRoot = await findProjectRoot(path.dirname(path.resolve(filePath)));
  if (projectRoot) return projectRoot;
  if (fallbackRoot && isInside(fallbackRoot, filePath)) return path.resolve(fallbackRoot);
  return null;
}

export interface ProjectWritesResult {
  root: string;
  count: number;
  error?: Error;
}

/**
 * 把写入事件按所属项目分组、过滤非正文文件后写入各自的写作日志（CLI 与 GUI 共用）。
 * 单个项目写日志失败不会抛出，而是在结果中返回 error，统计失败不应影响主操作。
 */
export async function recordProjectWrites(
  events: WriteEvent[],
  options: { fallbackRoot?: string | null } = {}
): Promise<ProjectWritesResult[]> {
  return (async () => {
    const groups = new Map<string, WriteEvent[]>();
    const configuredRoots = new Map<string, boolean>();
    for (const event of events) {
      if (!isStoryFile(event.path)) continue;
      const root = await resolveWritingLogRoot(event.path, options.fallbackRoot);
      if (!root) continue;
      let configured = configuredRoots.get(root);
      if (configured === undefined) {
        configured = await pathExists(getConfigPath(root));
        configuredRoots.set(root, configured);
      }
      if (!isTrackedStoryPath(event.path, root, { configured })) continue;
      const list = groups.get(root) ?? [];
      list.push(event);
      groups.set(root, list);
    }
    const results: ProjectWritesResult[] = [];
    for (const [root, list] of groups) {
      try {
        await recordWrites(root, list);
        results.push({ root, count: list.length });
      } catch (error) {
        results.push({
          root,
          count: 0,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }
    return results;
  })();
}

export interface StoryFileSave {
  /** 被保存文件的绝对路径 */
  path: string;
  /** 保存前的磁盘内容；新建文件为 null */
  previousContent: string | null;
  /** 保存后的内容 */
  content: string;
  at?: Date;
  /** GUI 当前打开的文件夹：文件不在 `ne init` 项目内时，日志写入该文件夹的 .novel-editor/ */
  workspaceRoot?: string | null;
}

/**
 * GUI 保存正文文件后调用：用与状态栏一致的字数口径计算增量并写入写作日志。
 * 内容未变化时不记录（避免无改动的重复保存虚增写入次数与时长）。
 */
export async function recordStoryFileSave(save: StoryFileSave): Promise<ProjectWritesResult[]> {
  return (async () => {
    if (save.previousContent === save.content) return [];
    if (!isStoryFile(save.path)) return [];
    return recordProjectWrites(
      [
        {
          path: path.resolve(save.path),
          previousChars:
            save.previousContent === null ? 0 : analyzeContentStats(save.previousContent).charCount,
          chars: analyzeContentStats(save.content).charCount,
          at: save.at,
        },
      ],
      { fallbackRoot: save.workspaceRoot }
    );
  })();
}

export async function getTodayStats(projectRoot: string, now = new Date()): Promise<WritingDay> {
  const log = await readWritingLog(projectRoot);
  const key = toDateKey(now);
  return log.days[key] ?? emptyDay(key);
}

export interface WritingHistory {
  days: WritingDay[];
  totals: { added: number; removed: number; net: number; writes: number; activeMs: number };
}

/** 最近 N 天（含今天）的写作统计，无记录的日期补 0 */
export async function getHistoryStats(
  projectRoot: string,
  days = 7,
  now = new Date()
): Promise<WritingHistory> {
  const log = await readWritingLog(projectRoot);
  const list: WritingDay[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const key = toDateKey(date);
    list.push(log.days[key] ?? emptyDay(key));
  }
  const totals = list.reduce(
    (acc, day) => ({
      added: acc.added + day.added,
      removed: acc.removed + day.removed,
      net: acc.net + day.net,
      writes: acc.writes + day.writes,
      activeMs: acc.activeMs + day.activeMs,
    }),
    { added: 0, removed: 0, net: 0, writes: 0, activeMs: 0 }
  );
  return { days: list, totals };
}
