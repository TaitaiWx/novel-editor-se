/**
 * 正文结构规则的存储（仅主进程与 CLI 使用，GUI 渲染进程经 IPC 读写）
 *
 * - `ne init` 项目（有 `.novel-editor/config.json`）：写在 config.json 的 `structure` 字段，
 *   保留其他字段不变（GUI 与 CLI 读同一份）
 * - 普通文件夹（没有 config.json）：写在 `<文件夹>/.novel-editor/structure.json`
 *   （`{ schemaVersion, structure }`）。不写 config.json，否则普通文件夹会变成 `ne init` 项目、
 *   正文树改按 novels/ 布局展示；GUI 打开过的文件夹本来就有 `.novel-editor/`（session.json）
 * - 两处都没有时使用默认规则（中文 + English）
 *
 * 读取时校验：未知预设、无效 / 不安全的自定义规则被丢弃并给出 warnings，不会让读取失败。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CoreError } from './errors';
import { pathExists } from './fs-ops';
import { PROJECT_CONFIG_FILE, PROJECT_META_DIR } from './project';
import {
  cloneStructureConfig,
  DEFAULT_STRUCTURE_CONFIG,
  normalizeStructureConfig,
  validateCustomStructureRule,
  STRUCTURE_PRESET_IDS,
  type StructureConfig,
} from './structure-rules';

export const STRUCTURE_CONFIG_FILE = 'structure.json';
export const STRUCTURE_CONFIG_SCHEMA_VERSION = 1;

export type StructureConfigLocationKind = 'project' | 'folder';

export interface StructureConfigLocation {
  /** project：写在 config.json 的 structure 字段；folder：写在 .novel-editor/structure.json */
  kind: StructureConfigLocationKind;
  /** 文件夹 / 项目根 */
  root: string;
  file: string;
}

export interface StructureConfigReadResult {
  config: StructureConfig;
  location: StructureConfigLocation;
  /** 文件里是否保存过结构配置（否则为默认规则） */
  stored: boolean;
  warnings: string[];
}

/** 文件夹对应的结构配置位置（不检查是否已保存） */
export async function resolveStructureConfigLocation(
  folder: string
): Promise<StructureConfigLocation> {
  const root = path.resolve(folder);
  const configFile = path.join(root, PROJECT_META_DIR, PROJECT_CONFIG_FILE);
  if (await pathExists(configFile)) return { kind: 'project', root, file: configFile };
  return { kind: 'folder', root, file: path.join(root, PROJECT_META_DIR, STRUCTURE_CONFIG_FILE) };
}

async function readJsonObject(file: string): Promise<Record<string, unknown> | null> {
  let text: string;
  try {
    text = await readFile(file, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 落到下面统一报错
  }
  throw new CoreError('INVALID_ARGUMENT', `配置文件解析失败: ${file}`);
}

/** 读取文件夹（项目根或普通文件夹）的正文结构规则 */
export async function readStructureConfig(folder: string): Promise<StructureConfigReadResult> {
  const location = await resolveStructureConfigLocation(folder);
  const json = await readJsonObject(location.file);
  const raw = json?.structure;
  if (raw === undefined) {
    return {
      config: cloneStructureConfig(DEFAULT_STRUCTURE_CONFIG),
      location,
      stored: false,
      warnings: [],
    };
  }
  const { config, warnings } = normalizeStructureConfig(raw);
  return { config, location, stored: true, warnings };
}

/**
 * 严格校验要写入的配置（不同于读取时的宽松处理：有任何无效项都拒绝，避免静默丢掉作者的规则）
 */
export function assertValidStructureConfig(raw: unknown): StructureConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new CoreError('INVALID_ARGUMENT', '结构配置必须是对象');
  }
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.presets) || !Array.isArray(value.custom)) {
    throw new CoreError('INVALID_ARGUMENT', '结构配置需要 presets 与 custom 两个数组');
  }
  for (const preset of value.presets) {
    if (
      typeof preset !== 'string' ||
      !(STRUCTURE_PRESET_IDS as readonly string[]).includes(preset)
    ) {
      throw new CoreError(
        'INVALID_ARGUMENT',
        `未知的预设：${String(preset)}（可选 ${STRUCTURE_PRESET_IDS.join(' / ')}）`
      );
    }
  }
  const ids = new Set<string>();
  for (const rule of value.custom) {
    const result = validateCustomStructureRule(rule);
    if (!result.ok) {
      const id = (rule as { id?: unknown } | null)?.id;
      throw new CoreError(
        'INVALID_ARGUMENT',
        `自定义规则 ${typeof id === 'string' ? id : ''} 无效：${result.error}`
      );
    }
    if (ids.has(result.rule.id)) {
      throw new CoreError('INVALID_ARGUMENT', `自定义规则 id 重复：${result.rule.id}`);
    }
    ids.add(result.rule.id);
  }
  const { config, warnings } = normalizeStructureConfig(value);
  if (warnings.length) throw new CoreError('INVALID_ARGUMENT', warnings.join('；'));
  return config;
}

/** 原子写入 JSON（先写临时文件再改名） */
async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  await rename(temp, file);
}

/** 保存正文结构规则；返回规范化后的配置与写入位置 */
export async function writeStructureConfig(
  folder: string,
  raw: unknown
): Promise<StructureConfigReadResult> {
  const config = assertValidStructureConfig(raw);
  const location = await resolveStructureConfigLocation(folder);
  const existing = (await readJsonObject(location.file)) ?? {};
  const next =
    location.kind === 'project'
      ? { ...existing, structure: config }
      : { ...existing, schemaVersion: STRUCTURE_CONFIG_SCHEMA_VERSION, structure: config };
  await writeJsonAtomic(location.file, next);
  return { config, location, stored: true, warnings: [] };
}

/**
 * 从 start 向上查找保存了结构配置的目录（项目 config.json 或普通文件夹的 structure.json）；
 * 都没有时返回 null（使用默认规则）。CLI 在普通文件夹里执行 `ne lint` / `ne stats` 时使用。
 */
export async function findStructureConfigRoot(start: string): Promise<string | null> {
  let current = path.resolve(start);
  for (;;) {
    const meta = path.join(current, PROJECT_META_DIR);
    if (
      (await pathExists(path.join(meta, PROJECT_CONFIG_FILE))) ||
      (await pathExists(path.join(meta, STRUCTURE_CONFIG_FILE)))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
