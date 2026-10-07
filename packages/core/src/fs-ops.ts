/**
 * 文件系统基础操作（纯 Node，无 Electron 依赖）
 *
 * GUI（apps/pc/src/main/handlers/file-system.ts）与 CLI 共用这里的实现。
 * 文件树排除规则按「条目名称」精确匹配，避免误伤 outline/builder 之类的正常文件名。
 */
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { CoreError, toCoreError } from './errors';
import { createGlobMatcher } from './glob';
import { analyzeContentStats } from './text-stats';

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: FileNode[];
  /** GUI 资料树：该目录是一场场景视频（内部分镜状态已隐藏，点击打开画布），见 internal-data.ts */
  sceneVideo?: boolean;
}

/** 文件树默认排除的条目名称 */
export const DEFAULT_EXCLUDED_NAMES: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.novel-editor',
  '.vscode',
  '.DS_Store',
  'dist',
  'build',
  'out',
]);

/** 视为正文（可统计、可导出）的文本扩展名，与 GUI workspace.ts 的 STORY_FILE_EXTENSIONS 一致 */
export const STORY_FILE_EXTENSIONS: readonly string[] = ['.md', '.markdown', '.txt'];

export const naturalCollator = new Intl.Collator('zh-Hans-CN', {
  numeric: true,
  sensitivity: 'base',
});

export function isStoryFile(filePath: string): boolean {
  return STORY_FILE_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function assertFile(target: string): Promise<void> {
  let info;
  try {
    info = await stat(target);
  } catch (error) {
    throw toCoreError(error, target);
  }
  if (!info.isFile()) throw new CoreError('NOT_A_FILE', `不是文件: ${target}`);
}

export async function assertDirectory(target: string): Promise<void> {
  let info;
  try {
    info = await stat(target);
  } catch (error) {
    throw toCoreError(error, target);
  }
  if (!info.isDirectory()) throw new CoreError('NOT_A_DIRECTORY', `不是目录: ${target}`);
}

export interface ListTreeOptions {
  /** 最大递归深度，默认不限（Infinity）。1 表示只列出直接子项 */
  depth?: number;
  /** 是否包含以 `.` 开头的隐藏条目 */
  includeHidden?: boolean;
  /** 额外排除的条目名称 */
  exclude?: Iterable<string>;
}

/** 文件树遍历的完整选项（listTree 与 readFolderTree 共用同一遍历实现） */
export interface BuildTreeOptions extends ListTreeOptions {
  /** natural：目录优先 + 自然排序（默认）；none：保持文件系统返回的顺序 */
  sort?: 'natural' | 'none';
  /** 文件节点是否携带 size（默认 true） */
  includeSize?: boolean;
  /** 是否跟随符号链接（默认 false，即忽略符号链接）；跟随时同一链接只展开一次以防循环 */
  followSymlinks?: boolean;
  /** 遇到无权限目录 / 无法 stat 的条目时跳过而不是抛错（默认 false） */
  skipUnreadable?: boolean;
}

/** 操作系统自动生成、对作者无意义的系统文件（不以 `.` 开头，但同样视为隐藏） */
export const SYSTEM_HIDDEN_NAMES: ReadonlySet<string> = new Set([
  'Thumbs.db',
  'ehthumbs.db',
  'desktop.ini',
  '$RECYCLE.BIN',
  'System Volume Information',
  'Icon\r',
]);

/** 是否为隐藏条目：以 `.` 开头的 dotfile，或系统自动生成的文件 */
export function isHiddenEntryName(name: string): boolean {
  return name.startsWith('.') || SYSTEM_HIDDEN_NAMES.has(name);
}

function shouldSkip(name: string, options: ListTreeOptions, extra: Set<string>): boolean {
  if (DEFAULT_EXCLUDED_NAMES.has(name) || extra.has(name)) return true;
  return !options.includeHidden && isHiddenEntryName(name);
}

function sortNodes(nodes: FileNode[]): FileNode[] {
  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return naturalCollator.compare(a.name, b.name);
  });
}

function isPermissionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === 'EACCES' || code === 'EPERM';
}

/**
 * 遍历目录，返回子节点列表。
 * 路径通过 path.join(dir, name) 拼接，不做 resolve，保证调用方传入的根路径形态原样保留。
 * 无权限目录在 skipUnreadable 下返回 null（由调用方丢弃该目录节点）。
 */
export async function buildFileTree(
  dir: string,
  options: BuildTreeOptions = {}
): Promise<FileNode[]> {
  const maxDepth = options.depth ?? Number.POSITIVE_INFINITY;
  const extra = new Set(options.exclude ?? []);
  const includeSize = options.includeSize !== false;
  const visitedLinks = new Set<string>();

  const readChildren = async (current: string, depth: number): Promise<FileNode[] | null> => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (options.skipUnreadable && isPermissionError(error)) return null;
      throw toCoreError(error, current);
    }
    const nodes: FileNode[] = [];
    for (const entry of entries) {
      if (shouldSkip(entry.name, options, extra)) continue;
      const full = path.join(current, entry.name);
      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      let size: number | undefined;
      try {
        if (entry.isSymbolicLink()) {
          if (!options.followSymlinks) continue;
          const linkInfo = await lstat(full);
          const linkKey = `${linkInfo.dev}:${linkInfo.ino}`;
          if (visitedLinks.has(linkKey)) continue;
          visitedLinks.add(linkKey);
          const target = await stat(full);
          isDirectory = target.isDirectory();
          isFile = target.isFile();
          size = target.size;
        } else if (isFile && includeSize) {
          size = (await stat(full)).size;
        }
      } catch (error) {
        // 断链或条目在遍历中被删除
        if (options.skipUnreadable) continue;
        throw toCoreError(error, full);
      }
      if (isDirectory) {
        const node: FileNode = { name: entry.name, path: full, type: 'directory' };
        if (depth < maxDepth) {
          const children = await readChildren(full, depth + 1);
          if (children === null) continue;
          node.children = children;
        }
        nodes.push(node);
      } else if (isFile) {
        const node: FileNode = { name: entry.name, path: full, type: 'file' };
        if (includeSize && size !== undefined) node.size = size;
        nodes.push(node);
      }
    }
    return options.sort === 'none' ? nodes : sortNodes(nodes);
  };

  return (await readChildren(dir, 1)) ?? [];
}

/** 列出目录文件树（目录优先、自然排序） */
export async function listTree(root: string, options: ListTreeOptions = {}): Promise<FileNode> {
  const absRoot = path.resolve(root);
  await assertDirectory(absRoot);
  return {
    name: path.basename(absRoot),
    path: absRoot,
    type: 'directory',
    children: await buildFileTree(absRoot, options),
  };
}

/** GUI 文件浏览器使用的文件夹结构 */
export interface FolderTree {
  path: string;
  files: FileNode[];
}

/** readFolderTree 选项 */
export interface ReadFolderTreeOptions {
  /** 是否显示隐藏文件（dotfile 与 Thumbs.db 等系统文件），默认 false；DEFAULT_EXCLUDED_NAMES 始终排除 */
  includeHidden?: boolean;
}

/**
 * 读取 GUI 文件浏览器的文件树（open-local-folder / refresh-folder 共用）。
 *
 * 与 GUI 早期基于 directory-tree 的行为保持一致：
 * - 保持文件系统返回顺序（排序由渲染进程负责）
 * - 默认隐藏 dotfile 与系统文件（与 CLI `ne file list` 一致，`includeHidden` 可显示）
 * - 跟随符号链接、跳过无权限目录
 * - 节点不带 size；目录节点总有 children 数组
 * - 根目录不存在或不是目录时返回空列表而不是抛错
 *
 * 唯一有意的差异：排除规则按条目名称精确匹配，而不是对整条路径做子串正则匹配，
 * 避免 `outline.md`、`.github`、或根路径中含 `build`/`out` 的目录被误隐藏。
 */
export async function readFolderTree(
  folderPath: string,
  options: ReadFolderTreeOptions = {}
): Promise<FolderTree> {
  try {
    const info = await stat(folderPath);
    if (!info.isDirectory()) return { path: folderPath, files: [] };
  } catch {
    return { path: folderPath, files: [] };
  }
  const files = await buildFileTree(folderPath, {
    includeHidden: options.includeHidden === true,
    sort: 'none',
    includeSize: false,
    followSymlinks: true,
    skipUnreadable: true,
  });
  return { path: folderPath, files };
}

export interface WalkFilesOptions {
  /** glob 过滤（相对于根目录），例如 `**\/*.md` 或 `*.txt` */
  glob?: string;
  /** 只保留正文文件（.md/.markdown/.txt） */
  storyOnly?: boolean;
  includeHidden?: boolean;
}

/**
 * 收集目录下的所有文件（绝对路径，自然排序）。
 * 若传入的是文件路径，则直接返回该文件。
 */
export async function walkFiles(target: string, options: WalkFilesOptions = {}): Promise<string[]> {
  const absTarget = path.resolve(target);
  let info;
  try {
    info = await stat(absTarget);
  } catch (error) {
    throw toCoreError(error, absTarget);
  }
  if (info.isFile()) return [absTarget];

  const matcher = options.glob ? createGlobMatcher(options.glob) : null;
  const result: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => naturalCollator.compare(a.name, b.name));
    for (const entry of entries) {
      if (shouldSkip(entry.name, options, new Set())) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        if (options.storyOnly && !isStoryFile(full)) continue;
        if (matcher && !matcher(path.relative(absTarget, full))) continue;
        result.push(full);
      }
    }
  };
  await walk(absTarget);
  return result;
}

export async function readTextFile(filePath: string): Promise<string> {
  const abs = path.resolve(filePath);
  await assertFile(abs);
  try {
    return await readFile(abs, 'utf-8');
  } catch (error) {
    throw toCoreError(error, abs);
  }
}

export interface WriteResult {
  path: string;
  /** 本次写入是否新建了文件 */
  created: boolean;
  /** 写入前字数（新建时为 0） */
  previousChars: number;
  /** 写入后字数 */
  chars: number;
  bytes: number;
}

export interface WriteOptions {
  /** 自动创建父目录，默认 true */
  parents?: boolean;
  /** 追加而不是覆盖 */
  append?: boolean;
}

/** 写入文本文件（覆盖或追加），返回前后字数用于写作统计 */
export async function writeTextFile(
  filePath: string,
  content: string,
  options: WriteOptions = {}
): Promise<WriteResult> {
  const abs = path.resolve(filePath);
  let previous: string | null = null;
  if (await pathExists(abs)) {
    await assertFile(abs);
    previous = await readFile(abs, 'utf-8');
  }
  const finalContent = options.append && previous !== null ? previous + content : content;
  try {
    if (options.parents !== false) await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, finalContent, 'utf-8');
  } catch (error) {
    throw toCoreError(error, abs);
  }
  return {
    path: abs,
    created: previous === null,
    previousChars: previous === null ? 0 : analyzeContentStats(previous).charCount,
    chars: analyzeContentStats(finalContent).charCount,
    bytes: Buffer.byteLength(finalContent, 'utf-8'),
  };
}

/** 新建文件，已存在时报错 */
export async function createFile(filePath: string, content = ''): Promise<WriteResult> {
  const abs = path.resolve(filePath);
  if (await pathExists(abs)) throw new CoreError('ALREADY_EXISTS', `文件已存在: ${abs}`);
  return writeTextFile(abs, content, { parents: true });
}

/** 新建目录，已存在时报错 */
export async function createDirectory(dirPath: string): Promise<string> {
  const abs = path.resolve(dirPath);
  if (await pathExists(abs)) throw new CoreError('ALREADY_EXISTS', `目录已存在: ${abs}`);
  await mkdir(abs, { recursive: true });
  return abs;
}

export interface DeleteResult {
  path: string;
  type: 'file' | 'directory';
}

/** 删除文件或目录；删除非空目录需要 recursive */
export async function deletePath(
  target: string,
  options: { recursive?: boolean } = {}
): Promise<DeleteResult> {
  const abs = path.resolve(target);
  let info;
  try {
    info = await stat(abs);
  } catch (error) {
    throw toCoreError(error, abs);
  }
  if (info.isDirectory()) {
    const entries = await readdir(abs);
    if (entries.length > 0 && !options.recursive) {
      throw new CoreError('INVALID_ARGUMENT', `目录非空，需要 --recursive 才能删除: ${abs}`);
    }
    await rm(abs, { recursive: true, force: false });
    return { path: abs, type: 'directory' };
  }
  await rm(abs, { force: false });
  return { path: abs, type: 'file' };
}

/** 两个路径是否指向同一个文件系统条目（不跟随符号链接） */
export async function isSameEntry(a: string, b: string): Promise<boolean> {
  try {
    const [infoA, infoB] = await Promise.all([lstat(a), lstat(b)]);
    return infoA.dev === infoB.dev && infoA.ino === infoB.ino;
  } catch {
    return false;
  }
}

/** 重命名/移动文件或目录 */
export async function renamePath(
  oldPath: string,
  newPath: string,
  options: { overwrite?: boolean } = {}
): Promise<{ from: string; to: string }> {
  const from = path.resolve(oldPath);
  const to = path.resolve(newPath);
  if (!(await pathExists(from))) throw new CoreError('NOT_FOUND', `路径不存在: ${from}`);
  if (from !== to && (await pathExists(to)) && !options.overwrite) {
    // 大小写不敏感的文件系统上仅改大小写（a.md → A.md）时，目标与源是同一文件，允许重命名
    if (!(await isSameEntry(from, to))) {
      throw new CoreError('ALREADY_EXISTS', `目标已存在: ${to}`);
    }
  }
  try {
    await mkdir(path.dirname(to), { recursive: true });
    await rename(from, to);
  } catch (error) {
    throw toCoreError(error, from);
  }
  return { from, to };
}
