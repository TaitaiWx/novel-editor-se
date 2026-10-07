/**
 * 文件面板搜索的纯函数：按名称匹配 项目说明 / 正文 / 人物 / 设定 / 资料，
 * 并把主进程全文搜索的结果合并为可点击的分组列表。
 *
 * 搜索时不再复用正文树（树节点默认折叠、项目说明不在树里，会导致结果「看不见」），
 * 而是展示扁平的分组结果列表，跨作品显示。
 */
import type { FileNode } from '../../types';
import type { Character, LoreEntry } from '../RightPanel/types';
import type { GrowthSheetSummary } from '../../utils/growthIndex';
import type { StoryDisplayNode } from '../../utils/storyStructure';
import { stripStoryFileExtension } from '../../utils/workspace';
import type { WorkspaceContentFileResult } from '../../../shared/workspace-search';

/** 每个名称分组最多显示的条数 */
export const SEARCH_GROUP_LIMIT = 30;

export type FileSearchGroupId = 'docs' | 'story' | 'characters' | 'lore' | 'materials' | 'content';

interface FileSearchItemBase {
  /** 列表中唯一的 key */
  key: string;
  /** 主标题（高亮关键词） */
  title: string;
  /** 次要说明：所在目录 / 角色定位 / 分类等 */
  detail?: string;
}

export type FileSearchItem =
  | (FileSearchItemBase & { kind: 'file'; path: string })
  | (FileSearchItemBase & { kind: 'character'; id: number })
  | (FileSearchItemBase & { kind: 'growth'; name: string })
  | (FileSearchItemBase & { kind: 'lore'; id: number })
  | (FileSearchItemBase & {
      kind: 'content';
      path: string;
      line: number;
      preview: string;
      matchStart: number;
      matchLength: number;
    });

export interface FileSearchGroup {
  id: FileSearchGroupId;
  label: string;
  items: FileSearchItem[];
  /** 命中总数（超过 SEARCH_GROUP_LIMIT 时大于 items.length） */
  total: number;
}

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/** 把文本按关键词（忽略大小写）切成高亮片段 */
export function splitHighlight(text: string, query: string): HighlightSegment[] {
  const needle = query.trim().toLowerCase();
  if (!needle || !text) return text ? [{ text, match: false }] : [];
  const haystack = text.toLowerCase();
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  let index = haystack.indexOf(needle, cursor);
  while (index !== -1) {
    if (index > cursor) segments.push({ text: text.slice(cursor, index), match: false });
    segments.push({ text: text.slice(index, index + needle.length), match: true });
    cursor = index + needle.length;
    index = haystack.indexOf(needle, cursor);
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** 文件所在目录相对项目根的路径（「星河旅人 / 第一卷-离乡」），位于根目录时为空 */
export function relativeDirectory(filePath: string, rootPath: string | null): string {
  const file = normalizeSlashes(filePath);
  const root = rootPath ? normalizeSlashes(rootPath) : '';
  let relative = root && file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
  const slash = relative.lastIndexOf('/');
  relative = slash === -1 ? '' : relative.slice(0, slash);
  // 项目模式的作品都在 novels/ 下，去掉这一层更易读
  relative = relative.replace(/^novels(\/|$)/, '');
  return relative.split('/').filter(Boolean).join(' / ');
}

function includes(text: string | undefined, needle: string): boolean {
  return Boolean(text) && (text as string).toLowerCase().includes(needle);
}

function collectFiles(nodes: FileNode[], out: FileNode[] = []): FileNode[] {
  nodes.forEach((node) => {
    if (node.type === 'file') out.push(node);
    else if (node.children) collectFiles(node.children, out);
  });
  return out;
}

function limitGroup(
  id: FileSearchGroupId,
  label: string,
  items: FileSearchItem[]
): FileSearchGroup | null {
  if (items.length === 0) return null;
  return { id, label, items: items.slice(0, SEARCH_GROUP_LIMIT), total: items.length };
}

export interface BuildSearchGroupsInput {
  query: string;
  rootPath: string | null;
  projectDocs: FileNode[];
  storyNodes: StoryDisplayNode[];
  materialNodes: FileNode[];
  characters: Character[];
  loreEntries: LoreEntry[];
  growthSheets: GrowthSheetSummary[];
  /** 主进程全文搜索结果；null 表示尚未返回 */
  contentFiles: WorkspaceContentFileResult[] | null;
}

/** 生成搜索结果分组（空关键词返回空数组） */
export function buildSearchGroups(input: BuildSearchGroupsInput): FileSearchGroup[] {
  const needle = input.query.trim().toLowerCase();
  if (!needle) return [];
  const { rootPath } = input;

  const docs: FileSearchItem[] = input.projectDocs
    .filter((node) => node.type === 'file' && includes(node.name, needle))
    .map((node) => ({ kind: 'file', key: `doc:${node.path}`, path: node.path, title: node.name }));

  const story: FileSearchItem[] = collectFiles(input.storyNodes)
    .filter((node) => includes(node.name, needle))
    .map((node) => ({
      kind: 'file',
      key: `story:${node.path}`,
      path: node.path,
      title: stripStoryFileExtension(node.name),
      detail: relativeDirectory(node.path, rootPath) || undefined,
    }));

  const characterNames = new Set(input.characters.map((item) => item.name));
  const characters: FileSearchItem[] = [
    ...input.characters
      .filter((item) =>
        [item.name, item.role, item.description, ...(item.aliases ?? [])].some((text) =>
          includes(text, needle)
        )
      )
      .map(
        (item): FileSearchItem => ({
          kind: 'character',
          key: `character:${item.id}`,
          id: item.id,
          title: item.name,
          detail: item.role || undefined,
        })
      ),
    // 只有成长档案、没有人物卡的条目
    ...input.growthSheets
      .filter(
        (sheet) =>
          !characterNames.has(sheet.name) &&
          [sheet.name, ...sheet.aliases].some((text) => includes(text, needle))
      )
      .map(
        (sheet): FileSearchItem => ({
          kind: 'growth',
          key: `growth:${sheet.name}`,
          name: sheet.name,
          title: sheet.name,
          detail: `成长档案 · Lv.${sheet.level}`,
        })
      ),
  ];

  const lore: FileSearchItem[] = input.loreEntries
    .filter((item) =>
      [item.title, item.summary, item.folder, ...(item.tags ?? [])].some((text) =>
        includes(text, needle)
      )
    )
    .map((item) => ({
      kind: 'lore',
      key: `lore:${item.id}`,
      id: item.id,
      title: item.title,
      detail: [item.folder, ...(item.tags ?? []).map((tag) => `#${tag}`)].filter(Boolean).join(' '),
    }));

  const materials: FileSearchItem[] = collectFiles(input.materialNodes)
    .filter((node) => includes(node.name, needle))
    .map((node) => ({
      kind: 'file',
      key: `material:${node.path}`,
      path: node.path,
      title: node.name,
      detail: relativeDirectory(node.path, rootPath) || undefined,
    }));

  const content: FileSearchItem[] = (input.contentFiles ?? []).flatMap((file) =>
    file.matches.map(
      (match): FileSearchItem => ({
        kind: 'content',
        key: `content:${file.file}:${match.line}`,
        path: file.file,
        title: stripStoryFileExtension(file.file.split(/[\\/]/).pop() ?? file.file),
        detail: relativeDirectory(file.file, rootPath) || undefined,
        line: match.line,
        preview: match.preview,
        matchStart: match.matchStart,
        matchLength: match.matchLength,
      })
    )
  );

  return [
    limitGroup('docs', '项目说明', docs),
    limitGroup('story', '正文', story),
    limitGroup('characters', '人物', characters),
    limitGroup('lore', '设定', lore),
    limitGroup('materials', '资料', materials),
    limitGroup('content', '内容', content),
  ].filter((group): group is FileSearchGroup => group !== null);
}

/** 按显示顺序展开为一维列表（键盘上下移动用） */
export function flattenSearchGroups(groups: FileSearchGroup[]): FileSearchItem[] {
  return groups.flatMap((group) => group.items);
}
