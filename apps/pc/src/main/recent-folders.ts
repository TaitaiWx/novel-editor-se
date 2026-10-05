/**
 * Recent folders manager — persists recent project paths to userData.
 * Follows VS Code pattern: reopen last folder on startup, maintain history.
 */
import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const MAX_RECENT = 10;

interface RecentFoldersData {
  lastFolder: string | null;
  folders: string[];
}

function getFilePath(): string {
  return join(app.getPath('userData'), 'recent-folders.json');
}

function read(): RecentFoldersData {
  const filePath = getFilePath();
  if (!existsSync(filePath)) {
    return { lastFolder: null, folders: [] };
  }
  try {
    return normalize(JSON.parse(readFileSync(filePath, 'utf-8')));
  } catch {
    return { lastFolder: null, folders: [] };
  }
}

/** 校验并规范化磁盘上的数据结构，字段缺失或类型错误时回退为默认值 */
function normalize(raw: unknown): RecentFoldersData {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { lastFolder: null, folders: [] };
  }
  const record = raw as Record<string, unknown>;
  const folders = Array.isArray(record.folders)
    ? record.folders.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
  const lastFolder = typeof record.lastFolder === 'string' ? record.lastFolder : null;
  return { lastFolder, folders: Array.from(new Set(folders)).slice(0, MAX_RECENT) };
}

function write(data: RecentFoldersData): void {
  writeFileSync(getFilePath(), JSON.stringify(data, null, 2), 'utf-8');
}

/** Add a folder to recents and set it as last opened. */
export function addRecentFolder(folderPath: string): void {
  const data = read();
  // Remove duplicate, prepend
  data.folders = [folderPath, ...data.folders.filter((f) => f !== folderPath)].slice(0, MAX_RECENT);
  data.lastFolder = folderPath;
  write(data);
}

/** Get the last opened folder path, or null if none. */
export function getLastFolder(): string | null {
  return read().lastFolder;
}

/** Get the list of recently opened folders. */
export function getRecentFolders(): string[] {
  return read().folders;
}

/** Clear recent folder history and last opened folder marker. */
export function clearRecentFolders(): void {
  write({ lastFolder: null, folders: [] });
}
