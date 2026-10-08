import { describe, expect, it } from 'vitest';
import type { AIProviderInfo } from '@/shared/ai';
import {
  pickDefaultModel,
  pickDefaultTextProvider,
  providerIdForRequest,
  resolveModelChoice,
  usableModels,
} from '@/render/utils/textProviders';
import { pickTextProvider } from '@/render/components/SceneVideoView/useVideoServices';
import { getAIConfigStatus, mergeSettingsDraft } from '@/render/utils/appSettings';
import { modelInfo } from '../helpers/aiModel';

function info(id: string, patch: Partial<AIProviderInfo> = {}): AIProviderInfo {
  return modelInfo({
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
  });
}

describe('默认写作 AI 的选择（渲染进程唯一口径）', () => {
  it('默认模型（可用时）> 第一个可用；不可用的跳过；选择器里默认在前', () => {
    const list = [info('text-1'), info('grok'), info('text-3', { isDefault: true })];
    expect(pickDefaultTextProvider(list)?.id).toBe('text-3');
    expect(pickTextProvider(list)).toBe('text-3');
    expect(usableModels(list, 'text').map((item) => item.id)).toEqual(['text-3', 'text-1', 'grok']);
    expect(
      pickDefaultTextProvider([info('text-1', { isDefault: true, enabled: false }), info('grok')])
        ?.id
    ).toBe('grok');
    expect(pickDefaultTextProvider([info('minimax-video', { kind: 'video' })])).toBeNull();
    const media = [
      info('video-1', { kind: 'video' }),
      info('video-2', { kind: 'video', isDefault: true }),
      info('video-3', { kind: 'video', configured: false }),
    ];
    expect(pickDefaultModel(media, 'video')?.id).toBe('video-2');
    expect(resolveModelChoice(media, 'video', 'video-1')?.id).toBe('video-1');
    // 选中的不可用 / 已删除：回到默认
    expect(resolveModelChoice(media, 'video', 'video-3')?.id).toBe('video-2');
    expect(resolveModelChoice(media, 'video', 'gone')?.id).toBe('video-2');
    expect(resolveModelChoice(media, 'image', null)).toBeNull();
  });

  it('请求里的 providerId：默认模型省略，其他显式传', () => {
    const list = [info('openai-compatible'), info('text-1', { isDefault: true })];
    expect(providerIdForRequest(list, list[1])).toBeUndefined();
    expect(providerIdForRequest(list, list[0])).toBe('openai-compatible');
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
