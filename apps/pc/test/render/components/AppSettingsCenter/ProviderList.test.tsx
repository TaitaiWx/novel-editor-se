// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProviderList from '@/render/components/AppSettingsCenter/AiSection/ProviderList';
import type { AIProviderInfo, AIProviderUpdate } from '@/shared/ai';
import {
  installElectronMock,
  uninstallElectronMock,
  type ElectronMock,
} from '../../hooks/electronMock';

/** 模拟主进程语义：未显式设置启用状态时 enabled 跟随是否已保存 Key（AIService.getProviderInfo） */
function mockMain() {
  const state: { key: boolean; stored: { enabled?: boolean; baseUrl?: string } } = {
    key: false,
    stored: {},
  };
  const info = (): AIProviderInfo => ({
    id: 'grok',
    kind: 'text',
    label: 'xAI Grok',
    description: '续写',
    defaultBaseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-4',
    models: ['grok-4'],
    configured: state.key,
    secureStorage: true,
    enabled: state.stored.enabled ?? state.key,
    baseUrl: state.stored.baseUrl ?? 'https://api.x.ai/v1',
    model: 'grok-4',
  });
  const mock: ElectronMock = installElectronMock((channel, ...args) => {
    switch (channel) {
      case 'ai-providers-list':
        return { ok: true, data: [info()] };
      case 'ai-providers-get':
        return { ok: true, data: info() };
      case 'ai-providers-set': {
        const update = args[1] as AIProviderUpdate;
        if (update.apiKey) state.key = true;
        if (update.clearKey) state.key = false;
        if (typeof update.enabled === 'boolean') state.stored.enabled = update.enabled;
        if (typeof update.baseUrl === 'string') state.stored.baseUrl = update.baseUrl;
        return { ok: true, data: info() };
      }
      default:
        return undefined;
    }
  });
  return { mock, state };
}

function setCalls(mock: ElectronMock): AIProviderUpdate[] {
  return mock.invoke.mock.calls
    .filter((c) => c[0] === 'ai-providers-set')
    .map((c) => c[2] as AIProviderUpdate);
}

afterEach(() => uninstallElectronMock());

describe('ProviderList（更多 AI 服务）', () => {
  it('先改接口地址再保存 Key：不会把未启用固化为「关闭」，保存 Key 后自动启用', async () => {
    const { mock, state } = mockMain();
    render(<ProviderList />);
    const card = await screen.findByTestId('ai-provider-grok');
    const toggle = within(card).getByRole('button', { name: '启用 xAI Grok' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    // 失焦保存地址：不携带 enabled
    const baseUrl = within(card).getByPlaceholderText('https://api.x.ai/v1');
    fireEvent.change(baseUrl, { target: { value: 'http://127.0.0.1:9/v1' } });
    fireEvent.blur(baseUrl);
    await within(card).findByText('已保存');
    expect(setCalls(mock)[0]).toEqual({ baseUrl: 'http://127.0.0.1:9/v1', model: 'grok-4' });
    expect(state.stored.enabled).toBeUndefined();

    // 保存 Key 后重新读取，开关自动打开
    fireEvent.change(within(card).getByLabelText('API Key'), { target: { value: 'xai-1' } });
    fireEvent.click(within(card).getByRole('button', { name: '保存 Key' }));
    await within(card).findByText('Key 已安全保存');
    expect(mock.invoke).toHaveBeenCalledWith('ai-providers-get', 'grok');
    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('true'));

    // 作者主动关闭才写入 enabled: false
    fireEvent.click(toggle);
    await waitFor(() => expect(state.stored.enabled).toBe(false));
    expect(setCalls(mock).at(-1)).toMatchObject({ enabled: false });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });
});
