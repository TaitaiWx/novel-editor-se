/**
 * AI 服务配置（独立的 Electron 实例 + 本地 mock 服务）
 *
 * 设置中心 → AI →「更多 AI 服务」配置 xAI Grok：接口地址指向本地 mock（OpenAI 兼容），
 * 只写的 API Key 由主进程加密保存 → 测试连接成功 → 流式通道（ai-stream-start / ai-stream-event）推送片段。
 * 同时确认渲染进程拿不到 Key 明文。
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
const GROK_CARD = '[data-testid="ai-provider-grok"]';
const requests: Array<{ auth?: string; body: Record<string, unknown> }> = [];
let server: Server;
let baseUrl = '';

function handle(req: IncomingMessage, res: ServerResponse) {
  let raw = '';
  req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf-8')));
  req.on('end', () => {
    const body = JSON.parse(raw || '{}') as Record<string, unknown>;
    requests.push({ auth: req.headers.authorization, body });
    if (req.headers.authorization !== `Bearer ${API_KEY}`) {
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
});
