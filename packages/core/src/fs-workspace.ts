import { withWorkspaceLease } from './workspace-lock';
/**
 * 工作区文件操作（纯 Node，无 Electron 依赖）
 *
 * GUI 文件浏览器的 IPC handler（apps/pc/src/main/handlers/file-system.ts）只做薄适配，
 * 实际逻辑都在这里：按编码读取、二进制读取、文件信息、删除、粘贴复制（无冲突命名）、
 * 项目导出复制、示例数据播种、生成资料空目录清理。CLI 也可直接复用。
 */
import { existsSync } from 'node:fs';
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { CoreError, toCoreError } from './errors';
import { atomicWriteTextFile } from './atomic-text-file';
import { pathExists } from './fs-ops';
import {
  GENERATED_MATERIAL_ROOT_NAME,
  getMaterialRootPath,
  isGeneratedMaterialPath,
} from './material';
import { PROJECT_META_DIR } from './project';

// ─── 读取 ──────────────────────────────────────────────────────────────────

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
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
};

/** 按扩展名推断 MIME 类型，未知时返回 application/octet-stream */
export function guessMimeType(filePath: string): string {
  return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * 按指定编码读取文本文件。
 * 未指定或为 UTF-8 时直接按 UTF-8 读取；否则使用 TextDecoder（支持 gbk/gb18030/big5/shift_jis 等）。
 */
export async function readTextFileWithEncoding(
  filePath: string,
  encoding?: string
): Promise<string> {
  try {
    if (encoding && encoding.toUpperCase() !== 'UTF-8') {
      const buffer = await readFile(filePath);
      return new TextDecoder(encoding.toLowerCase()).decode(buffer);
    }
    return await readFile(filePath, 'utf-8');
  } catch (error) {
    if (error instanceof RangeError) {
      throw new CoreError('UNSUPPORTED', `不支持的编码: ${encoding}`);
    }
    throw toCoreError(error, filePath);
  }
}

export interface BinaryFileContent {
  base64Content: string;
  byteSize: number;
  mimeType: string;
}

/** 以 base64 读取二进制文件（图片、PDF、音视频预览） */
export async function readFileBinary(filePath: string): Promise<BinaryFileContent> {
  try {
    const buffer = await readFile(filePath);
    return {
      base64Content: buffer.toString('base64'),
      byteSize: buffer.byteLength,
      mimeType: guessMimeType(filePath),
    };
  } catch (error) {
    throw toCoreError(error, filePath);
  }
}

/** 原子替换 UTF-8 文本（不创建父目录、不做统计，供编辑器自动保存这类高频场景） */
export async function saveTextFile(filePath: string, content: string): Promise<void> {
  try {
    await atomicWriteTextFile(filePath, content);
  } catch (error) {
    throw toCoreError(error, filePath);
  }
}

// ─── 文件信息 ──────────────────────────────────────────────────────────────

export interface FileInfo {
  size: number;
  created: Date;
  modified: Date;
  isDirectory: boolean;
  isFile: boolean;
}

export async function getFileInfo(filePath: string): Promise<FileInfo> {
  let stats;
  try {
    stats = await stat(filePath);
  } catch (error) {
    throw toCoreError(error, filePath);
  }
  return {
    size: stats.size,
    created: stats.birthtime,
    modified: stats.mtime,
    isDirectory: stats.isDirectory(),
    isFile: stats.isFile(),
  };
}

/** 批量获取文件信息；不存在或无法访问的路径会被静默跳过，结果保持输入顺序 */
export async function getFileInfoBatch(
  filePaths: readonly string[]
): Promise<Array<{ path: string; info: FileInfo }>> {
  const results = await Promise.allSettled(
    filePaths.map(async (filePath) => ({ path: filePath, info: await getFileInfo(filePath) }))
  );
  return results
    .filter(
      (result): result is PromiseFulfilledResult<{ path: string; info: FileInfo }> =>
        result.status === 'fulfilled'
    )
    .map((result) => result.value);
}

// ─── 删除 ──────────────────────────────────────────────────────────────────

/** 删除单个文件（符号链接只删除链接本身）；目标是目录时报错 */
export async function deleteFile(filePath: string): Promise<void> {
  return withWorkspaceLease(
    async () => {
      try {
        const info = await lstat(filePath);
        if (info.isDirectory()) throw new CoreError('NOT_A_FILE', `不是文件: ${filePath}`);
        await unlink(filePath);
      } catch (error) {
        throw toCoreError(error, filePath);
      }
    },
    { resources: [filePath] }
  );
}

/** 递归删除目录 */
export async function deleteDirectory(dirPath: string): Promise<void> {
  return withWorkspaceLease(
    async () => {
      try {
        await rm(dirPath, { recursive: true });
      } catch (error) {
        throw toCoreError(error, dirPath);
      }
    },
    { resources: [dirPath] }
  );
}

// ─── 复制 / 粘贴 ───────────────────────────────────────────────────────────

/**
 * 计算粘贴时的无冲突目标路径（Finder 风格）：
 * - 文件：`名称 copy.ext`、`名称 copy 2.ext` …
 * - 目录：`名称 copy`、`名称 copy 2` …
 * 目标不存在且源不在目标目录中时，直接使用原名。
 */
export async function resolvePasteDestination(
  sourcePath: string,
  targetDir: string,
  isDirectory: boolean
): Promise<string> {
  const baseName = path.basename(sourcePath);
  let destPath = path.join(targetDir, baseName);
  let needsRename = existsSync(destPath);
  if (!needsRename) {
    // 原地粘贴（源已在目标目录中，例如经由符号链接访问）也需要改名
    const srcReal = await realpath(sourcePath);
    const parentReal = await realpath(targetDir);
    needsRename = path.dirname(srcReal) === parentReal && path.basename(srcReal) === baseName;
  }
  if (!needsRename) return destPath;

  const ext = isDirectory ? '' : path.extname(baseName);
  const stem = ext ? baseName.slice(0, -ext.length) : baseName;
  destPath = path.join(targetDir, `${stem} copy${ext}`);
  let counter = 2;
  while (existsSync(destPath)) {
    destPath = path.join(targetDir, `${stem} copy ${counter}${ext}`);
    counter++;
  }
  return destPath;
}

export interface PasteResult {
  source: string;
  dest: string;
}

/** 把若干文件/目录复制到目标目录，同名时自动生成无冲突名称 */
export async function pastePaths(
  sourcePaths: readonly string[],
  targetDir: string
): Promise<PasteResult[]> {
  return withWorkspaceLease(
    async () => {
      if (!existsSync(targetDir)) {
        throw new CoreError('NOT_FOUND', `目标目录不存在: ${path.basename(targetDir)}`);
      }
      const results: PasteResult[] = [];
      for (const sourcePath of sourcePaths) {
        if (!existsSync(sourcePath)) {
          throw new CoreError('NOT_FOUND', `源文件不存在: ${path.basename(sourcePath)}`);
        }
        const baseName = path.basename(sourcePath);
        const isDirectory = (await stat(sourcePath)).isDirectory();
        const destPath = await resolvePasteDestination(sourcePath, targetDir, isDirectory);
        try {
          if (isDirectory) {
            await cp(sourcePath, destPath, { recursive: true });
          } else {
            await copyFile(sourcePath, destPath);
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          throw new CoreError('IO_ERROR', `粘贴失败 (${baseName}): ${msg}`);
        }
        results.push({ source: sourcePath, dest: destPath });
      }
      return results;
    },
    { resources: [...sourcePaths, targetDir] }
  );
}

/** 返回不冲突的路径：`base` 不存在时原样返回，否则依次尝试 `base (2)`、`base (3)` … */
export function nextAvailablePath(basePath: string): string {
  if (!existsSync(basePath)) return basePath;
  let counter = 2;
  while (existsSync(`${basePath} (${counter})`)) counter++;
  return `${basePath} (${counter})`;
}

export { copyProjectTo } from './project-copy';
export type { ProjectCopyOptions } from './project-copy';

/** 目录是否没有任何可见内容（忽略 .novel-editor 等隐藏项） */
async function hasNoVisibleEntries(dirPath: string): Promise<boolean> {
  try {
    return (await readdir(dirPath)).every((name) => name.startsWith('.'));
  } catch {
    return true;
  }
}

/** 资料下存放 AI 实测结果的文件夹名（「AI实测」） */
export const LIVE_CHECK_DIR_NAME = 'AI\u5b9e\u6d4b';
/** 资料文件夹名（「资料」） */
const MATERIAL_DIR_NAME_FOR_SEED = '\u8d44\u6599';

/**
 * 种子目录中不应被拷贝的本机运行产物：SQLite 数据库（含 WAL/SHM）、GUI 会话、写作日志、系统文件，
 * 以及 `<作品>/资料/AI实测/`（用真实 Key 实测 AI 服务的结果，体积大、只给本机看）。
 * 开发时直接打开过 sample-data 会在其中留下这些文件，拷贝给用户会带入别人的数据
 */
export function isSeedRuntimeArtifact(relativePath: string): boolean {
  const segments = relativePath.split(/[\\/]/).filter(Boolean);
  const name = segments[segments.length - 1] ?? '';
  if (name === '.DS_Store' || name === 'Thumbs.db') return true;
  // 用真实 Key 实测 AI 服务生成的结果（apps/pc/scripts/live-ai-check.mts），只留在本机
  if (
    segments.some(
      (segment, index) =>
        segment === LIVE_CHECK_DIR_NAME && segments[index - 1] === MATERIAL_DIR_NAME_FOR_SEED
    )
  ) {
    return true;
  }
  if (segments.length >= 2 && segments[segments.length - 2] === PROJECT_META_DIR) {
    return (
      /\.db(-wal|-shm|-journal)?$/i.test(name) ||
      name === 'session.json' ||
      name === 'writing-log.json'
    );
  }
  return false;
}

/** 种子目录（示例项目）的版本文件：`<项目>/.novel-editor/sample.json` → `{ "sampleVersion": N }` */
export const SEED_VERSION_FILE = 'sample.json';

/** 读取种子目录版本；没有版本文件（旧版示例）视为 0 */
export async function readSeedVersion(dir: string): Promise<number> {
  try {
    const raw = await readFile(path.join(dir, PROJECT_META_DIR, SEED_VERSION_FILE), 'utf-8');
    const version = (JSON.parse(raw) as { sampleVersion?: unknown }).sampleVersion;
    return typeof version === 'number' && Number.isFinite(version) ? version : 0;
  } catch {
    return 0;
  }
}

export type SeedSyncStatus = 'created' | 'filled' | 'upgraded' | 'unchanged';

export interface SeedSyncResult {
  path: string;
  status: SeedSyncStatus;
  /** status 为 upgraded 时，旧副本被整体改名保存到的位置 */
  backupPath?: string;
  version: number;
}

function formatBackupStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours()
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function copySeed(sourceDir: string, targetDir: string): Promise<void> {
  await mkdir(path.dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, {
    recursive: true,
    force: false,
    errorOnExist: false,
    filter: (source) => !isSeedRuntimeArtifact(path.relative(sourceDir, source)),
  });
}

/**
 * 让 targetDir 与 sourceDir 的示例内容保持同步：
 * - 不存在：整体拷贝（跳过 isSeedRuntimeArtifact 识别的本机运行产物）→ created
 * - 已存在但没有可见内容（例如此前源路径错误只建了空目录）：补拷贝，不覆盖已有文件 → filled
 * - 种子版本高于本机副本（旧版示例没有版本文件视为 0）：旧副本整体改名备份为
 *   `<目录>-旧版-<时间>`（保留用户在其中的改动与数据库），再拷贝新版 → upgraded
 * - 其余情况保持不动 → unchanged
 */
export async function syncSeededDirectory(
  targetDir: string,
  sourceDir: string,
  now: Date = new Date()
): Promise<SeedSyncResult> {
  return withWorkspaceLease(
    async () => {
      if (!(await pathExists(sourceDir))) {
        await mkdir(targetDir, { recursive: true });
        return { path: targetDir, status: 'unchanged', version: 0 };
      }
      const sourceVersion = await readSeedVersion(sourceDir);

      if (!(await pathExists(targetDir))) {
        await copySeed(sourceDir, targetDir);
        return { path: targetDir, status: 'created', version: sourceVersion };
      }
      if (await hasNoVisibleEntries(targetDir)) {
        await copySeed(sourceDir, targetDir);
        return { path: targetDir, status: 'filled', version: sourceVersion };
      }

      const targetVersion = await readSeedVersion(targetDir);
      if (sourceVersion <= targetVersion) {
        return { path: targetDir, status: 'unchanged', version: targetVersion };
      }

      let backupPath = `${targetDir}-旧版-${formatBackupStamp(now)}`;
      for (let index = 2; await pathExists(backupPath); index += 1) {
        backupPath = `${targetDir}-旧版-${formatBackupStamp(now)}-${index}`;
      }
      await rename(targetDir, backupPath);
      await copySeed(sourceDir, targetDir);
      return { path: targetDir, status: 'upgraded', backupPath, version: sourceVersion };
    },
    { resources: [path.dirname(targetDir), sourceDir] }
  );
}

/** 兼容旧调用：同步示例目录并返回其路径 */
export async function ensureSeededDirectory(targetDir: string, sourceDir: string): Promise<string> {
  return withWorkspaceLease(
    async () => {
      try {
        return (await syncSeededDirectory(targetDir, sourceDir)).path;
      } catch {
        await mkdir(targetDir, { recursive: true });
        return targetDir;
      }
    },
    { resources: [path.dirname(targetDir), sourceDir] }
  );
}

// ─── 生成资料空目录清理 ────────────────────────────────────────────────────

export { GENERATED_MATERIAL_ROOT_NAME, getMaterialRootPath, isGeneratedMaterialPath };
/** 资料根目录下由程序生成、可安全清理的作用域子目录 */
export const GENERATED_MATERIAL_SCOPE_DIRS: ReadonlySet<string> = new Set([
  'AI资料',
  '项目上下文',
  '卷上下文',
  '章上下文',
]);

async function isEmptyDirectory(dirPath: string): Promise<boolean> {
  try {
    return (await readdir(dirPath)).length === 0;
  } catch {
    return false;
  }
}

/**
 * 清理项目中空的生成资料目录：只删除 `资料/` 下已知作用域的空子目录，
 * 若 `资料/` 随之变空也一并删除。返回被删除的目录路径。
 *
 * 使用 rmdir 而非 rm({ recursive: false })：后者对目录总是抛 ERR_FS_EISDIR，
 * 且 rmdir 只能删除空目录，即使与其他写入发生竞争也不会误删内容。
 */
export async function cleanupEmptyGeneratedMaterialDirectories(
  folderPath: string
): Promise<string[]> {
  return withWorkspaceLease(
    async () => {
      const removed: string[] = [];
      const materialRootPath = path.join(folderPath, GENERATED_MATERIAL_ROOT_NAME);
      try {
        if (!(await stat(materialRootPath)).isDirectory()) return removed;
      } catch {
        return removed;
      }

      for (const childName of await readdir(materialRootPath)) {
        if (!GENERATED_MATERIAL_SCOPE_DIRS.has(childName)) continue;
        const childPath = path.join(materialRootPath, childName);
        try {
          if (!(await stat(childPath)).isDirectory()) continue;
          if (!(await isEmptyDirectory(childPath))) continue;
          await rmdir(childPath);
          removed.push(childPath);
        } catch {
          // 安全迁移只处理明确可删的空目录，失败时跳过
        }
      }

      if (await isEmptyDirectory(materialRootPath)) {
        try {
          await rmdir(materialRootPath);
          removed.push(materialRootPath);
        } catch {
          // 根目录无法删除时保留现场，不影响其他功能
        }
      }
      return removed;
    },
    { resources: [folderPath] }
  );
}
