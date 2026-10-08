/**
 * 真实 AI 服务冒烟测试（可选）：用真实 Key 在应用里走一遍「添加模型 → 测试连接 → 流式续写 → 出图」。
 *
 * 只有设置了 NE_LIVE_* 环境变量时才运行（CI 与日常 `pnpm test:e2e` 自动跳过）；Key 只经 IPC 写入本次临时
 * userData 的安全存储（结束后删除），不会写进仓库。用法（在仓库根目录）：
 *
 *   set -a; . ~/.config/novel-editor-live/keys.env; set +a
 *   NE_LIVE_PROXY=http://127.0.0.1:7890 pnpm test:e2e apps/pc/e2e/live-ai.e2e.ts
 *
 * 变量：NE_LIVE_DEEPSEEK_KEY / NE_LIVE_OPENAI_KEY / NE_LIVE_GROK_KEY / NE_LIVE_GEMINI_KEY /
 * NE_LIVE_VOLC_KEY（火山方舟）/ NE_LIVE_MINIMAX_KEY；NE_LIVE_PROXY 为境外服务使用的代理（应用「网络代理」手动地址）。
 * 视频不在这里生成（会产生费用），只测试连接；视频生成用 apps/pc/scripts/live-ai-check.mts --only video。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findPreset } from '../src/shared/ai-models';
import { setupAppSuite } from './support/suite';

interface LiveModel {
  name: string;
  capability: 'text' | 'image' | 'video' | 'speech';
  vendor: string;
  preset: string;
  keyEnv: string;
  model?: string;
  /** 境外服务：走 NE_LIVE_PROXY */
  proxy?: boolean;
}

const MODELS: LiveModel[] = [
  {
    name: 'DeepSeek',
    capability: 'text',
    vendor: 'openai-compatible',
    preset: 'deepseek',
    keyEnv: 'NE_LIVE_DEEPSEEK_KEY',
  },
  {
    name: 'OpenAI',
    capability: 'text',
    vendor: 'openai-compatible',
    preset: 'openai',
    keyEnv: 'NE_LIVE_OPENAI_KEY',
    model: 'gpt-5.4-mini',
    proxy: true,
  },
  {
    name: 'Grok',
    capability: 'text',
    vendor: 'grok',
    preset: 'grok',
    keyEnv: 'NE_LIVE_GROK_KEY',
    proxy: true,
  },
  {
    name: '豆包',
    capability: 'text',
    vendor: 'openai-compatible',
    preset: 'doubao',
    keyEnv: 'NE_LIVE_VOLC_KEY',
    model: 'doubao-seed-2-0-mini-260428',
  },
  {
    name: 'MiniMax 图片',
    capability: 'image',
    vendor: 'minimax-image',
    preset: 'minimax-image',
    keyEnv: 'NE_LIVE_MINIMAX_KEY',
  },
  {
    name: 'Grok 图片',
    capability: 'image',
    vendor: 'grok-image',
    preset: 'grok-image',
    keyEnv: 'NE_LIVE_GROK_KEY',
    proxy: true,
  },
  {
    name: 'Seedream',
    capability: 'image',
    vendor: 'seedream-image',
    preset: 'seedream',
    keyEnv: 'NE_LIVE_VOLC_KEY',
    model: 'doubao-seedream-5-0-pro-260628',
  },
  {
    name: 'MiniMax 配音',
    capability: 'speech',
    vendor: 'minimax-speech',
    preset: 'minimax-speech',
    keyEnv: 'NE_LIVE_MINIMAX_KEY',
  },
  {
    name: 'OpenAI 配音',
    capability: 'speech',
    vendor: 'openai-speech',
    preset: 'openai-speech',
    keyEnv: 'NE_LIVE_OPENAI_KEY',
    proxy: true,
  },
  {
    name: 'Grok 配音',
    capability: 'speech',
    vendor: 'grok-speech',
    preset: 'grok-speech',
    keyEnv: 'NE_LIVE_GROK_KEY',
    proxy: true,
  },
  {
    name: 'Seedance',
    capability: 'video',
    vendor: 'seedance-video',
    preset: 'seedance',
    keyEnv: 'NE_LIVE_VOLC_KEY',
    model: 'doubao-seedance-2-0-mini-260615',
  },
  {
    name: 'MiniMax 视频',
    capability: 'video',
    vendor: 'minimax-video',
    preset: 'minimax-video',
    keyEnv: 'NE_LIVE_MINIMAX_KEY',
  },
  {
    name: 'Grok 视频',
    capability: 'video',
    vendor: 'grok-video',
    preset: 'grok-video',
    keyEnv: 'NE_LIVE_GROK_KEY',
    proxy: true,
  },
];

const available = MODELS.filter((item) => process.env[item.keyEnv]?.trim());
const proxyUrl = process.env.NE_LIVE_PROXY?.trim();

describe.skipIf(available.length === 0)('真实 AI 服务（NE_LIVE_*）', () => {
  const suite = setupAppSuite({ fixture: { prefix: 'novel-editor-e2e-live-' } });
  const added = new Map<string, string>();

  it('添加模型（境外服务走代理）→ 每个模型测试连接成功；列表与配置文件里没有 Key', async () => {
    const { page, app } = suite;
    // 打开「启用 AI 功能」总开关（默认文本模型受它约束）
    await page.click('[aria-label="打开设置中心"]');
    await page.waitForTarget({ text: '设置中心', exact: true });
    await page.click({ text: 'AI', within: '[class*="sidebar"]', exact: true });
    // 开关的真实 input 视觉上隐藏，按存在判断
    await page.waitFor(
      () => Boolean(document.querySelector('input[role="switch"][aria-label="启用 AI 功能"]')),
      { message: '「启用 AI 功能」开关' }
    );
    await page.evaluate(() => {
      const master = document.querySelector(
        'input[role="switch"][aria-label="启用 AI 功能"]'
      ) as HTMLInputElement;
      if (!master.checked) master.click();
    });
    await page.click('[aria-label="关闭设置"]');
    await page.waitForGone({ text: '设置中心', exact: true });
    if (proxyUrl) {
      const saved = await page.evaluate<{ ok: boolean }>(
        (url: string) =>
          window.electron.ipcRenderer.invoke('ai-proxy-set', { mode: 'manual', url }),
        proxyUrl
      );
      expect(saved.ok).toBe(true);
    }
    const failures: string[] = [];
    for (const item of available) {
      const input = {
        capability: item.capability,
        vendor: item.vendor,
        preset: item.preset,
        label: `live · ${item.name}`,
        apiKey: process.env[item.keyEnv]?.trim() ?? '',
        useProxy: Boolean(item.proxy && proxyUrl),
        // 界面上选服务商时会预填地址；经 IPC 添加时自己带上
        baseUrl: findPreset(item.preset)?.baseUrl ?? '',
        // 界面上会预填推荐模型的第一个
        model: item.model ?? findPreset(item.preset)?.models[0] ?? '',
      };
      const result = await page.evaluate<{
        ok: boolean;
        data?: { id: string };
        error?: { message: string };
      }>(
        (payload: Record<string, unknown>) =>
          window.electron.ipcRenderer.invoke('ai-models-add', payload),
        input
      );
      if (!result.ok || !result.data) {
        failures.push(`${item.name} 添加失败：${result.error?.message ?? ''}`);
        continue;
      }
      added.set(item.name, result.data.id);
      const tested = await page.evaluate<{
        ok: boolean;
        error?: { kind: string; message: string };
      }>((id: string) => window.electron.ipcRenderer.invoke('ai-models-test', id), result.data.id);
      if (!tested.ok)
        failures.push(`${item.name}：[${tested.error?.kind}] ${tested.error?.message}`);
    }
    expect(failures).toEqual([]);

    const listed = await page.evaluate<string>(async () =>
      JSON.stringify(await window.electron.ipcRenderer.invoke('ai-providers-list'))
    );
    const providersFile = await readFile(path.join(app.userDataDir, 'ai-providers.json'), 'utf-8');
    for (const item of available) {
      const key = process.env[item.keyEnv]?.trim() ?? '';
      expect(listed.includes(key), `${item.name} 的 Key 出现在列表里`).toBe(false);
      expect(providersFile.includes(key), `${item.name} 的 Key 写进了配置文件`).toBe(false);
    }
  });

  it('流式续写：每个文本模型都能流式返回正文', async () => {
    const { page } = suite;
    expect(added.size, '上一步没有成功添加任何模型').toBeGreaterThan(0);
    for (const item of available.filter((model) => model.capability === 'text')) {
      const id = added.get(item.name);
      if (!id) continue;
      const streamed = await page.evaluate<{ text: string; error?: string }>(
        (providerId: string) =>
          new Promise((resolve) => {
            let text = '';
            const dispose = window.electron.ipcRenderer.on(
              'ai-stream-event',
              (
                _event: unknown,
                payload: { type: string; text?: string; error?: { message: string } }
              ) => {
                if (payload.type === 'delta') text += payload.text ?? '';
                if (payload.type === 'done' || payload.type === 'error') {
                  if (typeof dispose === 'function') dispose();
                  resolve({ text, error: payload.error?.message });
                }
              }
            );
            void window.electron.ipcRenderer
              .invoke('ai-stream-start', {
                providerId,
                prompt: '续写一句：林舟背起行囊，走出了小镇。',
                maxTokens: 400,
              })
              .then((result: { ok: boolean; error?: { message: string } }) => {
                if (!result.ok) resolve({ text, error: result.error?.message });
              });
          }),
        id
      );
      expect(streamed.error, item.name).toBeUndefined();
      expect(streamed.text.trim().length, item.name).toBeGreaterThan(0);
    }
  }, 300_000);

  it('出图：每个图片模型都返回可用的图片（返回地址的经代理下载）', async () => {
    const { page } = suite;
    for (const item of available.filter((model) => model.capability === 'image')) {
      const id = added.get(item.name);
      if (!id) continue;
      // 出图可能要几十秒：在页面里发起请求，结果放到 window 上再轮询（避免单次 CDP 调用超时）
      await page.evaluate((providerId: string) => {
        const target = window as unknown as { __liveImage?: unknown };
        target.__liveImage = undefined;
        void window.electron.ipcRenderer
          .invoke('ai-image-generate', {
            providerId,
            prompt: 'A lighthouse on a cliff at dusk, watercolor',
            aspectRatio: '1:1',
            count: 1,
          })
          .then((value: unknown) => (target.__liveImage = value));
        return true;
      }, id);
      const result = await page.waitFor<{
        ok: boolean;
        data?: { images: Array<{ dataUrl: string }> };
        error?: { message: string };
      }>(() => (window as unknown as { __liveImage?: unknown }).__liveImage, {
        timeout: 240_000,
        message: `${item.name} 出图`,
      });
      expect(result.error?.message, item.name).toBeUndefined();
      expect(result.data?.images[0]?.dataUrl.startsWith('data:image/'), item.name).toBe(true);
    }
  }, 600_000);
});
