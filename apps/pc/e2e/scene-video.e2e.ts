/**
 * 场景视频（独立的 Electron 实例 + 本地 mock 服务）
 *
 * mock 服务同时扮演：
 * - 文本服务（xAI Grok，OpenAI 兼容 /v1/chat/completions）：返回 4 个镜头的分镜 JSON；
 *   系统提示词带预演标记（PREVIZ_PROMPT_TAG）时返回 3D 预演脚本（PrevizScript）
 * - 视频服务（MiniMax 形状）：提交 → 第一次查询生成中 → 之后成功 → 取文件地址 → 下载测试内生成的小 MP4
 *
 * 流程（画布）：打开 001-启程 → 选中「第一场」正文 → 文件栏「场景视频」→ 自动用 AI 拆分镜（≥3 个镜头节点）
 * → 点镜头 1 节点上的「生成」→ 任务完成 → 成片落盘到 资料/视频/001-启程/第一场 清晨的青石镇/
 * → 节点显示成片、资料面板自动出现「视频」目录、分镜.md 自动写入、自动记录到本章章纲
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureForReview, ensureSidebarOpen, openChapter, setupAppSuite } from './support/suite';
import { createTinyMp4 } from './support/mp4-fixture';
import { PREVIZ_PROMPT_TAG } from '@novel-editor/ai/prompts';
import { comboboxSelector, selectedOptionText } from './support/select';

// 示例作品集里已经预先做好了这一场的场景视频：去掉它，从零走一遍「拆分镜 → 生成」
const suite = setupAppSuite({
  fixture: {
    prefix: 'novel-editor-e2e-scene-video-',
    exclude: ['novels/星河旅人/资料/视频/001-启程'],
  },
});

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

/** AI 实时写的关节轨迹：林舟举起右手挥手（循环） */
const WAVE_TRACKS = {
  rightUpperArm: [
    [0, 0, 0, -150],
    [0.25, 0, 0, -160],
    [0.5, 0, 0, -150],
  ],
  rightForearm: [
    [0, -20, 0, 25],
    [0.25, -20, 0, -25],
    [0.5, -20, 0, 25],
  ],
};

/** 3D 预演脚本：林舟从左走到中间回头挥手，镜头从全景推到中景 */
const PREVIZ_SCRIPT = {
  durationSec: 2,
  mood: 'dusk',
  summary: '林舟走到镇口回头',
  figures: [
    {
      name: '林舟',
      keys: [
        { t: 0, x: -1.5, z: 0, facing: 90, pose: 'walk' },
        {
          t: 1.5,
          x: 0,
          z: 0,
          facing: 90,
          pose: 'walk',
          motion: { tracks: WAVE_TRACKS, loop: true },
        },
        { t: 2, x: 0, z: 0, facing: 0, pose: 'look-back' },
      ],
    },
  ],
  camera: [
    { t: 0, shotSize: 'full', lens: 35 },
    { t: 2, shotSize: 'medium', lens: 35 },
  ],
  props: [{ kind: 'tree', x: 1.5, z: -2 }],
};

function isPrevizRequest(body: Record<string, unknown>): boolean {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const first: unknown = messages[0];
  return (
    typeof first === 'object' &&
    first !== null &&
    typeof (first as { content?: unknown }).content === 'string' &&
    (first as { content: string }).content.includes(PREVIZ_PROMPT_TAG)
  );
}

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
          choices: [
            {
              message: {
                content: JSON.stringify(isPrevizRequest(body) ? PREVIZ_SCRIPT : STORYBOARD),
              },
              finish_reason: 'stop',
            },
          ],
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
    // 视频服务已配置（工具栏出现下拉框）
    await page.waitForTarget(comboboxSelector('视频服务'));
    expect(await selectedOptionText(page, '视频服务')).toBe('MiniMax 海螺视频');
    // 画布：自动用 AI（Grok mock）拆分镜，不需要点任何按钮
    const SHOT_NODES = '[data-testid="scene-canvas"] [role="group"][aria-label^="镜头 "]';
    await page.waitFor((selector: string) => document.querySelectorAll(selector).length >= 3, {
      args: [SHOT_NODES],
      timeout: 15_000,
      message: 'AI 自动拆出至少 3 个镜头节点',
    });
    const chat = requests.find((item) => item.path === '/v1/chat/completions');
    expect(JSON.stringify(chat?.body.messages)).toContain('石板路还湿着');
    // 节点：人物 → 场景 → 镜头 → 样片，节点之间有连线
    for (const label of ['人物 林舟', '场景', '样片']) {
      await page.waitForTarget(
        `[data-testid="scene-canvas"] [role="group"][aria-label="${label}"]`
      );
    }
    expect(
      await page.evaluate<number>(
        () => document.querySelectorAll('[data-testid="scene-canvas"] path[data-edge]').length
      )
    ).toBeGreaterThanOrEqual(5);
    // 「生成 N 个镜头」只计还没有成片的镜头：4 × 6 秒 × ¥0.5
    await page.waitFor(
      () =>
        document.querySelector('[data-testid="scene-video-estimate"]')?.textContent ===
        '预计 ¥12.00 · 4 个镜头 · 共 24 秒',
      { message: '费用预估覆盖全部未生成的镜头' }
    );
    // 单击场景节点：右侧检查器显示场景正文（来自选区）
    await page.click('[data-testid="scene-canvas"] [role="group"][aria-label="场景"] p');
    await page.waitForTarget('[data-testid="scene-inspector"]');
    expect(
      await page.evaluate<string>(
        () =>
          (
            document.querySelector(
              '[data-testid="scene-inspector"] textarea'
            ) as HTMLTextAreaElement
          ).value
      )
    ).toContain('“舟哥！”');
    await captureForReview(page, 'scene-video-canvas');

    // 只生成镜头 1：直接点节点上的「生成」
    const generateShot1 = 'button[aria-label="生成镜头 1"]';
    await page.waitFor(
      (selector: string) =>
        !(document.querySelector(selector) as HTMLButtonElement | null)?.disabled,
      { args: [generateShot1], message: '镜头 1 的「生成」可用' }
    );
    await page.click(generateShot1);
    await page.waitUntil(() => requests.some((item) => item.path === '/v1/video_generation'), {
      timeout: 10_000,
      message: '镜头 1 已提交',
    });
    // 提交 → 轮询（第一次生成中，之后成功）→ 下载；轮询间隔 5 秒。完成后节点直接显示成片
    try {
      await page.waitFor(
        () =>
          (
            document.querySelector(
              '[role="group"][aria-label="镜头 1"] [data-testid="shot-video"]'
            ) as HTMLVideoElement | null
          )?.src.startsWith('blob:') ?? false,
        { timeout: 60_000, message: '镜头 1 节点显示成片' }
      );
    } catch (error) {
      const nodeText = await page
        .evaluate<string>(
          () =>
            document.querySelector('[role="group"][aria-label="镜头 1"]')?.textContent ?? '(无节点)'
        )
        .catch(() => '(读取失败)');
      const seen = requests.map((item) => `${item.method} ${item.path}`).join(', ');
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n镜头 1 节点: ${nodeText}\nmock 请求: ${seen}`
      );
    }
    // MiniMax 不支持生成声音：开关不可用，请求里也不带声音参数
    expect(
      await page.evaluate<boolean>(
        () =>
          (document.querySelector('[data-testid="scene-video-audio-toggle"]') as HTMLButtonElement)
            ?.disabled ?? false
      )
    ).toBe(true);
    const submit = requests.find((item) => item.path === '/v1/video_generation');
    expect(submit?.auth).toBe(`Bearer ${API_KEY}`);
    expect(String(submit?.body.prompt)).toContain('青石镇镇口的老槐树');
    expect('generate_audio' in (submit?.body ?? {})).toBe(false);
    // 出场人物的三视图 / 主要形象图作为参考图一起提交（MiniMax subject_reference）
    const subject = submit?.body.subject_reference as Array<{ image: string[] }> | undefined;
    expect(subject?.[0]?.image.length).toBeGreaterThan(0);
    expect(subject?.[0]?.image.every((url) => url.startsWith('data:image/webp;base64,'))).toBe(
      true
    );
    expect(requests.filter((item) => item.path === '/v1/video_generation')).toHaveLength(1);

    // 结果都在资料里：成片 + 提示词记录 + 自动保存的 分镜.json / 分镜.md（不需要手动导出）
    const videoFile = fixture.resolve(...SCENE_DIR, '镜头1-v1.mp4');
    await page.waitUntil(() => existsSync(videoFile), { message: '镜头1-v1.mp4 已落盘' });
    expect((await readFile(videoFile)).equals(Buffer.from(mp4))).toBe(true);
    expect(existsSync(fixture.resolve(...SCENE_DIR, '镜头1-v1.prompt.json'))).toBe(true);
    await page.waitUntil(() => existsSync(fixture.resolve(...SCENE_DIR, '分镜.md')), {
      message: '分镜.md 已自动写入',
    });
    // 第一个成片出现后自动在本章章纲里记录一次
    await page.waitUntil(
      async () => {
        const raw = await readFile(fixture.resolve(...SCENE_DIR, '分镜.json'), 'utf-8').catch(
          () => '{}'
        );
        return (JSON.parse(raw) as { outlineLinked?: boolean }).outlineLinked === true;
      },
      { timeout: 15_000, message: '分镜.json 记录已回链章纲' }
    );
    // 资料面板自动刷新：不用手动「刷新」就能看到 视频 目录
    await page.waitFor(
      () =>
        document.querySelector('section[aria-label="资料"]')?.textContent?.includes('视频') ??
        false,
      { timeout: 10_000, message: '资料里出现「视频」目录' }
    );
    // 「在资料中查看」：展开并定位到这一场的文件夹
    await page.click('button[aria-label="在资料中查看"]');
    await page.waitFor(
      (scene: string) =>
        document.querySelector('section[aria-label="资料"]')?.textContent?.includes(scene) ?? false,
      { args: [SCENE], timeout: 10_000, message: '资料中定位到场景文件夹' }
    );

    // 检查器：镜头 1 的版本与预览
    await page.click('[role="group"][aria-label="镜头 1"] p');
    await page.waitFor(
      () =>
        (
          document.querySelector('[data-testid="scene-video-preview"]') as HTMLVideoElement | null
        )?.src.startsWith('blob:') ?? false,
      { timeout: 15_000, message: '检查器预览播放器出现' }
    );
    await page.waitForTarget({ text: 'v1', within: '[data-testid="scene-inspector"]' });
    await captureForReview(page, 'scene-video-done');
    if (process.env.NOVEL_EDITOR_E2E_SCREENSHOT_DIR) {
      await page.click('[aria-label="折叠侧边栏"]');
      await page.waitForTarget('[title="展开侧边栏"]');
      await new Promise((resolve) => setTimeout(resolve, 300));
      await captureForReview(page, 'scene-video-canvas-wide');
      await ensureSidebarOpen(page);
    }
  }, 120_000);
  it('人物节点显示三视图；成片在编辑器旁边打开；3D 预演生成动画并保存为预演视频 + 首帧构图', async () => {
    const { page, fixture } = suite;
    // 示例人物带三视图：画布人物节点直接显示（生成视频时自动作为参考图）
    await page.waitFor(
      () =>
        Array.from(
          document.querySelectorAll<HTMLImageElement>(
            '[data-testid="scene-canvas"] [data-testid="character-turnaround"] img'
          )
        ).some((img) => img.naturalWidth > 0),
      { timeout: 10_000, message: '人物节点显示三视图' }
    );

    // 检查器「在旁边看」：成片在编辑器右侧的参考窗格里播放，可缩成小卡片、关闭
    await page.click('[role="group"][aria-label="镜头 1"] p');
    await page.click({ text: '在旁边看', within: '[data-testid="scene-inspector"]', exact: true });
    await page.waitFor(
      () =>
        (
          document.querySelector(
            '[data-testid="reference-pane"] [data-testid="reference-video"]'
          ) as HTMLVideoElement | null
        )?.src.startsWith('blob:') ?? false,
      { timeout: 15_000, message: '参考窗格播放成片' }
    );
    await captureForReview(page, 'reference-pane-video');
    await page.click('[data-testid="reference-pane"] [aria-label="缩成小卡片"]');
    await page.waitForTarget('[data-testid="reference-mini"]');
    await page.click('[data-testid="reference-mini"] [aria-label="关闭参考"]');
    await page.waitForGone('[data-testid="reference-mini"]');

    // 首帧：3D 预演 → 用 mock 文本服务生成预演脚本 → 播放 → 保存预演视频（镜头1-预演.mp4 + 第一帧 镜头1-预演.png）
    // 动作由 AI 实时写成关节轨迹（mock 文本服务的脚本里林舟挥手），不需要任何动作文件
    await page.waitForTarget('[data-testid="keyframe-section"]');
    await page.click({ text: '3D 预演', within: '[data-testid="keyframe-section"]', exact: true });
    await page.waitForTarget('[data-testid="previz-dialog"]');
    // 等舞台真正就绪（three.js 动态加载 + WebGL 上下文），没有 WebGL 的环境只验证提示
    const ready = await page.waitFor<'ready' | 'error'>(
      () => {
        const stage = document
          .querySelector('[data-testid="previz-dialog"]')
          ?.getAttribute('data-stage');
        return stage === 'ready' || stage === 'error' ? stage : null;
      },
      { timeout: 20_000, message: '3D 预演舞台就绪' }
    );
    if (ready === 'error') {
      // 没有 WebGL 的环境（部分 CI）：给出提示即可
      await page.click('[aria-label="关闭预演"]');
      await page.waitForGone('[data-testid="previz-dialog"]');
      return;
    }
    // 动作描述预填了镜头画面描述；模型下拉列出已配置的 Grok
    await page.waitFor(
      () =>
        (
          document.querySelector(
            '[data-testid="previz-dialog"] textarea'
          ) as HTMLTextAreaElement | null
        )?.value.includes('老槐树') ?? false,
      { timeout: 5_000, message: '动作描述预填画面描述' }
    );
    await page.waitFor(
      () =>
        document
          .querySelector('[data-testid="previz-dialog"] [role="combobox"][aria-label="预演模型"]')
          ?.textContent?.includes('Grok') ?? false,
      { timeout: 10_000, message: '模型下拉列出 Grok' }
    );
    const before = requests.filter((item) => isPrevizRequest(item.body)).length;
    await page.click({ text: '生成预演', within: '[data-testid="previz-dialog"]', exact: true });
    await page.waitForTarget(
      { text: PREVIZ_SCRIPT.summary, within: '[data-testid="previz-dialog"]' },
      15_000
    );
    const previzRequests = requests.filter((item) => isPrevizRequest(item.body));
    expect(previzRequests.length).toBe(before + 1);
    // 提示词列出了木偶关节与轨迹格式，不再有动作库 / BVH
    const previzBody = JSON.stringify(previzRequests[previzRequests.length - 1].body);
    expect(previzBody).toContain('rightUpperArm');
    expect(previzBody).toContain('motion.tracks');
    expect(previzBody).not.toMatch(/bvh|lib:|builtin:/i);
    // 生成后自动播放：进度在走
    await page.waitFor(
      () => {
        const text = document.querySelector('[data-testid="previz-time"]')?.textContent ?? '';
        return /^(?!0\.0s)\d+\.\ds \/ 2\.0s$/.test(text);
      },
      { timeout: 5_000, message: '预演在播放' }
    );
    await captureForReview(page, 'scene-video-previz');
    await page.click({ text: '保存预演视频', within: '[data-testid="previz-dialog"]' });
    // 没有可用编码器的环境：显示错误后关闭即可
    const outcome = await page.waitFor<'saved' | 'error'>(
      () => {
        const dialog = document.querySelector('[data-testid="previz-dialog"]');
        if (!dialog) return 'saved';
        return dialog.querySelector('[role="alert"]') ? 'error' : null;
      },
      { timeout: 60_000, message: '预演视频保存完成' }
    );
    if (outcome === 'error') {
      await page.click('[aria-label="关闭预演"]');
      await page.waitForGone('[data-testid="previz-dialog"]');
      return;
    }
    const mp4File = fixture.resolve(...SCENE_DIR, '镜头1-预演.mp4');
    const webmFile = fixture.resolve(...SCENE_DIR, '镜头1-预演.webm');
    const previzFile = fixture.resolve(...SCENE_DIR, '镜头1-预演.png');
    await page.waitUntil(
      () => existsSync(previzFile) && (existsSync(mp4File) || existsSync(webmFile)),
      {
        message: '镜头1-预演.mp4 与 镜头1-预演.png 已落盘',
      }
    );
    const png = await readFile(previzFile);
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    if (existsSync(mp4File)) {
      const video = await readFile(mp4File);
      expect(video.subarray(4, 8).toString('ascii')).toBe('ftyp');
      expect(video.length).toBeGreaterThan(1000);
    }
    await page.waitForTarget('[data-testid="keyframe-section"] img[alt$="预演第一帧"]', 10_000);
    await page.waitFor(
      () =>
        (
          document.querySelector('[data-testid="previz-video"]') as HTMLVideoElement | null
        )?.src.startsWith('blob:') ?? false,
      { timeout: 15_000, message: '检查器播放预演视频' }
    );
    await page.waitUntil(
      async () => {
        const raw = await readFile(fixture.resolve(...SCENE_DIR, '分镜.json'), 'utf-8');
        const state = JSON.parse(raw) as {
          previz?: Record<string, string>;
          previzVideo?: Record<string, string>;
          previzScripts?: Record<string, { durationSec?: number }>;
        };
        const scripts = JSON.stringify(state.previzScripts ?? {});
        return (
          scripts.includes(
            `"tracks":{"rightUpperArm":${JSON.stringify(WAVE_TRACKS.rightUpperArm)}`
          ) &&
          Object.values(state.previz ?? {}).some((value) => value.endsWith('镜头1-预演.png')) &&
          Object.values(state.previzVideo ?? {}).some((value) => /-\S*\.(mp4|webm)$/.test(value)) &&
          Object.values(state.previzScripts ?? {}).some((value) => value.durationSec === 2)
        );
      },
      {
        timeout: 10_000,
        message: '分镜.json 记录了预演第一帧、预演视频与脚本（含 AI 写的关节轨迹）',
      }
    );
  }, 120_000);
});
