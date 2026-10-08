import { describe, expect, it } from 'vitest';
import type { AIProviderInfo } from '@/shared/ai';
import {
  chosenDefaultTextProvider,
  pickDefaultTextProvider,
  providerIdForRequest,
} from '@/render/utils/textProviders';
import { pickTextProvider } from '@/render/components/SceneVideoView/useVideoServices';
import { getAIConfigStatus, mergeSettingsDraft } from '@/render/utils/appSettings';

function info(id: string, patch: Partial<AIProviderInfo> = {}): AIProviderInfo {
  return {
    id,
    kind: 'text',
    label: id,
    description: '',
    defaultBaseUrl: '',
    defaultModel: '',
    models: [],
    configured: true,
    secureStorage: true,
    enabled: true,
    baseUrl: '',
    model: '',
    ...patch,
  };
}

describe('默认写作 AI 的选择（渲染进程唯一口径）', () => {
  it('选定的 > 内置 > 第一个可用；不可用的跳过', () => {
    const builtin = info('openai-compatible', { isDefaultText: true });
    expect(pickDefaultTextProvider([info('grok'), builtin])?.id).toBe('openai-compatible');
    expect(chosenDefaultTextProvider([info('grok'), builtin])).toBeNull();
    const chosen = info('custom-text-2', { isDefaultText: true, defaultTextChosen: true });
    const list = [info('openai-compatible'), info('grok'), chosen];
    expect(pickDefaultTextProvider(list)?.id).toBe('custom-text-2');
    expect(pickTextProvider(list)).toBe('custom-text-2');
    expect(chosenDefaultTextProvider(list)?.id).toBe('custom-text-2');
    expect(
      pickDefaultTextProvider([info('openai-compatible', { enabled: false }), info('grok')])?.id
    ).toBe('grok');
    expect(pickDefaultTextProvider([info('minimax-video', { kind: 'video' })])).toBeNull();
  });

  it('请求里的 providerId：默认写作 AI 省略，其他显式传', () => {
    const list = [
      info('openai-compatible'),
      info('custom-text-1', { isDefaultText: true, defaultTextChosen: true }),
    ];
    expect(providerIdForRequest(list, list[1])).toBeUndefined();
    expect(providerIdForRequest(list, list[0])).toBe('openai-compatible');
    // 没有任何标记（旧主进程 / 测试替身）：内置就是默认
    expect(providerIdForRequest([info('openai-compatible')], info('openai-compatible'))).toBe(
      undefined
    );
  });

  it('AI 可用状态：默认写作 AI 是自定义服务时只看总开关与它是否可用', () => {
    const settings = mergeSettingsDraft(
      JSON.stringify({
        ai: {
          enabled: true,
          enabledExplicitlySet: true,
          baseUrl: '',
          model: '',
          defaultTextProviderId: 'custom-text-1',
          defaultTextReady: true,
        },
      })
    );
    expect(getAIConfigStatus(settings).ready).toBe(true);
    expect(
      getAIConfigStatus({ ...settings, ai: { ...settings.ai, defaultTextReady: false } })
    ).toMatchObject({ ready: false, hasApiKey: false });
    expect(getAIConfigStatus({ ...settings, ai: { ...settings.ai, enabled: false } }).ready).toBe(
      false
    );
    // 旧数据没有显式开关：默认写作 AI 已有 Key 视为已启用（与主进程一致）
    const legacy = mergeSettingsDraft(
      JSON.stringify({ ai: { defaultTextProviderId: 'custom-text-1', defaultTextReady: true } })
    );
    expect(legacy.ai.enabled).toBe(true);
  });
});
