/**
 * AI 模型列表的非密钥配置（userData/ai-providers.json，应用全局）
 *
 * - schemaVersion 2：按能力（文本 / 图片 / 视频 / 语音）的模型列表 models[]、每个能力的默认模型 defaults、视频队列设置
 * - 每条模型：id、能力、协议实现（vendor）、显示名称、服务商预设、接口地址、模型与参数；Key 在 CredentialStore（按 id）
 * - 旧版文件（schemaVersion 1）第一次读取时迁移（model-migration.ts），原文件备份为 ai-providers.v1.json
 * - 所有写入都在这里校验（地址只允许 http(s) 且不含账号密码、名称长度、模型长度、数值范围、每个能力最多 50 条）
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import { normalizeLanguage } from '@novel-editor/video';
import type { AIProviderUpdate, VideoSettingsInfo } from '../../shared/ai';
import {
  AI_CAPABILITIES,
  findPreset,
  isAICapability,
  MAX_MODELS_PER_CAPABILITY,
  MODEL_ID_PATTERN,
  MODEL_LABEL_MAX,
  MODEL_NAME_MAX,
  PRESET_KEY_PATTERN,
  type AICapability,
} from '../../shared/ai-models';
import {
  DEFAULT_VIDEO_SETTINGS,
  emptyModelConfig,
  legacyParams,
  migrateLegacyConfig,
  type ModelConfigFile,
  type ModelEntry,
} from './model-migration';

export { DEFAULT_VIDEO_SETTINGS, type ModelEntry };

/** 一条模型的参数（视频费用预估等只关心这些） */
export interface StoredProviderConfig {
  enabled?: boolean;
  baseUrl?: string;
  model?: string;
  pricePerSecond?: number;
  currency?: 'CNY' | 'USD';
  temperature?: number;
  maxTokens?: number;
  contextTokens?: number;
  voice?: string;
}

export const PROVIDER_CONFIG_FILE_NAME = 'ai-providers.json';
export const LEGACY_BACKUP_SUFFIX = '.v1.json';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 校验接口地址：只允许 http(s)、不含账号密码，去掉末尾斜杠；空字符串表示恢复默认 */
export function normalizeBaseUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length > 2048) throw new Error('接口地址过长');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('接口地址格式不正确');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('接口地址只支持 http / https');
  }
  if (url.username || url.password) throw new Error('接口地址不能包含账号密码');
  return trimmed.replace(/\/+$/, '');
}

export function normalizeModelName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length > MODEL_NAME_MAX || /[\r\n]/.test(trimmed)) throw new Error('模型名称无效');
  return trimmed;
}

/** 显示名称：1–40 个字符，不含控制字符 */
export function normalizeModelLabel(value: unknown): string {
  if (typeof value !== 'string') throw new Error('名称无效');
  const trimmed = value.trim();
  const chars = Array.from(trimmed);
  if (chars.length === 0) throw new Error('名称不能为空');
  if (chars.length > MODEL_LABEL_MAX) throw new Error(`名称不能超过 ${MODEL_LABEL_MAX} 个字符`);
  const hasControl = chars.some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (hasControl) throw new Error('名称不能包含控制字符');
  return trimmed;
}

export function isModelId(value: unknown): value is string {
  return typeof value === 'string' && MODEL_ID_PATTERN.test(value);
}

/** 可选数值：null 删除，范围外报错，其他类型忽略 */
function applyNumber(
  target: ModelEntry,
  key: 'temperature' | 'maxTokens' | 'contextTokens',
  value: unknown,
  min: number,
  max: number,
  label: string
): void {
  if (value === null) {
    delete target[key];
    return;
  }
  if (typeof value !== 'number') return;
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label}需在 ${min}–${max} 之间`);
  }
  target[key] = value;
}

/** 把一次更新应用到模型上（全部字段校验；apiKey / clearKey 由 CredentialStore 处理，这里忽略） */
export function applyModelUpdate(entry: ModelEntry, update: AIProviderUpdate): ModelEntry {
  const next: ModelEntry = { ...entry };
  if (update.label !== undefined) next.label = normalizeModelLabel(update.label);
  if (typeof update.enabled === 'boolean') next.enabled = update.enabled;
  const baseUrl = normalizeBaseUrl(update.baseUrl);
  if (baseUrl !== undefined) {
    if (baseUrl) next.baseUrl = baseUrl;
    else delete next.baseUrl;
  }
  const model = normalizeModelName(update.model);
  if (model !== undefined) {
    if (model) next.model = model;
    else delete next.model;
  }
  if (update.preset !== undefined) {
    const preset = findPreset(
      typeof update.preset === 'string' && PRESET_KEY_PATTERN.test(update.preset)
        ? update.preset
        : undefined
    );
    if (!preset || preset.capability !== next.capability || preset.vendor !== next.vendor) {
      throw new Error('服务商预设与模型类型不一致');
    }
    next.preset = preset.key;
  }
  if (update.pricePerSecond === null) delete next.pricePerSecond;
  else if (typeof update.pricePerSecond === 'number') {
    if (!Number.isFinite(update.pricePerSecond) || update.pricePerSecond < 0) {
      throw new Error('单价必须是非负数');
    }
    next.pricePerSecond = update.pricePerSecond;
  }
  if (update.currency === 'CNY' || update.currency === 'USD') next.currency = update.currency;
  applyNumber(next, 'temperature', update.temperature, 0, 2, '温度');
  applyNumber(next, 'maxTokens', update.maxTokens, 1, 1_000_000, '单次回复长度');
  applyNumber(next, 'contextTokens', update.contextTokens, 1_000, 10_000_000, '上下文长度');
  if (typeof update.voice === 'string') {
    const voice = update.voice.trim();
    if (voice.length > 100 || /[\r\n]/.test(voice)) throw new Error('声音名称无效');
    if (voice) next.voice = voice;
    else delete next.voice;
  }
  return next;
}

/** 读取新版文件里的一条模型（不合法的丢弃） */
function readEntry(value: unknown): ModelEntry | null {
  if (!isRecord(value) || !isModelId(value.id) || !isAICapability(value.capability)) return null;
  if (typeof value.vendor !== 'string' || !value.vendor) return null;
  const label = typeof value.label === 'string' && value.label.trim() ? value.label.trim() : null;
  if (!label) return null;
  const params = legacyParams(value);
  return {
    id: value.id,
    capability: value.capability,
    vendor: value.vendor,
    label: label.slice(0, 200),
    ...(typeof value.preset === 'string' && value.preset ? { preset: value.preset } : {}),
    ...params,
    enabled: params.enabled !== false,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    ...(typeof value.settingsImported === 'boolean'
      ? { settingsImported: value.settingsImported }
      : {}),
  };
}

function readFile(parsed: Record<string, unknown>): ModelConfigFile {
  const file = emptyModelConfig();
  const seen = new Set<string>();
  for (const item of Array.isArray(parsed.models) ? parsed.models : []) {
    const entry = readEntry(item);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    file.models.push(entry);
  }
  const defaults = isRecord(parsed.defaults) ? parsed.defaults : {};
  const nextNumber = isRecord(parsed.nextNumber) ? parsed.nextNumber : {};
  for (const capability of AI_CAPABILITIES) {
    const id = defaults[capability];
    if (typeof id === 'string' && seen.has(id)) file.defaults[capability] = id;
    const n = nextNumber[capability];
    if (typeof n === 'number' && Number.isInteger(n) && n > 0) file.nextNumber[capability] = n;
  }
  if (isRecord(parsed.video)) {
    file.video = { ...DEFAULT_VIDEO_SETTINGS, ...(parsed.video as Partial<VideoSettingsInfo>) };
  }
  return file;
}

export interface ProviderConfigStoreOptions {
  /** 旧版迁移时判断某个旧 id 是否已保存 Key */
  hasCredential?: (id: string) => boolean;
  clock?: () => Date;
}

/** 新增模型的身份字段（其余参数经 applyModelUpdate 校验后写入） */
export interface NewModelIdentity {
  capability: AICapability;
  vendor: string;
  label: string;
  preset?: string;
  /** 指定 id（旧版内置服务的兼容入口）；省略时分配 <能力>-<n> */
  id?: string;
}

export class ProviderConfigStore {
  constructor(
    private readonly filePath: string,
    private readonly options: ProviderConfigStoreOptions = {}
  ) {}

  private now(): string {
    return (this.options.clock ?? (() => new Date()))().toISOString();
  }

  private read(): ModelConfigFile {
    if (!existsSync(this.filePath)) return emptyModelConfig();
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, 'utf-8')) as unknown;
    } catch {
      return emptyModelConfig();
    }
    if (!isRecord(parsed)) return emptyModelConfig();
    if (parsed.schemaVersion === 2) return readFile(parsed);
    // 旧版：迁移并写回（原文件先备份，备份已存在时不覆盖）
    const migrated = migrateLegacyConfig(parsed, {
      hasCredential: this.options.hasCredential ?? (() => false),
      now: this.now(),
    });
    try {
      const backup = this.filePath.replace(/\.json$/, '') + LEGACY_BACKUP_SUFFIX;
      if (!existsSync(backup)) writeFileSync(backup, readFileSync(this.filePath));
      this.write(migrated);
    } catch (error) {
      console.warn('[ai] 迁移 ai-providers.json 失败（本次按迁移结果使用）:', error);
    }
    return migrated;
  }

  private write(file: ModelConfigFile): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(file, null, 2)}\n`, 'utf-8');
    renameSync(temp, this.filePath);
  }

  /** 全部模型（按添加顺序；可按能力过滤） */
  list(capability?: AICapability): ModelEntry[] {
    return this.read()
      .models.filter((item) => !capability || item.capability === capability)
      .map((item) => ({ ...item }));
  }

  getEntry(id: string): ModelEntry | undefined {
    const entry = this.read().models.find((item) => item.id === id);
    return entry ? { ...entry } : undefined;
  }

  /** 一条模型的参数（不存在时为空对象） */
  get(id: string): StoredProviderConfig {
    const entry = this.read().models.find((item) => item.id === id);
    if (!entry) return {};
    const { enabled, baseUrl, model, pricePerSecond, currency } = entry;
    const { temperature, maxTokens, contextTokens, voice } = entry;
    const params: StoredProviderConfig = {
      enabled,
      baseUrl,
      model,
      pricePerSecond,
      currency,
      temperature,
      maxTokens,
      contextTokens,
      voice,
    };
    for (const key of Object.keys(params) as Array<keyof StoredProviderConfig>) {
      if (params[key] === undefined) delete params[key];
    }
    return params;
  }

  /** 新增一条模型（参数校验失败时不写入） */
  add(identity: NewModelIdentity, update: AIProviderUpdate = {}): ModelEntry {
    const file = this.read();
    const { capability } = identity;
    if (!isAICapability(capability)) throw new Error('无效的模型类型');
    if (
      file.models.filter((item) => item.capability === capability).length >=
      MAX_MODELS_PER_CAPABILITY
    ) {
      throw new Error(`每类最多添加 ${MAX_MODELS_PER_CAPABILITY} 个模型`);
    }
    let id = identity.id;
    if (id !== undefined) {
      if (!isModelId(id)) throw new Error('无效的模型 id');
      if (file.models.some((item) => item.id === id)) throw new Error('模型已存在');
    } else {
      let n = file.nextNumber[capability];
      while (file.models.some((item) => item.id === `${capability}-${n}`)) n += 1;
      id = `${capability}-${n}`;
      file.nextNumber[capability] = n + 1;
    }
    const base: ModelEntry = {
      id,
      capability,
      vendor: identity.vendor,
      label: normalizeModelLabel(identity.label),
      enabled: true,
      createdAt: this.now(),
    };
    const entry = applyModelUpdate(
      base,
      identity.preset ? { ...update, preset: identity.preset } : update
    );
    file.models.push(entry);
    this.write(file);
    return { ...entry };
  }

  /** 合并更新（全部字段校验） */
  update(id: string, update: AIProviderUpdate): ModelEntry {
    const file = this.read();
    const index = file.models.findIndex((item) => item.id === id);
    if (index < 0) throw new Error('找不到这个模型');
    const next = applyModelUpdate(file.models[index], update);
    file.models[index] = next;
    this.write(file);
    return { ...next };
  }

  /** 旧版 openai-compatible：从设置中心 JSON 导入的参数（只补没有的字段），并标记已导入 */
  importSettings(id: string, params: Partial<ModelEntry>, label?: string): ModelEntry | undefined {
    const file = this.read();
    const entry = file.models.find((item) => item.id === id);
    if (!entry) return undefined;
    for (const key of ['baseUrl', 'model', 'temperature', 'maxTokens', 'contextTokens'] as const) {
      const value = params[key];
      if (value !== undefined && entry[key] === undefined) {
        (entry as unknown as Record<string, unknown>)[key] = value;
      }
    }
    if (label) entry.label = label;
    entry.settingsImported = true;
    this.write(file);
    return { ...entry };
  }

  /** 删除一条模型；它是某个能力的默认模型时清除默认（之后按第一个可用的） */
  remove(id: string): boolean {
    const file = this.read();
    const before = file.models.length;
    file.models = file.models.filter((item) => item.id !== id);
    if (file.models.length === before) return false;
    for (const capability of AI_CAPABILITIES) {
      if (file.defaults[capability] === id) delete file.defaults[capability];
    }
    this.write(file);
    return true;
  }

  getDefaultId(capability: AICapability): string | undefined {
    return this.read().defaults[capability];
  }

  /** 设置某个能力的默认模型（undefined 清除；由调用方校验 id 的能力） */
  setDefaultId(capability: AICapability, id: string | undefined): void {
    const file = this.read();
    if (id) file.defaults[capability] = id;
    else delete file.defaults[capability];
    this.write(file);
  }

  getVideoSettings(): VideoSettingsInfo {
    return { ...this.read().video };
  }

  updateVideoSettings(update: Partial<VideoSettingsInfo>): VideoSettingsInfo {
    const file = this.read();
    const next: VideoSettingsInfo = { ...file.video };
    if (typeof update.maxConcurrent === 'number' && Number.isFinite(update.maxConcurrent)) {
      next.maxConcurrent = Math.min(8, Math.max(1, Math.round(update.maxConcurrent)));
    }
    for (const key of ['dailyLimit', 'perTaskLimit'] as const) {
      const value = update[key];
      if (value === undefined) continue;
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) next[key] = value;
      else delete next[key];
    }
    if (update.voiceLanguage !== undefined) {
      const language = normalizeLanguage(update.voiceLanguage);
      if (language) next.voiceLanguage = language;
      else delete next.voiceLanguage;
    }
    file.video = next;
    this.write(file);
    return { ...next };
  }
}
