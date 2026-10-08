/**
 * ai-providers.json 旧版（schemaVersion 1：内置服务 providers[id] + customText + customMedia + defaultTextProviderId）
 * → 新版（schemaVersion 2：按能力的模型列表 models[] + 每个能力的默认模型 defaults）
 *
 * 规则（不丢任何东西）：
 * - 内置服务：已保存 Key 或改过配置（地址 / 模型 / 参数 / 单价 / 声音）的才变成一条模型，id 保持旧 id（Key 不用搬）；
 *   从没配置过的不出现在列表里
 * - 内置 openai-compatible 的地址 / 模型 / 参数在设置中心 JSON（按项目），这里只建条目（settingsImported: false），
 *   数据库打开后由 AIService 导入（见 service.ts reconcileLegacySettings）
 * - 自己添加的文本 / 视频 / 图片 / 语音服务（custom-*）原样变成模型，id、名称、参数不变
 * - 默认写作 AI：作者选过的保持；没选过时为内置 openai-compatible（它存在时）
 * - 视频队列设置原样保留
 */
import { BUILTIN_PROVIDERS } from '@novel-editor/ai';
import {
  AI_CAPABILITIES,
  defaultModelLabel,
  isAICapability,
  presetForVendor,
  presetProviderName,
  type AICapability,
} from '../../shared/ai-models';
import type { VideoSettingsInfo } from '../../shared/ai';

export const LEGACY_DEFAULT_TEXT_ID = 'openai-compatible';

export interface ModelEntry {
  id: string;
  capability: AICapability;
  /** 协议实现（注册表里的 Provider id） */
  vendor: string;
  /** 显示名称 */
  label: string;
  /** 添加时选的服务商预设（只用于显示「服务商」） */
  preset?: string;
  baseUrl?: string;
  model?: string;
  enabled: boolean;
  temperature?: number;
  maxTokens?: number;
  contextTokens?: number;
  pricePerSecond?: number;
  currency?: 'CNY' | 'USD';
  voice?: string;
  createdAt: string;
  /** 旧版内置 openai-compatible：参数是否已从设置中心 JSON 导入 */
  settingsImported?: boolean;
}

export interface ModelConfigFile {
  schemaVersion: 2;
  models: ModelEntry[];
  defaults: Partial<Record<AICapability, string>>;
  /** 新模型 id 的编号（按能力只增不减，删除后不复用，避免旧 Key 串号） */
  nextNumber: Record<AICapability, number>;
  video: VideoSettingsInfo;
}

export const DEFAULT_VIDEO_SETTINGS: VideoSettingsInfo = { maxConcurrent: 2 };

export function emptyModelConfig(): ModelConfigFile {
  return {
    schemaVersion: 2,
    models: [],
    defaults: {},
    nextNumber: { text: 1, image: 1, video: 1, speech: 1 },
    video: { ...DEFAULT_VIDEO_SETTINGS },
  };
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** 旧版每个服务的非密钥配置 → 模型参数（只取合法字段） */
export function legacyParams(stored: unknown): Partial<ModelEntry> {
  if (!isRecord(stored)) return {};
  const params: Partial<ModelEntry> = {};
  const baseUrl = str(stored.baseUrl);
  const model = str(stored.model);
  const voice = str(stored.voice);
  if (baseUrl) params.baseUrl = baseUrl;
  if (model) params.model = model;
  if (voice) params.voice = voice;
  for (const key of ['temperature', 'maxTokens', 'contextTokens', 'pricePerSecond'] as const) {
    const value = num(stored[key]);
    if (value !== undefined) params[key] = value;
  }
  if (stored.currency === 'CNY' || stored.currency === 'USD') params.currency = stored.currency;
  if (typeof stored.enabled === 'boolean') params.enabled = stored.enabled;
  return params;
}

/** 改过配置（不只是开关）：迁移时保留为一条模型 */
function hasMeaningfulConfig(params: Partial<ModelEntry>): boolean {
  return Object.keys(params).some((key) => key !== 'enabled');
}

export interface LegacyMigrationContext {
  /** 某个旧 id 是否已在 CredentialStore 里保存 Key */
  hasCredential: (id: string) => boolean;
  /** 迁移时间（createdAt） */
  now: string;
}

/** 内置服务的服务商名称（迁移后的显示名称前半段） */
function vendorProviderLabel(vendor: string): string {
  const preset = presetForVendor(vendor);
  if (preset) return presetProviderName(preset);
  return BUILTIN_PROVIDERS.find((item) => item.id === vendor)?.label ?? vendor;
}

function builtinEntry(
  vendor: string,
  capability: AICapability,
  params: Partial<ModelEntry>,
  now: string
): ModelEntry {
  const descriptor = BUILTIN_PROVIDERS.find((item) => item.id === vendor);
  const isLegacyDefault = vendor === LEGACY_DEFAULT_TEXT_ID;
  const model = params.model ?? (isLegacyDefault ? '' : (descriptor?.defaultModel ?? ''));
  return {
    id: vendor,
    capability,
    vendor,
    label: defaultModelLabel(vendorProviderLabel(vendor), model),
    preset: presetForVendor(vendor)?.key,
    ...params,
    enabled: params.enabled !== false,
    createdAt: now,
    ...(isLegacyDefault ? { settingsImported: false } : {}),
  };
}

function readLabel(value: unknown, fallback: string): string {
  return str(value)?.slice(0, 200) ?? fallback;
}

/** 编号：id 末尾的数字 */
function idNumber(id: string): number {
  const value = Number(id.slice(id.lastIndexOf('-') + 1));
  return Number.isInteger(value) ? value : 0;
}

/** 旧版文件 → 新版（纯函数；调用方负责写回与备份） */
export function migrateLegacyConfig(
  parsed: unknown,
  context: LegacyMigrationContext
): ModelConfigFile {
  const file = emptyModelConfig();
  if (!isRecord(parsed)) return file;
  const providers = isRecord(parsed.providers) ? parsed.providers : {};
  const seen = new Set<string>();

  for (const descriptor of BUILTIN_PROVIDERS) {
    if (!isAICapability(descriptor.kind)) continue;
    const params = legacyParams(providers[descriptor.id]);
    const configured = context.hasCredential(descriptor.id);
    // openai-compatible 的地址 / 模型在设置中心 JSON：只看 Key
    const keep =
      configured || (descriptor.id !== LEGACY_DEFAULT_TEXT_ID && hasMeaningfulConfig(params));
    if (!keep) continue;
    file.models.push(builtinEntry(descriptor.id, descriptor.kind, params, context.now));
    seen.add(descriptor.id);
  }

  const customText = Array.isArray(parsed.customText) ? parsed.customText : [];
  for (const item of customText) {
    if (!isRecord(item) || typeof item.id !== 'string') continue;
    if (!/^custom-text-[0-9]{1,6}$/.test(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    const params = legacyParams(providers[item.id]);
    file.models.push({
      id: item.id,
      capability: 'text',
      vendor: 'openai-compatible',
      label: readLabel(item.label, item.id),
      preset: 'custom',
      ...params,
      enabled: params.enabled !== false,
      createdAt: str(item.createdAt) ?? context.now,
    });
  }

  const customMedia = Array.isArray(parsed.customMedia) ? parsed.customMedia : [];
  for (const item of customMedia) {
    if (!isRecord(item) || typeof item.id !== 'string' || seen.has(item.id)) continue;
    if (!/^custom-(video|image|speech)-[0-9]{1,6}$/.test(item.id)) continue;
    const kind = item.kind;
    if (!isAICapability(kind) || !item.id.startsWith(`custom-${kind}-`)) continue;
    const vendor = BUILTIN_PROVIDERS.find(
      (entry) => entry.id === item.vendor && entry.kind === kind
    );
    if (!vendor) continue;
    seen.add(item.id);
    const params = legacyParams(providers[item.id]);
    file.models.push({
      id: item.id,
      capability: kind,
      vendor: vendor.id,
      label: readLabel(item.label, item.id),
      preset: presetForVendor(vendor.id)?.key,
      ...params,
      enabled: params.enabled !== false,
      createdAt: str(item.createdAt) ?? context.now,
    });
  }

  const chosen = str(parsed.defaultTextProviderId);
  const textIds = new Set(file.models.filter((m) => m.capability === 'text').map((m) => m.id));
  if (chosen && textIds.has(chosen)) file.defaults.text = chosen;
  else if (textIds.has(LEGACY_DEFAULT_TEXT_ID)) file.defaults.text = LEGACY_DEFAULT_TEXT_ID;

  // 新编号从旧自定义编号之后开始（新 id 形如 text-<n>，不会与 custom-* 冲突，这里只是保持递增直观）
  for (const capability of AI_CAPABILITIES) {
    const used = file.models
      .filter((item) => item.capability === capability && item.id.startsWith('custom-'))
      .map((item) => idNumber(item.id));
    file.nextNumber[capability] = Math.max(1, ...used.map((n) => n + 1));
  }

  if (isRecord(parsed.video)) {
    file.video = { ...DEFAULT_VIDEO_SETTINGS, ...(parsed.video as Partial<VideoSettingsInfo>) };
  }
  return file;
}
