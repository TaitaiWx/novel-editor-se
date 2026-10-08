/**
 * Provider 非密钥配置（地址、模型、启用、单价、声音）、自定义文本 AI、默认写作 AI 与视频队列设置
 *
 * 保存在 userData/ai-providers.json（应用全局）。内置 openai-compatible 的地址 / 模型 / 温度仍沿用
 * 设置中心「AI 设置」（novel-editor:settings-center），这里只保存它的启用开关与其他 Provider。
 * 自定义文本 AI（custom-text-<n>）只在这里登记名称；它们的 Key 与其他服务一样在 CredentialStore。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import { normalizeLanguage } from '@novel-editor/video';
import type { AIProviderUpdate, VideoSettingsInfo } from '../../shared/ai';

export interface StoredProviderConfig {
  enabled?: boolean;
  baseUrl?: string;
  model?: string;
  pricePerSecond?: number;
  currency?: 'CNY' | 'USD';
  /** 文本服务：温度 / 单次回复长度 / 上下文长度 */
  temperature?: number;
  maxTokens?: number;
  contextTokens?: number;
  /** 配音服务：默认声音 */
  voice?: string;
}

/** 作者添加的 OpenAI 兼容文本 AI（DeepSeek、通义、Kimi、本地 Ollama 等） */
export interface CustomTextProfile {
  id: string;
  label: string;
  createdAt: string;
}

interface ProviderConfigFile {
  schemaVersion: 1;
  providers: Record<string, StoredProviderConfig>;
  video: VideoSettingsInfo;
  customText: CustomTextProfile[];
  /** 下一个自定义文本 AI 的编号（只增不减，删除后不复用，避免旧 Key 串号） */
  nextCustomTextNumber: number;
  /** 作者选定的默认写作 AI；未选择时为内置 openai-compatible */
  defaultTextProviderId?: string;
}

export const CUSTOM_TEXT_ID_PREFIX = 'custom-text-';
export const CUSTOM_TEXT_ID_PATTERN = /^custom-text-[0-9]{1,6}$/;
export const MAX_CUSTOM_TEXT_PROVIDERS = 20;
const LABEL_MAX = 40;

export const PROVIDER_CONFIG_FILE_NAME = 'ai-providers.json';
export const DEFAULT_VIDEO_SETTINGS: VideoSettingsInfo = { maxConcurrent: 2 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 校验接口地址：只允许 http(s)，去掉末尾斜杠 */
export function normalizeBaseUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return '';
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

function normalizeModel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length > 200 || /[\r\n]/.test(trimmed)) throw new Error('模型名称无效');
  return trimmed;
}

/** 自定义文本 AI 的名称：1–40 个字符，不含控制字符 */
export function normalizeProfileLabel(value: unknown): string {
  if (typeof value !== 'string') throw new Error('名称无效');
  const trimmed = value.trim();
  const length = Array.from(trimmed).length;
  if (length === 0) throw new Error('名称不能为空');
  if (length > LABEL_MAX) throw new Error(`名称不能超过 ${LABEL_MAX} 个字符`);
  const hasControl = Array.from(trimmed).some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (hasControl) throw new Error('名称不能包含控制字符');
  return trimmed;
}

export function isCustomTextId(value: unknown): value is string {
  return typeof value === 'string' && CUSTOM_TEXT_ID_PATTERN.test(value);
}

/** 可选数值：null 删除，范围外报错，其他类型忽略 */
function applyNumber(
  target: StoredProviderConfig,
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

function readCustomText(value: unknown): CustomTextProfile[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const list: CustomTextProfile[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isCustomTextId(item.id) || seen.has(item.id)) continue;
    if (typeof item.label !== 'string' || !item.label.trim()) continue;
    seen.add(item.id);
    list.push({
      id: item.id,
      label: item.label.trim().slice(0, 200),
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
    });
  }
  return list;
}

/** 已用编号的下一个（文件里记录的计数器与现有 id 取较大值） */
function nextNumber(stored: unknown, list: CustomTextProfile[]): number {
  const used = list.map((item) => Number(item.id.slice(CUSTOM_TEXT_ID_PREFIX.length)));
  const fromFile =
    typeof stored === 'number' && Number.isInteger(stored) && stored > 0 ? stored : 1;
  return Math.max(fromFile, ...used.map((n) => n + 1), 1);
}

export class ProviderConfigStore {
  constructor(private readonly filePath: string) {}

  private read(): ProviderConfigFile {
    const empty: ProviderConfigFile = {
      schemaVersion: 1,
      providers: {},
      video: { ...DEFAULT_VIDEO_SETTINGS },
      customText: [],
      nextCustomTextNumber: 1,
    };
    if (!existsSync(this.filePath)) return empty;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8')) as unknown;
      if (!isRecord(parsed)) return empty;
      const providers = isRecord(parsed.providers)
        ? (parsed.providers as Record<string, StoredProviderConfig>)
        : {};
      const video = isRecord(parsed.video) ? (parsed.video as Partial<VideoSettingsInfo>) : {};
      const customText = readCustomText(parsed.customText);
      const defaultId =
        typeof parsed.defaultTextProviderId === 'string' && parsed.defaultTextProviderId
          ? parsed.defaultTextProviderId
          : undefined;
      return {
        schemaVersion: 1,
        providers,
        video: { ...DEFAULT_VIDEO_SETTINGS, ...video },
        customText,
        nextCustomTextNumber: nextNumber(parsed.nextCustomTextNumber, customText),
        ...(defaultId ? { defaultTextProviderId: defaultId } : {}),
      };
    } catch {
      return empty;
    }
  }

  private write(file: ProviderConfigFile): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(file, null, 2)}\n`, 'utf-8');
    renameSync(temp, this.filePath);
  }

  get(providerId: string): StoredProviderConfig {
    return { ...(this.read().providers[providerId] ?? {}) };
  }

  /** 合并更新（apiKey / clearKey 由 CredentialStore 处理，这里忽略） */
  update(providerId: string, update: AIProviderUpdate): StoredProviderConfig {
    const file = this.read();
    const next: StoredProviderConfig = { ...(file.providers[providerId] ?? {}) };
    if (typeof update.enabled === 'boolean') next.enabled = update.enabled;
    const baseUrl = normalizeBaseUrl(update.baseUrl);
    if (baseUrl !== undefined) {
      if (baseUrl) next.baseUrl = baseUrl;
      else delete next.baseUrl;
    }
    const model = normalizeModel(update.model);
    if (model !== undefined) {
      if (model) next.model = model;
      else delete next.model;
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
    file.providers[providerId] = next;
    this.write(file);
    return { ...next };
  }

  // ─── 自定义文本 AI ──────────────────────────────────────────────────

  listCustomText(): CustomTextProfile[] {
    return this.read().customText.map((item) => ({ ...item }));
  }

  /** 登记一个自定义文本 AI，返回分配的 id（custom-text-<n>） */
  addCustomText(label: unknown, createdAt: string): CustomTextProfile {
    const name = normalizeProfileLabel(label);
    const file = this.read();
    if (file.customText.length >= MAX_CUSTOM_TEXT_PROVIDERS) {
      throw new Error(`最多添加 ${MAX_CUSTOM_TEXT_PROVIDERS} 个文本 AI`);
    }
    const profile: CustomTextProfile = {
      id: `${CUSTOM_TEXT_ID_PREFIX}${file.nextCustomTextNumber}`,
      label: name,
      createdAt,
    };
    file.customText.push(profile);
    file.nextCustomTextNumber += 1;
    // 编号只增不减；同 id 的旧配置（理论上不存在）一并清掉
    delete file.providers[profile.id];
    this.write(file);
    return { ...profile };
  }

  renameCustomText(id: string, label: unknown): CustomTextProfile {
    const name = normalizeProfileLabel(label);
    const file = this.read();
    const profile = file.customText.find((item) => item.id === id);
    if (!profile) throw new Error('找不到这个文本 AI');
    profile.label = name;
    this.write(file);
    return { ...profile };
  }

  /** 删除自定义文本 AI 的登记与配置；它是默认写作 AI 时恢复为内置默认 */
  removeCustomText(id: string): boolean {
    const file = this.read();
    const before = file.customText.length;
    file.customText = file.customText.filter((item) => item.id !== id);
    const existed = file.customText.length !== before || id in file.providers;
    delete file.providers[id];
    if (file.defaultTextProviderId === id) delete file.defaultTextProviderId;
    if (existed) this.write(file);
    return existed;
  }

  getDefaultTextProviderId(): string | undefined {
    return this.read().defaultTextProviderId;
  }

  /** 设置默认写作 AI；传入 undefined 恢复为内置默认（由调用方校验 id 是文本服务） */
  setDefaultTextProviderId(id: string | undefined): void {
    const file = this.read();
    if (id) file.defaultTextProviderId = id;
    else delete file.defaultTextProviderId;
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
