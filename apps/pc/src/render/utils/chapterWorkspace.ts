import type { FileNode } from '../types';

export type ChapterStatus = 'draft' | 'writing' | 'revising' | 'done';
export type ProjectPreset = 'focused' | 'standard';

export interface ChapterMetadata {
  status?: ChapterStatus;
  summary?: string;
  plotNote?: string;
  linkedCharacterIds?: number[];
  linkedLoreIds?: number[];
  autoLinkedCharacterIds?: number[];
  autoLinkedLoreIds?: number[];
  dismissedCharacterIds?: number[];
  dismissedLoreIds?: number[];
}

export interface ChapterFile {
  path: string;
  name: string;
  title: string;
  chapterNumber: number | null;
  order: number;
  extension: string;
  directory: string;
}

const CHAPTER_FILE_EXTENSIONS = new Set(['.md', '.markdown', '.txt']);
const CHAPTER_DIR_PATTERN = /(?:^|[/\\])(chapters?|章节|正文)(?:[/\\]|$)/i;
const EXCLUDED_CHAPTER_DIR_PATTERN =
  /(?:^|[/\\])(notes?|大纲|outline|设定|人物|materials?|素材|ai-reports?)(?:[/\\]|$)/i;
const CHAPTER_NAME_PATTERN = /^第\s*(\d+)\s*章(?:\s+(.+))?$/i;

export const CHAPTER_STATUS_LABELS: Record<ChapterStatus, string> = {
  draft: '草稿',
  writing: '写作中',
  revising: '修订中',
  done: '已定稿',
};

export const PROJECT_PRESET_LABELS: Record<ProjectPreset, string> = {
  focused: '聚焦写作',
  standard: '标准工作台',
};

export function flattenFileNodes(nodes: FileNode[]): FileNode[] {
  return nodes.flatMap((node) => [node, ...(node.children ? flattenFileNodes(node.children) : [])]);
}

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

export function getFileExtension(fileName: string): string {
  const match = fileName.match(/(\.[^.]+)$/);
  return match ? match[1].toLowerCase() : '';
}

export function stripFileExtension(fileName: string): string {
  const ext = getFileExtension(fileName);
  return ext ? fileName.slice(0, -ext.length) : fileName;
}

export function sanitizeChapterTitle(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || '未命名';
}

export function formatChapterIndex(value: number): string {
  return String(value).padStart(2, '0');
}

export function parseChapterFileName(fileName: string): {
  chapterNumber: number | null;
  title: string;
  extension: string;
} {
  const extension = getFileExtension(fileName);
  const baseName = stripFileExtension(fileName).trim();
  const matched = baseName.match(CHAPTER_NAME_PATTERN);
  if (!matched) {
    return {
      chapterNumber: null,
      title: sanitizeChapterTitle(baseName),
      extension,
    };
  }

  return {
    chapterNumber: Number(matched[1]),
    title: sanitizeChapterTitle(matched[2] || '未命名'),
    extension,
  };
}

export function buildChapterHeading(chapterNumber: number, title: string): string {
  return `# 第${formatChapterIndex(chapterNumber)}章 ${sanitizeChapterTitle(title)}`;
}

export function buildChapterFileName(
  chapterNumber: number,
  title: string,
  extension = '.md'
): string {
  return `第${formatChapterIndex(chapterNumber)}章 ${sanitizeChapterTitle(title)}${extension}`;
}

export function buildChapterInitialContent(chapterNumber: number, title: string): string {
  return `${buildChapterHeading(chapterNumber, title)}\n\n`;
}

export function rewriteChapterHeading(
  content: string,
  chapterNumber: number,
  title: string
): string {
  const heading = buildChapterHeading(chapterNumber, title);
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const firstNonEmptyIndex = lines.findIndex((line) => line.trim().length > 0);

  if (firstNonEmptyIndex === -1) {
    return `${heading}\n\n`;
  }

  const nextLines = [...lines];
  if (/^#\s+/.test(nextLines[firstNonEmptyIndex])) {
    nextLines[firstNonEmptyIndex] = heading;
    return nextLines.join('\n');
  }

  return `${heading}\n\n${normalized.trimStart()}`;
}

function compareChapterFiles(left: ChapterFile, right: ChapterFile): number {
  if (left.chapterNumber !== null && right.chapterNumber !== null) {
    if (left.chapterNumber !== right.chapterNumber) {
      return left.chapterNumber - right.chapterNumber;
    }
  } else if (left.chapterNumber !== null) {
    return -1;
  } else if (right.chapterNumber !== null) {
    return 1;
  }

  return left.name.localeCompare(right.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
}

function isChapterTextFile(node: FileNode): boolean {
  return node.type === 'file' && CHAPTER_FILE_EXTENSIONS.has(getFileExtension(node.name));
}

export function isLikelyChapterPath(path: string): boolean {
  return CHAPTER_DIR_PATTERN.test(path);
}

export function extractChapterFiles(nodes: FileNode[]): ChapterFile[] {
  const allFiles = flattenFileNodes(nodes).filter(isChapterTextFile);
  if (allFiles.length === 0) return [];

  const numberedFiles = allFiles.filter(
    (node) =>
      parseChapterFileName(node.name).chapterNumber !== null &&
      !EXCLUDED_CHAPTER_DIR_PATTERN.test(node.path)
  );
  const chapterDirFiles = allFiles.filter((node) => CHAPTER_DIR_PATTERN.test(node.path));

  // 章节识别保持保守：
  // 1. 一旦作品存在章节目录，只把这些目录里的文本视为章节；
  // 2. 没有章节目录时，只识别显式的“第XX章”命名文件。
  const preferredFiles = chapterDirFiles.length > 0 ? chapterDirFiles : numberedFiles;
  if (preferredFiles.length === 0) return [];

  const dedupedFiles = Array.from(
    new Map(preferredFiles.map((node) => [node.path, node])).values()
  );

  return dedupedFiles
    .map((node, index) => {
      const parsed = parseChapterFileName(node.name);
      const lastSlash = Math.max(node.path.lastIndexOf('/'), node.path.lastIndexOf('\\'));
      return {
        path: node.path,
        name: node.name,
        title: parsed.title,
        chapterNumber: parsed.chapterNumber,
        order: parsed.chapterNumber ?? index + 1,
        extension: parsed.extension || '.md',
        directory: lastSlash >= 0 ? node.path.slice(0, lastSlash) : '',
      } satisfies ChapterFile;
    })
    .sort(compareChapterFiles)
    .map((item, index) => ({
      ...item,
      order: index + 1,
    }));
}

export function getNextChapterNumber(nodes: FileNode[]): number {
  const chapters = extractChapterFiles(nodes);
  const maxChapter = chapters.reduce(
    (maxValue, chapter) => Math.max(maxValue, chapter.chapterNumber ?? chapter.order),
    0
  );
  return maxChapter + 1;
}

export function createChapterMetadataStorageKey(folderPath: string | null): string | null {
  return folderPath ? `novel-editor:chapter-metadata:${folderPath}` : null;
}

export function findPreferredChapterDirectory(
  folderPath: string | null,
  nodes: FileNode[],
  selectedPath?: string | null
): string | null {
  if (!folderPath) return null;

  if (selectedPath) {
    const selectedNode = findNodeInTree(nodes, selectedPath);
    if (selectedNode?.type === 'directory' && isLikelyChapterPath(selectedNode.path)) {
      return selectedNode.path;
    }
    if (selectedNode?.type === 'file') {
      const lastSlash = Math.max(selectedPath.lastIndexOf('/'), selectedPath.lastIndexOf('\\'));
      const parentDir = lastSlash >= 0 ? selectedPath.slice(0, lastSlash) : folderPath;
      if (isLikelyChapterPath(parentDir)) {
        return parentDir;
      }
    }
  }

  const preferred = flattenFileNodes(nodes).find(
    (node) => node.type === 'directory' && isLikelyChapterPath(node.path)
  );
  return preferred?.path || folderPath;
}

export function getRelativeDirectoryLabel(
  folderPath: string | null,
  directoryPath: string
): string {
  if (!folderPath || !directoryPath) return '根目录';
  const normalizedRoot = folderPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedDir = directoryPath.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalizedDir === normalizedRoot) return '根目录';
  if (!normalizedDir.startsWith(`${normalizedRoot}/`)) {
    return normalizedDir.split('/').pop() || normalizedDir;
  }
  const relative = normalizedDir.slice(normalizedRoot.length + 1);
  return relative || '根目录';
}

export function remapRecordKeys<T>(
  source: Record<string, T>,
  renameMap: Record<string, string>
): Record<string, T> {
  if (Object.keys(renameMap).length === 0) return source;
  const nextEntries = Object.entries(source).map(([key, value]) => [renameMap[key] || key, value]);
  return Object.fromEntries(nextEntries) as Record<string, T>;
}
