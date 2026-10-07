/** 文件树的纯函数：路径比较、查找节点、祖先目录、排序与可见文件列表（从 index.tsx 拆出） */
import type { FileNode } from '../../types';

export function samePath(left: string, right: string): boolean {
  const fix = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '');
  return fix(left) === fix(right);
}

/** 树中与 targetPath 相同的节点路径（兼容分隔符差异）；不存在时为 null */
export function findTreePath(nodes: FileNode[], targetPath: string): string | null {
  for (const node of nodes) {
    if (samePath(node.path, targetPath)) return node.path;
    if (node.type === 'directory' && node.children) {
      const found = findTreePath(node.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

export const sortNodes = (nodes: FileNode[]): FileNode[] => {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name, 'zh-CN');
  });
};

export function findAncestorDirectoryPaths(
  nodes: FileNode[],
  targetPath: string,
  ancestors: string[] = []
): string[] {
  for (const node of nodes) {
    if (node.path === targetPath) {
      return node.type === 'directory' ? [...ancestors, node.path] : ancestors;
    }
    if (node.type === 'directory' && node.children) {
      const result = findAncestorDirectoryPaths(node.children, targetPath, [
        ...ancestors,
        node.path,
      ]);
      if (result.length > 0) return result;
    }
  }
  return [];
}

export function collectVisibleFilePaths(nodes: FileNode[], expandedDirs: Set<string>): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.type === 'file') {
      paths.push(node.path);
      continue;
    }
    if (node.children && expandedDirs.has(node.path)) {
      paths.push(...collectVisibleFilePaths(sortNodes(node.children), expandedDirs));
    }
  }
  return paths;
}
