// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AiSection from '@/render/components/AppSettingsCenter/AiSection';
import { AI_PANELS_STORAGE_KEY } from '@/render/components/AppSettingsCenter/AiSection/useExpandedPanels';
import { AI_PRESET_OPTIONS } from '@/render/components/AppSettingsCenter/constants';
import type { AICustomProviderInput, AIProviderInfo, AIProviderUpdate } from '@/shared/ai';
import { DEFAULT_AI_SETTINGS } from '@/render/utils/appSettings';
import {
  installElectronMock,
  uninstallElectronMock,
  type ElectronMock,
} from '../../hooks/electronMock';
import { chooseOption } from '../../helpers/select';

type Row = AIProviderInfo & { stored: { enabled?: boolean } };

function base(id: string, kind: AIProviderInfo['kind'], label: string): Row {
  return {
    id,
    kind,
    label,
    description: `${label} 说明`,
    defaultBaseUrl: `https://${id}.test/v1`,
    defaultModel: `${id}-model`,
    models: [`${id}-model`],
    configured: false,
    secureStorage: true,
    enabled: false,
    baseUrl: `https://${id}.test/v1`,
    model: `${id}-model`,
    stored: {},
  };
}

/** 模拟主进程语义：enabled 未显式设置时跟随是否已保存 Key；默认写作 AI 只有一个 */
function mockMain() {
  const rows: Row[] = [
    { ...base('openai-compatible', 'text', 'OpenAI 兼容'), enabled: true },
    { ...base('grok', 'text', 'xAI Grok'), configured: true },
    base('seedream-image', 'image', 'Seedream 图片'),
    { ...base('seedance-video', 'video', 'Seedance'), supportsAudio: true, currency: 'CNY' },
    base('openai-speech', 'speech', 'OpenAI 兼容配音'),
  ];
  let defaultId: string | null = null;
  const next: Record<string, number> = { text: 1, video: 1, image: 1, speech: 1 };
  const info = (row: Row): AIProviderInfo => {
    const { stored, ...rest } = row;
    const resolved = defaultId ?? 'openai-compatible';
    return {
      ...rest,
      enabled: row.id === 'openai-compatible' ? true : (stored.enabled ?? row.configured),
      ...(row.kind === 'text' && row.id === resolved
        ? { isDefaultText: true, defaultTextChosen: Boolean(defaultId) }
        : {}),
    };
  };
  const find = (id: unknown) => rows.find((row) => row.id === id) as Row;
  const mock: ElectronMock = installElectronMock((channel, ...args) => {
    switch (channel) {
      case 'ai-providers-list':
        return { ok: true, data: rows.map(info) };
      case 'ai-providers-get':
        return { ok: true, data: info(find(args[0])) };
      case 'ai-providers-set': {
        const row = find(args[0]);
        const update = args[1] as AIProviderUpdate;
        if (update.apiKey) row.configured = true;
        if (update.clearKey) row.configured = false;
        if (typeof update.enabled === 'boolean') row.stored.enabled = update.enabled;
        if (typeof update.baseUrl === 'string') row.baseUrl = update.baseUrl;
        if (typeof update.label === 'string') row.label = update.label;
        for (const key of ['temperature', 'maxTokens', 'contextTokens'] as const) {
          const value = update[key];
          if (value === null) delete row[key];
          else if (typeof value === 'number') row[key] = value;
        }
        return { ok: true, data: info(row) };
      }
      case 'ai-providers-add-custom': {
        const input = args[0] as AICustomProviderInput;
        const kind = input.kind ?? 'text';
        const vendor = rows.find((row) => row.id === input.vendor);
        const row: Row = {
          ...base(`custom-${kind}-${next[kind]++}`, kind, input.label),
          baseUrl: input.baseUrl || vendor?.defaultBaseUrl || '',
          model: input.model || vendor?.defaultModel || '',
          custom: true,
          ...(input.vendor ? { vendor: input.vendor } : {}),
          ...(vendor?.supportsAudio ? { supportsAudio: true } : {}),
          ...(typeof input.pricePerSecond === 'number'
            ? { pricePerSecond: input.pricePerSecond }
            : {}),
          ...(input.voice ? { voice: input.voice } : {}),
          ...(input.apiKey ? { configured: true } : {}),
        };
        rows.push(row);
        return { ok: true, data: info(row) };
      }
      case 'ai-providers-remove-custom': {
        const index = rows.findIndex((row) => row.id === args[0]);
        if (index >= 0) rows.splice(index, 1);
        if (defaultId === args[0]) defaultId = null;
        return { ok: true, data: { removed: index >= 0 } };
      }
      case 'ai-providers-set-default':
        defaultId = (args[0] as string | null) ?? null;
        return { ok: true, data: rows.map(info) };
      case 'video-settings-get':
        return { ok: true, data: { maxConcurrent: 2, voiceLanguage: 'zh-CN' } };
      default:
        return undefined;
    }
  });
  return { mock, rows };
}

function renderSection(enabled = true) {
  const setSettings = vi.fn();
  const utils = render(
    <AiSection
      aiSettings={{ ...DEFAULT_AI_SETTINGS, enabled }}
      activeAIPreset={AI_PRESET_OPTIONS[0]}
      setSettings={setSettings}
      setAI={vi.fn()}
      applyAIPreset={vi.fn()}
      aiSaveStatus=""
      handleSaveAISettings={vi.fn(async () => undefined)}
    />
  );
  return { ...utils, setSettings };
}

const panel = (id: string) => screen.getByTestId(`ai-provider-${id}`);
function headerToggle(id: string): HTMLButtonElement {
  return panel(id).querySelector('button[aria-expanded]') as HTMLButtonElement;
}

function setCalls(mock: ElectronMock, id: string): AIProviderUpdate[] {
  return mock.invoke.mock.calls
    .filter((call) => call[0] === 'ai-providers-set' && call[1] === id)
    .map((call) => call[2] as AIProviderUpdate);
}

beforeEach(() => window.localStorage.clear());
afterEach(() => uninstallElectronMock());

describe('设置中心 AI 分区', () => {
  it('总开关独立在最上方；按能力分区；语言默认在「语音」里', async () => {
    mockMain();
    const { setSettings } = renderSection(false);
    await screen.findByTestId('ai-provider-grok');
    const master = screen.getByRole('switch', { name: '启用 AI 功能' });
    expect(master.closest('[data-testid^="ai-provider-"]')).toBeNull();
    fireEvent.click(master);
    expect(setSettings).toHaveBeenCalled();

    for (const title of ['文本（写作 / 续写 / 分镜 / 预演）', '图片', '视频', '语音（配音）']) {
      expect(screen.getByRole('region', { name: title })).toBeTruthy();
    }
    const speech = screen.getByRole('region', { name: '语音（配音）' });
    expect(within(speech).getByRole('combobox', { name: '配音默认语言' })).toBeTruthy();
    expect(within(speech).getByTestId('ai-provider-openai-speech')).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: '视频' })).getByTestId('ai-provider-seedance-video')
    ).toBeTruthy();
    // 总开关关闭时，内置服务的开关不可用
    expect(
      within(panel('openai-compatible')).getByRole('switch', { name: '启用 OpenAI 兼容' })
    ).toHaveProperty('disabled', true);
  });

  it('折叠：已配置 / 默认的展开，其余收起；展开状态记在 localStorage', async () => {
    mockMain();
    const first = renderSection();
    await screen.findByTestId('ai-provider-grok');
    expect(headerToggle('openai-compatible').getAttribute('aria-expanded')).toBe('true');
    expect(headerToggle('grok').getAttribute('aria-expanded')).toBe('true');
    expect(headerToggle('seedance-video').getAttribute('aria-expanded')).toBe('false');
    expect(within(panel('seedance-video')).queryByLabelText('API Key')).toBeNull();

    fireEvent.click(headerToggle('seedance-video'));
    fireEvent.click(headerToggle('grok'));
    expect(within(panel('seedance-video')).getByLabelText('API Key')).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(AI_PANELS_STORAGE_KEY) ?? '{}')).toEqual({
      'seedance-video': true,
      grok: false,
    });

    first.unmount();
    renderSection();
    await screen.findByTestId('ai-provider-grok');
    expect(headerToggle('seedance-video').getAttribute('aria-expanded')).toBe('true');
    expect(headerToggle('grok').getAttribute('aria-expanded')).toBe('false');
  });

  it('厂商表单只显示需要的字段', async () => {
    mockMain();
    renderSection();
    await screen.findByTestId('ai-provider-grok');
    for (const id of ['seedance-video', 'openai-speech', 'seedream-image']) {
      fireEvent.click(headerToggle(id));
    }
    const seedance = panel('seedance-video');
    expect(within(seedance).getByLabelText('Seedance 每秒单价')).toBeTruthy();
    expect(within(seedance).getByText(/生成声音/)).toBeTruthy();
    expect(within(seedance).queryByLabelText('声音')).toBeNull();
    const speech = panel('openai-speech');
    expect(within(speech).getByLabelText('声音')).toBeTruthy();
    expect(within(speech).queryByLabelText(/每秒单价/)).toBeNull();
    const grok = panel('grok');
    expect(within(grok).getByLabelText('接口地址')).toBeTruthy();
    expect(within(grok).queryByLabelText(/每秒单价/)).toBeNull();
    // 每个文本服务都有同一组生成参数；媒体服务没有
    expect(within(seedance).queryByLabelText('温度')).toBeNull();
    expect(within(panel('seedream-image')).getByText(/参考图/)).toBeTruthy();
    // 内置服务：预设 + 地址 + 模型 + Key + 温度 / 上下文 / 回复长度
    const builtin = panel('openai-compatible');
    for (const label of ['服务预设', '模型名称']) {
      expect(within(builtin).getByRole('combobox', { name: label })).toBeTruthy();
    }
    for (const label of ['接口地址', 'API Key', '温度', '上下文长度', '单次回复长度']) {
      expect(within(builtin).getByLabelText(label)).toBeTruthy();
    }
  });

  it('只保存改动的字段；保存 Key 后刷新启用状态；主动关闭才写入 enabled', async () => {
    const { mock, rows } = mockMain();
    rows[1].configured = false;
    renderSection();
    await screen.findByTestId('ai-provider-grok');
    fireEvent.click(headerToggle('grok'));
    const grok = panel('grok');
    const toggle = within(grok).getByRole('switch', { name: '启用 xAI Grok' });
    expect((toggle as HTMLInputElement).checked).toBe(false);

    const baseUrl = within(grok).getByLabelText('接口地址');
    fireEvent.change(baseUrl, { target: { value: 'http://127.0.0.1:9/v1' } });
    fireEvent.blur(baseUrl);
    await within(grok).findByText('已保存');
    expect(setCalls(mock, 'grok')[0]).toEqual({ baseUrl: 'http://127.0.0.1:9/v1' });
    expect(rows[1].stored.enabled).toBeUndefined();

    fireEvent.change(within(grok).getByLabelText('API Key'), { target: { value: 'xai-1' } });
    fireEvent.click(within(grok).getByRole('button', { name: '保存 Key' }));
    await within(grok).findByText('Key 已安全保存');
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(true));
    expect(within(grok).getByText('已启用')).toBeTruthy();

    fireEvent.click(toggle);
    await waitFor(() => expect(rows[1].stored.enabled).toBe(false));
    expect(setCalls(mock, 'grok').at(-1)).toEqual({ enabled: false });
    await waitFor(() => expect(within(grok).getByText('已配置 · 未启用')).toBeTruthy());
  });

  it('添加自定义文本 AI → 设为默认 → 改名 → 删除', async () => {
    const { mock } = mockMain();
    renderSection();
    await screen.findByTestId('ai-provider-grok');
    const text = screen.getByRole('region', { name: '文本（写作 / 续写 / 分镜 / 预演）' });
    expect(within(text).getByText('默认写作 AI：OpenAI 兼容')).toBeTruthy();

    fireEvent.click(within(text).getByRole('button', { name: '添加文本 AI' }));
    chooseOption('服务模板', 'Kimi');
    expect((screen.getByLabelText('新文本 AI 接口地址') as HTMLInputElement).value).toBe(
      'https://api.moonshot.cn/v1'
    );
    fireEvent.change(screen.getByLabelText('新文本 AI 名称'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    expect(screen.getByRole('alert').textContent).toBe('请填写名称');
    fireEvent.change(screen.getByLabelText('新文本 AI 名称'), { target: { value: '我的 Kimi' } });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));

    const custom = await screen.findByTestId('ai-provider-custom-text-1');
    expect(mock.invoke).toHaveBeenCalledWith('ai-providers-add-custom', {
      kind: 'text',
      label: '我的 Kimi',
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'kimi-k2-turbo-preview',
    });
    // 新面板自动展开，显示名称 / 地址 / 模型 / Key / 文本参数
    expect(headerToggle('custom-text-1').getAttribute('aria-expanded')).toBe('true');
    for (const label of ['名称', '接口地址', '模型', 'API Key', '温度', '单次回复长度']) {
      expect(within(custom).getByLabelText(label)).toBeTruthy();
    }

    fireEvent.click(within(custom).getByRole('button', { name: '设为默认' }));
    await waitFor(() => expect(within(custom).getByText('默认')).toBeTruthy());
    expect(mock.invoke).toHaveBeenCalledWith('ai-providers-set-default', 'custom-text-1');
    expect(within(text).getByText('默认写作 AI：我的 Kimi')).toBeTruthy();
    // 内置服务恢复为默认时传 null
    fireEvent.click(within(panel('openai-compatible')).getByRole('button', { name: '设为默认' }));
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledWith('ai-providers-set-default', null));
    fireEvent.click(within(custom).getByRole('button', { name: '设为默认' }));
    await waitFor(() => expect(within(custom).getByText('默认')).toBeTruthy());

    const name = within(custom).getByLabelText('名称');
    fireEvent.change(name, { target: { value: 'Kimi 长文' } });
    fireEvent.blur(name);
    await waitFor(() =>
      expect(setCalls(mock, 'custom-text-1').at(-1)).toEqual({ label: 'Kimi 长文' })
    );

    fireEvent.click(within(custom).getByRole('button', { name: '删除这个 AI' }));
    fireEvent.click(within(custom).getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(screen.queryByTestId('ai-provider-custom-text-1')).toBeNull());
    expect(mock.invoke).toHaveBeenCalledWith('ai-providers-remove-custom', 'custom-text-1');
    await waitFor(() => expect(within(text).getByText('默认写作 AI：OpenAI 兼容')).toBeTruthy());
  });

  it('添加失败时显示主进程的错误', async () => {
    const { mock } = mockMain();
    renderSection();
    await screen.findByTestId('ai-provider-grok');
    const original = mock.invoke.getMockImplementation();
    mock.invoke.mockImplementation(async (channel: string, ...args: unknown[]) =>
      channel === 'ai-providers-add-custom'
        ? { ok: false, error: { kind: 'bad-request', message: '接口地址只支持 http / https' } }
        : original?.(channel, ...args)
    );
    fireEvent.click(screen.getByRole('button', { name: '添加文本 AI' }));
    fireEvent.change(screen.getByLabelText('新文本 AI 接口地址'), {
      target: { value: 'ftp://x' },
    });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    expect((await screen.findByRole('alert')).textContent).toBe('接口地址只支持 http / https');
  });

  it('每个文本服务都有同一组「生成参数」；非内置服务失焦即保存、清空恢复默认', async () => {
    const { mock } = mockMain();
    renderSection();
    await screen.findByTestId('ai-provider-grok');
    fireEvent.click(headerToggle('grok'));
    fireEvent.click(
      within(screen.getByRole('region', { name: /文本/ })).getByRole('button', {
        name: '添加文本 AI',
      })
    );
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    await screen.findByTestId('ai-provider-custom-text-1');
    for (const id of ['openai-compatible', 'grok', 'custom-text-1']) {
      if (headerToggle(id).getAttribute('aria-expanded') !== 'true')
        fireEvent.click(headerToggle(id));
    }

    const groups = screen.getAllByTestId('ai-generation-params');
    // 内置 OpenAI 兼容（默认展开）、Grok、新添加的 DeepSeek
    expect(groups).toHaveLength(3);
    const labels = (group: HTMLElement) =>
      within(group)
        .getAllByRole('spinbutton')
        .map((input) => input.getAttribute('aria-label'));
    for (const group of groups) {
      expect(within(group).getByText('生成参数')).toBeTruthy();
      expect(labels(group)).toEqual(['温度', '上下文长度', '单次回复长度']);
    }
    const ranges = groups.map((group) =>
      within(group)
        .getAllByRole('spinbutton')
        .map(
          (input) => `${input.getAttribute('aria-valuemin')}-${input.getAttribute('aria-valuemax')}`
        )
        .join(',')
    );
    expect(new Set(ranges).size).toBe(1);

    const grokParams = within(panel('grok')).getByTestId('ai-generation-params');
    const temperature = within(grokParams).getByLabelText('温度');
    fireEvent.change(temperature, { target: { value: '0.4' } });
    fireEvent.blur(temperature);
    await waitFor(() => expect(setCalls(mock, 'grok').at(-1)).toEqual({ temperature: 0.4 }));
    const context = within(grokParams).getByLabelText('上下文长度');
    fireEvent.change(context, { target: { value: '32000' } });
    fireEvent.blur(context);
    await waitFor(() => expect(setCalls(mock, 'grok').at(-1)).toEqual({ contextTokens: 32000 }));
    fireEvent.change(temperature, { target: { value: '' } });
    fireEvent.blur(temperature);
    await waitFor(() => expect(setCalls(mock, 'grok').at(-1)).toEqual({ temperature: null }));
  });

  it('添加表单的「取消」「添加」在同一行、同一按钮样式', async () => {
    mockMain();
    renderSection();
    await screen.findByTestId('ai-provider-grok');
    fireEvent.click(screen.getByRole('button', { name: '添加文本 AI' }));
    const form = screen.getByRole('group', { name: '添加文本 AI' });
    const cancel = within(form).getByRole('button', { name: '取消' });
    const add = within(form).getByRole('button', { name: '添加' });
    expect(cancel.parentElement).toBe(add.parentElement);
    expect(cancel.parentElement?.classList.contains('footerButtons')).toBe(true);
    expect(cancel.classList.contains('footerButton')).toBe(true);
    expect(add.classList.contains('footerButton')).toBe(true);
  });

  it('添加自定义视频服务（沿用 Seedance）与语音服务', async () => {
    const { mock } = mockMain();
    renderSection();
    await screen.findByTestId('ai-provider-grok');

    const video = screen.getByRole('region', { name: /^视频/ });
    fireEvent.click(within(video).getByRole('button', { name: '添加视频服务' }));
    const videoForm = screen.getByRole('group', { name: '添加视频服务' });
    // 服务类型候选只有同类的内置服务；名称默认带序号
    expect(within(videoForm).getByRole('combobox', { name: '服务类型' }).textContent).toBe(
      'Seedance'
    );
    expect((within(videoForm).getByLabelText('新视频服务 名称') as HTMLInputElement).value).toBe(
      'Seedance 2'
    );
    fireEvent.change(within(videoForm).getByLabelText('新视频服务 接口地址'), {
      target: { value: 'http://127.0.0.1:9/api/v3' },
    });
    fireEvent.change(within(videoForm).getByLabelText('新视频服务 API Key'), {
      target: { value: 'ark-2' },
    });
    fireEvent.click(within(videoForm).getByRole('button', { name: '添加' }));
    const customVideo = await screen.findByTestId('ai-provider-custom-video-1');
    expect(mock.invoke).toHaveBeenCalledWith('ai-providers-add-custom', {
      kind: 'video',
      vendor: 'seedance-video',
      label: 'Seedance 2',
      baseUrl: 'http://127.0.0.1:9/api/v3',
      model: '',
      apiKey: 'ark-2',
    });
    // 新面板：名称 + 厂商自己的字段（单价、生成声音说明），没有生成参数
    expect(within(customVideo).getByLabelText('名称')).toBeTruthy();
    expect(within(customVideo).getByLabelText('Seedance 2 每秒单价')).toBeTruthy();
    expect(within(customVideo).getByText(/生成声音/)).toBeTruthy();
    expect(within(customVideo).queryByTestId('ai-generation-params')).toBeNull();
    expect(within(customVideo).getByRole('button', { name: '删除这个服务' })).toBeTruthy();

    const speech = screen.getByRole('region', { name: /^语音/ });
    fireEvent.click(within(speech).getByRole('button', { name: '添加语音服务' }));
    const speechForm = screen.getByRole('group', { name: '添加语音服务' });
    fireEvent.change(within(speechForm).getByLabelText('新语音服务 名称'), {
      target: { value: '自建 TTS' },
    });
    fireEvent.change(within(speechForm).getByLabelText('新语音服务 默认声音'), {
      target: { value: 'nova' },
    });
    fireEvent.click(within(speechForm).getByRole('button', { name: '添加' }));
    const customSpeech = await screen.findByTestId('ai-provider-custom-speech-1');
    expect(mock.invoke).toHaveBeenCalledWith(
      'ai-providers-add-custom',
      expect.objectContaining({
        kind: 'speech',
        vendor: 'openai-speech',
        label: '自建 TTS',
        voice: 'nova',
      })
    );
    expect(within(customSpeech).getByLabelText('声音')).toBeTruthy();

    fireEvent.click(within(customSpeech).getByRole('button', { name: '删除这个服务' }));
    fireEvent.click(within(customSpeech).getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(screen.queryByTestId('ai-provider-custom-speech-1')).toBeNull());
    expect(mock.invoke).toHaveBeenCalledWith('ai-providers-remove-custom', 'custom-speech-1');
  });
});
