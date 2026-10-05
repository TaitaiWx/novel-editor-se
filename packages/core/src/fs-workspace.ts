/**
 * 工作区文件操作（纯 Node，无 Electron 依赖）
 *
 * GUI 文件浏览器的 IPC handler（apps/pc/src/main/handlers/file-system.ts）只做薄适配，
 * 实际逻辑都在这里：按编码读取、二进制读取、文件信息、删除、粘贴复制（无冲突命名）、
 * 项目导出复制、示例数据播种、生成资料空目录清理。CLI 也可直接复用。
 */
import { existsSync } from 'node:fs';
import {
  access,
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { CoreError, toCoreError } from './errors';
import { pathExists } from './fs-ops';
import { GENERATED_MATERIAL_ROOT_NAME, isGeneratedMaterialPath } from './material';

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

/** 直接覆盖写入 UTF-8 文本（不创建父目录、不做统计，供编辑器自动保存这类高频场景） */
export async function saveTextFile(filePath: string, content: string): Promise<void> {
  try {
    await writeFile(filePath, content, 'utf-8');
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
  try {
    const info = await lstat(filePath);
    if (info.isDirectory()) throw new CoreError('NOT_A_FILE', `不是文件: ${filePath}`);
    await unlink(filePath);
  } catch (error) {
    throw toCoreError(error, filePath);
  }
}

/** 递归删除目录 */
export async function deleteDirectory(dirPath: string): Promise<void> {
  try {
    await rm(dirPath, { recursive: true });
  } catch (error) {
    throw toCoreError(error, dirPath);
  }
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
}

/** 返回不冲突的路径：`base` 不存在时原样返回，否则依次尝试 `base (2)`、`base (3)` … */
export function nextAvailablePath(basePath: string): string {
  if (!existsSync(basePath)) return basePath;
  let counter = 2;
  while (existsSync(`${basePath} (${counter})`)) counter++;
  return `${basePath} (${counter})`;
}

/** 把整个项目目录复制到 destParent 下（同名时追加 ` (n)`），返回最终目标路径 */
export async function copyProjectTo(folderPath: string, destParent: string): Promise<string> {
  if (!existsSync(folderPath)) throw new CoreError('NOT_FOUND', '项目目录不存在');
  const finalDest = nextAvailablePath(path.join(destParent, path.basename(folderPath)));
  try {
    await cp(folderPath, finalDest, { recursive: true });
  } catch (error) {
    throw toCoreError(error, finalDest);
  }
  return finalDest;
}

/**
 * 确保 targetDir 存在：首次调用时从 sourceDir 复制种子数据（例如示例项目），
 * 种子不存在或复制失败时创建空目录。已存在时不做任何改动。
 */
export async function ensureSeededDirectory(targetDir: string, sourceDir: string): Promise<string> {
  if (await pathExists(targetDir)) return targetDir;
  try {
    await access(sourceDir);
    await mkdir(path.dirname(targetDir), { recursive: true });
    await cp(sourceDir, targetDir, { recursive: true });
  } catch {
    await mkdir(targetDir, { recursive: true });
  }
  return targetDir;
}

// ─── 生成资料空目录清理 ────────────────────────────────────────────────────

export { GENERATED_MATERIAL_ROOT_NAME, isGeneratedMaterialPath };
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
}
