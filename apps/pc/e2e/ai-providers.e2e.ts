/**
 * AI 模型配置（独立的 Electron 实例 + 本地 mock 服务）
 *
 * 设置中心「AI」每个能力一张模型列表，Grok / DeepSeek 等只是服务商预设：
 * 1. 文本：用「xAI Grok」预设添加模型（地址指向 mock、手动填写模型名）→ 只写的 Key → 测试连接 → 流式通道；
 *    渲染进程拿不到 Key 明文。
 * 2. 再用「DeepSeek」预设添加第二个模型（同一个 mock、不同模型名）→ 测试连接 → 设为默认 →
 *    省略模型的 ai-request 走它（mock 记录模型与 Key）；同一服务商 + 地址再加一个模型时沿用已保存的 Key。
 * 3. 「语音」分区的配音默认语言：下拉选项浮在设置弹窗之上，点选后 video-settings-get 返回新语言。
 * 4. 文本模型的「生成参数」温度：失焦保存到 ai-providers.json，重新打开仍在，请求体里带这个温度。
 * 5. 视频（Seedance 预设）与语音模型：测试连接走自己的地址与 Key；场景视频的「视频模型」下拉里能选到它。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chooseSelectOption, comboboxSelector, selectedOptionText } from './support/select';
import { openChapter, setupAppSuite } from './support/suite';

const suite = setupAppSuite({ fixture: { prefix: 'novel-editor-e2e-ai-' } });

const API_KEY = 'xai-e2e-secret-0001';
const CUSTOM_KEY = 'custom-e2e-secret-0002';
const VIDEO_KEY = 'ark-e2e-secret-0003';
const SPEECH_KEY = 'tts-e2e-secret-0004';
const GROK_MODEL = 'grok-mock-a';
const DEEPSEEK_MODEL = 'deepseek-mock-b';
const GROK_ROW = '[data-testid="ai-model-text-1"]';
const DEEPSEEK_ROW = '[data-testid="ai-model-text-2"]';
const TEXT_SECTION = '[data-testid="ai-section-text"]';
const ADD_FORM = '[role="group"][aria-label="添加模型"]';
const ACCEPTED_KEYS = [API_KEY, CUSTOM_KEY, VIDEO_KEY, SPEECH_KEY].map((key) => `Bearer ${key}`);
const requests: Array<{
  auth?: string;
  method?: string;
  url?: string;
  body: Record<string, unknown>;
}> = [];
let server: Server;
let baseUrl = '';

function handle(req: IncomingMessage, res: ServerResponse) {
  let raw = '';
  req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf-8')));
  req.on('end', () => {
    const body = JSON.parse(raw || '{}') as Record<string, unknown>;
    requests.push({ auth: req.headers.authorization, method: req.method, url: req.url, body });
    if (!ACCEPTED_KEYS.includes(req.headers.authorization ?? '')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Incorrect API key provided' } }));
      return;
    }
    if (!body.stream) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ model: 'grok-mock', choices: [{ message: { content: 'pong' } }] }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const piece of ['雾气', '翻涌，', '林舟拔剑。']) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
    }
    res.end('data: [DONE]\n\n');
  });
}

beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('AI 模型配置', () => {
  it('1. 用 Grok 预设添加文本模型（mock）→ 只写 Key → 测试连接；流式通道推送片段；渲染进程拿不到 Key', async () => {
    const { page, app } = suite;
    await openAiSettings();
    // 还没有模型：空状态说明「添加模型」；总开关独立在最上方
    await page.waitForTarget({ text: '还没有文本模型', within: TEXT_SECTION });
    expect(
      await page.evaluate<boolean>(() => {
        const master = document.querySelector('input[role="switch"][aria-label="启用 AI 功能"]');
        return Boolean(master) && !master?.closest('[data-testid^="ai-model-"]');
      })
    ).toBe(true);
    // 打开总开关（默认文本模型受它约束）
    await page.evaluate(() => {
      const master = document.querySelector(
        'input[role="switch"][aria-label="启用 AI 功能"]'
      ) as HTMLInputElement;
      if (!master.checked) master.click();
    });

    await addTextModel({ provider: 'xAI Grok', model: GROK_MODEL, apiKey: API_KEY });
    await page.waitForTarget(GROK_ROW);
    const rowText = await textOf(GROK_ROW);
    expect(rowText).toContain(`xAI Grok · ${GROK_MODEL}`);
    expect(rowText).toContain('已配置');
    expect(rowText).toContain('默认');

    await page.click({ text: '测试连接', within: GROK_ROW, exact: true });
    await waitForConnected(GROK_ROW);
    expect(requests.at(-1)).toMatchObject({
      auth: `Bearer ${API_KEY}`,
      body: { model: GROK_MODEL, max_tokens: 1 },
    });

    // 渲染进程只能看到 configured，看不到 Key
    const listed = await page.evaluate<string>(async () =>
      JSON.stringify(await window.electron.ipcRenderer.invoke('ai-providers-list'))
    );
    expect(listed).toContain('"configured":true');
    expect(listed).toContain('"vendor":"grok"');
    expect(listed).not.toContain(API_KEY);

    // 流式通道：ai-stream-start → ai-stream-event（delta… → done）
    const streamed = await page.evaluate<{ text: string; types: string[] }>(
      () =>
        new Promise((resolve, reject) => {
          let text = '';
          const types: string[] = [];
          const dispose = window.electron.ipcRenderer.on(
            'ai-stream-event',
            (_event: unknown, payload: { type: string; text?: string }) => {
              types.push(payload.type);
              if (payload.type === 'delta') text += payload.text ?? '';
              if (payload.type === 'done' || payload.type === 'error') {
                if (typeof dispose === 'function') dispose();
                resolve({ text, types });
              }
            }
          );
          window.electron.ipcRenderer
            .invoke('ai-stream-start', { providerId: 'text-1', prompt: '续写' })
            .then((result: unknown) => {
              if (!(result as { ok: boolean }).ok) reject(new Error(JSON.stringify(result)));
            });
        })
    );
    expect(streamed).toEqual({
      text: '雾气翻涌，林舟拔剑。',
      types: ['delta', 'delta', 'delta', 'done'],
    });

    // Key 保存在 userData 的 ai-credentials.json（按模型 id）；系统钥匙串可用时文件中没有明文
    const credentialFile = path.join(app.userDataDir, 'ai-credentials.json');
    expect(existsSync(credentialFile)).toBe(true);
    const stored = JSON.parse(await readFile(credentialFile, 'utf-8')) as {
      entries: Record<string, { encrypted: boolean; data: string }>;
    };
    if (stored.entries['text-1'].encrypted) {
      expect(await readFile(credentialFile, 'utf-8')).not.toContain(API_KEY);
    }
    await closeSettings();
  });

  it('2. 用 DeepSeek 预设添加第二个模型 → 测试连接 → 设为默认 → ai-request 走它；同服务商 + 地址沿用 Key', async () => {
    const { page, app } = suite;
    await openAiSettings();
    await addTextModel({ provider: 'DeepSeek', model: DEEPSEEK_MODEL, apiKey: CUSTOM_KEY });
    await page.waitForTarget(DEEPSEEK_ROW);
    await page.click({ text: '测试连接', within: DEEPSEEK_ROW, exact: true });
    await waitForConnected(DEEPSEEK_ROW);
    expect(requests.at(-1)).toMatchObject({
      auth: `Bearer ${CUSTOM_KEY}`,
      body: { model: DEEPSEEK_MODEL, max_tokens: 1 },
    });

    // 还没设默认：省略模型的请求走第一个（Grok）
    const request = async () => {
      const before = requests.length;
      const result = await page.evaluate<{ ok: boolean; text?: string; error?: string }>(() =>
        window.electron.ipcRenderer.invoke('ai-request', { prompt: '默认模型' })
      );
      expect(result).toEqual({ ok: true, text: 'pong' });
      expect(requests.length).toBe(before + 1);
      return requests.at(-1);
    };
    expect(await request()).toMatchObject({
      auth: `Bearer ${API_KEY}`,
      body: { model: GROK_MODEL },
    });

    // 设为默认：行内出现「默认」，分区标题显示默认模型
    await page.click({ text: '设为默认', within: DEEPSEEK_ROW, exact: true });
    await page.waitForTarget({ text: '默认', within: DEEPSEEK_ROW, exact: true });
    await page.waitForTarget({ text: `默认：DeepSeek · ${DEEPSEEK_MODEL}`, exact: true });
    expect(await request()).toMatchObject({
      auth: `Bearer ${CUSTOM_KEY}`,
      body: { model: DEEPSEEK_MODEL },
    });

    // 同一服务商 + 地址再加一个模型：默认沿用已保存的 Key（不需要再粘贴）
    await addTextModel({ provider: 'xAI Grok', model: 'grok-mock-c', reuseKey: true });
    const third = '[data-testid="ai-model-text-3"]';
    await page.waitForTarget(third);
    expect(await textOf(third)).toContain('已配置');
    await page.click({ text: '测试连接', within: third, exact: true });
    await waitForConnected(third);
    expect(requests.at(-1)).toMatchObject({
      auth: `Bearer ${API_KEY}`,
      body: { model: 'grok-mock-c' },
    });

    // Key 只在安全存储；配置文件记录默认模型
    const providersFile = await readFile(path.join(app.userDataDir, 'ai-providers.json'), 'utf-8');
    expect(providersFile).toContain('"text": "text-2"');
    for (const key of [API_KEY, CUSTOM_KEY]) expect(providersFile).not.toContain(key);
    await closeSettings();
  });

  it('3. 语音 → 配音默认语言：选项浮在设置弹窗之上，点选后保存', async () => {
    const { page } = suite;
    const listbox = '[role="listbox"][aria-label="配音默认语言"]';
    await openAiSettings();
    const trigger = '[role="combobox"][aria-label="配音默认语言"]';
    await page.waitForTarget(trigger);
    await page.evaluate((selector: string) => {
      document.querySelector(selector)?.scrollIntoView({ block: 'center' });
      return true;
    }, trigger);
    await page.click(trigger);
    await page.waitForTarget(listbox);
    // 选一个当前没选中的语言；它中心点上最上层的元素必须是选项本身（没有被设置弹窗遮住）
    const target = await page.evaluate<{ label: string; topmost: boolean }>((selector: string) => {
      const options = Array.from(
        document.querySelectorAll(`${selector} [role="option"]`)
      ) as HTMLElement[];
      const option = options.find((item) => item.getAttribute('aria-selected') !== 'true')!;
      option.scrollIntoView({ block: 'nearest' });
      const rect = option.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { label: option.textContent ?? '', topmost: Boolean(hit && option.contains(hit)) };
    }, listbox);
    expect(target.topmost).toBe(true);
    await page.click({ text: target.label, within: listbox, exact: true });
    await page.waitForGone(listbox);
    const saved = await page.waitFor(
      async () => {
        const result = (await window.electron.ipcRenderer.invoke('video-settings-get')) as {
          ok: boolean;
          data?: { voiceLanguage?: string };
        };
        return result.ok && result.data?.voiceLanguage && result.data.voiceLanguage !== 'zh-CN'
          ? result.data.voiceLanguage
          : null;
      },
      { message: '配音默认语言已保存' }
    );
    expect(target.label).toContain(String(saved));
    expect(
      await page.evaluate<string>(
        (selector: string) => document.querySelector(selector)?.textContent ?? '',
        trigger
      )
    ).toBe(target.label);
    await closeSettings();
  });

  it('4. 文本模型的生成参数：温度失焦保存、重新打开仍在，请求体带这个温度', async () => {
    const { page, app } = suite;
    const temperature = `${GROK_ROW} [data-testid="ai-generation-params"] input[aria-label="温度"]`;
    const openEditor = async () => {
      if (!(await page.exists(temperature))) {
        await page.click(`${GROK_ROW} button[aria-label="编辑 xAI Grok · ${GROK_MODEL}"]`);
      }
      await page.waitForTarget(temperature);
    };
    await openAiSettings();
    await openEditor();
    await fill(temperature, '0.4');
    await page.click(`${GROK_ROW} input[aria-label="显示名称"]`);
    const file = path.join(app.userDataDir, 'ai-providers.json');
    await page.waitUntil(async () => /"temperature": 0\.4/.test(await readFile(file, 'utf-8')), {
      message: '温度写入 ai-providers.json',
    });
    await closeSettings();

    await openAiSettings();
    await openEditor();
    expect(
      await page.evaluate<string>(
        (selector: string) => (document.querySelector(selector) as HTMLInputElement).value,
        temperature
      )
    ).toBe('0.4');
    await closeSettings();

    const before = requests.length;
    const result = await page.evaluate<{ ok: boolean }>(() =>
      window.electron.ipcRenderer.invoke('ai-complete', { providerId: 'text-1', prompt: '温度' })
    );
    expect(result.ok).toBe(true);
    expect(requests.length).toBe(before + 1);
    expect(requests.at(-1)).toMatchObject({
      auth: `Bearer ${API_KEY}`,
      body: { model: GROK_MODEL, temperature: 0.4 },
    });
  });

  it('5. 视频（Seedance 预设）与语音模型：测试连接走自己的地址；场景视频的视频模型下拉里能选到', async () => {
    const { page } = suite;
    const VIDEO_SECTION = '[data-testid="ai-section-video"]';
    const SPEECH_SECTION = '[data-testid="ai-section-speech"]';
    const VIDEO_ROW = '[data-testid="ai-model-video-1"]';
    const SPEECH_ROW = '[data-testid="ai-model-speech-1"]';
    const VIDEO_LABEL = 'Seedance · doubao-seedance-1-0-pro-250528';
    await openAiSettings();

    await page.click({ text: '添加模型', within: VIDEO_SECTION, exact: true });
    await page.waitForTarget(`${VIDEO_SECTION} ${ADD_FORM}`);
    // 「取消」「添加」同一行、同样高度
    const buttons = await page.evaluate<Array<{ top: number; height: number }>>(
      (selector: string) =>
        Array.from(document.querySelectorAll(`${selector} button`))
          .filter((button) => ['取消', '添加'].includes(button.textContent?.trim() ?? ''))
          .map((button) => {
            const rect = button.getBoundingClientRect();
            return { top: Math.round(rect.top), height: Math.round(rect.height) };
          }),
      `${VIDEO_SECTION} ${ADD_FORM}`
    );
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toEqual(buttons[1]);
    await chooseSelectOption(page, '服务商', 'Seedance');
    await fill(`${VIDEO_SECTION} ${ADD_FORM} input[aria-label="接口地址"]`, `${baseUrl}/ark`);
    await fill(`${VIDEO_SECTION} ${ADD_FORM} input[aria-label="API Key"]`, VIDEO_KEY);
    await page.click({ text: '添加', within: `${VIDEO_SECTION} ${ADD_FORM}`, exact: true });
    await page.waitForTarget(VIDEO_ROW);
    await page.click({ text: '测试连接', within: VIDEO_ROW, exact: true });
    await waitForConnected(VIDEO_ROW);
    expect(requests.at(-1)?.auth).toBe(`Bearer ${VIDEO_KEY}`);
    expect(requests.at(-1)?.url?.startsWith('/v1/ark/')).toBe(true);

    await page.click({ text: '添加模型', within: SPEECH_SECTION, exact: true });
    await page.waitForTarget(`${SPEECH_SECTION} ${ADD_FORM}`);
    await fill(`${SPEECH_SECTION} ${ADD_FORM} input[aria-label="接口地址"]`, baseUrl);
    await fill(`${SPEECH_SECTION} ${ADD_FORM} input[aria-label="API Key"]`, SPEECH_KEY);
    await page.click({ text: '添加', within: `${SPEECH_SECTION} ${ADD_FORM}`, exact: true });
    await page.waitForTarget(SPEECH_ROW);
    await page.click({ text: '测试连接', within: SPEECH_ROW, exact: true });
    await waitForConnected(SPEECH_ROW);
    expect(requests.at(-1)).toMatchObject({ auth: `Bearer ${SPEECH_KEY}`, url: '/v1/models' });
    await closeSettings();

    // 场景视频：工具栏只有一个「视频模型」下拉，选项是模型的显示名称；Seedance 支持生成声音
    await openChapter(page, '001-启程', '林舟背起行囊');
    await page.click('[data-testid="scene-video-pill"]');
    await page.waitForTarget('[data-testid="scene-video-view"]', 15_000);
    await page.waitForTarget(comboboxSelector('视频模型'), 15_000);
    expect(await page.exists(comboboxSelector('视频服务'))).toBe(false);
    expect(await selectedOptionText(page, '视频模型')).toBe(VIDEO_LABEL);
    await page.click(comboboxSelector('视频模型'));
    const listbox = '[role="listbox"][aria-label="视频模型"]';
    await page.waitForTarget(listbox);
    expect(
      await page.evaluate<string[]>(
        (selector: string) =>
          Array.from(document.querySelectorAll(`${selector} [role="option"]`)).map(
            (option) => option.textContent?.trim() ?? ''
          ),
        listbox
      )
    ).toEqual([VIDEO_LABEL]);
    await page.press('Escape');
    await page.waitForGone(listbox);
    expect(
      await page.evaluate<boolean>(
        () =>
          !(document.querySelector('[data-testid="scene-video-audio-toggle"]') as HTMLButtonElement)
            .disabled
      )
    ).toBe(true);
  });
});

/** 打开设置中心的 AI 分区 */
async function openAiSettings(): Promise<void> {
  const { page } = suite;
  await page.click('[aria-label="打开设置中心"]');
  await page.waitForTarget({ text: '设置中心', exact: true });
  await page.click({ text: 'AI', within: '[class*="sidebar"]', exact: true });
  await page.waitForTarget(TEXT_SECTION);
}

async function closeSettings(): Promise<void> {
  const { page } = suite;
  await page.click('[aria-label="关闭设置"]');
  await page.waitForGone({ text: '设置中心', exact: true });
}

/** 选中输入框原有内容后输入（替换） */
async function fill(selector: string, text: string): Promise<void> {
  const { page } = suite;
  await page.evaluate((target: string) => {
    const input = document.querySelector(target) as HTMLInputElement;
    input.scrollIntoView({ block: 'center' });
    input.focus();
    input.select();
  }, selector);
  await page.type(text);
}

async function textOf(selector: string): Promise<string> {
  return suite.page.evaluate<string>(
    (target: string) => document.querySelector(target)?.textContent ?? '',
    selector
  );
}

async function waitForConnected(row: string): Promise<void> {
  await suite.page.waitFor(
    (selector: string) => /连接成功/.test(document.querySelector(selector)?.textContent ?? ''),
    { args: [row], message: `${row} 测试连接成功` }
  );
}

/**
 * 「文本」分区 →「添加模型」：选服务商预设，地址指向 mock，模型在下拉底部手动填写，
 * 填 Key 或沿用已保存的 Key（同一服务商 + 地址时默认勾选）
 */
async function addTextModel(options: {
  provider: string;
  model: string;
  apiKey?: string;
  reuseKey?: boolean;
}): Promise<void> {
  const { page } = suite;
  const form = `${TEXT_SECTION} ${ADD_FORM}`;
  await page.click({ text: '添加模型', within: TEXT_SECTION, exact: true });
  await page.waitForTarget(form);
  await chooseSelectOption(page, '服务商', options.provider);
  await fill(`${form} input[aria-label="接口地址"]`, baseUrl);
  await page.click(`${form} [role="combobox"][aria-label="模型"]`);
  await page.waitForTarget('input[aria-label="模型（自定义）"]');
  await page.click('input[aria-label="模型（自定义）"]');
  await page.type(options.model);
  await page.press('Enter');
  await page.waitForGone('[role="listbox"][aria-label="模型"]');
  expect(
    await page.evaluate<string>(
      (selector: string) =>
        (document.querySelector(selector) as HTMLInputElement | null)?.placeholder ?? '',
      `${form} input[aria-label="显示名称"]`
    )
  ).toBe(`${options.provider} · ${options.model}`);
  if (options.reuseKey) {
    expect(
      await page.evaluate<boolean>(
        (selector: string) =>
          (document.querySelector(selector) as HTMLInputElement | null)?.checked ?? false,
        `${form} input[type="checkbox"]`
      )
    ).toBe(true);
    expect(await page.exists(`${form} input[aria-label="API Key"]`)).toBe(false);
  } else if (options.apiKey) {
    await fill(`${form} input[aria-label="API Key"]`, options.apiKey);
  }
  await page.click({ text: '添加', within: form, exact: true });
  await page.waitForGone(form);
}
