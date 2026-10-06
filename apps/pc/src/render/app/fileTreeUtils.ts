/**
 * 文件树与路径相关的纯函数工具
 */
import type { FileNode } from '@/render/types';
import { createVolumeWorkspaceTab, parseVolumeWorkspaceTab } from '@/render/utils/workspace';
import { getPathBasename } from '@/render/utils/path';

export function findNodeInTree(nodes: FileNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children) {
      const found = findNodeInTree(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

export function isDraftLikeName(name: string): boolean {
  return /(draft|sample|test|outline|note|草稿|样稿|测试|片段|提纲|灵感)/i.test(name);
}

export function isVolumeLikeName(name: string): boolean {
  return /(^第[一二三四五六七八九十百千万零〇\d]+卷)|(^volume\s*\d+)|(^part\s*\d+)|(^act\s*\d+)|(^卷[\s_-]?\d+)/i.test(
    name.replace(/\.[^.]+$/, '')
  );
}

export function isMaterialLikeName(name: string): boolean {
  return /(资料|素材|media|material|materials|asset|assets|reference|references|research|image|images|doc|docs|pdf)/i.test(
    name
  );
}

/**
 * 作用域（当前作品目录，或普通文件夹 / 未归属时的项目根）下已有的资料目录，优先名为「资料」的目录。
 * files 是项目根的子节点；scopePath 不在树中（即项目根本身）时在顶层查找。
 */
export function findScopeMaterialRoot(files: FileNode[], scopePath: string): FileNode | null {
  const scopeNode = findNodeInTree(files, scopePath);
  const children = scopeNode?.type === 'directory' ? (scopeNode.children ?? []) : files;
  const candidates = children.filter(
    (node) => node.type === 'directory' && isMaterialLikeName(node.name)
  );
  return candidates.find((node) => node.name === '资料') ?? candidates[0] ?? null;
}

function countTreeFiles(node: FileNode): number {
  if (node.type === 'file') return 1;
  return (node.children ?? []).reduce((sum, child) => sum + countTreeFiles(child), 0);
}

/**
 * 「清空资料」的删除目标：资料分区的树是从完整文件树筛出来的，同一路径的目录里可能还有正文
 * （例如作品目录、novels 容器）。只有资料树节点与完整树中的同一目录内容一致时才整体删除，
 * 否则逐层深入只删资料文件，绝不会删到正文。
 */
export function collectMaterialDeletionTargets(
  materialNodes: FileNode[],
  fullTree: FileNode[]
): FileNode[] {
  const targets: FileNode[] = [];
  materialNodes.forEach((node) => {
    if (node.type === 'file') {
      targets.push(node);
      return;
    }
    const full = findNodeInTree(fullTree, node.path);
    if (full && countTreeFiles(full) === countTreeFiles(node)) {
      targets.push(node);
      return;
    }
    targets.push(...collectMaterialDeletionTargets(node.children ?? [], fullTree));
  });
  return targets;
}

export function ensureMarkdownFileName(name: string): string {
  return /\.[^./\\]+$/.test(name) ? name : `${name}.md`;
}

const INVALID_FILE_NAME_CHARACTERS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

export function sanitizeBaseName(name: string): string {
  // 逐字符清洗文件名，避免依赖复杂正则并兼容 Windows 非法文件名字符规则。
  const sanitizedCharacters: string[] = [];

  for (const character of name) {
    const codePoint = character.codePointAt(0) ?? 0;
    const isControlCharacter = codePoint >= 0 && codePoint <= 0x1f;

    sanitizedCharacters.push(
      isControlCharacter || INVALID_FILE_NAME_CHARACTERS.has(character) ? ' ' : character
    );
  }

  return sanitizedCharacters.join('').replace(/\s+/g, ' ').trim();
}

export function buildUniqueMarkdownName(baseName: string, existingNames: Set<string>): string {
  const normalizedBase = sanitizeBaseName(baseName) || '未命名';
  let candidate = ensureMarkdownFileName(normalizedBase);
  if (!existingNames.has(candidate)) {
    existingNames.add(candidate);
    return candidate;
  }
  let index = 2;
  while (existingNames.has(ensureMarkdownFileName(`${normalizedBase}-${index}`))) {
    index += 1;
  }
  candidate = ensureMarkdownFileName(`${normalizedBase}-${index}`);
  existingNames.add(candidate);
  return candidate;
}

export function getParentDirectory(path: string): string | null {
  const normalized = path.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash <= 0) return null;
  const parent = normalized.slice(0, lastSlash);
  // 中文说明：保留原路径使用的分隔符风格，避免 Windows 下拿“/”路径去匹配“\”树节点。
  return path.includes('\\') && !path.includes('/') ? parent.replace(/\//g, '\\') : parent;
}

export function getPathBaseName(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
}

export function joinSiblingPath(parentDir: string, name: string, originalPath: string): string {
  const separator = originalPath.includes('\\') && !originalPath.includes('/') ? '\\' : '/';
  return `${parentDir}${separator}${name}`;
}

export function getFileExtension(name: string): string {
  const matched = name.match(/(\.[^./\\]+)$/);
  return matched ? matched[1] : '';
}

export function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

export function isUntitledTabPath(path: string | null): boolean {
  return typeof path === 'string' && path.startsWith('__untitled__:');
}

export function isChangelogTabPath(path: string | null): boolean {
  return typeof path === 'string' && path.startsWith('__changelog__:');
}

export function normalizeWorkspacePath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

export function isPathInWorkspace(path: string, folderPath: string): boolean {
  const normalizedFolder = normalizeWorkspacePath(folderPath).replace(/\/+$/, '');
  const normalizedPath = normalizeWorkspacePath(path);
  return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
}

export function getNodeDisplayName(path: string): string {
  const fileName = getPathBasename(path);
  return fileName.replace(/\.[^.]+$/, '');
}

export function replacePathPrefix(path: string, oldPath: string, newPath: string): string {
  if (path === oldPath) return newPath;
  if (path.startsWith(`${oldPath}/`) || path.startsWith(`${oldPath}\\`)) {
    return `${newPath}${path.slice(oldPath.length)}`;
  }
  return path;
}

export function remapWorkspaceTabPath(path: string, oldPath: string, newPath: string): string {
  const volumePath = parseVolumeWorkspaceTab(path);
  if (volumePath) {
    const nextVolumePath = replacePathPrefix(volumePath, oldPath, newPath);
    return nextVolumePath === volumePath ? path : createVolumeWorkspaceTab(nextVolumePath);
  }
  return replacePathPrefix(path, oldPath, newPath);
}

export function isPathSameOrDescendant(path: string, parentPath: string): boolean {
  return (
    path === parentPath || path.startsWith(`${parentPath}/`) || path.startsWith(`${parentPath}\\`)
  );
}

export function buildUniqueMovedName(originalName: string, siblingNames: Set<string>): string {
  if (!siblingNames.has(originalName)) return originalName;

  const extension = getFileExtension(originalName);
  const baseName = extension ? stripExtension(originalName) : originalName;
  let index = 2;
  let candidateName = `${baseName}-${index}${extension}`;

  while (siblingNames.has(candidateName)) {
    index += 1;
    candidateName = `${baseName}-${index}${extension}`;
  }

  return candidateName;
}
