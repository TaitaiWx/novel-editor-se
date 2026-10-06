/**
 * 小说编辑器 GUI 端到端测试
 *
 * 整个文件共用一个 Electron 实例（启动约 2~3 秒），用例按顺序执行并共享界面状态，
 * 因此每个用例开头都要自己把界面带到需要的位置（打开章节、展开面板等），不要依赖上一个用例的结尾。
 * 运行：pnpm test:e2e（会先构建）或 pnpm test:e2e:only（使用现有 dist）。
 */
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getTodayStats, readGuiSession } from '@novel-editor/core';
import {
  buildAppEnv,
  launchApp,
  spawnElectron,
  stopProcess,
  waitForExit,
  writeLogs,
  type ElectronApp,
} from './support/app';
import { createFixtureProject, FIXTURE_CHAPTERS, type FixtureProject } from './support/fixture';
import { type ConsoleIssue, type Page } from './support/page';
import {
  SEL,
  answerPrompt,
  confirmDialog,
  contextMenuAction,
  editorText,
  ensureRightPanelOpen,
  expandTreePath,
  focusEditorEnd,
  redo,
  statusBarStats,
  switchStorylineMode,
  treeTitles,
  undo,
  undoUntilGone,
  waitForEditorText,
  waitForWorkspace,
} from './support/workbench';

/** 已知且可接受的控制台错误（新增条目时写明原因） */
const ALLOWED_ISSUES: RegExp[] = [];

const CHAPTER_DIR = ['未分卷', 'novels', '星河旅人'];
/** 文件面板「成长档案」分区 / 成长档案工作区标签 / 成长卡标题 */
const GROWTH_SECTION = `${SEL.workspaceTree} section:has([aria-label="新建成长卡"])`;
const GROWTH_WORKSPACE = '[class*="growthWorkspace"]';
const GROWTH_TITLE = `${GROWTH_WORKSPACE} header`;
const GROWTH_HELP = '[role="dialog"][aria-label="成长档案使用说明"]';

let fixture: FixtureProject;
let app: ElectronApp;
let page: Page;

function unexpected(issues: ConsoleIssue[]): ConsoleIssue[] {
  return issues.filter((issue) => !ALLOWED_ISSUES.some((pattern) => pattern.test(issue.text)));
}

/**
 * 截图供人工检查样式：设置 NOVEL_EDITOR_E2E_SCREENSHOT_DIR 时额外复制一份到该目录
 * （默认只写入 e2e/.artifacts/）
 */
async function captureForReview(name: string): Promise<void> {
  const dir = process.env.NOVEL_EDITOR_E2E_SCREENSHOT_DIR;
  if (!dir) return;
  const shot = await page.screenshot(name);
  if (!shot) return;
  await mkdir(dir, { recursive: true });
  await copyFile(shot, path.join(dir, `${name}.png`));
}

/** 等待成长卡 JSON 满足条件 */
async function waitForSheet<T extends { exp: number; level: number }>(
  name: string,
  predicate: (sheet: T) => boolean,
  message: string
): Promise<T> {
  const file = fixture.resolve('资料/记忆/角色', `${name}.json`);
  return page.waitUntil(
    async () => {
      if (!existsSync(file)) return null;
      const data = JSON.parse(await readFile(file, 'utf-8')) as T;
      return predicate(data) ? data : null;
    },
    { message }
  );
}

/** 回答连续弹出的 Prompt 中标题为 title 的那一个，并等待它被下一个替换或关闭 */
async function answerChainedPrompt(title: string, value: string): Promise<void> {
  await page.waitForTarget({ text: title, within: SEL.dialog, exact: true });
  await page.evaluate((selector: string) => {
    const input = document.querySelector(selector) as HTMLInputElement;
    input.focus();
    input.select();
  }, SEL.dialogInput);
  await page.type(value);
  await page.waitFor(
    (selector: string, expected: string) =>
      (document.querySelector(selector) as HTMLInputElement | null)?.value === expected,
    { args: [SEL.dialogInput, value], message: `输入框内容为「${value}」` }
  );
  await page.click({ text: '确定', within: SEL.dialog, exact: true });
  await page.waitForGone({ text: title, within: SEL.dialog, exact: true });
}

/** 成长档案入口在左侧文件面板：若侧边栏被折叠（例如退出专注模式后），先展开 */
async function ensureSidebarOpen(): Promise<void> {
  if (await page.exists('[title="展开侧边栏"]')) {
    await page.click('[title="展开侧边栏"]');
  }
  await page.waitForTarget(SEL.workspaceTree);
}

async function readProjectFile(relative: string): Promise<string> {
  return readFile(fixture.resolve(relative), 'utf-8');
}

/** 打开「星河旅人」下的某一章并等待编辑器加载出内容 */
async function openChapter(title: string, expectText: string): Promise<void> {
  await expandTreePath(page, [...CHAPTER_DIR, title]);
  await page.click({ text: title, within: SEL.workspaceTree, exact: true });
  await waitForEditorText(page, expectText);
}

beforeAll(async () => {
  fixture = await createFixtureProject();
  app = await launchApp({ projectDir: fixture.root });
  page = app.page;
});

afterAll(async () => {
  await app?.close();
  await fixture?.dispose();
});

beforeEach(({ task, onTestFailed }) => {
  onTestFailed(async () => {
    const name = `${Date.now()}-${task.name}`;
    const shot = await page?.screenshot(name);
    if (app) await writeLogs(name, app.logs);
    if (shot) console.error(`[e2e] 失败截图: ${shot}`);
  });
});

afterEach(() => {
  // 每个用例结束时检查控制台错误 / 未捕获异常，出现非预期错误直接判定失败
  const issues = unexpected(page?.takeIssues() ?? []);
  expect(issues, `控制台出现非预期错误:\n${issues.map((i) => i.text).join('\n')}`).toEqual([]);
});

describe('小说编辑器 GUI', () => {
  it('1. 启动：主窗口打开 fixture 项目并展示章节', async () => {
    await waitForWorkspace(page, path.basename(fixture.root));
    await expandTreePath(page, [...CHAPTER_DIR, '001-启程']);
    const titles = await treeTitles(page);
    expect(titles).toEqual(
      expect.arrayContaining(['剑与诗', '星河旅人', '001-启程', '002-迷雾森林'])
    );
    expect(titles).toContain('资料');

    // 开发构建同样应能读到仓库里的 release-notes.json
    const changelog = await page.evaluate<string>(() =>
      window.electron.ipcRenderer.invoke('get-changelog')
    );
    expect(changelog).not.toContain('发布说明不可用');
    // 全新安装不是「刚更新」，不应自动弹出更新日志
    expect(await page.exists({ text: '更新日志', exact: true })).toBe(false);
  });

  it('2. 编辑章节：自动保存到磁盘，撤销 / 重做生效', async () => {
    await openChapter('001-启程', '林舟背起行囊');
    const original = await readProjectFile(FIXTURE_CHAPTERS.first.file);

    await focusEditorEnd(page);
    await page.type('新增一句话。');
    await waitForEditorText(page, '新增一句话。');

    // 2 秒防抖：立即检查时磁盘尚未写入
    expect(await readProjectFile(FIXTURE_CHAPTERS.first.file)).toBe(original);
    await page.waitUntil(
      async () => (await readProjectFile(FIXTURE_CHAPTERS.first.file)).includes('新增一句话。'),
      { timeout: 10_000, message: '自动保存写入磁盘' }
    );

    await undo(page);
    await page.waitFor(
      () =>
        !Array.from(document.querySelectorAll('.cm-line')).some((line) =>
          line.textContent?.includes('新增一句话。')
        ),
      { message: '撤销后文本消失' }
    );
    await redo(page);
    await waitForEditorText(page, '新增一句话。');

    // 撤销后再自动保存，磁盘恢复原文
    await undo(page);
    await page.waitUntil(
      async () => (await readProjectFile(FIXTURE_CHAPTERS.first.file)) === original,
      { timeout: 10_000, message: '撤销后自动保存恢复原文' }
    );
    expect(await editorText(page)).not.toContain('新增一句话。');
  });

  it('3. 文件操作：新建、重命名、删除与磁盘保持一致', async () => {
    const chapterDir = fixture.resolve('novels/星河旅人');
    await openChapter('002-迷雾森林', '森林里的雾气');

    // 新建章：落在当前章节所在目录
    await page.click('button[aria-label="新建"]');
    await page.click({ text: '新建章', within: SEL.menu, exact: true });
    await answerPrompt(page, '003-归来');
    await page.waitUntil(() => existsSync(path.join(chapterDir, '003-归来.md')), {
      message: '新章节写入磁盘',
    });
    await page.waitForTarget({ text: '003-归来', within: SEL.workspaceTree, exact: true });

    // 重命名：行内铅笔按钮
    await page.click('button[aria-label="修改 003-归来"]');
    await answerPrompt(page, '003-重逢');
    await page.waitUntil(() => existsSync(path.join(chapterDir, '003-重逢.md')), {
      message: '重命名写入磁盘',
    });
    expect(existsSync(path.join(chapterDir, '003-归来.md'))).toBe(false);
    await page.waitForTarget({ text: '003-重逢', within: SEL.workspaceTree, exact: true });

    // 右键菜单同样可以重命名
    await contextMenuAction(page, '003-重逢', '重命名');
    await answerPrompt(page, '003-再会');
    await page.waitUntil(() => existsSync(path.join(chapterDir, '003-再会.md')), {
      message: '右键重命名写入磁盘',
    });

    // 删除：右键菜单 + 确认对话框
    await contextMenuAction(page, '003-再会', '删除文件');
    await confirmDialog(page, '003-再会.md');
    await page.waitUntil(() => !existsSync(path.join(chapterDir, '003-再会.md')), {
      message: '文件已从磁盘删除',
    });
    await page.waitForGone({ text: '003-再会', within: SEL.workspaceTree, exact: true });
    expect((await readdir(chapterDir)).sort()).toEqual(['001-启程.md', '002-迷雾森林.md']);
  });

  it('4. 状态栏字数统计随输入变化', async () => {
    await openChapter('002-迷雾森林', '森林里的雾气');
    const original = await readProjectFile(FIXTURE_CHAPTERS.second.file);
    const before = await statusBarStats(page);
    expect(Number.isFinite(before.words)).toBe(true);

    await focusEditorEnd(page);
    await page.type('雾中传来脚步声');
    await page.waitFor(
      (selector: string, expected: number) => {
        const text = (document.querySelector(selector) as HTMLElement | null)?.innerText ?? '';
        const match = /(\d+)\s*字/.exec(text.replace(/\s+/g, ' '));
        return match ? Number(match[1]) === expected : false;
      },
      { args: [SEL.statusBar, before.words + 7], message: '字数 +7' }
    );

    await page.press('Enter');
    await page.type('二');
    await page.waitFor(
      (selector: string, expected: number) => {
        const text = (document.querySelector(selector) as HTMLElement | null)?.innerText ?? '';
        const match = /(\d+)\s*行/.exec(text.replace(/\s+/g, ' '));
        return match ? Number(match[1]) === expected : false;
      },
      { args: [SEL.statusBar, before.lines + 1], message: '行数 +1' }
    );

    // 字数同时写入磁盘后再还原，避免影响后续用例
    await page.waitUntil(
      async () => (await readProjectFile(FIXTURE_CHAPTERS.second.file)).includes('脚步声'),
      { timeout: 10_000, message: '输入后自动保存' }
    );
    await undoUntilGone(page, '脚步声');
    await page.waitUntil(
      async () => (await readProjectFile(FIXTURE_CHAPTERS.second.file)) === original,
      { timeout: 10_000, message: '还原后自动保存' }
    );
  });

  it('5. 右侧面板：各视图渲染无报错，专注模式下编辑器正常换行', async () => {
    await openChapter('001-启程', '林舟背起行囊');
    await ensureRightPanelOpen(page);

    const views: Array<[string, string]> = [
      ['本章大纲', '章纲'],
      ['卷规划', '剧情板'],
      ['三签卡', '三签创作法'],
      ['成长', '角色成长档案'],
      ['目录', '启程'],
    ];
    for (const [label, marker] of views) {
      await switchStorylineMode(page, label);
      await page.waitForTarget({ text: marker, within: SEL.storyline });
    }

    // 人物 / 设定中枢通过文件树右键「查看详情」打开
    await contextMenuAction(page, '角色', '查看详情');
    await page.waitForTarget({ text: '人物与关系' });
    await contextMenuAction(page, '设定', '查看详情');
    await page.waitForTarget({ text: '设定' });

    // 专注模式：长段落必须折行，不能出现横向滚动
    await openChapter('001-启程', '林舟背起行囊');
    const original = await readProjectFile(FIXTURE_CHAPTERS.first.file);
    await focusEditorEnd(page);
    await page.type('很长的一段话'.repeat(60));
    const measure = () =>
      page.evaluate<{ wrapping: boolean; overflow: number; lastLineHeight: number }>(() => {
        const scroller = document.querySelector('.cm-scroller') as HTMLElement;
        const lines = Array.from(document.querySelectorAll('.cm-content .cm-line'));
        return {
          wrapping:
            document.querySelector('.cm-content')?.classList.contains('cm-lineWrapping') ?? false,
          overflow: scroller.scrollWidth - scroller.clientWidth,
          lastLineHeight: lines[lines.length - 1]?.getBoundingClientRect().height ?? 0,
        };
      });

    await page.click('[title="进入专注模式 (F11)"]');
    await page.waitForTarget('[title="退出聚焦模式 (F11)"]');
    const focused = await measure();
    expect(focused.wrapping).toBe(true);
    expect(focused.overflow).toBeLessThanOrEqual(1);
    expect(focused.lastLineHeight).toBeGreaterThan(40);

    await page.click('[title="退出聚焦模式 (F11)"]');
    await page.waitForTarget('[title="进入专注模式 (F11)"]');
    const normal = await measure();
    expect(normal.overflow).toBeLessThanOrEqual(1);

    await undoUntilGone(page, '很长的一段话');
    await page.waitUntil(
      async () => (await readProjectFile(FIXTURE_CHAPTERS.first.file)) === original,
      { timeout: 10_000, message: '还原后自动保存' }
    );
  });

  it('6. 成长档案：首次使用 → 新建成长卡 → 引导 → 记一笔写入 JSON；推演 / 世界可达，使用说明可打开', async () => {
    const memoryDir = fixture.resolve('资料/记忆');
    await ensureSidebarOpen();
    await ensureRightPanelOpen(page);
    await switchStorylineMode(page, '成长');

    // 视图切换按钮在默认宽度与接近折叠阈值的窄宽度下都保持单行（不出现「目\n录」）
    const toggleLayout = () =>
      page.evaluate<{ multiLine: string[]; count: number }>(() => {
        const buttons = Array.from(
          document.querySelectorAll<HTMLElement>('[class*="storylineToolbar"] > button')
        );
        const lineHeight = (el: HTMLElement) => parseFloat(getComputedStyle(el).lineHeight) || 16;
        return {
          count: buttons.length,
          multiLine: buttons
            .filter((el) => el.clientHeight > lineHeight(el) * 1.6 + 8)
            .map((el) => el.innerText),
        };
      });
    expect(await toggleLayout()).toEqual({ count: 5, multiLine: [] });
    await captureForReview('storyline-toggle-default');
    const wrapperSelector = '[class*="rightPanelWrapper"]';
    const originalWidth = await page.evaluate<string>(
      (selector: string) => (document.querySelector(selector) as HTMLElement).style.width,
      wrapperSelector
    );
    await page.evaluate((selector: string) => {
      (document.querySelector(selector) as HTMLElement).style.width = '140px';
    }, wrapperSelector);
    expect(await toggleLayout()).toEqual({ count: 5, multiLine: [] });
    await page.evaluate(() =>
      document.querySelector('[class*="storylineToolbar"]')?.scrollIntoView({ block: 'center' })
    );
    await captureForReview('storyline-toggle-narrow');
    await page.evaluate(
      (selector: string, width: string) => {
        (document.querySelector(selector) as HTMLElement).style.width = width;
      },
      wrapperSelector,
      originalWidth
    );

    // 首次使用：右侧面板给出用途说明与「开始使用」
    await page.waitForTarget({ text: '开始使用', within: SEL.storyline, exact: true });
    await captureForReview('growth-v2-panel-setup');
    await page.click({ text: '开始使用', within: SEL.storyline, exact: true });
    await page.waitUntil(() => existsSync(path.join(memoryDir, '规则.json')), {
      message: '规则.json 已创建',
    });

    // 总览空状态：新建成长卡 / 查看使用说明
    await page.click('[aria-label="打开成长档案总览"]');
    await page.waitForTarget({ text: '还没有成长卡', within: GROWTH_WORKSPACE, exact: true });
    await captureForReview('growth-v2-overview-empty');
    await page.click({ text: '查看使用说明', within: GROWTH_WORKSPACE, exact: true });
    await page.waitForTarget({ text: '记一笔：每章写完 30 秒', within: GROWTH_HELP, exact: true });
    await captureForReview('growth-v2-help');
    await page.click('[aria-label="关闭使用说明"]');
    await page.waitForGone(GROWTH_HELP);

    await page.click({ text: '+ 新建成长卡', within: GROWTH_WORKSPACE, exact: true });
    await answerChainedPrompt('新建成长卡', '林舟');
    await page.waitForTarget({ text: '成长 · 林舟', exact: true });
    await page.waitForTarget({ text: '林舟', within: GROWTH_TITLE, exact: true });

    // 第一次打开成长卡：显示引导（左侧列表 → 记一笔 → 提醒 → 更多），看完后不再出现
    await page.waitForTarget('[role="dialog"][aria-label^="引导 1/"]');
    await captureForReview('growth-v2-tour');
    await page.click({ text: '下一步', exact: true });
    await page.waitForTarget('[role="dialog"][aria-label^="引导 2/"]');
    await captureForReview('growth-v2-tour-record');
    await page.click({ text: '跳过', exact: true });
    await page.waitForGone('[role="dialog"][aria-label^="引导"]');

    // 记一笔：章节默认取最近打开的正文章节（用例 5 打开了 001-启程）
    await page.click('[aria-label="为 林舟 记一笔"]');
    await page.waitForTarget('form[aria-label="为 林舟 记一笔"]');
    const chapterValue = await page.evaluate<string>(
      () =>
        (
          document.querySelector(
            'form[aria-label="为 林舟 记一笔"] input[aria-label="章节"]'
          ) as HTMLInputElement | null
        )?.value ?? ''
    );
    expect(chapterValue).toBe('1');
    await page.click('input[aria-label="获得多少经验"]');
    await page.type('500');
    await page.click('input[aria-label="发生了什么"]');
    await page.type('击败狼王');
    await captureForReview('growth-v2-record-open');
    await page.press('Enter');

    await page.waitForTarget({ text: '林舟 获得 500 经验，升到 Lv.2' });
    const sheetFile = path.join(memoryDir, '角色', '林舟.json');
    const sheet = await page.waitUntil(
      async () => {
        const data = JSON.parse(await readFile(sheetFile, 'utf-8')) as {
          name: string;
          level: number;
          exp: number;
          events: Array<{ type: string; delta?: number; chapter?: number; note?: string }>;
        };
        return data.exp === 500 ? data : null;
      },
      { message: '成长卡写入经验' }
    );
    expect(sheet).toMatchObject({ name: '林舟', level: 2, exp: 500 });
    expect(sheet.events).toEqual([
      expect.objectContaining({ type: 'exp', delta: 500, chapter: 1, note: '击败狼王' }),
    ]);
    expect(existsSync(path.join(memoryDir, '角色', '林舟.md'))).toBe(true);
    await page.waitForTarget({ text: 'Lv.2', within: GROWTH_WORKSPACE, exact: true });
    await page.waitForTarget({ text: '本级 200 / 600 · 距下一级 400', within: GROWTH_WORKSPACE });
    await page.waitForTarget({ text: '击败狼王', within: GROWTH_WORKSPACE, exact: true });
    await captureForReview('growth-v2-sheet-linzhou');

    // 世界：队伍 / 地图 / 规则
    await page.click({ text: '世界', within: GROWTH_WORKSPACE, exact: true });
    for (const [tab, marker] of [
      ['队伍', '组队历史'],
      ['地图', '地点'],
      ['规则', '核心规则'],
    ]) {
      await page.click({ text: tab, within: `${GROWTH_WORKSPACE} [role="tablist"]`, exact: true });
      await page.waitForTarget({ text: marker, within: GROWTH_WORKSPACE });
    }
    await captureForReview('growth-v2-world');

    // 推演：AI 未配置时友好提示，且不改动成长卡
    await page.click({ text: '推演', within: GROWTH_WORKSPACE, exact: true });
    await page.click({ text: '战士之道', exact: true });
    await page.click({ text: '法师之道', exact: true });
    await page.click({ text: '开始推演', exact: true });
    await page.waitForTarget('[role="alert"]', 20_000);
    const alertText = await page.evaluate<string>(
      () => (document.querySelector('[role="alert"]') as HTMLElement).innerText
    );
    expect(alertText).toMatch(/AI/);
    await captureForReview('growth-v2-simulate');
    const after = JSON.parse(await readFile(sheetFile, 'utf-8')) as { exp: number };
    expect(after.exp).toBe(500);
    await page.click({ text: '档案', within: GROWTH_WORKSPACE, exact: true });

    // 标题区的「?」打开使用说明
    await page.click(`${GROWTH_WORKSPACE} [aria-label="使用说明"]`);
    await page.waitForTarget(GROWTH_HELP);
    await page.press('Escape');
    await page.waitForGone(GROWTH_HELP);
  });

  it('7. 「⋯」菜单同步人物卡 / 设定到记忆文件夹', async () => {
    await ensureSidebarOpen();
    await page.click({ text: '林舟', within: GROWTH_SECTION, exact: true });
    await page.waitForTarget({ text: '林舟', within: GROWTH_TITLE, exact: true });
    await page.click(`${GROWTH_WORKSPACE} [aria-label="更多操作"]`);
    await captureForReview('growth-v2-more-menu');
    await page.click({ text: '同步人物卡 / 设定到记忆文件夹', within: SEL.menu, exact: true });
    await page.waitForTarget({ text: '已同步' });
    const memoryDir = fixture.resolve('资料/记忆');
    expect(existsSync(path.join(memoryDir, '角色卡'))).toBe(true);
    expect(existsSync(path.join(memoryDir, '设定'))).toBe(true);
  });

  it('8. 成长档案一级入口：文件面板新建 → 记一笔写入 JSON → 提醒 → 总览 → 右侧摘要', async () => {
    // 用例 6 已创建记忆库并为林舟建卡：分区中应列出林舟及其等级
    await ensureSidebarOpen();
    await page.waitForTarget({ text: '成长档案', within: SEL.workspaceTree, exact: true });
    await page.waitForTarget({ text: '林舟', within: GROWTH_SECTION, exact: true });
    await page.waitForTarget({ text: 'Lv.2', within: GROWTH_SECTION, exact: true });

    await page.click('[aria-label="新建成长卡"]');
    await answerChainedPrompt('新建成长卡', '白芷');
    await page.waitForTarget({ text: '成长 · 白芷', exact: true });
    await page.waitForTarget({ text: '白芷', within: GROWTH_TITLE, exact: true });
    await waitForSheet('白芷', (sheet) => sheet.exp === 0, '白芷 成长卡已创建');
    // 引导只出现一次
    expect(await page.exists('[role="dialog"][aria-label^="引导"]')).toBe(false);
    await page.waitForTarget({ text: '白芷', within: GROWTH_SECTION, exact: true });

    const recordExp = async (exp: string, chapter: string) => {
      await page.click('[aria-label="为 白芷 记一笔"]');
      await page.waitForTarget('form[aria-label="为 白芷 记一笔"]');
      // 聚焦章节框会全选，直接输入即可覆盖默认章节
      await page.click('form[aria-label="为 白芷 记一笔"] input[aria-label="章节"]');
      await page.type(chapter);
      await page.click('form[aria-label="为 白芷 记一笔"] input[aria-label="获得多少经验"]');
      await page.type(exp);
      await page.press('Enter');
      await page.waitForGone('form[aria-label="为 白芷 记一笔"]');
    };
    await recordExp('300', '2');
    await page.waitForTarget({ text: '白芷 获得 300 经验，升到 Lv.2' });

    const sheet = await waitForSheet<{
      exp: number;
      level: number;
      events: Array<{ type: string; delta?: number; chapter?: number }>;
    }>('白芷', (data) => data.exp === 300, '白芷 成长卡写入经验');
    expect(sheet.level).toBe(2);
    expect(sheet.events).toEqual([
      expect.objectContaining({ type: 'exp', delta: 300, chapter: 2 }),
    ]);
    await page.waitForTarget({ text: '本级 0 / 600 · 距下一级 600', within: GROWTH_WORKSPACE });
    // 写入后文件面板中的等级徽章同步刷新（白芷与林舟都是 Lv.2）
    await page.waitFor(
      (selector: string) =>
        (document.querySelector(selector) as HTMLElement | null)?.innerText.match(/Lv\.2/g)
          ?.length === 2,
      { args: [GROWTH_SECTION], message: '文件面板显示白芷 Lv.2' }
    );
    // 没有问题时不显示提醒
    expect(await page.exists('[aria-label="需要留意"]')).toBe(false);
    await captureForReview('growth-v2-sheet');

    // 同一章连升 2 级以上 → 出现提醒横幅，展开后看到原因与建议
    await recordExp('2400', '2');
    await waitForSheet('白芷', (data) => data.exp === 2700, '白芷 一章内连升');
    await page.waitForTarget(`${GROWTH_WORKSPACE} [aria-label="需要留意"]`);
    await page.click(`${GROWTH_WORKSPACE} [aria-label="需要留意"] button[aria-expanded="false"]`);
    await page.waitForTarget({ text: '连升 3 级', within: GROWTH_WORKSPACE });
    await captureForReview('growth-v2-warnings');

    // 点击已有档案：切换到对应角色的标签
    await page.click({ text: '林舟', within: GROWTH_SECTION, exact: true });
    await page.waitForTarget({ text: '成长 · 林舟', exact: true });
    await page.waitForTarget({ text: '林舟', within: GROWTH_TITLE, exact: true });

    // 总览：卡片网格 + 提醒圆点
    await page.click('[aria-label="打开成长档案总览"]');
    await page.waitForTarget({ text: '成长档案', within: '[class*="tabBar"]', exact: true });
    await page.waitForTarget('[aria-label="打开 白芷 的成长卡"]');
    await page.waitForTarget('[aria-label="打开 林舟 的成长卡"]');
    await captureForReview('growth-v2-overview');

    // 右侧面板：本章出场角色的摘要 + 记一笔
    await openChapter('001-启程', '林舟背起行囊');
    await ensureRightPanelOpen(page);
    await switchStorylineMode(page, '成长');
    await page.waitForTarget({ text: '本章出场', within: SEL.storyline });
    await page.waitForTarget(`${SEL.storyline} [aria-label="为 林舟 记一笔"]`);
    // 关掉堆叠的 toast，避免遮住右侧面板底部的摘要
    await page.evaluate(() => {
      document
        .querySelectorAll<HTMLButtonElement>('button[aria-label="关闭通知"]')
        .forEach((button) => button.click());
      document
        .querySelector('[class*="storylineView"] [aria-label="为 林舟 记一笔"]')
        ?.scrollIntoView({ block: 'center' });
    });
    await page.waitForGone('button[aria-label="关闭通知"]');
    await captureForReview('growth-v2-panel-summary');
    await switchStorylineMode(page, '目录');
  });

  it('9. 人物详情的「成长档案」按钮：为人物新建并打开成长卡', async () => {
    await contextMenuAction(page, '角色', '新建人物');
    // 新建人物会连续弹出三个对话框，answerPrompt 等待对话框消失的判定不适用，按标题逐个回答
    await answerChainedPrompt('新建人物', '莉娜');
    await answerChainedPrompt('人物定位', '法师');
    await answerChainedPrompt('人物分类', '次要角色');
    await page.waitForGone(SEL.dialog);
    // 新建人物后自动打开人物详情
    await page.waitForTarget('[aria-label="为 莉娜 新建成长档案"]', 15_000);
    await captureForReview('growth-entry-character-detail');
    await page.click('[aria-label="为 莉娜 新建成长档案"]');

    await page.waitForTarget({ text: '成长 · 莉娜', exact: true });
    await page.waitForTarget({ text: '莉娜', within: GROWTH_TITLE, exact: true });
    const sheet = await waitForSheet<{ exp: number; level: number; name: string }>(
      '莉娜',
      () => true,
      '莉娜 成长卡已创建'
    );
    expect(sheet).toMatchObject({ name: '莉娜', level: 1, exp: 0 });
    await page.waitForTarget({ text: '莉娜', within: GROWTH_SECTION, exact: true });

    // 回到人物详情：按钮显示等级
    await page.click({ text: '莉娜', within: '[class*="tabBar"]', exact: true });
    await page.waitForTarget('[aria-label="打开 莉娜 的成长档案"]');
    await captureForReview('growth-entry-filepanel');
  });

  it('10. GUI 与 CLI 共享：保存计入写作日志，会话文件反映打开 / 未保存的文件', async () => {
    // 前面场景的自动保存已经写入 .novel-editor/writing-log.json（ne stats today 读取同一份）
    const today = await getTodayStats(fixture.root);
    expect(today.writes).toBeGreaterThan(0);

    await openChapter('001-启程', '林舟背起行囊');
    const chapterPath = path.join(fixture.root, FIXTURE_CHAPTERS.first.file);
    const original = await readProjectFile(FIXTURE_CHAPTERS.first.file);
    const readSession = () => readGuiSession(fixture.root);

    // 会话文件：GUI 运行中，当前文件在打开列表里（ne status 读取同一份）
    await page.waitUntil(
      async () => {
        const { status, session } = await readSession();
        return status === 'active' && session?.activeFile === chapterPath;
      },
      { timeout: 5_000, message: '会话文件记录当前文件' }
    );

    // 输入后、自动保存前：会话里标记为未保存
    await focusEditorEnd(page);
    await page.type('会话测试。');
    await page.waitUntil(
      async () => (await readSession()).session?.dirtyFiles.includes(chapterPath) ?? false,
      { timeout: 3_000, message: '会话标记未保存文件' }
    );
    // 自动保存后：未保存列表清空，写作日志写入次数增加
    await page.waitUntil(async () => (await readSession()).session?.dirtyFiles.length === 0, {
      timeout: 10_000,
      message: '保存后会话清除未保存标记',
    });
    expect((await getTodayStats(fixture.root)).writes).toBeGreaterThan(today.writes);

    // 还原 fixture
    await undoUntilGone(page, '会话测试。');
    await page.waitUntil(
      async () => (await readProjectFile(FIXTURE_CHAPTERS.first.file)) === original,
      { timeout: 10_000, message: '还原后自动保存' }
    );
  });

  it('11. 关于：设置分区显示完整设备 ID；小窗口隐藏设备 ID，复制与上传日志同行并用 toast 反馈', async () => {
    const pkg = JSON.parse(await readFile(path.resolve(__dirname, '../package.json'), 'utf-8')) as {
      version: string;
    };
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const RUNNING =
      /^首次运行 \d{4}-\d{2}-\d{2} · 本次已运行 (不到 1 分钟|\d+ 分钟|\d+ 小时( \d+ 分)?)$/;
    const DIALOG = '[role="dialog"][aria-label="关于小说编辑器"]';
    const readText = (selector: string) =>
      page.evaluate<string>(
        (sel: string) => document.querySelector(sel)?.textContent?.trim() ?? '',
        selector
      );

    // 设置中心 →「关于」分区：行式布局，完整显示设备 ID
    await page.click('[aria-label="打开设置中心"]');
    await page.waitForTarget({ text: '设置中心', exact: true });
    await page.click({ text: '关于', within: '[class*="sidebar"]', exact: true });
    await page.waitForTarget('[data-testid="about-device-id"]');
    expect(await readText('[data-testid="about-version"]')).toBe(`版本 ${pkg.version}`);
    expect(await readText('[data-testid="about-runtime"]')).toMatch(RUNNING);
    const deviceId = await readText('[data-testid="about-device-id"]');
    expect(deviceId).toMatch(UUID);
    // 设备 ID 与 userData/device-id 文件一致
    expect((await readFile(path.join(app.userDataDir, 'device-id'), 'utf-8')).trim()).toBe(
      deviceId
    );
    await captureForReview('about-section');

    // 更新通道与崩溃自动上传开关移到「通用 → 更新与诊断」
    await page.click({ text: '通用', within: '[class*="sidebar"]', exact: true });
    await page.waitForTarget('[role="radiogroup"][aria-label="更新通道"]');
    await page.waitForTarget(
      '[role="switch"][aria-label="崩溃时自动上传日志"][aria-checked="true"]'
    );
    await page.evaluate(() => {
      document.querySelector('[role="radiogroup"][aria-label="更新通道"]')?.scrollIntoView();
    });
    await captureForReview('settings-update-group');
    await page.click('[aria-label="关闭设置"]');
    await page.waitForGone({ text: '设置中心', exact: true });

    // 状态栏版本面板 →「关于…」→ 关于小窗口
    await page.click({ text: `v${pkg.version}`, exact: true });
    await page.click({ text: '关于…', exact: true });
    await page.waitForTarget(DIALOG);
    await page.waitForTarget({ text: '复制设备 ID', within: DIALOG, exact: true });
    expect(await readText(`${DIALOG} [data-testid="about-runtime"]`)).toMatch(RUNNING);
    // 小窗口：宽度不超过 400px、内容不滚动、不显示设备 ID；关闭按钮不压住内容；两个按钮同一行等宽
    const layout = await page.evaluate<{
      width: number;
      scrolls: boolean;
      text: string;
      closeOverlaps: boolean;
      buttons: { top: number; width: number }[];
    }>((sel: string) => {
      const dialog = document.querySelector(sel) as HTMLElement;
      const scrolls = [dialog, ...Array.from(dialog.querySelectorAll<HTMLElement>('*'))].some(
        (el) =>
          el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY !== 'visible'
      );
      const close = (
        dialog.querySelector('[aria-label="关闭关于"]') as HTMLElement
      ).getBoundingClientRect();
      const content = Array.from(dialog.querySelectorAll<HTMLElement>('img, [data-testid]')).map(
        (el) => el.getBoundingClientRect()
      );
      const closeOverlaps = content.some(
        (r) =>
          r.left < close.right &&
          r.right > close.left &&
          r.top < close.bottom &&
          r.bottom > close.top
      );
      const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button'))
        .filter((b) => /复制设备 ID|上传日志/.test(b.textContent ?? ''))
        .map((b) => {
          const r = b.getBoundingClientRect();
          return { top: Math.round(r.top), width: Math.round(r.width) };
        });
      return {
        width: dialog.getBoundingClientRect().width,
        scrolls,
        text: dialog.innerText,
        closeOverlaps,
        buttons,
      };
    }, DIALOG);
    expect(layout.width).toBeLessThanOrEqual(400);
    expect(layout.scrolls).toBe(false);
    expect(layout.closeOverlaps).toBe(false);
    expect(layout.text).not.toContain(deviceId);
    expect(layout.text).not.toContain(deviceId.slice(0, 8));
    expect(layout.buttons).toHaveLength(2);
    expect(layout.buttons[0].top).toBe(layout.buttons[1].top);
    expect(Math.abs(layout.buttons[0].width - layout.buttons[1].width)).toBeLessThanOrEqual(1);
    for (const hidden of ['Electron', '数据目录', 'GitHub', '复制诊断信息', '更新通道']) {
      expect(layout.text).not.toContain(hidden);
    }
    await captureForReview('about-dialog');

    // 复制设备 ID（E2E 模式下主进程不写系统剪贴板）→ toast
    await page.click({ text: '复制设备 ID', within: DIALOG, exact: true });
    await page.waitForTarget({ text: '设备 ID 已复制', exact: true });
    await page.waitForTarget('[role="tooltip"]');
    expect(await readText('[role="tooltip"]')).toBe('复制本机设备 ID，用于问题排查与灰度分组');
    await captureForReview('about-dialog-copied');

    // 上传日志：E2E 未配置上传地址 → 打包保存到（重定向到测试 userData 的）下载目录，toast 提示
    await page.click({ text: '上传日志', within: DIALOG, exact: true });
    const status = await page.waitFor<string>(
      () => {
        const text = document.body.innerText;
        const match = /日志已打包到 下载\/\S+\.zip，可发送给我们/.exec(text);
        return match ? match[0] : null;
      },
      { timeout: 15_000, message: '日志打包完成 toast' }
    );
    expect(await page.exists({ text: '打包中…', within: DIALOG, exact: true })).toBe(false);
    const fileName = /下载\/(novel-editor-logs-\d{8}-\d{6}-[0-9a-f]{8}\.zip)/.exec(status)?.[1];
    expect(fileName, status).toBeTruthy();
    expect(fileName).toContain(deviceId.slice(0, 8));
    const zipPath = path.join(app.userDataDir, 'downloads', fileName as string);
    expect(existsSync(zipPath)).toBe(true);
    const zip = await JSZip.loadAsync(await readFile(zipPath));
    const entries = Object.keys(zip.files);
    expect(entries).toContain('diagnostics.json');
    expect(entries.some((name) => /\.(db|sqlite|md)$/i.test(name))).toBe(false);
    const diagnostics = JSON.parse(
      (await zip.file('diagnostics.json')?.async('string')) ?? '{}'
    ) as { deviceId: string; app: { version: string }; reason: string };
    expect(diagnostics).toMatchObject({
      deviceId,
      reason: 'manual',
      app: { version: pkg.version },
    });
    // 弹窗内仍不显示设备 ID 与内联状态
    expect(await readText(DIALOG)).not.toContain(deviceId);
    expect(await page.exists('[data-testid="about-upload-status"]')).toBe(false);
    await captureForReview('about-dialog-uploaded');

    await page.click('[aria-label="关闭关于"]');
    await page.waitForGone(DIALOG);
  });

  it('12. 资料：哈希 / GUID 文件名中间省略并保留扩展名，按类型显示图标、类型标签与悬停信息', async () => {
    await waitForWorkspace(page, path.basename(fixture.root));
    const materialDir = fixture.resolve('资料');
    const exts = ['png', 'jpg', 'mp4', 'mov', 'mp3', 'pdf', 'docx', 'xlsx', 'pptx', 'zip'];
    const moreExts = ['txt', 'md', 'json', 'webp', 'gif', 'wav', 'csv', 'heic', 'bin', 'm4a'];
    const names = [...exts, ...moreExts].map((ext, index) => {
      const hex = createHash('md5').update(`material-${index}`).digest('hex');
      if (index % 5 === 1) {
        // 带花括号的大写 GUID（Windows 剪贴板 / 微信导出常见）
        const guid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
        return `{${guid.toUpperCase()}}.${ext}`;
      }
      return `${hex}.${ext}`;
    });
    await Promise.all(
      names.map((name, index) =>
        writeFile(path.join(materialDir, name), 'x'.repeat(256 * (index + 1)), 'utf-8')
      )
    );

    interface RowReport {
      name: string;
      found: boolean;
      tail: string;
      tailFullyVisible: boolean;
      headTruncated: boolean;
      kindLabel: string;
      title: string;
    }
    const inspectRows = () =>
      page.evaluate<RowReport[]>((expected: string[]) => {
        const rows = Array.from(document.querySelectorAll<HTMLElement>('[class*="itemHeader"]'));
        return expected.map((name) => {
          const row = rows.find((element) => element.title.split('\n')[0] === name);
          const tail = row?.querySelector<HTMLElement>('[class*="itemNameTail"]');
          const head = row?.querySelector<HTMLElement>('[class*="itemNameHead"]');
          // 以文件名容器为边界：尾部被容器裁掉同样算不可见
          const rowRect = row?.querySelector('[class*="itemName"]')?.getBoundingClientRect();
          const tailRect = tail?.getBoundingClientRect();
          return {
            name,
            found: Boolean(row),
            tail: tail?.textContent ?? '',
            tailFullyVisible: Boolean(
              tail &&
                rowRect &&
                tailRect &&
                tail.scrollWidth <= tail.clientWidth + 1 &&
                tailRect.right <= rowRect.right + 0.5 &&
                tailRect.left >= rowRect.left - 0.5 &&
                tailRect.width > 0
            ),
            headTruncated: Boolean(head && head.scrollWidth > head.clientWidth),
            kindLabel: row?.querySelector('[class*="itemKind"]')?.textContent ?? '',
            title: row?.title ?? '',
          };
        });
      }, names);

    try {
      await contextMenuAction(page, '资料', '刷新资料');
      // 资料分区下是「资料」目录节点（目录行的悬停提示就是目录名），未展开时先展开
      const hashRowVisible = () =>
        page.evaluate<boolean>(
          (first: string) =>
            Array.from(document.querySelectorAll<HTMLElement>('[class*="itemHeader"]')).some(
              (row) => row.title.split('\n')[0] === first
            ),
          names[0]
        );
      if (!(await hashRowVisible())) {
        await page.click('[class*="itemHeader"][title="资料"]');
      }
      await page.waitFor(
        (first: string) =>
          Array.from(document.querySelectorAll<HTMLElement>('[class*="itemHeader"]')).some(
            (row) => row.title.split('\n')[0] === first
          ),
        { args: [names[0]], message: '资料列表出现哈希文件' }
      );
      // 文件大小 / 修改时间异步到达后写入悬停提示
      await page.waitFor(
        (first: string) =>
          Array.from(document.querySelectorAll<HTMLElement>('[class*="itemHeader"]')).some(
            (row) => row.title.startsWith(`${first}\n`) && row.title.includes('修改于')
          ),
        { args: [names[0]], message: '悬停提示包含修改时间' }
      );

      const reports = await inspectRows();
      for (const report of reports) {
        const ext = report.name.slice(report.name.lastIndexOf('.'));
        expect(report.found, `${report.name} 应出现在资料列表`).toBe(true);
        // 尾部 = 主名末 6 位 + 扩展名，且完整可见（扩展名不再被截掉）
        expect(report.tail.endsWith(ext), `${report.name} 尾部保留扩展名`).toBe(true);
        expect(report.tailFullyVisible, `${report.name} 扩展名完整可见`).toBe(true);
        expect(report.kindLabel, `${report.name} 显示类型标签`).not.toBe('');
        expect(report.title.split('\n')[0]).toBe(report.name);
      }
      // 侧栏宽度下哈希名确实被中间省略（而非整行显示）
      expect(reports.some((report) => report.headTruncated)).toBe(true);
      expect(reports.find((report) => report.name.endsWith('.mp4'))?.kindLabel).toBe('视频');
      expect(reports.find((report) => report.name.endsWith('.png'))?.kindLabel).toBe('图片');
      expect(reports.find((report) => report.name.endsWith('.bin'))?.kindLabel).toBe('BIN');

      await page.evaluate((first: string) => {
        Array.from(document.querySelectorAll<HTMLElement>('[class*="itemHeader"]'))
          .find((row) => row.title.split('\n')[0] === first)
          ?.scrollIntoView({ block: 'start' });
      }, names[0]);
      await captureForReview('material-hash-names');
    } finally {
      await Promise.all(names.map((name) => rm(path.join(materialDir, name), { force: true })));
      await contextMenuAction(page, '资料', '刷新资料');
      await page.waitFor(
        (first: string) =>
          !Array.from(document.querySelectorAll<HTMLElement>('[class*="itemHeader"]')).some(
            (row) => row.title.split('\n')[0] === first
          ),
        { args: [names[0]], message: '还原后哈希文件从资料列表消失' }
      );
    }
  });

  it('13. 单实例：第二次启动把文件夹转发给已有窗口', async () => {
    const other = await createFixtureProject('novel-editor-e2e-second-');
    try {
      await mkdir(other.resolve('novels/另一部作品'), { recursive: true });
      await writeFile(other.resolve('novels/另一部作品/001-开端.md'), '# 开端\n', 'utf-8');

      const second = spawnElectron([other.root], buildAppEnv(app.userDataDir));
      const exited = await waitForExit(second, 15_000);
      if (!exited) await stopProcess(second);
      expect(exited, '第二个实例应在转发后立即退出').toBe(true);

      await waitForWorkspace(page, path.basename(other.root));
      await expandTreePath(page, ['未分卷', 'novels', '另一部作品', '001-开端']);
      await page.waitForTarget({ text: '001-开端', within: SEL.workspaceTree, exact: true });
      // 原 Electron 进程仍在运行
      expect(app.process.exitCode).toBeNull();
    } finally {
      await other.dispose();
    }
  });
});
