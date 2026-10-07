/**
 * 场景视频（独立的 Electron 实例 + 本地 mock 服务）
 *
 * mock 服务同时扮演：
 * - 文本服务（xAI Grok，OpenAI 兼容 /v1/chat/completions）：返回 4 个镜头的分镜 JSON
 * - 视频服务（MiniMax 形状）：提交 → 第一次查询生成中 → 之后成功 → 取文件地址 → 下载测试内生成的小 MP4
 *
 * 流程：打开 001-启程 → 选中「第一场」正文 → 文件栏「场景视频」→ AI 生成分镜（≥3 个镜头）
 * → 只勾选镜头 1 → 生成选中镜头 → 任务完成 → 成片落盘到 资料/视频/001-启程/第一场 清晨的青石镇/ → 预览播放器出现
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureForReview, ensureSidebarOpen, openChapter, setupAppSuite } from './support/suite';
import { createTinyMp4 } from './support/mp4-fixture';

const suite = setupAppSuite({ fixture: { prefix: 'novel-editor-e2e-scene-video-' } });

const API_KEY = 'e2e-scene-video-key';
const SCENE = '第一场 清晨的青石镇';
const CHAPTER_FILE = ['novels', '星河旅人', '第一卷-离乡', '001-启程.md'];
const SCENE_DIR = ['novels', '星河旅人', '资料', '视频', '001-启程', SCENE];
const STORYBOARD = {
  shots: [
    {
      shotSize: '远景',
      durationSec: 6,
      description: '雨后清晨，青石镇镇口的老槐树湿漉漉地发亮',
      camera: '缓慢推近',
    },
    { shotSize: '中景', durationSec: 6, description: '林舟背着行囊回头望向铁匠铺', camera: '固定' },
    { shotSize: '近景', durationSec: 6, description: '小石头光着脚从巷子里跑出来', camera: '跟拍' },
    { shotSize: '特写', durationSec: 6, description: '林舟接过烤得焦黄的饼', camera: '推近' },
  ],
};

interface RecordedRequest {
  method: string;
  path: string;
  auth?: string;
  body: Record<string, unknown>;
}

const requests: RecordedRequest[] = [];
const queryCount = new Map<string, number>();
const mp4 = createTinyMp4();
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
    requests.push({
      method: req.method ?? 'GET',
      path: url.pathname,
      auth: req.headers.authorization,
      body,
    });
    // 成片下载地址（签名地址，不需要鉴权）
    if (url.pathname === '/files/clip.mp4') {
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(mp4.length) });
      res.end(Buffer.from(mp4));
      return;
    }
    if (req.headers.authorization !== `Bearer ${API_KEY}`) {
      json(res, 401, { error: { message: 'Incorrect API key provided' } });
      return;
    }
    switch (url.pathname) {
      case '/v1/chat/completions':
        json(res, 200, {
          model: 'grok-mock',
          choices: [{ message: { content: JSON.stringify(STORYBOARD) }, finish_reason: 'stop' }],
        });
        return;
      case '/v1/video_generation':
        json(res, 200, {
          task_id: 'mm-task-1',
          base_resp: { status_code: 0, status_msg: 'success' },
        });
        return;
      case '/v1/query/video_generation': {
        const id = url.searchParams.get('task_id') ?? '';
        const count = (queryCount.get(id) ?? 0) + 1;
        queryCount.set(id, count);
        json(
          res,
          200,
          count === 1
            ? { task_id: id, status: 'Processing', base_resp: { status_code: 0 } }
            : { task_id: id, status: 'Success', file_id: 'file-1', base_resp: { status_code: 0 } }
        );
        return;
      }
      case '/v1/files/retrieve':
        json(res, 200, {
          file: { file_id: 'file-1', download_url: `${baseUrl}/files/clip.mp4` },
          base_resp: { status_code: 0 },
        });
        return;
      default:
        json(res, 404, { error: { message: `unknown ${url.pathname}` } });
    }
  });
}

beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('场景视频', () => {
  it('选中一场 → 场景视频 → AI 分镜 → 生成镜头 1 → 成片落盘并可预览', async () => {
    const { page, fixture } = suite;

    // 配置 mock 服务（Key 只写，主进程加密保存）：文本用 Grok，视频用 MiniMax
    const configured = await page.evaluate<boolean[]>(
      async (url: string, key: string) => {
        const ipc = window.electron.ipcRenderer;
        const results = await Promise.all([
          ipc.invoke('ai-providers-set', 'grok', {
            apiKey: key,
            baseUrl: `${url}/v1`,
            enabled: true,
          }),
          ipc.invoke('ai-providers-set', 'minimax-video', {
            apiKey: key,
            baseUrl: url,
            enabled: true,
            pricePerSecond: 0.5,
            currency: 'CNY',
          }),
        ]);
        return results.map((result) => (result as { ok: boolean }).ok);
      },
      baseUrl,
      API_KEY
    );
    expect(configured).toEqual([true, true]);

    await openChapter(page, '001-启程', '林舟背起行囊');

    // 选中「第一场」的正文（从第一段到小石头那一段）。DOM 选区要经异步的 selectionchange 才同步进
    // CodeMirror 状态，机器繁忙时固定等待不够：轮询直到状态栏（读编辑器状态）的光标到达选区末行
    const chapterText = await readFile(fixture.resolve(...CHAPTER_FILE), 'utf-8');
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
    await page.waitForTarget({
      text: `001-启程 · ${SCENE}`,
      within: '[data-testid="scene-video-view"]',
    });
    // 左栏：场景正文来自选区；视频服务已配置（下拉框出现）
    expect(
      await page.evaluate<string>(
        () =>
          (
            document.querySelector(
              '[data-testid="scene-video-view"] textarea'
            ) as HTMLTextAreaElement
          ).value
      )
    ).toContain('“舟哥！”');
    await page.waitForTarget('select[aria-label="视频服务"]');
    await captureForReview(page, 'scene-video-open');

    // 中栏：AI 生成分镜（Grok mock）→ 4 个镜头
    await page.click({ text: 'AI 生成分镜', within: '[data-testid="scene-video-view"]' });
    await page.waitFor(() => document.querySelectorAll('li[aria-label^="镜头 "]').length >= 3, {
      timeout: 15_000,
      message: 'AI 分镜出现至少 3 个镜头',
    });
    const chat = requests.find((item) => item.path === '/v1/chat/completions');
    expect(JSON.stringify(chat?.body.messages)).toContain('石板路还湿着');

    // 只生成镜头 1：取消勾选其余镜头
    await page.evaluate(() => {
      document
        .querySelectorAll<HTMLInputElement>('input[aria-label^="选择镜头 "]')
        .forEach((input) => {
          if (input.getAttribute('aria-label') !== '选择镜头 1' && input.checked) input.click();
        });
    });
    await page.waitFor(
      () =>
        document.querySelector('[data-testid="scene-video-estimate"]')?.textContent ===
        '预计 ¥3.00 · 1 个镜头 · 共 6 秒',
      { message: '费用预估只计镜头 1' }
    );
    await captureForReview(page, 'scene-video-storyboard');

    // 按钮可用后再点击，并确认任务确实提交（任务列表出现一行），失败时立即报错而不是空等 60 秒
    await page.waitFor(
      () =>
        Array.from(
          document.querySelectorAll<HTMLButtonElement>('[data-testid="scene-video-view"] button')
        ).some((button) => button.textContent === '生成选中镜头' && !button.disabled),
      { message: '「生成选中镜头」可用' }
    );
    await page.click({ text: '生成选中镜头', within: '[data-testid="scene-video-view"]' });
    await page.waitFor(() => document.querySelectorAll('ul[aria-label="生成任务"] li').length > 0, {
      timeout: 10_000,
      message: '镜头 1 已提交（任务列表出现）',
    });
    // 提交 → 轮询（第一次生成中，之后成功）→ 下载；轮询间隔 5 秒
    try {
      await page.waitFor(
        () =>
          Array.from(document.querySelectorAll('ul[aria-label="生成任务"] li')).some((li) =>
            li.textContent?.includes('已完成')
          ),
        { timeout: 60_000, message: '镜头 1 生成完成' }
      );
    } catch (error) {
      // 附上任务列表与 mock 收到的请求，便于区分「没提交 / 轮询失败退避 / 下载失败」
      const taskList = await page
        .evaluate<string>(
          () => document.querySelector('ul[aria-label="生成任务"]')?.textContent ?? '(无任务列表)'
        )
        .catch(() => '(读取失败)');
      const seen = requests.map((item) => `${item.method} ${item.path}`).join(', ');
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n任务列表: ${taskList}\nmock 请求: ${seen}`
      );
    }
    const submit = requests.find((item) => item.path === '/v1/video_generation');
    expect(submit?.auth).toBe(`Bearer ${API_KEY}`);
    expect(String(submit?.body.prompt)).toContain('青石镇镇口的老槐树');

    // 成片与提示词记录落盘
    const videoFile = fixture.resolve(...SCENE_DIR, '镜头1-v1.mp4');
    await page.waitUntil(() => existsSync(videoFile), { message: '镜头1-v1.mp4 已落盘' });
    expect((await readFile(videoFile)).equals(Buffer.from(mp4))).toBe(true);
    expect(existsSync(fixture.resolve(...SCENE_DIR, '镜头1-v1.prompt.json'))).toBe(true);
    // 分镜随修改自动保存为 分镜.json
    await page.waitUntil(() => existsSync(fixture.resolve(...SCENE_DIR, '分镜.json')), {
      message: '分镜.json 已保存',
    });

    // 右栏：预览播放器加载本地成片（blob 地址）
    await page.waitFor(
      () =>
        (
          document.querySelector('[data-testid="scene-video-preview"]') as HTMLVideoElement | null
        )?.src.startsWith('blob:'),
      { timeout: 15_000, message: '预览播放器出现' }
    );
    await page.waitForTarget({ text: 'v1', within: '[data-testid="scene-video-view"]' });
    await captureForReview(page, 'scene-video-done');
    // 宽布局（容器 > 1080px）才是三栏：折叠侧边栏后再截一张，结束时展开还原
    if (process.env.NOVEL_EDITOR_E2E_SCREENSHOT_DIR) {
      await page.click('[aria-label="折叠侧边栏"]');
      await page.waitForTarget('[title="展开侧边栏"]');
      await page.evaluate(() =>
        document.querySelector('[data-testid="scene-video-view"]')?.scrollTo?.(0, 0)
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      await captureForReview(page, 'scene-video-three-columns');
      await ensureSidebarOpen(page);
    }
  }, 120_000);
});
