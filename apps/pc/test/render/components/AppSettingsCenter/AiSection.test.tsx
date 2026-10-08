// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AiSection from '@/render/components/AppSettingsCenter/AiSection';
import type { AIModelInput, AIProviderInfo, AIProviderUpdate } from '@/shared/ai';
import { DEFAULT_AI_SETTINGS } from '@/render/utils/appSettings';
import { defaultModelLabel, findPreset, presetProviderName } from '@/shared/ai-models';
import {
  installElectronMock,
  uninstallElectronMock,
  type ElectronMock,
} from '../../hooks/electronMock';
import { chooseOption, getCombobox, selectOptionTexts } from '../../helpers/select';
import { modelInfo } from '../../helpers/aiModel';

const VENDOR_DEFAULTS: Record<string, { baseUrl: string; model: string; audio?: boolean }> = {
  'openai-compatible': { baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.4-mini' },
  grok: { baseUrl: 'https://api.x.ai/v1', model: 'grok-4' },
  'seedance-video': {
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seedance-2-0-260128',
    audio: true,
  },
  'openai-speech': { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts' },
};

/** 模拟主进程：模型列表、每个能力一个默认（选定的 > 第一个可用的 > 第一个）、沿用 Key */
function mockMain(initial: Array<Partial<AIProviderInfo> & { id: string }> = []) {
  const rows: AIProviderInfo[] = [];
  const defaults: Record<string, string | undefined> = {};
  const next: Record<string, number> = { text: 1, image: 1, video: 1, speech: 1 };
  const make = (patch: Partial<AIProviderInfo> & { id: string }): AIProviderInfo => {
    const kind = patch.kind ?? 'text';
    const vendor = patch.vendor ?? 'openai-compatible';
    const preset = findPreset(patch.preset);
    const defaults = VENDOR_DEFAULTS[vendor] ?? { baseUrl: '', model: '' };
    return modelInfo({
      kind,
      vendor,
      label: patch.id,
      providerLabel: preset ? presetProviderName(preset) : vendor,
      description: '',
      defaultBaseUrl: defaults.baseUrl,
      defaultModel: defaults.model,
      models: preset?.models ?? [],
      configured: false,
      secureStorage: true,
      enabled: true,
      baseUrl: defaults.baseUrl,
      model: defaults.model,
      ...(defaults.audio ? { supportsAudio: true } : {}),
      ...patch,
    });
  };
  initial.forEach((item) => rows.push(make(item)));
  const resolve = (kind: string) => {
    const list = rows.filter((row) => row.kind === kind);
    const chosen = defaults[kind];
    if (chosen && list.some((row) => row.id === chosen)) return chosen;
    return (list.find((row) => row.configured && row.enabled) ?? list[0])?.id;
  };
  const view = () =>
    rows.map((row) => {
      const isDefault = row.id === resolve(row.kind);
      return { ...row, isDefault, ...(row.kind === 'text' ? { isDefaultText: isDefault } : {}) };
    });
  const find = (id: unknown) => rows.find((row) => row.id === id) as AIProviderInfo;
  let proxy: { mode: string; url?: string } = { mode: 'system' };
  const mock: ElectronMock = installElectronMock((channel, ...args) => {
    switch (channel) {
      case 'ai-providers-list':
        return { ok: true, data: view() };
      case 'ai-models-add': {
        const input = args[0] as AIModelInput;
        if (input.baseUrl === 'https://broken.test') {
          return { ok: false, error: { kind: 'bad-request', message: '接口地址不可用' } };
        }
        const source = input.reuseKeyFrom ? find(input.reuseKeyFrom) : undefined;
        let id = `${input.capability}-${next[input.capability]++}`;
        while (rows.some((item) => item.id === id))
          id = `${input.capability}-${next[input.capability]++}`;
        const row = make({
          id,
          kind: input.capability,
          vendor: input.vendor,
          preset: input.preset,
          label: input.label ?? 'x',
          baseUrl: input.baseUrl || VENDOR_DEFAULTS[input.vendor]?.baseUrl || '',
          model: input.model || VENDOR_DEFAULTS[input.vendor]?.model || '',
          configured: Boolean(input.apiKey || source?.configured),
          useProxy: input.useProxy === true,
          ...(typeof input.pricePerSecond === 'number'
            ? { pricePerSecond: input.pricePerSecond }
            : {}),
        });
        rows.push(row);
        return { ok: true, data: view().find((item) => item.id === row.id) };
      }
      case 'ai-models-update': {
        const row = find(args[0]);
        const update = args[1] as AIProviderUpdate;
        if (update.apiKey) row.configured = true;
        if (update.clearKey) row.configured = false;
        if (typeof update.enabled === 'boolean') row.enabled = update.enabled;
        if (typeof update.useProxy === 'boolean') row.useProxy = update.useProxy;
        for (const key of ['label', 'baseUrl', 'model', 'voice'] as const) {
          const value = update[key];
          if (typeof value === 'string') row[key] = value;
        }
        for (const key of [
          'temperature',
          'maxTokens',
          'contextTokens',
          'pricePerSecond',
        ] as const) {
          const value = update[key];
          if (value === null) delete row[key];
          else if (typeof value === 'number') row[key] = value;
        }
        return { ok: true, data: view().find((item) => item.id === row.id) };
      }
      case 'ai-models-remove': {
        const index = rows.findIndex((row) => row.id === args[0]);
        if (index >= 0) rows.splice(index, 1);
        return { ok: true, data: { removed: index >= 0 } };
      }
      case 'ai-models-set-default':
        defaults[args[0] as string] = (args[1] as string | null) ?? undefined;
        return { ok: true, data: view() };
      case 'ai-models-test':
        return { ok: true, data: { latencyMs: 42 } };
      case 'ai-proxy-get':
        return { ok: true, data: proxy };
      case 'ai-proxy-set': {
        const value = args[0] as { mode: string; url?: string };
        if (value.mode === 'manual' && value.url?.startsWith('ftp')) {
          return { ok: false, error: { kind: 'bad-request', message: '代理地址只支持 http' } };
        }
        proxy = value.mode === 'manual' ? { mode: 'manual', url: value.url } : { mode: 'system' };
        return { ok: true, data: proxy };
      }
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
    <AiSection aiSettings={{ ...DEFAULT_AI_SETTINGS, enabled }} setSettings={setSettings} />
  );
  return { ...utils, setSettings };
}

const section = (name: string) => screen.getByRole('region', { name });
const row = (id: string) => screen.getByTestId(`ai-model-${id}`);

function calls(mock: ElectronMock, channel: string): unknown[][] {
  return mock.invoke.mock.calls.filter((call) => call[0] === channel).map((call) => call.slice(1));
}

afterEach(() => {
  uninstallElectronMock();
});

const GROK = {
  id: 'grok',
  vendor: 'grok',
  preset: 'grok',
  label: 'xAI Grok · grok-4',
  configured: true,
};

describe('设置中心 · AI 模型列表', () => {
  it('总开关独立；每个能力一张列表，没有模型时显示空状态；行内显示服务商 · 模型、状态与默认', async () => {
    mockMain([
      GROK,
      { id: 'text-1', preset: 'deepseek', label: 'DeepSeek 写作', model: 'deepseek-chat' },
    ]);
    const { setSettings } = renderSection(false);
    fireEvent.click(screen.getByRole('switch', { name: '启用 AI 功能' }));
    expect(setSettings).toHaveBeenCalledOnce();

    await screen.findByTestId('ai-model-grok');
    const text = section('文本（写作 / 续写 / 分镜 / 预演）');
    expect(
      within(text)
        .getAllByRole('region')
        .map((item) => item.getAttribute('aria-label'))
    ).toEqual(['xAI Grok · grok-4', 'DeepSeek 写作']);
    expect(within(row('grok')).getByText('已配置')).toBeTruthy();
    expect(within(row('grok')).getByText('默认')).toBeTruthy();
    expect(within(row('text-1')).getByText('未配置')).toBeTruthy();
    expect(within(row('text-1')).getByText('DeepSeek')).toBeTruthy();
    expect(within(row('text-1')).getByText('deepseek-chat')).toBeTruthy();
    expect(within(text).getByText('默认：xAI Grok · grok-4')).toBeTruthy();
    // 没有单独的内置服务面板
    expect(screen.queryByTestId('ai-provider-openai-compatible')).toBeNull();
    for (const name of ['图片', '视频', '语音（配音）']) {
      expect(within(section(name)).getByText(/还没有/)).toBeTruthy();
      expect(within(section(name)).getByRole('button', { name: '添加模型' })).toBeTruthy();
    }
    expect(
      within(section('语音（配音）')).getByRole('combobox', { name: '配音默认语言' })
    ).toBeTruthy();
    // 图标按钮都有可访问名称
    expect(
      within(row('grok')).getByRole('button', { name: '编辑 xAI Grok · grok-4' })
    ).toBeTruthy();
    expect(
      within(row('grok')).getByRole('button', { name: '删除 xAI Grok · grok-4' })
    ).toBeTruthy();
  });

  it('添加模型：选服务商预填协议、地址与推荐模型；显示名称默认「服务商 · 模型」；Key 只写', async () => {
    const { mock } = mockMain();
    renderSection();
    const text = section('文本（写作 / 续写 / 分镜 / 预演）');
    fireEvent.click(await within(text).findByRole('button', { name: '添加模型' }));
    const form = screen.getByRole('group', { name: '添加模型' });
    expect(selectOptionTexts('服务商', within(form))).toEqual([
      'OpenAI',
      'DeepSeek',
      'xAI Grok',
      '通义千问',
      'Kimi',
      '智谱 GLM',
      'Ollama（本地）',
      'Google Gemini',
      '豆包（火山方舟）',
      '自定义（OpenAI 兼容）',
    ]);
    chooseOption(getCombobox('服务商', within(form)), 'xAI Grok');
    expect((within(form).getByLabelText('接口地址') as HTMLInputElement).value).toBe(
      'https://api.x.ai/v1'
    );
    expect(getCombobox('模型', within(form)).textContent).toBe('grok-4.7');
    chooseOption(getCombobox('模型', within(form)), 'grok-4.6');
    expect((within(form).getByLabelText('显示名称') as HTMLInputElement).placeholder).toBe(
      'xAI Grok · grok-4.6'
    );
    fireEvent.change(within(form).getByLabelText('API Key'), { target: { value: 'xai-1' } });
    fireEvent.click(within(form).getByRole('button', { name: '添加' }));
    await screen.findByTestId('ai-model-text-1');
    expect(calls(mock, 'ai-models-add')[0][0]).toEqual({
      capability: 'text',
      vendor: 'grok',
      preset: 'grok',
      label: 'xAI Grok · grok-4.6',
      baseUrl: 'https://api.x.ai/v1',
      model: 'grok-4.6',
      // 境外服务商默认勾选「通过代理访问」
      useProxy: true,
      apiKey: 'xai-1',
    });
    expect(screen.queryByRole('group', { name: '添加模型' })).toBeNull();

    // 自定义：手动填写模型名称；地址必填
    fireEvent.click(within(text).getByRole('button', { name: '添加模型' }));
    const custom = screen.getByRole('group', { name: '添加模型' });
    chooseOption(getCombobox('服务商', within(custom)), '自定义（OpenAI 兼容）');
    fireEvent.click(within(custom).getByRole('button', { name: '添加' }));
    expect(within(custom).getByRole('alert').textContent).toBe('请填写接口地址');
    fireEvent.change(within(custom).getByLabelText('接口地址'), {
      target: { value: 'https://broken.test' },
    });
    fireEvent.click(getCombobox('模型', within(custom)));
    const manual = screen.getByLabelText('模型（自定义）');
    fireEvent.change(manual, { target: { value: 'my-model' } });
    fireEvent.keyDown(manual, { key: 'Enter' });
    expect(getCombobox('模型', within(custom)).textContent).toBe('my-model');
    fireEvent.click(within(custom).getByRole('button', { name: '添加' }));
    // 主进程的错误原样显示
    expect((await within(custom).findByRole('alert')).textContent).toBe('接口地址不可用');
  });

  it('同一服务商 + 地址已有 Key：默认沿用（主进程复制），也可以改填新 Key', async () => {
    // 已保存的条目是旧预设地址（带 /v1），与新预设地址等价，仍可沿用
    const { mock } = mockMain([
      {
        id: 'text-1',
        preset: 'deepseek',
        label: 'DeepSeek · deepseek-chat',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        configured: true,
      },
    ]);
    renderSection();
    const text = section('文本（写作 / 续写 / 分镜 / 预演）');
    fireEvent.click(await within(text).findByRole('button', { name: '添加模型' }));
    const form = screen.getByRole('group', { name: '添加模型' });
    // OpenAI 预设：地址不同，没有可沿用的 Key
    expect(within(form).queryByRole('checkbox', { name: /沿用已保存的 Key/ })).toBeNull();
    chooseOption(getCombobox('服务商', within(form)), 'DeepSeek');
    const reuse = within(form).getByRole('checkbox', { name: /沿用已保存的 Key/ });
    expect((reuse as HTMLInputElement).checked).toBe(true);
    expect(within(form).queryByLabelText('API Key')).toBeNull();
    expect(within(form).getByText('与「DeepSeek · deepseek-chat」使用同一个 Key')).toBeTruthy();
    chooseOption(getCombobox('模型', within(form)), 'deepseek-v4-pro');
    fireEvent.click(within(form).getByRole('button', { name: '添加' }));
    await screen.findByTestId('ai-model-text-2');
    expect(calls(mock, 'ai-models-add')[0][0]).toMatchObject({
      vendor: 'openai-compatible',
      preset: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-pro',
      reuseKeyFrom: 'text-1',
    });
    expect(calls(mock, 'ai-models-add')[0][0]).not.toHaveProperty('apiKey');
    expect(within(row('text-2')).getByText('已配置')).toBeTruthy();

    // 取消勾选：填自己的 Key
    fireEvent.click(within(text).getByRole('button', { name: '添加模型' }));
    const again = screen.getByRole('group', { name: '添加模型' });
    chooseOption(getCombobox('服务商', within(again)), 'DeepSeek');
    fireEvent.click(within(again).getByRole('checkbox', { name: /沿用已保存的 Key/ }));
    fireEvent.change(within(again).getByLabelText('API Key'), { target: { value: 'sk-new' } });
    fireEvent.click(within(again).getByRole('button', { name: '添加' }));
    await screen.findByTestId('ai-model-text-3');
    expect(calls(mock, 'ai-models-add')[1][0]).toMatchObject({ apiKey: 'sk-new' });
    expect(calls(mock, 'ai-models-add')[1][0]).not.toHaveProperty('reuseKeyFrom');
  });

  it('设为默认（每个能力一个）、测试连接、启用开关', async () => {
    const { mock } = mockMain([
      GROK,
      { id: 'text-1', preset: 'deepseek', label: 'DeepSeek · deepseek-chat', configured: true },
    ]);
    renderSection();
    await screen.findByTestId('ai-model-text-1');
    fireEvent.click(within(row('text-1')).getByRole('button', { name: '设为默认' }));
    await waitFor(() => expect(within(row('text-1')).getByText('默认')).toBeTruthy());
    expect(within(row('grok')).queryByText('默认')).toBeNull();
    expect(calls(mock, 'ai-models-set-default')).toEqual([['text', 'text-1']]);

    fireEvent.click(within(row('grok')).getByRole('button', { name: '测试连接' }));
    expect(await within(row('grok')).findByText('连接成功（42 ms）')).toBeTruthy();
    expect(calls(mock, 'ai-models-test')).toEqual([['grok']]);

    fireEvent.click(within(row('grok')).getByRole('switch', { name: '启用 xAI Grok · grok-4' }));
    await waitFor(() => expect(within(row('grok')).getByText('已配置 · 已停用')).toBeTruthy());
    expect(calls(mock, 'ai-models-update')).toEqual([['grok', { enabled: false }]]);
  });

  it('编辑：就地展开；生成参数失焦保存、清空恢复默认；换模型时默认名称跟着变；Key 只写', async () => {
    const { mock } = mockMain([GROK]);
    renderSection();
    await screen.findByTestId('ai-model-grok');
    fireEvent.click(within(row('grok')).getByRole('button', { name: '编辑 xAI Grok · grok-4' }));
    const params = within(row('grok')).getByRole('group', { name: 'xAI Grok · grok-4 生成参数' });
    const temperature = within(params).getByLabelText('温度');
    fireEvent.change(temperature, { target: { value: '0.6' } });
    fireEvent.blur(temperature);
    await waitFor(() =>
      expect(calls(mock, 'ai-models-update')).toContainEqual(['grok', { temperature: 0.6 }])
    );
    fireEvent.change(within(params).getByLabelText('温度'), { target: { value: '' } });
    fireEvent.blur(within(params).getByLabelText('温度'));
    await waitFor(() =>
      expect(calls(mock, 'ai-models-update')).toContainEqual(['grok', { temperature: null }])
    );

    chooseOption(getCombobox('模型', within(row('grok'))), 'grok-4.3');
    await waitFor(() =>
      expect(calls(mock, 'ai-models-update')).toContainEqual([
        'grok',
        { model: 'grok-4.3', label: defaultModelLabel('xAI Grok', 'grok-4.3') },
      ])
    );
    await screen.findByRole('region', { name: 'xAI Grok · grok-4.3' });

    // 改过名的不跟着变
    const label = within(row('grok')).getByLabelText('显示名称');
    fireEvent.change(label, { target: { value: '快写' } });
    fireEvent.blur(label);
    await screen.findByRole('region', { name: '快写' });
    chooseOption(getCombobox('模型', within(row('grok'))), 'grok-4.6');
    await waitFor(() =>
      expect(calls(mock, 'ai-models-update')).toContainEqual(['grok', { model: 'grok-4.6' }])
    );

    const key = within(row('grok')).getByLabelText('API Key') as HTMLInputElement;
    fireEvent.change(key, { target: { value: 'xai-2' } });
    fireEvent.click(within(row('grok')).getByRole('button', { name: '保存 Key' }));
    expect(await within(row('grok')).findByText('Key 已安全保存')).toBeTruthy();
    expect(key.value).toBe('');
    expect(calls(mock, 'ai-models-update')).toContainEqual(['grok', { apiKey: 'xai-2' }]);
  });

  it('删除：确认后删除（Key 一起）；视频模型有每秒单价，语音模型有默认声音', async () => {
    const { mock } = mockMain([
      GROK,
      { id: 'video-1', kind: 'video', vendor: 'seedance-video', preset: 'seedance', label: '方舟' },
      {
        id: 'speech-1',
        kind: 'speech',
        vendor: 'openai-speech',
        preset: 'openai-speech',
        label: '配音',
      },
    ]);
    renderSection();
    await screen.findByTestId('ai-model-grok');
    fireEvent.click(within(row('grok')).getByRole('button', { name: '删除 xAI Grok · grok-4' }));
    fireEvent.click(within(row('grok')).getByRole('button', { name: '取消' }));
    expect(calls(mock, 'ai-models-remove')).toEqual([]);
    fireEvent.click(within(row('grok')).getByRole('button', { name: '删除 xAI Grok · grok-4' }));
    fireEvent.click(within(row('grok')).getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(screen.queryByTestId('ai-model-grok')).toBeNull());
    expect(calls(mock, 'ai-models-remove')).toEqual([['grok']]);

    fireEvent.click(within(row('video-1')).getByRole('button', { name: '编辑 方舟' }));
    const price = within(row('video-1')).getByLabelText('方舟 每秒单价');
    fireEvent.change(price, { target: { value: '0.5' } });
    fireEvent.blur(price);
    await waitFor(() =>
      expect(calls(mock, 'ai-models-update')).toContainEqual(['video-1', { pricePerSecond: 0.5 }])
    );
    expect(within(row('video-1')).queryByRole('group', { name: /生成参数/ })).toBeNull();

    fireEvent.click(within(row('speech-1')).getByRole('button', { name: '编辑 配音' }));
    chooseOption(getCombobox('默认声音', within(row('speech-1'))), 'onyx');
    await waitFor(() =>
      expect(calls(mock, 'ai-models-update')).toContainEqual(['speech-1', { voice: 'onyx' }])
    );
  });

  it('网络代理：默认跟随系统；手动填写地址失焦保存，无效地址就地提示；显示使用代理的模型数', async () => {
    const { mock } = mockMain([{ ...GROK, useProxy: true }]);
    renderSection();
    const group = await screen.findByTestId('ai-section-proxy');
    expect(within(group).getByRole('heading', { name: '网络代理' })).toBeTruthy();
    await waitFor(() => expect(calls(mock, 'ai-proxy-get')).toHaveLength(1));
    expect(getCombobox('代理方式', within(group)).textContent).toBe('跟随系统代理');
    expect(group.textContent).toContain('1 个模型通过代理访问');
    expect(within(group).queryByLabelText('代理地址')).toBeNull();

    chooseOption(getCombobox('代理方式', within(group)), '手动填写代理地址');
    const input = within(group).getByLabelText('代理地址') as HTMLInputElement;
    expect(input.placeholder).toBe('http://127.0.0.1:7890');
    // 渲染进程先做同一套校验，不合法时不发请求
    fireEvent.change(input, { target: { value: 'http://u:p@127.0.0.1:7890' } });
    fireEvent.blur(input);
    expect(within(group).getByRole('status').textContent).toContain('账号密码');
    expect(calls(mock, 'ai-proxy-set')).toHaveLength(0);

    fireEvent.change(input, { target: { value: ' socks5://127.0.0.1:1080/ ' } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(calls(mock, 'ai-proxy-set').at(-1)?.[0]).toEqual({
        mode: 'manual',
        url: 'socks5://127.0.0.1:1080',
      })
    );
    expect((await within(group).findByRole('status')).textContent).toBe('已保存');
    expect(input.value).toBe('socks5://127.0.0.1:1080');

    chooseOption(getCombobox('代理方式', within(group)), '跟随系统代理');
    await waitFor(() =>
      expect(calls(mock, 'ai-proxy-set').at(-1)?.[0]).toEqual({ mode: 'system' })
    );
  });

  it('模型的「通过代理访问」：境外服务商添加时默认勾选、国内不勾；编辑里可开关，行内显示「通过代理」', async () => {
    const { mock } = mockMain([GROK]);
    renderSection();
    const text = section('文本（写作 / 续写 / 分镜 / 预演）');
    fireEvent.click(await within(text).findByRole('button', { name: '添加模型' }));
    const form = screen.getByRole('group', { name: '添加模型' });
    const proxyBox = () =>
      within(form).getByRole('checkbox', { name: '通过代理访问' }) as HTMLInputElement;
    // 第一个预设是 OpenAI：默认勾选
    expect(proxyBox().checked).toBe(true);
    chooseOption(getCombobox('服务商', within(form)), 'DeepSeek');
    expect(proxyBox().checked).toBe(false);
    fireEvent.click(proxyBox());
    expect(proxyBox().checked).toBe(true);
    fireEvent.change(within(form).getByLabelText('API Key'), { target: { value: 'sk-1' } });
    fireEvent.click(within(form).getByRole('button', { name: '添加' }));
    const added = await screen.findByTestId('ai-model-text-1');
    expect(calls(mock, 'ai-models-add')[0][0]).toMatchObject({
      preset: 'deepseek',
      useProxy: true,
    });
    expect(within(added).getByTestId('ai-model-proxy-tag').textContent).toBe('通过代理');
    expect(within(row('grok')).queryByTestId('ai-model-proxy-tag')).toBeNull();

    // 编辑：勾选后立即保存
    fireEvent.click(within(row('grok')).getByRole('button', { name: /编辑/ }));
    const box = within(row('grok')).getByRole('checkbox', {
      name: '通过代理访问',
    }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    await waitFor(() =>
      expect(calls(mock, 'ai-models-update').at(-1)).toEqual(['grok', { useProxy: true }])
    );
    expect(await within(row('grok')).findByTestId('ai-model-proxy-tag')).toBeTruthy();
  });

  it('视频 / 图片 / 语音的服务商预设', async () => {
    const { mock } = mockMain();
    renderSection();
    const video = section('视频');
    fireEvent.click(await within(video).findByRole('button', { name: '添加模型' }));
    const form = within(video).getByRole('group', { name: '添加模型' });
    expect(selectOptionTexts('服务商', within(form))).toEqual([
      'MiniMax 海螺',
      'Seedance',
      'xAI Grok Imagine',
      'Google Gemini Omni',
    ]);
    chooseOption(getCombobox('服务商', within(form)), 'Seedance');
    fireEvent.change(within(form).getByLabelText('每秒单价'), { target: { value: '0.4' } });
    fireEvent.change(within(form).getByLabelText('API Key'), { target: { value: 'ark' } });
    fireEvent.click(within(form).getByRole('button', { name: '添加' }));
    await screen.findByTestId('ai-model-video-1');
    expect(calls(mock, 'ai-models-add')[0][0]).toMatchObject({
      capability: 'video',
      vendor: 'seedance-video',
      preset: 'seedance',
      label: 'Seedance · doubao-seedance-2-0-260128',
      pricePerSecond: 0.4,
    });
    fireEvent.click(within(section('图片')).getByRole('button', { name: '添加模型' }));
    expect(
      selectOptionTexts(
        '服务商',
        within(within(section('图片')).getByRole('group', { name: '添加模型' }))
      )
    ).toEqual([
      'Seedream（火山方舟）',
      'MiniMax',
      'xAI Grok',
      'OpenAI 图片',
      'Google Gemini（Nano Banana）',
    ]);
    fireEvent.click(within(section('语音（配音）')).getByRole('button', { name: '添加模型' }));
    expect(
      selectOptionTexts(
        '服务商',
        within(within(section('语音（配音）')).getByRole('group', { name: '添加模型' }))
      )
    ).toEqual(['OpenAI 兼容', 'MiniMax', 'xAI Grok', 'Google Gemini', '豆包语音（火山引擎）']);
    // 豆包语音：预填接口地址与模型（= 资源 id），Key 说明指向豆包语音控制台；国内服务不默认走代理
    const speechForm = within(section('语音（配音）')).getByRole('group', { name: '添加模型' });
    chooseOption(getCombobox('服务商', within(speechForm)), '豆包语音（火山引擎）');
    expect((within(speechForm).getByLabelText('接口地址') as HTMLInputElement).value).toBe(
      'https://openspeech.bytedance.com'
    );
    expect(getCombobox('模型', within(speechForm)).textContent).toBe('seed-tts-2.0');
    expect(speechForm.textContent).toContain('豆包语音');
    expect(speechForm.textContent).toContain('API Key 管理');
    expect(
      (within(speechForm).getByRole('checkbox', { name: '通过代理访问' }) as HTMLInputElement)
        .checked
    ).toBe(false);
    expect(getCombobox('默认声音', within(speechForm))).toBeTruthy();
  });
});
