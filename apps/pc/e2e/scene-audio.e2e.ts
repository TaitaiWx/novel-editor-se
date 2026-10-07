/**
 * 场景视频 · 声音（独立的 Electron 实例 + 本地 mock 服务）
 *
 * mock 服务同时扮演：
 * - 文本服务（xAI Grok，OpenAI 兼容 /v1/chat/completions）：返回带对白（说话人 / 台词 / 情绪）与音效的分镜 JSON
 * - 配音服务（OpenAI 兼容 /v1/audio/speech）：返回测试内生成的小 WAV
 *
 * 流程：配置服务 → 选中「第一场」→ 场景视频 → AI 分镜带对白（节点显示「台词 N」）→ 场景检查器选英语、
 * 选本地背景音乐（「打开」对话框由 NOVEL_EDITOR_E2E_OPEN_PATH 替代，复制到 资料/音乐/）→ 镜头 1 检查器
 * 「生成配音」→ 镜头1-台词-l1.wav 落盘、分镜.json 记录配音文件与声音设置、检查器可试听
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureForReview, openChapter, setupAppSuite } from './support/suite';
import { createTinyWav } from './support/wav-fixture';
import { chooseSelectOption, comboboxSelector } from './support/select';

/** 「打开」对话框的替身：背景音乐源文件（测试内生成） */
const BGM_SOURCE = path.join(os.tmpdir(), `scene-audio-bgm-${process.pid}.wav`);
process.env.NOVEL_EDITOR_E2E_OPEN_PATH = BGM_SOURCE;

const suite = setupAppSuite({ fixture: { prefix: 'novel-editor-e2e-scene-audio-' } });

const API_KEY = 'e2e-scene-audio-key';
const SCENE = '第一场 清晨的青石镇';
const SCENE_DIR = ['novels', '星河旅人', '资料', '视频', '001-启程', SCENE];
const MUSIC_DIR = ['novels', '星河旅人', '资料', '音乐'];
const STORYBOARD = {
  shots: [
    {
      shotSize: '远景',
      durationSec: 4,
      description: '雨后清晨，青石镇镇口的老槐树湿漉漉地发亮',
      camera: '缓慢推近',
      dialogue: [
        { speaker: '小石头', text: '舟哥！', emotion: 'happy' },
        { speaker: 'narrator', text: '那天清晨，雨刚停。' },
      ],
      sfx: [{ prompt: '远处鸡鸣', atSec: 1 }],
    },
    {
      shotSize: '中景',
      durationSec: 4,
      description: '林舟接过烤得焦黄的饼',
      dialogue: [{ speaker: '林舟', text: '替我看好铁匠铺，等我回来。' }],
    },
    {
      shotSize: '近景',
      durationSec: 4,
      description: '小石头仰着头，认真得像在立誓',
      dialogue: [{ speaker: '小石头', text: '你一定要回来。' }],
    },
  ],
};

interface RecordedRequest {
  path: string;
  auth?: string;
  body: Record<string, unknown>;
}

const requests: RecordedRequest[] = [];
const speechWav = createTinyWav(0.6, 520);
let server: Server;
let baseUrl = '';

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function handle(req: IncomingMessage, res: ServerResponse) {
  let raw = '';
  req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf-8')));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', baseUrl);
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    requests.push({ path: url.pathname, auth: req.headers.authorization, body });
    if (req.headers.authorization !== `Bearer ${API_KEY}`) {
      json(res, 401, { error: { message: 'Incorrect API key provided' } });
      return;
    }
    if (url.pathname === '/v1/chat/completions') {
      json(res, 200, {
        model: 'grok-mock',
        choices: [{ message: { content: JSON.stringify(STORYBOARD) }, finish_reason: 'stop' }],
      });
      return;
    }
    if (url.pathname === '/v1/audio/speech') {
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': String(speechWav.length),
      });
      res.end(Buffer.from(speechWav));
      return;
    }
    json(res, 404, { error: { message: `unknown ${url.pathname}` } });
  });
}

beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await writeFile(BGM_SOURCE, createTinyWav(2, 220));
});

afterAll(async () => {
  delete process.env.NOVEL_EDITOR_E2E_OPEN_PATH;
  await rm(BGM_SOURCE, { force: true });
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function readStoryboardJson(file: string): Promise<Record<string, unknown>> {
  const raw = await readFile(file, 'utf-8').catch(() => '{}');
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

describe('场景视频 · 声音', () => {
  it('AI 分镜带对白 → 选语言与背景音乐 → 生成配音落盘并记录到 分镜.json', async () => {
    const { page, fixture } = suite;

    const configured = await page.evaluate<boolean[]>(
      async (url: string, key: string) => {
        const ipc = window.electron.ipcRenderer;
        const results = await Promise.all([
          ipc.invoke('ai-providers-set', 'grok', {
            apiKey: key,
            baseUrl: `${url}/v1`,
            enabled: true,
          }),
          ipc.invoke('ai-providers-set', 'openai-speech', {
            apiKey: key,
            baseUrl: `${url}/v1`,
            enabled: true,
          }),
        ]);
        return results.map((result) => (result as { ok: boolean }).ok);
      },
      baseUrl,
      API_KEY
    );
    expect(configured).toEqual([true, true]);

    await openChapter(page, '001-启程', '林舟背起行囊');
    // 选中「第一场」正文（与 scene-video.e2e.ts 相同：轮询直到选区同步进编辑器状态）
    const chapterText = await readFile(
      fixture.resolve('novels', '星河旅人', '第一卷-离乡', '001-启程.md'),
      'utf-8'
    );
    const endLine =
      chapterText.split(/\r?\n/).findIndex((line) => line.startsWith('“你一定要回来。”')) + 1;
    expect(endLine).toBeGreaterThan(0);
    await page.waitFor(
      (line: number) => {
        const status = document.querySelector('[class*="statusBar"]')?.textContent ?? '';
        const column = Number(new RegExp(`行 ${line}, 列 (\\d+)`).exec(status)?.[1] ?? 0);
        if (column > 1) return true;
        const lines = Array.from(document.querySelectorAll<HTMLElement>('.cm-content .cm-line'));
        const start = lines.find((item) => item.textContent?.startsWith('石板路还湿着'));
        const end = lines.find((item) => item.textContent?.startsWith('“你一定要回来。”'));
        if (!start || !end) return false;
        (document.querySelector('.cm-content') as HTMLElement).focus();
        const range = document.createRange();
        range.setStart(start, 0);
        range.setEnd(end, end.childNodes.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return false;
      },
      { args: [endLine], message: '编辑器选区已同步到第一场末行' }
    );

    await page.click('[data-testid="scene-video-pill"]');
    await page.waitForTarget('[data-testid="scene-video-view"]', 15_000);
    const SHOT_NODES = '[data-testid="scene-canvas"] [role="group"][aria-label^="镜头 "]';
    await page.waitFor((selector: string) => document.querySelectorAll(selector).length === 3, {
      args: [SHOT_NODES],
      timeout: 15_000,
      message: 'AI 拆出 3 个镜头节点',
    });
    // 分镜提示词要求提取对白与说话人
    const chat = requests.find((item) => item.path === '/v1/chat/completions');
    expect(JSON.stringify(chat?.body.messages)).toContain('dialogue');
    // 节点上的声音标记：镜头 1 有两句台词、一个音效
    const shot1Badges = '[role="group"][aria-label="镜头 1"] [data-testid="shot-audio-badges"]';
    await page.waitFor(
      (selector: string) => {
        const text = document.querySelector(selector)?.textContent ?? '';
        return text.includes('台词 2') && text.includes('音效 1');
      },
      { args: [shot1Badges], message: '镜头 1 节点显示 台词 2 / 音效 1' }
    );

    // 场景检查器 → 声音：配音语言选英语，背景音乐选本地文件（复制到 资料/音乐/）
    await page.click('[data-testid="scene-canvas"] [role="group"][aria-label="场景"] p');
    await page.waitForTarget('[data-testid="scene-audio-section"]');
    await chooseSelectOption(page, '配音语言', '英语（美国）（en-US）');
    await chooseSelectOption(page, '背景音乐', '本地音乐文件');
    const bgmName = path.basename(BGM_SOURCE);
    await page.waitFor(
      (name: string) =>
        document.querySelector('[data-testid="scene-audio-bgm-file"]')?.textContent === name,
      { args: [bgmName], timeout: 10_000, message: '检查器显示背景音乐文件名' }
    );
    const copiedBgm = fixture.resolve(...MUSIC_DIR, bgmName);
    await page.waitUntil(() => existsSync(copiedBgm), { message: '背景音乐已复制到 资料/音乐/' });
    expect((await readFile(copiedBgm)).equals(await readFile(BGM_SOURCE))).toBe(true);
    await page.waitForTarget('[data-testid="scene-audio-bgm-preview"]');
    await page.waitFor(
      (selector: string) => (document.querySelector(selector)?.textContent ?? '').includes('配乐'),
      { args: [shot1Badges], message: '镜头节点显示「配乐」' }
    );
    await captureForReview(page, 'scene-audio-scene-inspector');

    // 镜头 1 检查器：对白带说话人；生成第一句的配音
    await page.click('[role="group"][aria-label="镜头 1"] p');
    await page.waitForTarget('[data-testid="shot-dialogue"]');
    expect(
      await page.evaluate<string[]>(() =>
        Array.from(
          document.querySelectorAll<HTMLTextAreaElement>('[data-testid="shot-dialogue"] textarea')
        ).map((item) => item.value)
      )
    ).toEqual(['舟哥！', '那天清晨，雨刚停。']);
    expect(
      await page.evaluate<string>(
        (selector: string) => document.querySelector(selector)?.textContent?.trim() ?? '',
        comboboxSelector('镜头 1 第 1 句 说话人')
      )
    ).toBe('小石头');
    await page.click('button[aria-label="为镜头 1 第 1 句生成配音"]');
    const voiceFile = fixture.resolve(...SCENE_DIR, '镜头1-台词-l1.wav');
    await page.waitUntil(() => existsSync(voiceFile), {
      timeout: 15_000,
      message: '镜头1-台词-l1.wav 已落盘',
    });
    expect((await readFile(voiceFile)).equals(Buffer.from(speechWav))).toBe(true);
    const speech = requests.find((item) => item.path === '/v1/audio/speech');
    expect(speech?.auth).toBe(`Bearer ${API_KEY}`);
    expect(speech?.body).toMatchObject({ model: 'gpt-4o-mini-tts', input: '舟哥！' });
    expect(String(speech?.body.instructions)).toContain('en-US');
    // 检查器可以试听
    await page.waitForTarget(
      '[data-testid="shot-dialogue"] [data-testid="dialogue-audio"]',
      15_000
    );

    // 分镜.json 记录：配音文件、语言、背景音乐
    const storyboardFile = fixture.resolve(...SCENE_DIR, '分镜.json');
    await page.waitUntil(
      async () => {
        const saved = await readStoryboardJson(storyboardFile);
        const board = saved.storyboard as
          | { shots?: Array<{ dialogue?: Array<{ audioFile?: string }> }> }
          | undefined;
        return board?.shots?.[0]?.dialogue?.[0]?.audioFile === '镜头1-台词-l1.wav';
      },
      { timeout: 15_000, message: '分镜.json 记录了配音文件' }
    );
    const saved = await readStoryboardJson(storyboardFile);
    expect(saved.audio).toMatchObject({
      language: 'en-US',
      ducking: true,
      bgm: { source: 'file', path: `资料/音乐/${bgmName}` },
    });
    const board = saved.storyboard as {
      shots: Array<{ dialogue?: Array<Record<string, unknown>>; sfx?: unknown[] }>;
    };
    expect(board.shots[0].dialogue?.[0]).toMatchObject({
      id: 'l1',
      speaker: '小石头',
      text: '舟哥！',
      emotion: 'happy',
      audioFile: '镜头1-台词-l1.wav',
      audioDurationSec: 0.6,
    });
    expect(board.shots[0].sfx).toHaveLength(1);
    // 分镜.md 的对白列带说话人
    const markdown = await readFile(fixture.resolve(...SCENE_DIR, '分镜.md'), 'utf-8');
    expect(markdown).toContain('小石头：舟哥！');
    await captureForReview(page, 'scene-audio-shot-inspector');
  }, 120_000);
});
