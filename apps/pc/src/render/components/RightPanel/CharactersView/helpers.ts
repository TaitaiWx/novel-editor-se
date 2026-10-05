import type {
  Character,
  CharacterCategory,
  CharacterCurrentStateItem,
  CharacterTimelineItem,
} from '../types';
import type { FileNode, OpenLocalResult } from '../../../types/File';

// 人物视图内部使用的纯函数与类型（无 React 依赖）

export interface TimelineIpcInvoker {
  invoke(channel: 'refresh-folder', folderPath: string): Promise<OpenLocalResult>;
  invoke(channel: 'read-file', filePath: string): Promise<string>;
}

export interface NovelCorpusFile {
  path: string;
  label: string;
  content: string;
}

export interface TimelineEditorState {
  itemId: string;
  mode: 'edit' | 'create-manual';
  source: CharacterTimelineItem['source'];
  autoKey?: string;
  sourceLabel?: string;
}

export type CharacterCategoryFilter = CharacterCategory | 'all';

export type GraphLayout = Record<number, { x: number; y: number }>;

export interface CharacterDbRow {
  id: number;
  name: string;
  role: string;
  description: string;
  attributes: string;
}

export const TIMELINE_TEXT_FILE_RE = /\.(md|markdown|txt)$/i;
export const NOVEL_CORPUS_READ_CONCURRENCY = 4;
export const DEFAULT_CURRENT_STATE_LABELS = [
  '当前进展',
  '当前危机',
  '当前目标',
  '关键能力',
  '关键资源',
];

export function stripTimelineFileExtension(label: string): string {
  return label.replace(TIMELINE_TEXT_FILE_RE, '');
}

export function formatTimelineLineLabel(startLine?: number, endLine?: number): string {
  if (typeof startLine !== 'number' || startLine <= 0) return '';
  if (typeof endLine === 'number' && endLine > startLine) {
    return `第 ${startLine}-${endLine} 行`;
  }
  return `第 ${startLine} 行`;
}

export function createCurrentStateItem(label = '', value = ''): CharacterCurrentStateItem {
  const generatedId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `state-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id: generatedId,
    label,
    value,
  };
}

export function cloneCurrentStateItems(
  items: CharacterCurrentStateItem[]
): CharacterCurrentStateItem[] {
  return items.map((item, index) => ({
    id: item.id || `state-copy-${index}`,
    label: item.label,
    value: item.value,
  }));
}

export function buildDerivedCurrentStateItems(
  character: Character | null,
  timelineItems: CharacterTimelineItem[]
): CharacterCurrentStateItem[] {
  if (!character) return [];

  const latestItem = timelineItems.length > 0 ? timelineItems[timelineItems.length - 1] : null;
  const derivedItems: CharacterCurrentStateItem[] = [];

  if (latestItem?.chapterLabel) {
    derivedItems.push({
      id: 'derived-current-chapter',
      label: '当前章节',
      value: latestItem.chapterLabel,
    });
  }
  if (latestItem?.title) {
    derivedItems.push({
      id: 'derived-current-progress',
      label: '当前进展',
      value: latestItem.title,
    });
  }
  if (latestItem?.summary) {
    derivedItems.push({
      id: 'derived-current-summary',
      label: '当前状态',
      value: latestItem.summary,
    });
  }
  if (character.role.trim()) {
    derivedItems.push({
      id: 'derived-current-role',
      label: '角色定位',
      value: character.role.trim(),
    });
  }

  return derivedItems;
}

export function flattenFileNodes(nodes: FileNode[]): FileNode[] {
  return nodes.flatMap((node) => {
    if (node.type === 'file') return [node];
    return node.children ? flattenFileNodes(node.children) : [];
  });
}

export function buildRelativeFileLabel(folderPath: string, filePath: string): string {
  const normalizedFolderPath = folderPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedFilePath = filePath.replace(/\\/g, '/');
  if (normalizedFilePath.startsWith(`${normalizedFolderPath}/`)) {
    return normalizedFilePath.slice(normalizedFolderPath.length + 1);
  }
  const segments = normalizedFilePath.split('/');
  return segments[segments.length - 1] || normalizedFilePath;
}

export async function loadNovelCorpusFiles(
  folderPath: string,
  ipc: TimelineIpcInvoker
): Promise<NovelCorpusFile[]> {
  const tree = await ipc.invoke('refresh-folder', folderPath);
  const textFiles = flattenFileNodes(tree.files)
    .filter((node) => node.type === 'file' && TIMELINE_TEXT_FILE_RE.test(node.name))
    .sort((left, right) => left.path.localeCompare(right.path, 'zh-CN', { numeric: true }));

  const corpusFiles: NovelCorpusFile[] = [];
  for (let index = 0; index < textFiles.length; index += NOVEL_CORPUS_READ_CONCURRENCY) {
    const batch = textFiles.slice(index, index + NOVEL_CORPUS_READ_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (file) => {
        const raw = await ipc.invoke('read-file', file.path);
        return {
          path: file.path,
          label: buildRelativeFileLabel(folderPath, file.path),
          content: raw.trim(),
        } satisfies NovelCorpusFile;
      })
    );
    corpusFiles.push(...batchResults.filter((item) => item.content));
  }

  return corpusFiles;
}
