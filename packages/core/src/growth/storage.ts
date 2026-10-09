import { withWorkspaceLease } from '../workspace-lock';
/**
 * 记忆库文件读写（Node.js）：`<root>/资料/记忆/`
 *
 * root 是作品作用域根目录（见 work-scope.ts）：`ne init` 项目中为作品目录 `<novelsDir>/<作品>/`，
 * 普通文件夹为文件夹本身，旧版项目根资料（「未归属」）为项目根。所有函数的 root 参数都是它。
 *
 * JSON 是唯一数据源；Markdown（README.md、角色/*.md）在每次保存时重新生成。
 * 写入采用「临时文件 + rename」，避免 GUI / CLI 同时写入时出现半截文件。
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CoreError } from '../errors';
import { createSheet, findSheet } from './engine';
import {
  renderCharacterSnapshot,
  renderMemoryReadme,
  renderSettingSnapshot,
  renderSheetMarkdown,
  type CharacterSnapshotInput,
  type SettingSnapshotInput,
} from './markdown';
import { normalizeAtlas, normalizePartyBook, normalizeRuleset, normalizeSheet } from './normalize';
import { createRulesetFromTemplate, type GrowthTemplate } from './templates';
import {
  GROWTH_SCHEMA_VERSION,
  MEMORY_ATLAS_FILE,
  MEMORY_CHARACTER_CARDS_DIR,
  MEMORY_DIR_SEGMENTS,
  MEMORY_PARTY_FILE,
  MEMORY_README_FILE,
  MEMORY_RULESET_FILE,
  MEMORY_SETTINGS_DIR,
  MEMORY_SHEETS_DIR,
  type Atlas,
  type GrowthRuleset,
  type GrowthSheet,
  type MemoryBundle,
  type PartyBook,
} from './types';

export function getMemoryDir(root: string): string {
  return path.join(root, ...MEMORY_DIR_SEGMENTS);
}

/** 角色名 → 安全的文件名（去掉路径分隔符与非法字符） */
export function toMemoryFileName(name: string): string {
  const safe = name
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 120);
  if (!safe) throw new CoreError('INVALID_ARGUMENT', `无效的名称: ${name}`);
  return safe;
}

async function readJson(filePath: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, '')) as unknown;
  } catch (error) {
    throw new CoreError(
      'INVALID_ARGUMENT',
      `JSON 解析失败: ${filePath}（${error instanceof Error ? error.message : String(error)}）`
    );
  }
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content, 'utf-8');
  await rename(tmp, filePath);
}

function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export interface LoadedMemory extends MemoryBundle {
  dir: string;
  /** 规则.json 是否存在 */
  initialized: boolean;
  /** 加载时跳过的损坏文件 */
  issues: string[];
}

export async function loadMemory(root: string): Promise<LoadedMemory> {
  const dir = getMemoryDir(root);
  const rawRuleset = await readJson(path.join(dir, MEMORY_RULESET_FILE));
  const ruleset = normalizeRuleset(rawRuleset);
  const party = normalizePartyBook(await readJson(path.join(dir, MEMORY_PARTY_FILE)));
  const atlas = normalizeAtlas(await readJson(path.join(dir, MEMORY_ATLAS_FILE)));
  const issues: string[] = [];
  const sheets: GrowthSheet[] = [];
  let entries: string[] = [];
  try {
    entries = await readdir(path.join(dir, MEMORY_SHEETS_DIR));
  } catch {
    entries = [];
  }
  for (const entry of entries.filter((name) => name.endsWith('.json')).sort()) {
    const filePath = path.join(dir, MEMORY_SHEETS_DIR, entry);
    try {
      sheets.push(normalizeSheet(await readJson(filePath), entry.replace(/\.json$/, '')));
    } catch (error) {
      issues.push(`${entry}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { dir, initialized: rawRuleset !== undefined, ruleset, sheets, party, atlas, issues };
}

/** 重新生成 README.md 与所有角色摘要 */
export async function regenerateMemoryDocs(root: string, bundle?: MemoryBundle): Promise<void> {
  return withWorkspaceLease(
    async () => {
      const data = bundle ?? (await loadMemory(root));
      const dir = getMemoryDir(root);
      await writeAtomic(path.join(dir, MEMORY_README_FILE), renderMemoryReadme(data));
      for (const sheet of data.sheets) {
        await writeAtomic(
          path.join(dir, MEMORY_SHEETS_DIR, `${toMemoryFileName(sheet.name)}.md`),
          renderSheetMarkdown(data.ruleset, sheet, data)
        );
      }
    },
    { resources: [root] }
  );
}

export interface InitMemoryOptions {
  template?: GrowthTemplate;
  /** 覆盖已存在的 规则.json */
  force?: boolean;
}

export interface InitMemoryResult {
  dir: string;
  created: string[];
  skipped: string[];
}

export async function initMemory(
  root: string,
  options: InitMemoryOptions = {}
): Promise<InitMemoryResult> {
  return withWorkspaceLease(
    async () => {
      const dir = getMemoryDir(root);
      const created: string[] = [];
      const skipped: string[] = [];
      await mkdir(path.join(dir, MEMORY_SHEETS_DIR), { recursive: true });
      const files: Array<[string, unknown]> = [
        [MEMORY_RULESET_FILE, createRulesetFromTemplate(options.template ?? 'dnd')],
        [MEMORY_PARTY_FILE, { schemaVersion: GROWTH_SCHEMA_VERSION, parties: [], companions: [] }],
        [MEMORY_ATLAS_FILE, { schemaVersion: GROWTH_SCHEMA_VERSION, locations: [] }],
      ];
      for (const [name, value] of files) {
        const filePath = path.join(dir, name);
        const exists = (await readJson(filePath)) !== undefined;
        if (exists && !(options.force && name === MEMORY_RULESET_FILE)) {
          skipped.push(filePath);
          continue;
        }
        await writeAtomic(filePath, toJson(value));
        created.push(filePath);
      }
      await regenerateMemoryDocs(root);
      return { dir, created, skipped };
    },
    { resources: [root] }
  );
}

export async function saveRuleset(root: string, ruleset: GrowthRuleset): Promise<GrowthRuleset> {
  return withWorkspaceLease(
    async () => {
      const normalized = normalizeRuleset(ruleset);
      await writeAtomic(path.join(getMemoryDir(root), MEMORY_RULESET_FILE), toJson(normalized));
      await regenerateMemoryDocs(root);
      return normalized;
    },
    { resources: [root] }
  );
}

export async function saveSheet(root: string, sheet: GrowthSheet): Promise<GrowthSheet> {
  return withWorkspaceLease(
    async () => {
      const normalized = normalizeSheet(sheet, sheet.name);
      const dir = getMemoryDir(root);
      await writeAtomic(
        path.join(dir, MEMORY_SHEETS_DIR, `${toMemoryFileName(normalized.name)}.json`),
        toJson(normalized)
      );
      await regenerateMemoryDocs(root);
      return normalized;
    },
    { resources: [root] }
  );
}

export async function deleteSheet(root: string, name: string): Promise<void> {
  return withWorkspaceLease(
    async () => {
      const base = path.join(getMemoryDir(root), MEMORY_SHEETS_DIR, toMemoryFileName(name));
      await rm(`${base}.json`, { force: true });
      await rm(`${base}.md`, { force: true });
      await regenerateMemoryDocs(root);
    },
    { resources: [root] }
  );
}

export async function saveParty(root: string, party: PartyBook): Promise<PartyBook> {
  return withWorkspaceLease(
    async () => {
      const normalized = normalizePartyBook(party);
      await writeAtomic(path.join(getMemoryDir(root), MEMORY_PARTY_FILE), toJson(normalized));
      await regenerateMemoryDocs(root);
      return normalized;
    },
    { resources: [root] }
  );
}

export async function saveAtlas(root: string, atlas: Atlas): Promise<Atlas> {
  return withWorkspaceLease(
    async () => {
      const normalized = normalizeAtlas(atlas);
      await writeAtomic(path.join(getMemoryDir(root), MEMORY_ATLAS_FILE), toJson(normalized));
      await regenerateMemoryDocs(root);
      return normalized;
    },
    { resources: [root] }
  );
}

/** 按名字/别名获取角色卡，不存在时按当前规则新建并保存 */
export async function ensureSheet(
  root: string,
  name: string,
  aliases: string[] = []
): Promise<{ sheet: GrowthSheet; created: boolean; memory: LoadedMemory }> {
  return withWorkspaceLease(
    async () => {
      const memory = await loadMemory(root);
      const existing = findSheet(memory.sheets, name);
      if (existing) {
        const merged = Array.from(new Set([...existing.aliases, ...aliases])).filter(
          (alias) => alias && alias !== existing.name
        );
        if (merged.length !== existing.aliases.length) {
          const updated = await saveSheet(root, { ...existing, aliases: merged });
          return { sheet: updated, created: false, memory };
        }
        return { sheet: existing, created: false, memory };
      }
      const sheet = await saveSheet(root, createSheet(memory.ruleset, name, { aliases }));
      return { sheet, created: true, memory };
    },
    { resources: [root] }
  );
}

export interface SnapshotSyncInput {
  characters: CharacterSnapshotInput[];
  settings: SettingSnapshotInput[];
}

export interface SnapshotSyncResult {
  dir: string;
  characterFiles: string[];
  settingFiles: string[];
  removed: string[];
}

async function syncSnapshotDir(
  dir: string,
  items: Array<{ name: string; content: string }>
): Promise<{ written: string[]; removed: string[] }> {
  await mkdir(dir, { recursive: true });
  const written: string[] = [];
  const used = new Map<string, number>();
  for (const item of items) {
    const base = toMemoryFileName(item.name);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    const fileName = `${count === 0 ? base : `${base}-${count + 1}`}.md`;
    await writeAtomic(path.join(dir, fileName), item.content);
    written.push(path.join(dir, fileName));
  }
  // 删除数据库中已不存在的旧快照（只删 .md，不碰作者放进来的其他文件）
  const removed: string[] = [];
  for (const entry of await readdir(dir)) {
    const full = path.join(dir, entry);
    if (entry.endsWith('.md') && !written.includes(full)) {
      await rm(full, { force: true });
      removed.push(full);
    }
  }
  return { written, removed };
}

/** 把编辑器数据库中的人物卡与设定同步为 `角色卡/*.md`、`设定/*.md` 只读快照 */
export async function syncMemorySnapshots(
  root: string,
  input: SnapshotSyncInput
): Promise<SnapshotSyncResult> {
  return withWorkspaceLease(
    async () => {
      const dir = getMemoryDir(root);
      const characters = await syncSnapshotDir(
        path.join(dir, MEMORY_CHARACTER_CARDS_DIR),
        input.characters
          .filter((item) => item.name.trim())
          .map((item) => ({ name: item.name, content: renderCharacterSnapshot(item) }))
      );
      const settings = await syncSnapshotDir(
        path.join(dir, MEMORY_SETTINGS_DIR),
        input.settings
          .filter((item) => item.title.trim())
          .map((item) => ({
            name: item.category ? `${item.category}-${item.title}` : item.title,
            content: renderSettingSnapshot(item),
          }))
      );
      await regenerateMemoryDocs(root);
      return {
        dir,
        characterFiles: characters.written,
        settingFiles: settings.written,
        removed: [...characters.removed, ...settings.removed],
      };
    },
    { resources: [root] }
  );
}
