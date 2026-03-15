import { createHash } from 'crypto';
import { readdir, readFile, stat, writeFile } from 'fs/promises';
import path from 'path';
import { getDatabase, novelOps } from './database';

const IGNORED_NAMES = new Set([
  '.git',
  '.novel-editor',
  '.vscode',
  'node_modules',
  'dist',
  'build',
  'out',
  '.DS_Store',
]);

const MIME_BY_EXT: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.yml': 'application/yaml',
  '.yaml': 'application/yaml',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.scss': 'text/x-scss',
  '.css': 'text/css',
  '.html': 'text/html',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.zip': 'application/zip',
};

export interface VersionSnapshotInfo {
  id: number;
  message: string;
  date: string;
  totalFiles: number;
  totalBytes: number;
}

export interface SnapshotFileContent {
  snapshotId: number;
  relativePath: string;
  isBinary: boolean;
  mimeType: string;
  byteSize: number;
  content: string | null;
  base64Content: string | null;
}

export interface SnapshotProgress {
  stage: 'scanning' | 'persisting';
  discoveredFiles: number;
  processedFiles: number;
  totalFiles: number;
  processedBytes: number;
  totalBytes: number;
}

interface ScannedFile {
  relativePath: string;
  buffer: Buffer;
  contentHash: string;
  byteSize: number;
  isBinary: boolean;
  mimeType: string;
}

interface FileDescriptor {
  absolutePath: string;
  relativePath: string;
  byteSize: number;
  mimeType: string;
}

function guessMimeType(filePath: string): string {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function isBinaryBuffer(buffer: Buffer): boolean {
  const sampleSize = Math.min(buffer.length, 4096);
  if (sampleSize === 0) return false;

  let suspicious = 0;
  for (let index = 0; index < sampleSize; index++) {
    const value = buffer[index];
    if (value === 0) return true;
    if (value < 7 || (value > 14 && value < 32)) suspicious++;
  }

  return suspicious / sampleSize > 0.1;
}

async function collectFileDescriptors(
  rootDir: string,
  onProgress?: (progress: SnapshotProgress) => void,
  currentDir = rootDir,
  state = {
    discoveredFiles: 0,
    processedFiles: 0,
    totalFiles: 0,
    processedBytes: 0,
    totalBytes: 0,
  }
): Promise<FileDescriptor[]> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const result: FileDescriptor[] = [];

  for (const entry of entries) {
    if (IGNORED_NAMES.has(entry.name)) continue;

    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await collectFileDescriptors(rootDir, onProgress, absolutePath, state)));
      continue;
    }

    if (!entry.isFile()) continue;

    const fileStat = await stat(absolutePath);
    const relativePath = path.relative(rootDir, absolutePath).replace(/\\/g, '/');

    state.discoveredFiles += 1;
    state.totalFiles = state.discoveredFiles;
    state.totalBytes += fileStat.size;

    onProgress?.({
      stage: 'scanning',
      discoveredFiles: state.discoveredFiles,
      processedFiles: state.processedFiles,
      totalFiles: state.totalFiles,
      processedBytes: state.processedBytes,
      totalBytes: state.totalBytes,
    });

    result.push({
      absolutePath,
      relativePath,
      byteSize: fileStat.size,
      mimeType: guessMimeType(relativePath),
    });
  }
  return result;
}

async function scanDirectoryWithProgress(
  rootDir: string,
  onProgress?: (progress: SnapshotProgress) => void
): Promise<ScannedFile[]> {
  const progressState = {
    discoveredFiles: 0,
    processedFiles: 0,
    totalFiles: 0,
    processedBytes: 0,
    totalBytes: 0,
  };
  const descriptors = await collectFileDescriptors(rootDir, onProgress, rootDir, progressState);
  descriptors.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  const result: ScannedFile[] = [];
  const batchSize = 8;
  for (let index = 0; index < descriptors.length; index += batchSize) {
    const batch = descriptors.slice(index, index + batchSize);
    const scannedBatch = await Promise.all(
      batch.map(async (descriptor) => {
        const buffer = await readFile(descriptor.absolutePath);
        const isBinary = isBinaryBuffer(buffer);

        return {
          relativePath: descriptor.relativePath,
          buffer,
          contentHash: createHash('sha256').update(buffer).digest('hex'),
          byteSize: descriptor.byteSize,
          isBinary,
          mimeType: descriptor.mimeType,
        } satisfies ScannedFile;
      })
    );

    for (const file of scannedBatch) {
      result.push(file);
      progressState.processedFiles += 1;
      progressState.processedBytes += file.byteSize;

      onProgress?.({
        stage: 'scanning',
        discoveredFiles: progressState.discoveredFiles,
        processedFiles: progressState.processedFiles,
        totalFiles: progressState.totalFiles,
        processedBytes: progressState.processedBytes,
        totalBytes: progressState.totalBytes,
      });
    }
  }

  return result;
}

function ensureNovel(folderPath: string): number {
  const existing = novelOps.getByFolder(folderPath) as { id: number } | undefined;
  if (existing?.id) return existing.id;

  const created = novelOps.create(path.basename(folderPath), folderPath, '');
  return Number(created.lastInsertRowid);
}

function normalizeRelativePath(folderPath: string, filePath: string): string {
  return path.relative(folderPath, filePath).replace(/\\/g, '/');
}

function cleanupOrphanBlobs(): void {
  getDatabase()
    .prepare(
      `DELETE FROM version_blobs
       WHERE NOT EXISTS (
         SELECT 1 FROM version_entries WHERE version_entries.content_hash = version_blobs.content_hash
       )`
    )
    .run();
}

export const versionOps = {
  ensureProject(folderPath: string) {
    return ensureNovel(folderPath);
  },

  async createSnapshot(
    folderPath: string,
    message?: string,
    onProgress?: (progress: SnapshotProgress) => void
  ): Promise<number | null> {
    const database = getDatabase();
    const novelId = ensureNovel(folderPath);
    const files = await scanDirectoryWithProgress(folderPath, onProgress);
    const latestSnapshot = database
      .prepare('SELECT id FROM version_snapshots WHERE novel_id = ? ORDER BY id DESC LIMIT 1')
      .get(novelId) as { id: number } | undefined;

    if (latestSnapshot) {
      const previousEntries = database
        .prepare(
          'SELECT relative_path, content_hash FROM version_entries WHERE snapshot_id = ? ORDER BY relative_path'
        )
        .all(latestSnapshot.id) as { relative_path: string; content_hash: string }[];

      const unchanged =
        previousEntries.length === files.length &&
        previousEntries.every(
          (entry, index) =>
            entry.relative_path === files[index]?.relativePath &&
            entry.content_hash === files[index]?.contentHash
        );

      if (unchanged) return null;
    }

    const snapshotMessage = message?.trim() || `手动保存 ${new Date().toLocaleString('zh-CN')}`;
    const totalBytes = files.reduce((sum, file) => sum + file.byteSize, 0);

    const insertSnapshot = database.prepare(
      'INSERT INTO version_snapshots (novel_id, message, total_files, total_bytes) VALUES (?, ?, ?, ?)'
    );
    const selectBlob = database.prepare(
      'SELECT content_hash FROM version_blobs WHERE content_hash = ? LIMIT 1'
    );
    const insertBlob = database.prepare(
      `INSERT INTO version_blobs (content_hash, content, byte_size, is_binary, mime_type)
       VALUES (?, ?, ?, ?, ?)`
    );
    const insertEntry = database.prepare(
      `INSERT INTO version_entries (snapshot_id, relative_path, content_hash, byte_size, is_binary, mime_type)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    const transaction = database.transaction(() => {
      const snapshot = insertSnapshot.run(novelId, snapshotMessage, files.length, totalBytes);
      const snapshotId = Number(snapshot.lastInsertRowid);

      onProgress?.({
        stage: 'persisting',
        discoveredFiles: files.length,
        processedFiles: 0,
        totalFiles: files.length,
        processedBytes: 0,
        totalBytes,
      });

      let persistedFiles = 0;
      let persistedBytes = 0;

      for (const file of files) {
        const exists = selectBlob.get(file.contentHash) as { content_hash: string } | undefined;
        if (!exists) {
          insertBlob.run(
            file.contentHash,
            file.buffer,
            file.byteSize,
            file.isBinary ? 1 : 0,
            file.mimeType
          );
        }

        insertEntry.run(
          snapshotId,
          file.relativePath,
          file.contentHash,
          file.byteSize,
          file.isBinary ? 1 : 0,
          file.mimeType
        );

        persistedFiles += 1;
        persistedBytes += file.byteSize;
        onProgress?.({
          stage: 'persisting',
          discoveredFiles: files.length,
          processedFiles: persistedFiles,
          totalFiles: files.length,
          processedBytes: persistedBytes,
          totalBytes,
        });
      }

      return snapshotId;
    });

    return transaction();
  },

  listSnapshots(folderPath: string, filePath?: string, limit = 50): VersionSnapshotInfo[] {
    const database = getDatabase();
    const novel = novelOps.getByFolder(folderPath) as { id: number } | undefined;
    if (!novel?.id) return [];

    if (filePath) {
      const relativePath = normalizeRelativePath(folderPath, filePath);
      return database
        .prepare(
          `SELECT s.id, s.message, s.created_at, s.total_files, s.total_bytes
           FROM version_snapshots s
           INNER JOIN version_entries e ON e.snapshot_id = s.id
           WHERE s.novel_id = ? AND e.relative_path = ?
           ORDER BY s.id DESC
           LIMIT ?`
        )
        .all(novel.id, relativePath, limit)
        .map((row) => ({
          id: Number((row as { id: number }).id),
          message: String((row as { message: string }).message),
          date: String((row as { created_at: string }).created_at),
          totalFiles: Number((row as { total_files: number }).total_files),
          totalBytes: Number((row as { total_bytes: number }).total_bytes),
        }));
    }

    return database
      .prepare(
        `SELECT id, message, created_at, total_files, total_bytes
         FROM version_snapshots
         WHERE novel_id = ?
         ORDER BY id DESC
         LIMIT ?`
      )
      .all(novel.id, limit)
      .map((row) => ({
        id: Number((row as { id: number }).id),
        message: String((row as { message: string }).message),
        date: String((row as { created_at: string }).created_at),
        totalFiles: Number((row as { total_files: number }).total_files),
        totalBytes: Number((row as { total_bytes: number }).total_bytes),
      }));
  },

  renameSnapshot(snapshotId: number, newMessage: string) {
    return getDatabase()
      .prepare('UPDATE version_snapshots SET message = ? WHERE id = ?')
      .run(newMessage, snapshotId);
  },

  deleteSnapshot(snapshotId: number) {
    const database = getDatabase();
    const transaction = database.transaction(() => {
      database.prepare('DELETE FROM version_entries WHERE snapshot_id = ?').run(snapshotId);
      database.prepare('DELETE FROM version_snapshots WHERE id = ?').run(snapshotId);
      cleanupOrphanBlobs();
    });
    transaction();
  },

  getSnapshotFileContent(
    folderPath: string,
    snapshotId: number,
    filePath: string
  ): SnapshotFileContent {
    const relativePath = normalizeRelativePath(folderPath, filePath);
    const row = getDatabase()
      .prepare(
        `SELECT e.relative_path, e.byte_size, e.is_binary, e.mime_type, b.content
         FROM version_entries e
         INNER JOIN version_blobs b ON b.content_hash = e.content_hash
         WHERE e.snapshot_id = ? AND e.relative_path = ?`
      )
      .get(snapshotId, relativePath) as
      | {
          relative_path: string;
          byte_size: number;
          is_binary: number;
          mime_type: string;
          content: Buffer;
        }
      | undefined;

    if (!row) {
      throw new Error(`版本中不存在文件: ${relativePath}`);
    }

    return {
      snapshotId,
      relativePath: row.relative_path,
      isBinary: row.is_binary === 1,
      mimeType: row.mime_type,
      byteSize: row.byte_size,
      content: row.is_binary === 1 ? null : row.content.toString('utf-8'),
      base64Content: row.is_binary === 1 ? row.content.toString('base64') : null,
    };
  },

  async restoreFileFromSnapshot(folderPath: string, snapshotId: number, filePath: string) {
    const relativePath = normalizeRelativePath(folderPath, filePath);
    const row = getDatabase()
      .prepare(
        `SELECT b.content
         FROM version_entries e
         INNER JOIN version_blobs b ON b.content_hash = e.content_hash
         WHERE e.snapshot_id = ? AND e.relative_path = ?`
      )
      .get(snapshotId, relativePath) as { content: Buffer } | undefined;

    if (!row) {
      throw new Error(`版本中不存在文件: ${relativePath}`);
    }

    await writeFile(filePath, row.content);
  },
};
