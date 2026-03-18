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
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return { lastFolder: null, folders: [] };
  }
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
