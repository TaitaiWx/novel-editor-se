import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS_DRAFT,
  DEFAULT_SHORTCUT_SETTINGS,
  READONLY_SHORTCUTS,
  SHORTCUT_FIELD_DEFINITIONS,
  applyShortcutOverrides,
  formatShortcutLabel,
  getAIConfigMissingMessage,
  getAIConfigStatus,
  matchShortcutEvent,
  mergeSettingsDraft,
  normalizeShortcutInput,
  type AIConfigStatus,
  type SettingsDraft,
} from '@/render/utils/appSettings';

type KeyInit = Partial<
  Pick<
    KeyboardEvent,
    'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'isComposing' | 'keyCode'
  >
>;
const keyEvent = (init: KeyInit): KeyboardEvent =>
  ({
    key: '',
    code: '',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    isComposing: false,
    keyCode: 0,
    ...init,
  }) as unknown as KeyboardEvent;

describe('mergeSettingsDraft 边界', () => {
  it('空值与非法 JSON 返回默认设置', () => {
    expect(mergeSettingsDraft(null)).toBe(DEFAULT_SETTINGS_DRAFT);
    expect(mergeSettingsDraft('{坏掉的 json')).toBe(DEFAULT_SETTINGS_DRAFT);
  });

  it('合并快捷键并处理非数字千字标记', () => {
    const merged = mergeSettingsDraft(
      JSON.stringify({
        general: { thousandCharMarkerStep: 'abc', showStatusBar: false },
        shortcuts: { quickOpen: 'Mod+K' },
      })
    );
    expect(merged.general.thousandCharMarkerStep).toBe(1000);
    expect(merged.general.showStatusBar).toBe(false);
    expect(merged.shortcuts.quickOpen).toBe('Mod+K');
    expect(merged.shortcuts.closeTab).toBe(DEFAULT_SHORTCUT_SETTINGS.closeTab);
  });

  it('字符串形式的档位会被四舍五入', () => {
    const merged = mergeSettingsDraft(
      JSON.stringify({ general: { thousandCharMarkerStep: '499.6' } })
    );
    expect(merged.general.thousandCharMarkerStep).toBe(500);
  });

  it('平铺旧结构中的 enabledExplicitlySet 会保留关闭状态', () => {
    const merged = mergeSettingsDraft(
      JSON.stringify({ enabled: false, enabledExplicitlySet: true, apiKey: 'sk-old' })
    );
    expect(merged.ai.enabled).toBe(false);
    expect(merged.ai.enabledExplicitlySet).toBe(true);
  });

  it('没有密钥时保持未启用', () => {
    const merged = mergeSettingsDraft(JSON.stringify({ ai: { apiKey: '   ' } }));
    expect(merged.ai.enabled).toBe(false);
  });
});

describe('AI 配置状态', () => {
  const withAi = (ai: Partial<SettingsDraft['ai']>): SettingsDraft => ({
    ...DEFAULT_SETTINGS_DRAFT,
    ai: { ...DEFAULT_SETTINGS_DRAFT.ai, ...ai },
  });

  it('全部配置完成时 ready', () => {
    const status = getAIConfigStatus(withAi({ enabled: true, apiKey: 'sk-1' }));
    expect(status.ready).toBe(true);
    expect(getAIConfigMissingMessage(status)).toBeNull();
  });

  it('缺少 ai 节点时使用默认值', () => {
    const status = getAIConfigStatus({
      ...DEFAULT_SETTINGS_DRAFT,
      ai: undefined,
    } as unknown as SettingsDraft);
    expect(status.enabled).toBe(false);
  });

  it.each<[Partial<AIConfigStatus>, string]>([
    [{ enabled: false }, '请先在设置中心启用 AI'],
    [{ hasApiKey: false }, '请先在设置中心填写 AI Key'],
    [{ hasBaseUrl: false, hasModel: false }, '请先在设置中心补全 AI Base URL 和模型'],
    [{ hasBaseUrl: false }, '请先在设置中心填写 AI Base URL'],
    [{ hasModel: false }, '请先在设置中心填写 AI 模型'],
    [{}, '请先在设置中心启用并配置 AI'],
  ])('缺失提示 %o', (patch, message) => {
    const status: AIConfigStatus = {
      enabled: true,
      hasApiKey: true,
      hasBaseUrl: true,
      hasModel: true,
      ready: false,
      ...patch,
    };
    expect(getAIConfigMissingMessage(status)).toBe(message);
  });
});

describe('normalizeShortcutInput', () => {
  it.each([
    ['', ''],
    ['   ', ''],
    ['cmd+shift+p', 'Mod+Shift+P'],
    ['Ctrl + Option + l', 'Mod+Alt+L'],
    ['CommandOrControl+f11', 'Mod+F11'],
    ['esc', 'Escape'],
    ['Mod+return', 'Mod+Enter'],
    ['alt+space', 'Alt+Space'],
    ['Mod+tab', 'Mod+Tab'],
    ['shift', 'Shift'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeShortcutInput(input)).toBe(expected);
  });
});

describe('matchShortcutEvent', () => {
  it('不带 key 的 keydown（输入框自动填充等派发）直接忽略，不抛错', () => {
    const noKey = new Event('keydown') as KeyboardEvent;
    expect(() => matchShortcutEvent(noKey, 'Mod+P')).not.toThrow();
    expect(matchShortcutEvent(noKey, 'Mod+P')).toBe(false);
    const emptyKey = { key: '', metaKey: true } as unknown as KeyboardEvent;
    expect(matchShortcutEvent(emptyKey, 'Mod+P')).toBe(false);
  });

  it('匹配 Mod 组合键（meta 或 ctrl）', () => {
    expect(matchShortcutEvent(keyEvent({ key: 'p', metaKey: true }), 'Mod+P')).toBe(true);
    expect(matchShortcutEvent(keyEvent({ key: 'p', ctrlKey: true }), 'Mod+P')).toBe(true);
    expect(matchShortcutEvent(keyEvent({ key: 'p' }), 'Mod+P')).toBe(false);
    expect(matchShortcutEvent(keyEvent({ key: 'P', metaKey: true, shiftKey: true }), 'Mod+P')).toBe(
      false
    );
  });

  it('Space 通过 code 匹配，F 键与 Alt 修饰', () => {
    expect(
      matchShortcutEvent(keyEvent({ key: ' ', code: 'Space', altKey: true }), 'Alt+Space')
    ).toBe(true);
    expect(matchShortcutEvent(keyEvent({ key: 'F11' }), 'F11')).toBe(true);
  });

  it('输入法组合中或快捷键为空时不匹配', () => {
    expect(
      matchShortcutEvent(keyEvent({ key: 'p', metaKey: true, isComposing: true }), 'Mod+P')
    ).toBe(false);
    expect(matchShortcutEvent(keyEvent({ key: 'p' }), '')).toBe(false);
  });
});

describe('formatShortcutLabel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('macOS 显示 Cmd', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: '' });
    expect(formatShortcutLabel('mod+shift+f')).toBe('Cmd + Shift + F');
  });

  it('其他平台显示 Ctrl', () => {
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'Windows' });
    expect(formatShortcutLabel('Mod+W')).toBe('Ctrl + W');
  });

  it('navigator 不存在时按非 mac 处理', () => {
    vi.stubGlobal('navigator', undefined);
    expect(formatShortcutLabel('Mod+B')).toBe('Ctrl + B');
  });

  it('空快捷键返回空字符串', () => {
    expect(formatShortcutLabel('')).toBe('');
  });
});

describe('applyShortcutOverrides', () => {
  it('覆盖可配置的快捷键，第二个“切换专注模式”保留备用键', () => {
    const shortcuts = [
      { accelerator: 'Mod+P', description: '搜索文件' },
      { accelerator: 'Mod+Shift+F', description: '切换专注模式' },
      { accelerator: 'F11', description: '切换专注模式' },
      { accelerator: 'Mod+O', description: '打开作品目录' },
    ];
    const result = applyShortcutOverrides(shortcuts, {
      ...DEFAULT_SHORTCUT_SETTINGS,
      quickOpen: 'Mod+K',
      toggleFocusMode: 'Mod+Alt+F',
    });
    expect(result.map((s) => s.accelerator)).toEqual(['Mod+K', 'Mod+Alt+F', 'F11', 'Mod+O']);
    expect(result[3]).toBe(shortcuts[3]);
  });
});

describe('常量', () => {
  it('导出字段定义与只读快捷键', () => {
    expect(SHORTCUT_FIELD_DEFINITIONS.map((d) => d.key)).toEqual(
      Object.keys(DEFAULT_SHORTCUT_SETTINGS)
    );
    expect(READONLY_SHORTCUTS.some((s) => s.accelerator === 'F11')).toBe(true);
  });
});
