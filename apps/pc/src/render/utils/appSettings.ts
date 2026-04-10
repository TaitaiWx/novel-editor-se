import { isImeComposing } from './ime';

export const SETTINGS_STORAGE_KEY = 'novel-editor:settings-center';

export interface GeneralSettings {
  collapseRightPanelOnStartup: boolean;
  showStatusBar: boolean;
  showThousandCharMarkers: boolean;
  thousandCharMarkerStep: number;
  showFileSizes: boolean;
  openChangelogAfterUpdate: boolean;
}

export type ShortcutCommand =
  | 'quickOpen'
  | 'toggleSidebar'
  | 'toggleFocusMode'
  | 'closeTab'
  | 'formatChapter';

export interface ShortcutSettings {
  quickOpen: string;
  toggleSidebar: string;
  toggleFocusMode: string;
  closeTab: string;
  formatChapter: string;
}

export type AIProvider = 'openai-compatible' | 'openai' | 'deepseek';
export type AIPresetKey =
  | 'openai-official'
  | 'deepseek-official'
  | 'openrouter'
  | 'copilot'
  | 'custom';

export interface AISettings {
  enabled: boolean;
  enabledExplicitlySet?: boolean;
  provider: AIProvider;
  preset: AIPresetKey;
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
  contextTokens: number;
  maxTokens: number;
}

export interface SettingsDraft {
  general: GeneralSettings;
  shortcuts: ShortcutSettings;
  ai: AISettings;
}

export interface AIConfigStatus {
  enabled: boolean;
  hasApiKey: boolean;
  hasBaseUrl: boolean;
  hasModel: boolean;
  ready: boolean;
}

export interface ShortcutFieldDefinition {
  key: ShortcutCommand;
  label: string;
  description: string;
  placeholder: string;
}

export const THOUSAND_CHAR_MARKER_STEP_OPTIONS = [500, 1000, 2000, 5000] as const;

export const SHORTCUT_FIELD_DEFINITIONS: ShortcutFieldDefinition[] = [
  {
    key: 'quickOpen',
    label: '搜索并打开文件',
    description: '在作品目录中搜索并快速打开文件。',
    placeholder: '例如 Mod+P',
  },
  {
    key: 'toggleSidebar',
    label: '切换侧边栏',
    description: '收起或展开左侧作品目录。',
    placeholder: '例如 Mod+B',
  },
  {
    key: 'toggleFocusMode',
    label: '切换专注模式',
    description: '切换写作专注模式。F11 仍保留为备用快捷键。',
    placeholder: '例如 Mod+Shift+F',
  },
  {
    key: 'closeTab',
    label: '关闭当前标签',
    description: '关闭当前打开的文件标签页。',
    placeholder: '例如 Mod+W',
  },
  {
    key: 'formatChapter',
    label: '格式化当前章节',
    description: '对当前章节执行整章排版整理，统一段首缩进和空行。',
    placeholder: '例如 Mod+Alt+L',
  },
];

export const READONLY_SHORTCUTS = [
  { accelerator: isMacLike() ? 'Cmd+O' : 'Ctrl+O', description: '打开作品目录' },
  { accelerator: isMacLike() ? 'Cmd+Q' : 'Ctrl+Q', description: '退出应用' },
  { accelerator: isMacLike() ? 'Cmd+M' : 'Ctrl+M', description: '最小化窗口' },
  { accelerator: 'CommandOrControl+Shift+E', description: '导出项目' },
  { accelerator: 'F11', description: '切换专注模式（备用键）' },
];

function isMacLike(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /mac/i.test(navigator.platform || navigator.userAgent);
}

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  collapseRightPanelOnStartup: true,
  showStatusBar: true,
  showThousandCharMarkers: true,
  thousandCharMarkerStep: 1000,
  showFileSizes: true,
  openChangelogAfterUpdate: true,
};

export const DEFAULT_SHORTCUT_SETTINGS: ShortcutSettings = {
  quickOpen: 'Mod+P',
  toggleSidebar: 'Mod+B',
  toggleFocusMode: 'Mod+Shift+F',
  closeTab: 'Mod+W',
  formatChapter: 'Mod+Alt+L',
};

export const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: false,
  enabledExplicitlySet: false,
  provider: 'openai-compatible',
  preset: 'openai-official',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-5.4-mini',
  apiKey: '',
  temperature: 1.3,
  contextTokens: 128000,
  maxTokens: 8192,
};

export const DEFAULT_SETTINGS_DRAFT: SettingsDraft = {
  general: DEFAULT_GENERAL_SETTINGS,
  shortcuts: DEFAULT_SHORTCUT_SETTINGS,
  ai: DEFAULT_AI_SETTINGS,
};

type ParsedSettingsDraft = Partial<SettingsDraft> &
  Partial<{
    enabled: boolean;
    enabledExplicitlySet: boolean;
    provider: AIProvider;
    preset: AIPresetKey;
    baseUrl: string;
    model: string;
    apiKey: string;
    temperature: number;
    contextTokens: number;
    maxTokens: number;
  }>;

function hasOwnField(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function normalizeParsedAISettings(parsed: ParsedSettingsDraft): Partial<AISettings> {
  const nestedAi =
    parsed.ai && typeof parsed.ai === 'object' ? (parsed.ai as Partial<AISettings>) : undefined;

  const legacyAi: Partial<AISettings> = {
    enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : undefined,
    enabledExplicitlySet:
      typeof parsed.enabledExplicitlySet === 'boolean' ? parsed.enabledExplicitlySet : undefined,
    provider: parsed.provider,
    preset: parsed.preset,
    baseUrl: parsed.baseUrl,
    model: parsed.model,
    apiKey: parsed.apiKey,
    temperature: parsed.temperature,
    contextTokens: parsed.contextTokens,
    maxTokens: parsed.maxTokens,
  };

  const mergedAi = {
    ...legacyAi,
    ...(nestedAi || {}),
  };

  const enabledExplicitlySet =
    mergedAi.enabledExplicitlySet === true ||
    hasOwnField(parsed, 'enabledExplicitlySet') ||
    (nestedAi ? hasOwnField(nestedAi, 'enabledExplicitlySet') : false);

  const hasStoredCredential = Boolean(mergedAi.apiKey?.trim());

  return {
    ...mergedAi,
    enabledExplicitlySet,
    // 中文说明：旧版本会把 enabled 默认存成 false，即使用户已经填了 API Key。
    // 没有“显式关闭”标记时，只要检测到已保存的密钥，就按已启用迁移。
    enabled: enabledExplicitlySet
      ? Boolean(mergedAi.enabled)
      : Boolean(mergedAi.enabled) || hasStoredCredential,
  };
}

function normalizeMarkerStep(step: unknown): number {
  const numericStep = typeof step === 'number' ? step : Number(step);
  if (!Number.isFinite(numericStep)) {
    return DEFAULT_GENERAL_SETTINGS.thousandCharMarkerStep;
  }
  const normalizedStep = Math.round(numericStep);
  if (
    THOUSAND_CHAR_MARKER_STEP_OPTIONS.includes(
      normalizedStep as (typeof THOUSAND_CHAR_MARKER_STEP_OPTIONS)[number]
    )
  ) {
    return normalizedStep;
  }
  return DEFAULT_GENERAL_SETTINGS.thousandCharMarkerStep;
}

export function mergeSettingsDraft(raw: string | null): SettingsDraft {
  if (!raw) return DEFAULT_SETTINGS_DRAFT;
  try {
    const parsed = JSON.parse(raw) as ParsedSettingsDraft;
    const general = { ...DEFAULT_GENERAL_SETTINGS, ...(parsed.general || {}) };
    return {
      general: {
        ...general,
        // 中文说明：千字标记阈值统一限制在预设档位内，避免旧值或非法值污染根设置。
        thousandCharMarkerStep: normalizeMarkerStep(
          (general as Partial<GeneralSettings>).thousandCharMarkerStep
        ),
      },
      shortcuts: { ...DEFAULT_SHORTCUT_SETTINGS, ...(parsed.shortcuts || {}) },
      // 中文说明：这里兼容旧版 AI 设置结构。
      // 旧数据如果缺少 enabled，但已经填写了连接参数，则按“已启用”迁移，避免老用户升级后被误判成未配置。
      ai: { ...DEFAULT_AI_SETTINGS, ...normalizeParsedAISettings(parsed) },
    };
  } catch {
    return DEFAULT_SETTINGS_DRAFT;
  }
}

/**
 * 中文说明：统一从根设置草稿推导 AI 可用状态。
 * 渲染层所有入口都应复用这套口径，避免组件态和 SQLite 真源不一致。
 */
export function getAIConfigStatus(settings: SettingsDraft): AIConfigStatus {
  const ai = settings.ai ?? DEFAULT_AI_SETTINGS;
  const enabled = Boolean(ai.enabled);
  const hasApiKey = Boolean(ai.apiKey?.trim());
  const hasBaseUrl = Boolean(ai.baseUrl?.trim());
  const hasModel = Boolean(ai.model?.trim());
  return {
    enabled,
    hasApiKey,
    hasBaseUrl,
    hasModel,
    ready: enabled && hasApiKey && hasBaseUrl && hasModel,
  };
}

/**
 * 中文说明：统一输出缺失配置提示，避免不同入口提示不一致。
 */
export function getAIConfigMissingMessage(status: AIConfigStatus): string | null {
  if (status.ready) return null;
  if (!status.enabled) return '请先在设置中心启用 AI';
  if (!status.hasApiKey) return '请先在设置中心填写 AI Key';
  if (!status.hasBaseUrl && !status.hasModel) return '请先在设置中心补全 AI Base URL 和模型';
  if (!status.hasBaseUrl) return '请先在设置中心填写 AI Base URL';
  if (!status.hasModel) return '请先在设置中心填写 AI 模型';
  return '请先在设置中心启用并配置 AI';
}

export function normalizeShortcutInput(input: string): string {
  const raw = input.trim();
  if (!raw) return '';
  const tokens = raw
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean);

  let mod = false;
  let shift = false;
  let alt = false;
  let key = '';

  for (const token of tokens) {
    const upper = token.toUpperCase();
    if (['MOD', 'CMD', 'CTRL', 'CONTROL', 'COMMANDORCONTROL', 'COMMAND'].includes(upper)) {
      mod = true;
      continue;
    }
    if (['SHIFT'].includes(upper)) {
      shift = true;
      continue;
    }
    if (['ALT', 'OPTION'].includes(upper)) {
      alt = true;
      continue;
    }
    if (/^F\d{1,2}$/.test(upper)) {
      key = upper;
      continue;
    }
    if (upper === 'ESC' || upper === 'ESCAPE') {
      key = 'Escape';
      continue;
    }
    if (upper === 'ENTER' || upper === 'RETURN') {
      key = 'Enter';
      continue;
    }
    if (upper === 'SPACE') {
      key = 'Space';
      continue;
    }
    key = token.length === 1 ? token.toUpperCase() : token[0].toUpperCase() + token.slice(1);
  }

  const parts = [
    ...(mod ? ['Mod'] : []),
    ...(shift ? ['Shift'] : []),
    ...(alt ? ['Alt'] : []),
    ...(key ? [key] : []),
  ];

  return parts.join('+');
}

export function matchShortcutEvent(event: KeyboardEvent, shortcut: string): boolean {
  if (isImeComposing(event)) return false;
  const normalized = normalizeShortcutInput(shortcut);
  if (!normalized) return false;
  const tokens = normalized.split('+');
  const key = tokens[tokens.length - 1];
  const requiresMod = tokens.includes('Mod');
  const requiresShift = tokens.includes('Shift');
  const requiresAlt = tokens.includes('Alt');

  const eventKey = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  const keyMatches =
    key === 'Space' ? event.code === 'Space' : key.toUpperCase() === eventKey.toUpperCase();

  return (
    keyMatches &&
    Boolean(event.metaKey || event.ctrlKey) === requiresMod &&
    Boolean(event.shiftKey) === requiresShift &&
    Boolean(event.altKey) === requiresAlt
  );
}

export function formatShortcutLabel(accelerator: string): string {
  const normalized = normalizeShortcutInput(accelerator);
  if (!normalized) return '';
  const modLabel = isMacLike() ? 'Cmd' : 'Ctrl';
  return normalized.replace(/\bMod\b/g, modLabel).replace(/\+/g, ' + ');
}

export function applyShortcutOverrides<T extends { accelerator: string; description: string }>(
  shortcuts: T[],
  settings: ShortcutSettings
): T[] {
  const overrides = new Map<string, string>([
    ['搜索文件', settings.quickOpen],
    ['切换侧边栏', settings.toggleSidebar],
    ['切换专注模式', settings.toggleFocusMode],
    ['关闭当前标签', settings.closeTab],
    ['格式化当前章节', settings.formatChapter],
  ]);

  const consumed = new Set<string>();

  return shortcuts.map((shortcut) => {
    const override = overrides.get(shortcut.description);
    if (!override) return shortcut;
    if (shortcut.description === '切换专注模式' && consumed.has(shortcut.description)) {
      return shortcut;
    }
    consumed.add(shortcut.description);
    return {
      ...shortcut,
      accelerator: override,
    };
  });
}
