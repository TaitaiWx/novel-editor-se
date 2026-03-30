import { isImeComposing } from './ime';

export const SETTINGS_STORAGE_KEY = 'novel-editor:settings-center';

export interface GeneralSettings {
  collapseRightPanelOnStartup: boolean;
  showStatusBar: boolean;
  showFileSizes: boolean;
  openChangelogAfterUpdate: boolean;
}

export type ShortcutCommand = 'quickOpen' | 'toggleSidebar' | 'toggleFocusMode' | 'closeTab';

export interface ShortcutSettings {
  quickOpen: string;
  toggleSidebar: string;
  toggleFocusMode: string;
  closeTab: string;
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

export interface ShortcutFieldDefinition {
  key: ShortcutCommand;
  label: string;
  description: string;
  placeholder: string;
}

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
  showFileSizes: true,
  openChangelogAfterUpdate: true,
};

export const DEFAULT_SHORTCUT_SETTINGS: ShortcutSettings = {
  quickOpen: 'Mod+P',
  toggleSidebar: 'Mod+B',
  toggleFocusMode: 'Mod+Shift+F',
  closeTab: 'Mod+W',
};

export const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: false,
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

export function mergeSettingsDraft(raw: string | null): SettingsDraft {
  if (!raw) return DEFAULT_SETTINGS_DRAFT;
  try {
    const parsed = JSON.parse(raw) as Partial<SettingsDraft>;
    return {
      general: { ...DEFAULT_GENERAL_SETTINGS, ...(parsed.general || {}) },
      shortcuts: { ...DEFAULT_SHORTCUT_SETTINGS, ...(parsed.shortcuts || {}) },
      ai: { ...DEFAULT_AI_SETTINGS, ...(parsed.ai || {}) },
    };
  } catch {
    return DEFAULT_SETTINGS_DRAFT;
  }
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
