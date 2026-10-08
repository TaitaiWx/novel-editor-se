/**
 * 设置中心 JSON（novel-editor:settings-center）中的 AI Key 处理
 *
 * 旧版把 API Key 明文存在设置 JSON（项目数据库的 settings 表）里。现在：
 * - migratePlaintextApiKey：打开数据库时把明文 Key 移入 CredentialStore，并从设置 JSON 中删除
 *   （顶层旧格式 apiKey 与嵌套 ai.apiKey 都处理）。若安全存储里已有 Key 且与明文不同，
 *   以安全存储为准（作者最近一次填写的值），明文同样删除
 * - sanitizeSettingsForRenderer：db-settings-get 返回前去掉 apiKey，注入 ai.hasApiKey
 * - interceptSettingsWrite：db-settings-set 写入前把 apiKey 转存到 CredentialStore 并去掉，
 *   同时丢弃渲染进程回写的派生字段（hasApiKey、默认写作 AI 摘要；兼容尚未改造的旧入口）
 * 迁移前「没有显式开关但填了 Key ⇒ 视为已启用」的推断在迁移时固化为 enabled + enabledExplicitlySet。
 */
export const SETTINGS_CENTER_KEY = 'novel-editor:settings-center';
export const DEFAULT_TEXT_PROVIDER_ID = 'openai-compatible';

export interface SecretSink {
  get(providerId: string): string | null;
  set(providerId: string, secret: string): void;
  has(providerId: string): boolean;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parse(raw: string | null | undefined): JsonRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readKey(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 从设置对象中取出明文 Key（嵌套优先，与渲染进程 mergeSettingsDraft 一致）并删除；返回 Key 与是否改动 */
function extractApiKey(settings: JsonRecord): { key: string; changed: boolean } {
  let changed = false;
  let key = '';
  const nested = isRecord(settings.ai) ? settings.ai : null;
  if (nested && 'apiKey' in nested) {
    key = readKey(nested.apiKey);
    delete nested.apiKey;
    changed = true;
  }
  if ('apiKey' in settings) {
    key = key || readKey(settings.apiKey);
    delete settings.apiKey;
    changed = true;
  }
  return { key, changed };
}

/** 迁移前的「是否启用」推断（与旧版主进程 / 渲染进程一致） */
function effectiveEnabled(settings: JsonRecord, hadKey: boolean): boolean {
  const nested = isRecord(settings.ai) ? settings.ai : {};
  const explicit =
    nested.enabledExplicitlySet === true ||
    settings.enabledExplicitlySet === true ||
    'enabledExplicitlySet' in settings ||
    'enabledExplicitlySet' in nested;
  // 与渲染进程 mergeSettingsDraft 一致：嵌套 ai.enabled 优先，其次旧版顶层 enabled
  const enabled = typeof nested.enabled === 'boolean' ? nested.enabled : Boolean(settings.enabled);
  return explicit ? enabled : enabled || hadKey;
}

export interface MigrationOutcome {
  migrated: boolean;
  /** 安全存储里已有不同的 Key，明文被丢弃 */
  conflict: boolean;
}

export function migratePlaintextApiKey(
  settingsStore: { get(key: string): string | undefined; set(key: string, value: string): void },
  secrets: SecretSink
): MigrationOutcome {
  const raw = settingsStore.get(SETTINGS_CENTER_KEY);
  const settings = parse(raw);
  if (!settings) return { migrated: false, conflict: false };
  const enabledBefore = effectiveEnabled(
    settings,
    Boolean(readKey(settings.apiKey) || (isRecord(settings.ai) ? readKey(settings.ai.apiKey) : ''))
  );
  const { key, changed } = extractApiKey(settings);
  if (!changed) return { migrated: false, conflict: false };
  let conflict = false;
  if (key) {
    const existing = secrets.get(DEFAULT_TEXT_PROVIDER_ID);
    if (!existing) secrets.set(DEFAULT_TEXT_PROVIDER_ID, key);
    else conflict = existing !== key;
    const ai = isRecord(settings.ai) ? settings.ai : {};
    settings.ai = { ...ai, enabled: enabledBefore, enabledExplicitlySet: true };
    // 顶层旧格式字段会覆盖嵌套值（渲染进程 normalizeParsedAISettings 中顶层 enabled 优先），一并固化
    if ('enabled' in settings) settings.enabled = enabledBefore;
    if ('enabledExplicitlySet' in settings) settings.enabledExplicitlySet = true;
  }
  settingsStore.set(SETTINGS_CENTER_KEY, JSON.stringify(settings));
  return { migrated: Boolean(key), conflict };
}

/** 注入给渲染进程的派生字段（写入时丢弃） */
const DERIVED_AI_FIELDS = [
  'hasApiKey',
  'defaultTextProviderId',
  'defaultTextLabel',
  'defaultTextReady',
] as const;

/**
 * db-settings-get：去掉 Key，注入 ai.hasApiKey；默认写作 AI 不是内置 openai-compatible 时
 * 再注入 defaultTextProviderId / defaultTextLabel / defaultTextReady（渲染进程据此判断 AI 是否可用）
 */
export function sanitizeSettingsForRenderer(
  raw: string | undefined,
  hasApiKey: boolean,
  defaultText?: { id: string; label: string; ready: boolean } | null
): string | undefined {
  const settings = parse(raw);
  if (!settings) return raw;
  extractApiKey(settings);
  const ai: JsonRecord = isRecord(settings.ai) ? { ...settings.ai } : {};
  for (const field of DERIVED_AI_FIELDS) delete ai[field];
  settings.ai = {
    ...ai,
    hasApiKey,
    ...(defaultText
      ? {
          defaultTextProviderId: defaultText.id,
          defaultTextLabel: defaultText.label,
          defaultTextReady: defaultText.ready,
        }
      : {}),
  };
  return JSON.stringify(settings);
}

/** db-settings-set：Key 转存到安全存储；返回可落库的 JSON（解析失败时原样返回） */
export function interceptSettingsWrite(value: string, secrets: SecretSink): string {
  const settings = parse(value);
  if (!settings) return value;
  const { key } = extractApiKey(settings);
  if (key) secrets.set(DEFAULT_TEXT_PROVIDER_ID, key);
  if (isRecord(settings.ai)) {
    const ai = settings.ai;
    for (const field of DERIVED_AI_FIELDS) delete ai[field];
  }
  return JSON.stringify(settings);
}
