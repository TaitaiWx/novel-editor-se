/**
 * 项目 / 作品 / 章节模型
 *
 * 磁盘布局（由 `ne init` 创建）：
 *
 *   <project>/
 *   ├── .novel-editor/
 *   │   ├── config.json          项目配置（ProjectConfig）
 *   │   ├── writing-log.json     写作日志（CLI 与 GUI 共同写入，stats today/history 使用）
 *   │   ├── session.json         GUI 会话（打开的文件、未保存变更，ne status 读取）
 *   │   └── novel-editor.db      GUI 打开项目后创建的 SQLite 数据库（CLI 不读写）
 *   └── novels/                  作品根目录（config.novelsDir，可配置为 "." 表示项目根）
 *       └── <作品名>/            一个目录就是一部作品
 *           ├── 001-第一章.md    章节文件：「三位序号-标题.扩展名」，序号决定顺序
 *           ├── 002-第二章.md
 *           └── 第2卷/           可选子目录，视为「卷」，其中章节同样按序号排序
 *
 * GUI 打开 <project> 时通过 `readProjectLayout` 读取同一份配置：novelsDir 下每个目录是「作品」、
 * 子目录是「卷」、正文文件是「章」，项目根目录下的文档（欢迎使用.md 等）是项目文档而不是章节；
 * 命名与排序规则（序号前缀、中文数字卷名）在 story-layout.ts 中与 GUI 共用。
 */
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CoreError } from './errors';
import { isGeneratedMaterialPath } from './material';
import {
  assertDirectory,
  createFile,
  deletePath,
  isStoryFile,
  naturalCollator,
  pathExists,
  readTextFile,
  walkFiles,
  writeTextFile,
  type WriteResult,
} from './fs-ops';
import {
  compareChapterFileNames,
  compareVolumeDirNames,
  parseChapterFileName,
} from './story-layout';
import { computeTextStats, sumTextStats, type TextStats } from './text-stats';

export const PROJECT_META_DIR = '.novel-editor';
export const PROJECT_CONFIG_FILE = 'config.json';
export const PROJECT_SCHEMA_VERSION = 1;
export const DEFAULT_NOVELS_DIR = 'novels';

export interface ProjectConfig {
  schemaVersion: number;
  name: string;
  createdAt: string;
  /** 作品根目录（相对项目根），默认 "novels" */
  novelsDir: string;
  /** 新建章节的扩展名 */
  chapterExtension: '.md' | '.txt';
}

export interface Project {
  root: string;
  configPath: string;
  config: ProjectConfig;
  novelsPath: string;
}

export function getConfigPath(root: string): string {
  return path.join(root, PROJECT_META_DIR, PROJECT_CONFIG_FILE);
}

function normalizeConfig(raw: Partial<ProjectConfig>, root: string): ProjectConfig {
  return {
    schemaVersion: raw.schemaVersion ?? PROJECT_SCHEMA_VERSION,
    name: raw.name || path.basename(root),
    createdAt: raw.createdAt || new Date(0).toISOString(),
    novelsDir: raw.novelsDir ?? DEFAULT_NOVELS_DIR,
    chapterExtension: raw.chapterExtension === '.txt' ? '.txt' : '.md',
  };
}

/** 从 start 开始向上查找包含 .novel-editor/config.json 的目录 */
export async function findProjectRoot(start: string): Promise<string | null> {
  let current = path.resolve(start);
  for (;;) {
    if (await pathExists(getConfigPath(current))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** 读取指定配置文件；项目根为 .novel-editor 的上级目录（或配置文件所在目录） */
export async function loadProjectFromConfig(configPath: string): Promise<Project> {
  const absConfig = path.resolve(configPath);
  let raw: Partial<ProjectConfig>;
  try {
    raw = JSON.parse(await readFile(absConfig, 'utf-8')) as Partial<ProjectConfig>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CoreError('NOT_FOUND', `配置文件不存在: ${absConfig}`);
    }
    throw new CoreError(
      'INVALID_ARGUMENT',
      `配置文件解析失败: ${absConfig} (${error instanceof Error ? error.message : String(error)})`
    );
  }
  const configDir = path.dirname(absConfig);
  const root = path.basename(configDir) === PROJECT_META_DIR ? path.dirname(configDir) : configDir;
  const config = normalizeConfig(raw, root);
  return { root, configPath: absConfig, config, novelsPath: path.resolve(root, config.novelsDir) };
}

export interface ResolveProjectOptions {
  cwd: string;
  configPath?: string;
}

/** 解析当前项目；找不到时返回 null */
export async function resolveProject(options: ResolveProjectOptions): Promise<Project | null> {
  if (options.configPath)
    return loadProjectFromConfig(path.resolve(options.cwd, options.configPath));
  const root = await findProjectRoot(options.cwd);
  return root ? loadProjectFromConfig(getConfigPath(root)) : null;
}

/** 解析当前项目；找不到时抛出 NOT_A_PROJECT */
export async function requireProject(options: ResolveProjectOptions): Promise<Project> {
  const project = await resolveProject(options);
  if (!project) {
    throw new CoreError(
      'NOT_A_PROJECT',
      `当前目录不在 Novel Editor 项目中: ${options.cwd}（先运行 \`ne init\`，或使用 --cwd / --config 指定）`
    );
  }
  return project;
}

export interface InitProjectOptions {
  name?: string;
  novelsDir?: string;
  chapterExtension?: '.md' | '.txt';
}

export interface InitProjectResult {
  project: Project;
  created: string[];
}

export async function initProject(
  dir: string,
  options: InitProjectOptions = {}
): Promise<InitProjectResult> {
  const root = path.resolve(dir);
  const configPath = getConfigPath(root);
  if (await pathExists(configPath)) {
    throw new CoreError('ALREADY_EXISTS', `项目已初始化: ${configPath}`);
  }
  const novelsDir = options.novelsDir ?? DEFAULT_NOVELS_DIR;
  if (path.isAbsolute(novelsDir) || novelsDir.split(/[\\/]/).includes('..')) {
    throw new CoreError('INVALID_ARGUMENT', `novelsDir 必须是项目内的相对路径: ${novelsDir}`);
  }
  const config: ProjectConfig = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: options.name || path.basename(root),
    createdAt: new Date().toISOString(),
    novelsDir,
    chapterExtension: options.chapterExtension ?? '.md',
  };
  const created: string[] = [];
  for (const target of [root, path.dirname(configPath), path.resolve(root, novelsDir)]) {
    if (!(await pathExists(target))) {
      await mkdir(target, { recursive: true });
      created.push(target);
    }
  }
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
  created.push(configPath);
  return {
    project: { root, configPath, config, novelsPath: path.resolve(root, novelsDir) },
    created,
  };
}

// ─── 作品 ────────────────────────────────────────────────────────────────────

export interface NovelSummary {
  name: string;
  path: string;
  chapterCount: number;
  chars: number;
}

export interface ChapterInfo {
  /** 全书序号（1 起） */
  index: number;
  /** 章节标题（去掉序号前缀和扩展名） */
  title: string;
  /** 文件名前缀中的序号，无前缀时为 null */
  order: number | null;
  /** 所在卷（相对作品目录的子目录，根目录为空串） */
  volume: string;
  /** 相对作品目录的路径（使用 / 分隔） */
  file: string;
  path: string;
  stats: TextStats;
}

export interface NovelInfo {
  name: string;
  path: string;
  chapterCount: number;
  volumes: string[];
  stats: TextStats;
  chapters: ChapterInfo[];
}

// 文件名中不允许出现的字符（含控制字符）
// eslint-disable-next-line no-control-regex
const INVALID_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

/** 将标题转换为安全的文件名片段 */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(INVALID_NAME_CHARS, '_').trim().replace(/\.+$/, '');
  if (!cleaned) throw new CoreError('INVALID_ARGUMENT', `名称无效: "${name}"`);
  return cleaned;
}

function assertNovelName(name: string): void {
  if (!name || name !== sanitizeFileName(name) || name.startsWith('.')) {
    throw new CoreError(
      'INVALID_ARGUMENT',
      `作品名不能包含 / \\ : * ? " < > | 或以 . 开头: "${name}"`
    );
  }
}

export async function listNovelNames(project: Project): Promise<string[]> {
  if (!(await pathExists(project.novelsPath))) return [];
  const entries = await readdir(project.novelsPath, { withFileTypes: true });
  return (
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .filter((entry) => !['node_modules', 'dist', 'build', 'out'].includes(entry.name))
      // novelsDir 为项目根（"."）时，根下的生成资料目录（资料/记忆 等）不是作品
      .filter(
        (entry) => !isGeneratedMaterialPath(path.join(project.novelsPath, entry.name), project.root)
      )
      .map((entry) => entry.name)
      .sort(naturalCollator.compare)
  );
}

/** GUI 打开文件夹时使用的项目结构：作品根目录与作品列表（与 `ne novel list` 同一口径） */
export interface ProjectLayout {
  name: string;
  novelsDir: string;
  novelsPath: string;
  /** 作品名（novelsDir 下的作品目录，自然排序） */
  novels: string[];
}

/**
 * 读取文件夹自身的项目结构；文件夹没有 `.novel-editor/config.json` 时返回 null（普通文件夹）。
 * 只看该文件夹本身，不向上查找：GUI 打开的是项目里的子目录时按普通文件夹展示。
 */
export async function readProjectLayout(folderPath: string): Promise<ProjectLayout | null> {
  const configPath = getConfigPath(path.resolve(folderPath));
  if (!(await pathExists(configPath))) return null;
  const project = await loadProjectFromConfig(configPath);
  return {
    name: project.config.name,
    novelsDir: project.config.novelsDir,
    novelsPath: project.novelsPath,
    novels: await listNovelNames(project),
  };
}

export async function resolveNovelPath(project: Project, name: string): Promise<string> {
  const names = await listNovelNames(project);
  if (names.includes(name)) return path.join(project.novelsPath, name);
  throw new CoreError(
    'NOT_FOUND',
    `作品不存在: "${name}"${names.length ? `（现有作品: ${names.join(', ')}）` : '（项目中还没有作品）'}`
  );
}

export async function createNovel(project: Project, name: string): Promise<NovelSummary> {
  assertNovelName(name);
  const novelPath = path.join(project.novelsPath, name);
  if (await pathExists(novelPath)) throw new CoreError('ALREADY_EXISTS', `作品已存在: ${name}`);
  await mkdir(novelPath, { recursive: true });
  return { name, path: novelPath, chapterCount: 0, chars: 0 };
}

export async function listNovels(project: Project): Promise<NovelSummary[]> {
  const names = await listNovelNames(project);
  const result: NovelSummary[] = [];
  for (const name of names) {
    const chapters = await listChapters(project, name);
    result.push({
      name,
      path: path.join(project.novelsPath, name),
      chapterCount: chapters.length,
      chars: chapters.reduce((sum, chapter) => sum + chapter.stats.chars, 0),
    });
  }
  return result;
}

export async function getNovelInfo(project: Project, name: string): Promise<NovelInfo> {
  const novelPath = await resolveNovelPath(project, name);
  const chapters = await listChapters(project, name);
  const volumes = Array.from(new Set(chapters.map((chapter) => chapter.volume))).filter(Boolean);
  return {
    name,
    path: novelPath,
    chapterCount: chapters.length,
    volumes,
    stats: sumTextStats(chapters.map((chapter) => chapter.stats)),
    chapters,
  };
}

// ─── 章节 ────────────────────────────────────────────────────────────────────

export function formatChapterFileName(order: number, title: string, ext: string): string {
  const width = Math.max(3, String(order).length);
  return `${String(order).padStart(width, '0')}-${sanitizeFileName(title)}${ext}`;
}

/** 递归收集作品下的章节：根目录章节在前，然后按卷序号（第一卷、第二卷…）排序 */
async function collectChapterFiles(novelPath: string): Promise<string[]> {
  const result: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && isStoryFile(entry.name) && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort(compareChapterFileNames);
    result.push(...files.map((name) => path.join(dir, name)));
    const dirs = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort(compareVolumeDirNames);
    for (const sub of dirs) await walk(path.join(dir, sub));
  };
  await walk(novelPath);
  return result;
}

export async function listChapters(project: Project, novel: string): Promise<ChapterInfo[]> {
  const novelPath = await resolveNovelPath(project, novel);
  const files = await collectChapterFiles(novelPath);
  const chapters: ChapterInfo[] = [];
  for (const [i, file] of files.entries()) {
    const relative = path.relative(novelPath, file).split(path.sep).join('/');
    const volume = path.dirname(relative) === '.' ? '' : path.dirname(relative);
    const { order, title } = parseChapterFileName(path.basename(file));
    const content = await readFile(file, 'utf-8');
    chapters.push({
      index: i + 1,
      title,
      order,
      volume,
      file: relative,
      path: file,
      stats: computeTextStats(content),
    });
  }
  return chapters;
}

/**
 * 按引用定位章节。引用可以是：全书序号（1 起）、相对路径/文件名、标题（精确或唯一包含）。
 */
export function findChapter(chapters: ChapterInfo[], ref: string): ChapterInfo {
  const trimmed = ref.trim();
  if (/^\d+$/.test(trimmed)) {
    const byIndex = chapters.find((chapter) => chapter.index === Number(trimmed));
    if (byIndex) return byIndex;
  }
  const exact = chapters.find(
    (chapter) =>
      chapter.file === trimmed ||
      path.basename(chapter.file) === trimmed ||
      chapter.title === trimmed
  );
  if (exact) return exact;
  const fuzzy = chapters.filter((chapter) => chapter.title.includes(trimmed));
  if (fuzzy.length === 1) return fuzzy[0];
  if (fuzzy.length > 1) {
    throw new CoreError(
      'INVALID_ARGUMENT',
      `章节引用 "${ref}" 不唯一，匹配到: ${fuzzy.map((c) => `${c.index}.${c.title}`).join(', ')}`
    );
  }
  throw new CoreError('NOT_FOUND', `章节不存在: "${ref}"（可用序号、文件名或标题引用）`);
}

export interface CreateChapterOptions {
  content?: string;
  /** 放入指定卷（作品下的子目录），不存在会自动创建 */
  volume?: string;
}

export async function createChapter(
  project: Project,
  novel: string,
  title: string,
  options: CreateChapterOptions = {}
): Promise<{ chapter: ChapterInfo; write: WriteResult }> {
  const novelPath = await resolveNovelPath(project, novel);
  const dir = options.volume
    ? path.join(novelPath, ...options.volume.split(/[\\/]/).map(sanitizeFileName))
    : novelPath;
  if (!path.resolve(dir).startsWith(path.resolve(novelPath))) {
    throw new CoreError('INVALID_ARGUMENT', `卷路径无效: ${options.volume}`);
  }
  await mkdir(dir, { recursive: true });
  const siblings = (await readdir(dir)).filter(isStoryFile);
  const maxOrder = siblings.reduce((max, name) => {
    const { order } = parseChapterFileName(name);
    return order !== null && order > max ? order : max;
  }, 0);
  const fileName = formatChapterFileName(maxOrder + 1, title, project.config.chapterExtension);
  const filePath = path.join(dir, fileName);
  const content = options.content ?? `# ${title}\n\n`;
  const write = await createFile(filePath, content);
  const chapters = await listChapters(project, novel);
  const chapter = chapters.find((item) => item.path === filePath);
  if (!chapter) throw new CoreError('IO_ERROR', `章节创建后未找到: ${filePath}`);
  return { chapter, write };
}

export interface ReorderOptions {
  /** 新顺序（章节引用列表）。只能包含同一卷内的章节，未列出的章节保持相对顺序排在后面 */
  order?: string[];
  /** 把某一章移动到所在卷的第 to 位（1 起） */
  move?: { ref: string; to: number };
}

export interface ReorderResult {
  renamed: Array<{ from: string; to: string }>;
  chapters: ChapterInfo[];
}

/** 将同一目录下的章节按给定顺序重新编号（两阶段重命名，避免冲突） */
async function renumberDirectory(
  dir: string,
  ordered: ChapterInfo[],
  novelPath: string
): Promise<Array<{ from: string; to: string }>> {
  const plans = ordered
    .map((chapter, i) => ({
      from: chapter.path,
      to: path.join(dir, formatChapterFileName(i + 1, chapter.title, path.extname(chapter.path))),
    }))
    .filter((plan) => plan.from !== plan.to);
  const stamp = `${process.pid}-${Date.now()}`;
  const temps = plans.map((plan, i) => path.join(dir, `.ne-reorder-${stamp}-${i}.tmp`));
  for (const [i, plan] of plans.entries()) await rename(plan.from, temps[i]);
  for (const [i, plan] of plans.entries()) {
    if (await pathExists(plan.to)) {
      // 回滚已移动的临时文件，避免覆盖用户文件
      for (const [j, back] of plans.entries()) {
        if (await pathExists(temps[j])) await rename(temps[j], back.from);
      }
      throw new CoreError('ALREADY_EXISTS', `重排时目标文件已存在: ${plan.to}`);
    }
    await rename(temps[i], plan.to);
  }
  const rel = (target: string) => path.relative(novelPath, target).split(path.sep).join('/');
  return plans.map((plan) => ({ from: rel(plan.from), to: rel(plan.to) }));
}

/**
 * 调整章节顺序。
 * - 不传 order/move：按当前顺序把每一卷的章节序号重新整理为 001、002…（填补空缺）
 * - 传 order：按给定顺序排列（同一卷内）
 * - 传 move：移动单个章节到所在卷的指定位置
 */
export async function reorderChapters(
  project: Project,
  novel: string,
  options: ReorderOptions = {}
): Promise<ReorderResult> {
  const novelPath = await resolveNovelPath(project, novel);
  const chapters = await listChapters(project, novel);
  const byVolume = new Map<string, ChapterInfo[]>();
  for (const chapter of chapters) {
    const list = byVolume.get(chapter.volume) ?? [];
    list.push(chapter);
    byVolume.set(chapter.volume, list);
  }

  const targetOrders = new Map<string, ChapterInfo[]>(byVolume);
  if (options.order && options.order.length > 0) {
    const picked = options.order.map((ref) => findChapter(chapters, ref));
    const volume = picked[0].volume;
    if (picked.some((chapter) => chapter.volume !== volume)) {
      throw new CoreError('INVALID_ARGUMENT', '--order 中的章节必须属于同一卷');
    }
    if (new Set(picked.map((chapter) => chapter.path)).size !== picked.length) {
      throw new CoreError('INVALID_ARGUMENT', '--order 中存在重复章节');
    }
    const rest = (byVolume.get(volume) ?? []).filter((chapter) => !picked.includes(chapter));
    targetOrders.set(volume, [...picked, ...rest]);
  } else if (options.move) {
    const chapter = findChapter(chapters, options.move.ref);
    const list = (byVolume.get(chapter.volume) ?? []).filter((item) => item !== chapter);
    const position = Math.min(Math.max(1, Math.floor(options.move.to)), list.length + 1);
    list.splice(position - 1, 0, chapter);
    targetOrders.set(chapter.volume, list);
  }

  const renamed: Array<{ from: string; to: string }> = [];
  for (const [volume, list] of targetOrders) {
    const dir = volume ? path.join(novelPath, ...volume.split('/')) : novelPath;
    renamed.push(...(await renumberDirectory(dir, list, novelPath)));
  }
  return { renamed, chapters: await listChapters(project, novel) };
}

export interface MergeResult {
  from: ChapterInfo;
  into: ChapterInfo;
  write: WriteResult;
  removed: string;
}

/** 合并章节：把 from 的正文追加到 to 的末尾，然后删除 from */
export async function mergeChapters(
  project: Project,
  novel: string,
  fromRef: string,
  toRef: string
): Promise<MergeResult> {
  const chapters = await listChapters(project, novel);
  const from = findChapter(chapters, fromRef);
  const into = findChapter(chapters, toRef);
  if (from.path === into.path) throw new CoreError('INVALID_ARGUMENT', '不能把章节合并到自身');
  const fromContent = await readTextFile(from.path);
  const intoContent = await readTextFile(into.path);
  const separator = intoContent.endsWith('\n\n') ? '' : intoContent.endsWith('\n') ? '\n' : '\n\n';
  const write = await writeTextFile(into.path, `${intoContent}${separator}${fromContent}`);
  await deletePath(from.path);
  const updated = await listChapters(project, novel);
  const mergedInto = updated.find((chapter) => chapter.path === into.path) ?? into;
  return { from, into: mergedInto, write, removed: from.path };
}

/** 判断路径是否位于目录内 */
export function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** 把 stats 目标（文件/目录/作品名）解析为文件列表 */
export async function resolveStatsTargets(
  target: string,
  cwd: string,
  project: Project | null
): Promise<{ kind: 'file' | 'directory' | 'novel'; path: string; files: string[] }> {
  const abs = path.resolve(cwd, target);
  if (await pathExists(abs)) {
    const info = await stat(abs);
    if (info.isFile()) return { kind: 'file', path: abs, files: [abs] };
    await assertDirectory(abs);
    const files = await walkFiles(abs, { storyOnly: true });
    return { kind: 'directory', path: abs, files };
  }
  if (project) {
    const names = await listNovelNames(project);
    if (names.includes(target)) {
      const novelPath = path.join(project.novelsPath, target);
      return { kind: 'novel', path: novelPath, files: await collectChapterFiles(novelPath) };
    }
  }
  throw new CoreError('NOT_FOUND', `找不到文件、目录或作品: ${target}`);
}
