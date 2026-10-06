/**
 * 日志包（zip）构建：纯 Node 实现，不依赖 Electron，便于单测
 *
 * 包内文件（白名单，不会打包作品正文或 SQLite 数据库）：
 * - diagnostics.json   应用 / 系统 / 运行时信息 + 本包的文件清单
 * - crash.json         仅 reason=crash：崩溃类型、错误信息与堆栈
 * - logs/*.log         electron-log 日志目录下的 .log 文件（单个文件只保留末尾一段）
 * - state/*.json       自动更新状态等小文件
 *
 * 所有文本都会把用户主目录替换成 `~`
 */
import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { LogUploadReason } from '../../shared/log-upload';
import { loadJSZip } from '../document-exporter/jszip';
import { MAX_LOG_FILE_BYTES, MAX_STATE_FILE_BYTES, MAX_TOTAL_LOG_BYTES } from './config';
import { createRedactor, redactValue } from './redact';

/** 崩溃上下文（写入 crash.json） */
export interface CrashContext {
  /** uncaughtException / unhandledRejection / render-process-gone / child-process-gone */
  kind: string;
  message: string;
  stack?: string;
  details?: Record<string, unknown>;
}

export interface LogBundleInput {
  reason: LogUploadReason;
  /** 诊断信息（diagnostics.ts 收集），会原样写入 diagnostics.json（脱敏后） */
  diagnostics: Record<string, unknown>;
  /** electron-log 的日志目录；不存在时跳过 */
  logDir: string | null;
  /** 额外打包的小状态文件（绝对路径），如 userData/updater-state.json */
  stateFiles: string[];
  homeDir: string;
  platform?: NodeJS.Platform;
  crash?: CrashContext | null;
  now?: Date;
  limits?: Partial<{
    maxLogFileBytes: number;
    maxTotalLogBytes: number;
    maxStateFileBytes: number;
  }>;
}

export interface LogBundle {
  buffer: Buffer;
  /** 包内文件路径 */
  entries: string[];
  /** 被截断（只保留末尾）的日志文件 */
  truncated: string[];
}

/** 数据库 / 作品正文等永远不打包的文件 */
const FORBIDDEN_FILE = /\.(db|sqlite|sqlite3|db-wal|db-shm|db-journal|md|markdown|txt|docx)$/i;

function isLogFileName(name: string): boolean {
  return name.toLowerCase().endsWith('.log') && !FORBIDDEN_FILE.test(name);
}

/** 读取文件末尾最多 maxBytes 字节 */
async function readTail(
  filePath: string,
  maxBytes: number
): Promise<{ text: string; truncated: boolean }> {
  const handle = await open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    let text = buffer.toString('utf-8');
    const truncated = size > maxBytes;
    if (truncated) {
      // 丢掉被截断的半行
      const firstBreak = text.indexOf('\n');
      text = `[… 已截断，只保留最后 ${length} 字节 …]\n${firstBreak >= 0 ? text.slice(firstBreak + 1) : text}`;
    }
    return { text, truncated };
  } finally {
    await handle.close();
  }
}

async function listLogFiles(
  logDir: string
): Promise<Array<{ name: string; filePath: string; mtimeMs: number }>> {
  let names: string[];
  try {
    names = await readdir(logDir);
  } catch {
    return [];
  }
  const files: Array<{ name: string; filePath: string; mtimeMs: number }> = [];
  for (const name of names) {
    if (!isLogFileName(name)) continue;
    const filePath = path.join(logDir, name);
    try {
      const info = await stat(filePath);
      if (info.isFile()) files.push({ name, filePath, mtimeMs: info.mtimeMs });
    } catch {
      // 文件在遍历过程中被轮转删除，忽略
    }
  }
  // 最近写入的优先，超出总量上限时先舍弃旧日志
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export async function buildLogBundle(input: LogBundleInput): Promise<LogBundle> {
  const redact = createRedactor(input.homeDir, input.platform);
  const maxLogFileBytes = input.limits?.maxLogFileBytes ?? MAX_LOG_FILE_BYTES;
  const maxTotalLogBytes = input.limits?.maxTotalLogBytes ?? MAX_TOTAL_LOG_BYTES;
  const maxStateFileBytes = input.limits?.maxStateFileBytes ?? MAX_STATE_FILE_BYTES;
  // 按需加载 jszip，避免崩溃钩子在启动时就把它拉进主进程
  const JSZip = await loadJSZip();
  const zip = new JSZip();
  const entries: string[] = [];
  const truncated: string[] = [];
  const skipped: string[] = [];

  if (input.logDir) {
    let total = 0;
    for (const file of await listLogFiles(input.logDir)) {
      const budget = Math.min(maxLogFileBytes, maxTotalLogBytes - total);
      if (budget <= 0) {
        skipped.push(`logs/${file.name}`);
        continue;
      }
      try {
        const { text, truncated: cut } = await readTail(file.filePath, budget);
        const entry = `logs/${file.name}`;
        zip.file(entry, redact(text));
        entries.push(entry);
        if (cut) truncated.push(entry);
        total += Buffer.byteLength(text);
      } catch {
        skipped.push(`logs/${file.name}`);
      }
    }
  }

  for (const filePath of input.stateFiles) {
    const name = path.basename(filePath);
    if (FORBIDDEN_FILE.test(name)) continue;
    try {
      const info = await stat(filePath);
      if (!info.isFile()) continue;
      if (info.size > maxStateFileBytes) {
        skipped.push(`state/${name}`);
        continue;
      }
      const { text } = await readTail(filePath, maxStateFileBytes);
      const entry = `state/${name}`;
      zip.file(entry, redact(text));
      entries.push(entry);
    } catch {
      // 状态文件不存在时跳过
    }
  }

  if (input.crash) {
    zip.file('crash.json', JSON.stringify(redactValue(input.crash, redact), null, 2));
    entries.push('crash.json');
  }

  entries.unshift('diagnostics.json');
  const diagnostics = {
    ...input.diagnostics,
    bundle: {
      reason: input.reason,
      generatedAt: (input.now ?? new Date()).toISOString(),
      files: entries,
      truncated,
      skipped,
    },
  };
  zip.file('diagnostics.json', JSON.stringify(redactValue(diagnostics, redact), null, 2));

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  return { buffer, entries, truncated };
}
