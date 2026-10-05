/**
 * 写作日志（stats today / history 的数据来源）
 *
 * 存储位置：<project>/.novel-editor/writing-log.json
 * 记录方式：每当 CLI（或 daemon）对项目内的正文文件执行写入类操作时追加一条按天聚合的记录。
 * 注意：目前只反映 CLI 侧的写入活动，GUI 中的编辑不会写入该日志。
 *
 * 写作时长为估算值：同一天内两次写入间隔不超过 ACTIVE_GAP_MS 时，把间隔计为活跃时间。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_META_DIR } from './project';

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

/** 记录一批写入事件（同一次命令的多个文件只读写一次日志） */
export async function recordWrites(projectRoot: string, events: WriteEvent[]): Promise<void> {
  if (events.length === 0) return;
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
