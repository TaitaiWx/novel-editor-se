/**
 * AI 服务配置（独立的 Electron 实例 + 本地 mock 服务）
 *
 * 1. 设置中心 → AI →「文本」分区展开 xAI Grok 面板：接口地址指向本地 mock（OpenAI 兼容），
 *    只写的 API Key 由主进程加密保存 → 测试连接成功 → 流式通道（ai-stream-start / ai-stream-event）推送片段。
 *    同时确认渲染进程拿不到 Key 明文。
 * 2. 添加一个自定义 OpenAI 兼容文本 AI（指向同一个 mock）→ 保存 Key → 测试连接 → 设为默认 →
 *    省略 providerId 的 ai-request 走这个服务（mock 记录请求的模型与 Key）。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupAppSuite } from './support/suite';

const suite = setupAppSuite({ fixture: { prefix: 'novel-editor-e2e-ai-' } });

const API_KEY = 'xai-e2e-secret-0001';
const CUSTOM_KEY = 'custom-e2e-secret-0002';
const CUSTOM_MODEL = 'mock-custom-model';
const GROK_CARD = '[data-testid="ai-provider-grok"]';
const CUSTOM_CARD = '[data-testid="ai-provider-custom-text-1"]';
const ADD_FORM = '[role="group"][aria-label="添加文本 AI"]';
const ACCEPTED_KEYS = [`Bearer ${API_KEY}`, `Bearer ${CUSTOM_KEY}`];
const requests: Array<{ auth?: string; body: Record<string, unknown> }> = [];
let server: Server;
let baseUrl = '';

function handle(req: IncomingMessage, res: ServerResponse) {
  let raw = '';
  req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf-8')));
  req.on('end', () => {
    const body = JSON.parse(raw || '{}') as Record<string, unknown>;
    requests.push({ auth: req.headers.authorization, body });
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

describe('AI 服务配置', () => {
  it('1. 设置中心配置 Grok（mock）→ 保存 Key → 测试连接成功；流式通道推送片段；渲染进程拿不到 Key', async () => {
    const { page, app } = suite;
    await page.click('[aria-label="打开设置中心"]');
    await page.waitForTarget({ text: '设置中心', exact: true });
    await page.click({ text: 'AI', within: '[class*="sidebar"]', exact: true });
    await page.waitForTarget(GROK_CARD);
    // 总开关独立在最上方；未配置的 Grok 面板默认收起，先展开
    // 开关的真实 input 视觉隐藏（role="switch"），只检查存在且不在任何服务面板里
    expect(
      await page.evaluate<boolean>(() => {
        const master = document.querySelector('input[role="switch"][aria-label="启用 AI 功能"]');
        return Boolean(master) && !master?.closest('[data-testid^="ai-provider-"]');
      })
    ).toBe(true);
    expect(
      await page.evaluate<string | null>(
        (selector: string) =>
          document
            .querySelector(`${selector} button[aria-expanded]`)
            ?.getAttribute('aria-expanded') ?? null,
        GROK_CARD
      )
    ).toBe('false');
    await page.click(`${GROK_CARD} button[aria-expanded]`);
    await page.waitForTarget(`${GROK_CARD} input[aria-label="API Key"]`);

    // 接口地址改为本地 mock（失焦即保存）
    await page.evaluate((selector: string) => {
      const input = document.querySelector(selector) as HTMLInputElement;
      input.focus();
      input.select();
    }, `${GROK_CARD} input[placeholder="https://api.x.ai/v1"]`);
    await page.type(baseUrl);
    await page.click(`${GROK_CARD} input[aria-label="API Key"]`);
    await page.waitForTarget({ text: '已保存', within: GROK_CARD, exact: true });

    // 只写的 Key：保存后输入框清空，只显示「已配置」
    await page.type(API_KEY);
    await page.click({ text: '保存 Key', within: GROK_CARD, exact: true });
    await page.waitForTarget({ text: 'Key 已安全保存', within: GROK_CARD, exact: true });
    expect(
      await page.evaluate<string>(
        (selector: string) => (document.querySelector(selector) as HTMLInputElement).value,
        `${GROK_CARD} input[aria-label="API Key"]`
      )
    ).toBe('');

    await page.click({ text: '测试连接', within: GROK_CARD, exact: true });
    await page.waitFor(
      (selector: string) => /连接成功/.test(document.querySelector(selector)?.textContent ?? ''),
      { args: [GROK_CARD], message: '测试连接成功' }
    );
    expect(requests.at(-1)?.auth).toBe(`Bearer ${API_KEY}`);
    expect(requests.at(-1)?.body).toMatchObject({ max_tokens: 1 });

    // 渲染进程只能看到 configured，看不到 Key
    const listed = await page.evaluate<string>(async () =>
      JSON.stringify(await window.electron.ipcRenderer.invoke('ai-providers-list'))
    );
    expect(listed).toContain('"configured":true');
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
            .invoke('ai-stream-start', { providerId: 'grok', prompt: '续写' })
            .then((result: unknown) => {
              if (!(result as { ok: boolean }).ok) reject(new Error(JSON.stringify(result)));
            });
        })
    );
    expect(streamed).toEqual({
      text: '雾气翻涌，林舟拔剑。',
      types: ['delta', 'delta', 'delta', 'done'],
    });

    // Key 保存在 userData 的 ai-credentials.json；系统钥匙串可用时文件中没有明文
    const credentialFile = path.join(app.userDataDir, 'ai-credentials.json');
    expect(existsSync(credentialFile)).toBe(true);
    const stored = JSON.parse(await readFile(credentialFile, 'utf-8')) as {
      entries: Record<string, { encrypted: boolean; data: string }>;
    };
    if (stored.entries.grok.encrypted) {
      expect(await readFile(credentialFile, 'utf-8')).not.toContain(API_KEY);
    }

    await page.click('[aria-label="关闭设置"]');
    await page.waitForGone({ text: '设置中心', exact: true });
  });

  it('2. 添加自定义文本 AI（mock）→ 保存 Key → 测试连接 → 设为默认 → ai-request 走它', async () => {
    const { page, app } = suite;
    /** 选中输入框原有内容后输入（替换） */
    const fill = async (selector: string, text: string) => {
      await page.evaluate((target: string) => {
        const input = document.querySelector(target) as HTMLInputElement;
        input.focus();
        input.select();
      }, selector);
      await page.type(text);
    };

    await page.click('[aria-label="打开设置中心"]');
    await page.waitForTarget({ text: '设置中心', exact: true });
    await page.click({ text: 'AI', within: '[class*="sidebar"]', exact: true });
    await page.waitForTarget(GROK_CARD);

    // 打开总开关（默认写作 AI 受它约束）
    await page.evaluate(() => {
      const master = document.querySelector(
        'input[role="switch"][aria-label="启用 AI 功能"]'
      ) as HTMLInputElement;
      if (!master.checked) master.click();
    });

    await page.click({ text: '添加文本 AI', exact: true });
    await page.waitForTarget(ADD_FORM);
    await fill(`${ADD_FORM} input[aria-label="新文本 AI 名称"]`, 'E2E 本地');
    await fill(`${ADD_FORM} input[aria-label="新文本 AI 接口地址"]`, baseUrl);
    await fill(`${ADD_FORM} input[aria-label="新文本 AI 模型"]`, CUSTOM_MODEL);
    await page.click({ text: '添加', within: ADD_FORM, exact: true });

    // 新面板自动展开：填 Key → 测试连接
    await page.waitForTarget(`${CUSTOM_CARD} input[aria-label="API Key"]`);
    await page.click(`${CUSTOM_CARD} input[aria-label="API Key"]`);
    await page.type(CUSTOM_KEY);
    await page.click({ text: '保存 Key', within: CUSTOM_CARD, exact: true });
    await page.waitForTarget({ text: 'Key 已安全保存', within: CUSTOM_CARD, exact: true });
    await page.click({ text: '测试连接', within: CUSTOM_CARD, exact: true });
    await page.waitFor(
      (selector: string) => /连接成功/.test(document.querySelector(selector)?.textContent ?? ''),
      { args: [CUSTOM_CARD], message: '自定义文本 AI 测试连接成功' }
    );
    expect(requests.at(-1)).toMatchObject({
      auth: `Bearer ${CUSTOM_KEY}`,
      body: { model: CUSTOM_MODEL, max_tokens: 1 },
    });

    // 设为默认：面板标题行出现「默认」，分区标题显示默认写作 AI
    await page.click({ text: '设为默认', within: CUSTOM_CARD, exact: true });
    await page.waitForTarget({ text: '默认', within: CUSTOM_CARD, exact: true });
    await page.waitForTarget({ text: '默认写作 AI：E2E 本地', exact: true });

    // 省略 providerId 的 ai-request（灵感、推演等）走默认写作 AI
    const before = requests.length;
    const result = await page.evaluate<{ ok: boolean; text?: string; error?: string }>(() =>
      window.electron.ipcRenderer.invoke('ai-request', { prompt: '默认写作 AI' })
    );
    expect(result).toEqual({ ok: true, text: 'pong' });
    expect(requests.length).toBe(before + 1);
    expect(requests.at(-1)).toMatchObject({
      auth: `Bearer ${CUSTOM_KEY}`,
      body: { model: CUSTOM_MODEL },
    });

    // Key 只在安全存储；列表里只有 configured
    const listed = await page.evaluate<string>(async () =>
      JSON.stringify(await window.electron.ipcRenderer.invoke('ai-providers-list'))
    );
    expect(listed).toContain('"id":"custom-text-1"');
    expect(listed).not.toContain(CUSTOM_KEY);
    const providersFile = await readFile(path.join(app.userDataDir, 'ai-providers.json'), 'utf-8');
    expect(providersFile).toContain('"defaultTextProviderId": "custom-text-1"');
    expect(providersFile).not.toContain(CUSTOM_KEY);

    await page.click('[aria-label="关闭设置"]');
    await page.waitForGone({ text: '设置中心', exact: true });
  });
});
