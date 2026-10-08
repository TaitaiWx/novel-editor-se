/**
 * 旧版内置文本 AI（openai-compatible）的地址 / 模型 / 参数在设置中心 JSON（按项目数据库）里；
 * 模型列表统一后改存在它自己的模型条目里（应用全局）。
 *
 * - 数据库打开后第一次读取时导入一次（只补条目里没有的字段，标记 settingsImported）
 * - 安全存储里有它的 Key 但还没有条目（例如明文 Key 刚从设置 JSON 迁移出来）：新建条目并导入；
 *   这个能力还没有默认模型时设为默认（与旧版「内置 AI 就是默认写作 AI」一致）
 */
import { defaultModelLabel } from '../../shared/ai-models';
import type { CredentialStore } from './credential-store';
import { LEGACY_DEFAULT_TEXT_ID } from './model-migration';
import {
  normalizeBaseUrl,
  normalizeModelName,
  type ModelEntry,
  type ProviderConfigStore,
} from './provider-config';
import { parseDefaultTextSettings, type DefaultTextSettings } from './request';

/** 旧版设置中心的服务预设 → 新预设 key 与服务商名称 */
const LEGACY_PRESETS: Record<string, { preset: string; name: string }> = {
  'openai-official': { preset: 'openai', name: 'OpenAI' },
  'deepseek-official': { preset: 'deepseek', name: 'DeepSeek' },
  openrouter: { preset: 'custom', name: 'OpenRouter' },
  copilot: { preset: 'custom', name: 'GitHub Models' },
  custom: { preset: 'custom', name: 'OpenAI 兼容' },
};

/** 迁移时还没导入设置的条目名称 */
export const LEGACY_PLACEHOLDER_LABEL = 'OpenAI 兼容';

function safe<T>(task: () => T | undefined): T | undefined {
  try {
    return task();
  } catch {
    return undefined;
  }
}

/** 设置 JSON → 条目参数（不合法的字段丢弃） */
export function legacySettingsParams(settings: DefaultTextSettings): Partial<ModelEntry> {
  const params: Partial<ModelEntry> = {};
  const baseUrl = safe(() => normalizeBaseUrl(settings.baseUrl));
  const model = safe(() => normalizeModelName(settings.model));
  if (baseUrl) params.baseUrl = baseUrl;
  if (model) params.model = model;
  const inRange = (value: number | undefined, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  if (inRange(settings.temperature, 0, 2)) params.temperature = settings.temperature;
  if (inRange(settings.maxTokens, 1, 1_000_000)) params.maxTokens = settings.maxTokens;
  if (inRange(settings.contextTokens, 1_000, 10_000_000)) {
    params.contextTokens = settings.contextTokens;
  }
  return params;
}

/** 导入后的显示名称：「服务商 · 模型」（没有模型时不改名） */
export function legacySettingsLabel(settings: DefaultTextSettings): string | undefined {
  if (!settings.model) return undefined;
  const name = LEGACY_PRESETS[settings.preset ?? '']?.name ?? LEGACY_PLACEHOLDER_LABEL;
  return defaultModelLabel(name, settings.model);
}

export function legacySettingsPreset(settings: DefaultTextSettings): string {
  return LEGACY_PRESETS[settings.preset ?? '']?.preset ?? 'custom';
}

/** 数据库打开后（readSettings 有值）导入旧设置；没有需要做的事时直接返回 */
export function reconcileLegacySettings(
  raw: string | undefined,
  configs: ProviderConfigStore,
  credentials: CredentialStore
): void {
  if (raw === undefined) return;
  const entry = configs.getEntry(LEGACY_DEFAULT_TEXT_ID);
  if (entry?.settingsImported) return;
  const hasKey = credentials.has(LEGACY_DEFAULT_TEXT_ID);
  if (!entry && !hasKey) return;
  const settings = parseDefaultTextSettings(raw, hasKey);
  const params = legacySettingsParams(settings);
  const label = legacySettingsLabel(settings);
  if (!entry) {
    configs.add({
      id: LEGACY_DEFAULT_TEXT_ID,
      capability: 'text',
      vendor: 'openai-compatible',
      label: label ?? LEGACY_PLACEHOLDER_LABEL,
      preset: legacySettingsPreset(settings),
    });
    configs.importSettings(LEGACY_DEFAULT_TEXT_ID, params);
    if (!configs.getDefaultId('text')) configs.setDefaultId('text', LEGACY_DEFAULT_TEXT_ID);
    return;
  }
  configs.importSettings(
    LEGACY_DEFAULT_TEXT_ID,
    params,
    entry.label === LEGACY_PLACEHOLDER_LABEL ? label : undefined
  );
}
