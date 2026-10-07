/**
 * 卷纲的数据来源：读取一卷的章节正文、各章已入库的章纲标题与作品人物库
 * 只读，不写任何数据；全部经已有 IPC（refresh-folder / read-file / db-outline-list-by-folder / db-character-list）
 */
import { isProjectDocumentName } from '@novel-editor/core/story-layout';
import type { VolumeChapterSource, VolumeCharacterRef } from '@novel-editor/basic-algorithm';
import type { PersistedOutlineNodeInput, PersistedOutlineRow } from '@/render/types/electron-api';
import { flattenFileNodes } from '@/render/utils/workspace';
import { isNovelCorpusFilePath } from '../CharactersView/helpers';
import { buildPersistedTreeFromRows, writeOutlineTree } from '../outline-entries';
import { mapCharacterRows } from '../utils';
import { chapterTitleFromPath, compareChapterPaths, dirName } from './volumePlanState';

/** 一卷最多读取的章节数（超出部分不参与推导，避免超长作品阻塞） */
export const VOLUME_CHAPTER_LIMIT = 300;
const READ_CONCURRENCY = 6;

type Ipc = NonNullable<Window['electron']>['ipcRenderer'];

function isDirectChild(filePath: string, root: string): boolean {
  return dirName(filePath).replace(/\\/g, '/') === root.replace(/\\/g, '/').replace(/\/+$/, '');
}

async function mapLimited<T, R>(items: T[], worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += READ_CONCURRENCY) {
    const batch = items.slice(index, index + READ_CONCURRENCY);
    results.push(...(await Promise.all(batch.map(worker))));
  }
  return results;
}

/** 列出卷内章节文件（排除资料目录与项目说明文档），按卷 / 章序号排序 */
export async function listVolumeChapterPaths(ipc: Ipc, volumePath: string): Promise<string[]> {
  const tree = await ipc.invoke('refresh-folder', volumePath);
  return flattenFileNodes(tree.files)
    .filter((node) => node.type === 'file' && isNovelCorpusFilePath(node.path, volumePath))
    .map((node) => node.path)
    .filter((path) => !(isDirectChild(path, volumePath) && isProjectDocumentName(path)))
    .sort((a, b) => compareChapterPaths(a, b, volumePath))
    .slice(0, VOLUME_CHAPTER_LIMIT);
}

/** 某章已入库章纲的顶层标题 */
export async function loadChapterOutlineTitles(
  ipc: Ipc,
  workPath: string,
  chapterPath: string
): Promise<string[]> {
  const rows = await ipc.invoke('db-outline-list-by-folder', workPath, {
    kind: 'chapter',
    path: chapterPath,
  });
  return buildPersistedTreeFromRows(rows)
    .map((node) => node.title.trim())
    .filter(Boolean);
}

export interface LoadVolumeOptions {
  volumePath: string;
  workPath: string | null;
  dbReady: boolean;
}

/** 读取整卷：正文 + （数据库就绪时）各章章纲 */
export async function loadVolumeChapters(
  ipc: Ipc,
  { volumePath, workPath, dbReady }: LoadVolumeOptions
): Promise<VolumeChapterSource[]> {
  const paths = await listVolumeChapterPaths(ipc, volumePath);
  return mapLimited(paths, async (path) => {
    const [content, outline] = await Promise.all([
      ipc.invoke('read-file', path).catch(() => ''),
      dbReady && workPath
        ? loadChapterOutlineTitles(ipc, workPath, path).catch(() => [] as string[])
        : Promise.resolve([] as string[]),
    ]);
    return { path, title: chapterTitleFromPath(path), content, outline };
  });
}

/** 作品人物库（名字 + 别名），没有作品记录时为空 */
export async function loadVolumeCharacters(
  ipc: Ipc,
  workPath: string
): Promise<VolumeCharacterRef[]> {
  const novel = (await ipc.invoke('db-novel-get-by-folder', workPath)) as { id: number } | null;
  if (!novel) return [];
  const rows = (await ipc.invoke('db-character-list', novel.id)) as Array<{
    id: number;
    name: string;
    role: string;
    description: string;
    attributes: string;
  }>;
  return mapCharacterRows(rows).map((character) => ({
    name: character.name,
    aliases: character.aliases,
  }));
}

export interface InsertBeatInput {
  title: string;
  content?: string;
  anchorText?: string;
  lineHint?: number | null;
}

/**
 * 把一个节拍追加到某章的章纲末尾；已有同名条目时不重复插入
 * 返回 'inserted' / 'exists'
 */
export async function insertBeatIntoChapterOutline(
  ipc: Ipc,
  workPath: string,
  chapterPath: string,
  beat: InsertBeatInput
): Promise<'inserted' | 'exists'> {
  const scope = { kind: 'chapter' as const, path: chapterPath };
  const rows: PersistedOutlineRow[] = await ipc.invoke(
    'db-outline-list-by-folder',
    workPath,
    scope
  );
  const tree = buildPersistedTreeFromRows(rows);
  const title = beat.title.trim();
  if (tree.some((node) => node.title.trim() === title)) return 'exists';
  const next: PersistedOutlineNodeInput[] = [
    ...tree,
    {
      title,
      content: beat.content?.trim() || '',
      anchorText: beat.anchorText?.trim() || title,
      lineHint: beat.lineHint ?? null,
      sortOrder: tree.length,
      children: [],
    },
  ];
  await writeOutlineTree(workPath, next, scope);
  return 'inserted';
}
