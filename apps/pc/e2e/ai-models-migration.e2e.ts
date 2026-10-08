/**
 * 旧版 AI 配置迁移（独立的 Electron 实例；启动前把旧版 ai-providers.json 与 ai-credentials.json 写进 userData）
 *
 * 旧版：内置服务（Grok 改过模型、Seedance 填了单价）+ 自己添加的 OpenAI 兼容文本 AI（选为默认写作 AI）
 * + 自己添加的 Seedance 视频服务 + 只关过开关、没有 Key 的 MiniMax 视频。
 * 启动后：设置中心「AI」每个能力一张模型列表，配置过的都在（id、名称、参数、Key、默认不变），
 * 从没配置过的不出现；原文件备份为 ai-providers.v1.json；省略模型的 ai-request 仍走原来的默认写作 AI。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { setupAppSuite } from './support/suite';

const TEXT_KEY = 'legacy-text-key-0001';
const GROK_KEY = 'legacy-grok-key-0002';
const VIDEO_KEY = 'legacy-video-key-0003';
const requests: Array<{ auth?: string; url?: string; body: Record<string, unknown> }> = [];

function handle(req: IncomingMessage, res: ServerResponse) {
  let raw = '';
  req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf-8')));
  req.on('end', () => {
    requests.push({
      auth: req.headers.authorization,
      url: req.url,
      body: JSON.parse(raw || '{}') as Record<string, unknown>,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '旧配置可用' } }] }));
  });
}

// mock 服务要在应用启动（写旧配置）之前就绪，地址写进旧配置
const server: Server = createServer(handle);
const ready = new Promise<string>((resolve) =>
  server.listen(0, '127.0.0.1', () =>
    resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`)
  )
);

/** CredentialStore 的旧文件：系统钥匙串不可用时的形态（base64 明文），任何环境都能读 */
function credential(secret: string) {
  return {
    data: Buffer.from(secret, 'utf-8').toString('base64'),
    encrypted: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const suite = setupAppSuite({
  fixture: { prefix: 'novel-editor-e2e-ai-migration-' },
  prepareUserData: async (dir) => {
    const baseUrl = await ready;
    await writeFile(
      path.join(dir, 'ai-providers.json'),
      JSON.stringify({
        schemaVersion: 1,
        providers: {
          grok: { model: 'grok-3', temperature: 0.8 },
          'seedance-video': { pricePerSecond: 0.7, currency: 'CNY' },
          'minimax-video': { enabled: false },
          'custom-text-1': { baseUrl, model: 'legacy-deepseek' },
          'custom-video-1': { baseUrl: `${baseUrl}/ark` },
        },
        video: { maxConcurrent: 3 },
        customText: [{ id: 'custom-text-1', label: 'DeepSeek 工作', createdAt: '' }],
        nextCustomTextNumber: 2,
        defaultTextProviderId: 'custom-text-1',
        customMedia: [
          { id: 'custom-video-1', kind: 'video', vendor: 'seedance-video', label: '方舟 工作室' },
        ],
        nextCustomMediaNumber: { video: 2, image: 1, speech: 1 },
      })
    );
    await writeFile(
      path.join(dir, 'ai-credentials.json'),
      JSON.stringify({
        schemaVersion: 1,
        entries: {
          grok: credential(GROK_KEY),
          'seedance-video': credential(VIDEO_KEY),
          'custom-text-1': credential(TEXT_KEY),
          'custom-video-1': credential(VIDEO_KEY),
        },
      })
    );
  },
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('旧版 AI 配置迁移', () => {
  it('配置过的服务都变成模型（id / 名称 / 参数 / Key / 默认不变）；没配置过的不出现；原文件备份', async () => {
    const { page, app } = suite;
    await page.click('[aria-label="打开设置中心"]');
    await page.waitForTarget({ text: '设置中心', exact: true });
    await page.click({ text: 'AI', within: '[class*="sidebar"]', exact: true });
    await page.waitForTarget('[data-testid="ai-model-custom-text-1"]');

    const rows = await page.evaluate<Record<string, string[]>>(() => {
      const result: Record<string, string[]> = {};
      for (const capability of ['text', 'image', 'video', 'speech']) {
        result[capability] = Array.from(
          document.querySelectorAll(
            `[data-testid="ai-section-${capability}"] [data-testid^="ai-model-"]`
          )
        ).map((row) => row.getAttribute('aria-label') ?? '');
      }
      return result;
    });
    expect(rows).toEqual({
      text: ['xAI Grok · grok-3', 'DeepSeek 工作'],
      image: [],
      video: ['Seedance · doubao-seedance-1-0-pro-250528', '方舟 工作室'],
      speech: [],
    });
    // 默认写作 AI 仍是作者原来选的；每条都是「已配置」
    await page.waitForTarget({ text: '默认：DeepSeek 工作', exact: true });
    const deepseek = await page.evaluate<string>(
      () => document.querySelector('[data-testid="ai-model-custom-text-1"]')?.textContent ?? ''
    );
    expect(deepseek).toContain('已配置');
    expect(deepseek).toContain('默认');
    await page.click('[aria-label="关闭设置"]');
    await page.waitForGone({ text: '设置中心', exact: true });

    // 列表：参数原样迁移，不含 Key
    const listed = await page.evaluate<string>(async () =>
      JSON.stringify(await window.electron.ipcRenderer.invoke('ai-providers-list'))
    );
    for (const key of [TEXT_KEY, GROK_KEY, VIDEO_KEY]) expect(listed).not.toContain(key);
    const data = (JSON.parse(listed) as { data: Array<Record<string, unknown>> }).data;
    expect(data.find((item) => item.id === 'grok')).toMatchObject({
      model: 'grok-3',
      temperature: 0.8,
      configured: true,
    });
    expect(data.find((item) => item.id === 'seedance-video')).toMatchObject({
      pricePerSecond: 0.7,
      supportsAudio: true,
    });
    expect(data.find((item) => item.id === 'minimax-video')).toBeUndefined();

    // 省略模型的 ai-request 走原来的默认写作 AI（它的地址、模型与 Key）
    await page.evaluate(async () => {
      const raw = (await window.electron.ipcRenderer.invoke(
        'db-settings-get',
        'novel-editor:settings-center'
      )) as string | null;
      const settings = raw ? (JSON.parse(raw) as { ai?: Record<string, unknown> }) : {};
      settings.ai = { ...(settings.ai ?? {}), enabled: true, enabledExplicitlySet: true };
      await window.electron.ipcRenderer.invoke(
        'db-settings-set',
        'novel-editor:settings-center',
        JSON.stringify(settings)
      );
    });
    const result = await page.evaluate<{ ok: boolean; text?: string }>(() =>
      window.electron.ipcRenderer.invoke('ai-request', { prompt: '迁移后' })
    );
    expect(result).toEqual({ ok: true, text: '旧配置可用' });
    expect(requests.at(-1)).toMatchObject({
      auth: `Bearer ${TEXT_KEY}`,
      url: '/v1/chat/completions',
      body: { model: 'legacy-deepseek' },
    });

    // 新文件 schemaVersion 2；旧文件原样备份
    const migrated = JSON.parse(
      await readFile(path.join(app.userDataDir, 'ai-providers.json'), 'utf-8')
    ) as {
      schemaVersion: number;
      defaults: Record<string, string>;
      video: { maxConcurrent: number };
    };
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.defaults.text).toBe('custom-text-1');
    expect(migrated.video.maxConcurrent).toBe(3);
    const backup = path.join(app.userDataDir, 'ai-providers.v1.json');
    expect(existsSync(backup)).toBe(true);
    expect(JSON.parse(await readFile(backup, 'utf-8'))).toMatchObject({ schemaVersion: 1 });
  });
});
