/**
 * Provider 非密钥配置（地址、模型、启用、单价）与视频队列设置
 *
 * 保存在 userData/ai-providers.json（应用全局）。openai-compatible 的地址 / 模型 / 温度仍沿用
 * 设置中心「AI 设置」（novel-editor:settings-center），这里只保存其他 Provider。
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
}

interface ProviderConfigFile {
  schemaVersion: 1;
  providers: Record<string, StoredProviderConfig>;
  video: VideoSettingsInfo;
}

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

export class ProviderConfigStore {
  constructor(private readonly filePath: string) {}

  private read(): ProviderConfigFile {
    const empty: ProviderConfigFile = {
      schemaVersion: 1,
      providers: {},
      video: { ...DEFAULT_VIDEO_SETTINGS },
    };
    if (!existsSync(this.filePath)) return empty;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8')) as unknown;
      if (!isRecord(parsed)) return empty;
      const providers = isRecord(parsed.providers)
        ? (parsed.providers as Record<string, StoredProviderConfig>)
        : {};
      const video = isRecord(parsed.video) ? (parsed.video as Partial<VideoSettingsInfo>) : {};
      return {
        schemaVersion: 1,
        providers,
        video: { ...DEFAULT_VIDEO_SETTINGS, ...video },
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
    file.providers[providerId] = next;
    this.write(file);
    return { ...next };
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
