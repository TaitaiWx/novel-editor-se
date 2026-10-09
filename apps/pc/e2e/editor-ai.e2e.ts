/**
 * 编辑器 AI 辅助（独立的 Electron 实例 + 本地 mock 的 OpenAI 兼容 SSE 服务，配置为 Grok）
 *
 * 1. 人物悬停卡片：悬停「林舟」→ 卡片显示 Lv.4（来自 资料/记忆/ 成长卡）与别名，Esc 关闭
 * 2. 行内续写：⌥/Alt+\ → 幽灵文字流式出现（不进入文档）→ Tab 采纳 → 正文与磁盘都有，计入写作日志；一次撤销整体回退
 * 3. 续写面板：「续写」按钮 → 生成建议（可查看本次上下文）→ 放弃后正文与磁盘不变
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTodayStats } from '@novel-editor/core';
import { FIXTURE_CHAPTERS } from './support/fixture';
import { sleep } from './support/page';
import { captureForReview, openChapter, setupAppSuite } from './support/suite';
import { editorText, focusEditorEnd, undo } from './support/workbench';

const suite = setupAppSuite({ fixture: { prefix: 'novel-editor-e2e-editor-ai-' } });

const API_KEY = 'xai-e2e-editor-0001';
const CARD = '[data-testid="character-hover-card"]';
const WIDGET = '[data-testid="continuation-widget"]';
const GHOST_REPLY = ['雾气', '翻涌，', '林舟握紧了', '手中的剑。'];
const SUGGESTION_REPLY = ['远处', '传来一声', '悠长的狼嚎。'];

const requests: Array<{ body: Record<string, unknown> }> = [];
let reply = GHOST_REPLY;
let server: Server;
let baseUrl = '';

function handle(req: IncomingMessage, res: ServerResponse) {
  let raw = '';
  req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf-8')));
  req.on('end', () => {
    const body = JSON.parse(raw || '{}') as Record<string, unknown>;
    requests.push({ body });
    if (req.headers.authorization !== `Bearer ${API_KEY}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Incorrect API key provided' } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    // 片段之间留间隔，确认界面是流式更新的
    const pieces = reply.slice();
    const timer = setInterval(() => {
      const piece = pieces.shift();
      if (piece === undefined) {
        clearInterval(timer);
        res.end('data: [DONE]\n\n');
        return;
      }
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
    }, 60);
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

const chapterFile = () => path.join(suite.fixture.root, FIXTURE_CHAPTERS.first.file);
const readChapter = () => readFile(chapterFile(), 'utf-8');

/** 编辑器正文（不含续写 widget 的文字） */
function documentText(): Promise<string> {
  return suite.page.evaluate(() =>
    Array.from(document.querySelectorAll('.cm-content .cm-line'))
      .map((line) => {
        const clone = line.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('[data-testid="continuation-widget"]').forEach((el) => el.remove());
        return clone.textContent ?? '';
      })
      .join('\n')
  );
}

describe('编辑器 AI 辅助', () => {
  it('1. 悬停人物名弹出人物卡片：等级来自成长档案，Esc 关闭', async () => {
    const { page } = suite;
    await openChapter(page, FIXTURE_CHAPTERS.first.title, '林舟背起行囊');
    // 刚打开章节时悬停扩展（懒加载）与人物列表可能还没就绪，此时的一次 mousemove 不会弹卡片；
    // 真实用户的鼠标会持续移动，这里同样「移开再悬停」直到卡片出现
    const name = { text: '林舟', within: '.cm-content', exact: true } as const;
    await page.waitUntil(
      async () => {
        await page.mouseMove(1, 1);
        await page.hover(name);
        for (let i = 0; i < 10; i += 1) {
          await sleep(100);
          const ok = await page.evaluate<boolean>(
            (selector: string) =>
              Boolean(document.querySelector(selector)?.textContent?.includes('Lv.4')),
            CARD
          );
          if (ok) return true;
        }
        return false;
      },
      { timeout: 15_000, message: '人物卡片显示 Lv.4' }
    );
    const text = await page.evaluate<string>(
      (selector: string) => document.querySelector(selector)?.textContent ?? '',
      CARD
    );
    expect(text).toContain('林舟');
    expect(text).toContain('又名 阿舟');
    expect(text).toContain('主角团');
    expect(text).toContain('上次出场');
    await captureForReview(page, 'editor-ai-hover-card');
    await page.press('Escape');
    await page.waitForGone(CARD);
  });

  it('2. ⌥/Alt+\\ 行内续写：幽灵文字流式出现，Tab 采纳后写入正文并保存，一次撤销回退', async () => {
    const { page } = suite;
    // 通过 IPC 配置 Grok（Key 只写不读），地址指向本地 mock
    const configured = await page.evaluate<boolean>(
      async (url: string, key: string) => {
        const result = (await window.electron.ipcRenderer.invoke('ai-providers-set', 'grok', {
          apiKey: key,
          baseUrl: url,
          enabled: true,
        })) as { ok: boolean; data?: { configured: boolean } };
        return result.ok && Boolean(result.data?.configured);
      },
      baseUrl,
      API_KEY
    );
    expect(configured).toBe(true);

    const original = await readChapter();
    const writesBefore = (await getTodayStats(suite.fixture.root)).writes;
    reply = GHOST_REPLY;

    await focusEditorEnd(page);
    // 实时预览下光标所在行显示源码（例如「# 」），所以先把光标放到末尾再读取对照文本
    const before = await documentText();
    await page.press('\\', ['Alt']);
    await page.waitFor(
      (selector: string) =>
        Boolean(document.querySelector(selector)?.textContent?.includes('雾气翻涌')),
      { args: [WIDGET], message: '幽灵文字开始流式出现' }
    );
    await page.waitFor(
      (selector: string) =>
        Boolean(document.querySelector(selector)?.textContent?.includes('Tab 采纳')),
      { args: [WIDGET], message: '续写完成，提示 Tab 采纳' }
    );
    // 采纳前不进入文档
    expect(await documentText()).toBe(before);
    await captureForReview(page, 'editor-ai-ghost-text');

    // 请求走 Grok 流式接口，并带上了作品上下文
    const request = requests.at(-1)?.body ?? {};
    expect(request.stream).toBe(true);
    const prompt = JSON.stringify(request.messages);
    expect(prompt).toContain('前文');
    expect(prompt).toContain('成长档案');

    await page.press('Tab');
    await page.waitForGone(WIDGET);
    const accepted = GHOST_REPLY.join('');
    expect(await documentText()).toBe(`${before}${accepted}`);
    await page.waitUntil(async () => (await readChapter()).endsWith(accepted), {
      timeout: 10_000,
      message: '采纳的续写已自动保存',
    });
    await page.waitUntil(
      async () => (await getTodayStats(suite.fixture.root)).writes > writesBefore,
      { timeout: 5_000, message: '采纳计入写作日志' }
    );

    // 采纳是单独一步撤销
    await undo(page);
    await page.waitFor(
      (text: string) =>
        !Array.from(document.querySelectorAll('.cm-content .cm-line'))
          .map((line) => line.textContent ?? '')
          .join('\n')
          .includes(text),
      { args: [accepted], message: '一次撤销回退整段续写' }
    );
    await page.waitUntil(async () => (await readChapter()) === original, {
      timeout: 10_000,
      message: '撤销后磁盘恢复原文',
    });
  });

  it('3. 续写面板：生成建议并查看上下文，放弃后正文不变', async () => {
    const { page } = suite;
    const original = await readChapter();
    reply = SUGGESTION_REPLY;

    await focusEditorEnd(page);
    const before = await documentText();
    await page.click('[data-testid="continuation-pill"]');
    await page.waitForTarget('[data-testid="continuation-panel"]');
    await page.click({ text: '一句', within: '[role="radiogroup"]', exact: true });
    await page.click({ text: '生成建议', exact: true });
    await page.waitForTarget({ text: '采纳', within: WIDGET, exact: true }, 15_000);
    // 建议模式在流式过程中就显示「采纳」（允许提前采纳），这里等完整建议到达
    const suggestion = SUGGESTION_REPLY.join('');
    await page.waitFor(
      (selector: string, text: string) =>
        Boolean(document.querySelector(selector)?.textContent?.includes(text)),
      { args: [WIDGET, suggestion], timeout: 15_000, message: '完整建议已流式到达' }
    );
    expect(await editorText(page)).toContain(suggestion);
    expect(await documentText()).toBe(before);

    // 流结束（[DONE]）后面板才从「正在续写…」切回可再次生成，等完成态稳定后再操作下方上下文按钮
    await page.waitFor(
      () =>
        !document
          .querySelector('[data-testid="continuation-panel"]')
          ?.parentElement?.textContent?.includes('正在续写'),
      { message: '续写流结束' }
    );

    await page.click({ text: '查看本次上下文', exact: true });
    await page.waitForTarget({ text: '收起本次上下文', exact: true });
    const panel = await page.evaluate<string>(
      () => document.querySelector('[class*="contextBody"]')?.textContent ?? ''
    );
    expect(panel).toContain('xAI Grok');
    expect(panel).toContain('前文');
    await captureForReview(page, 'editor-ai-continuation-panel');

    await page.click({ text: '放弃', within: '[role="status"]', exact: true });
    await page.waitForGone(WIDGET);
    expect(await documentText()).toBe(before);
    await sleep(2500);
    expect(await readChapter()).toBe(original);
    await page.press('Escape');
  });
});
