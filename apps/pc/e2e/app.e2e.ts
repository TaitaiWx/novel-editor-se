/**
 * 小说编辑器 GUI 端到端测试
 *
 * 整个文件共用一个 Electron 实例（启动约 2~3 秒），用例按顺序执行并共享界面状态，
 * 因此每个用例开头都要自己把界面带到需要的位置（打开章节、展开面板等），不要依赖上一个用例的结尾。
 * 运行：pnpm test:e2e（会先构建）或 pnpm test:e2e:only（使用现有 dist）。
 */
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
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
import { PRIMARY_MODIFIER, type ConsoleIssue, type Page } from './support/page';
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
/** 文件面板「成长档案」分区 / 成长档案工作区标签 / 标签标题区 */
const GROWTH_SECTION = `${SEL.workspaceTree} section:has([aria-label="新建成长档案"])`;
const GROWTH_WORKSPACE = '[class*="viewWorkspace"]';
const GROWTH_HERO = 'section[aria-label="成长档案概览"]';

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
      { timeout: 6_000, message: '自动保存写入磁盘' }
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
      { timeout: 6_000, message: '撤销后自动保存恢复原文' }
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
      { timeout: 6_000, message: '输入后自动保存' }
    );
    await undoUntilGone(page, '脚步声');
    await page.waitUntil(
      async () => (await readProjectFile(FIXTURE_CHAPTERS.second.file)) === original,
      { timeout: 6_000, message: '还原后自动保存' }
    );
  });

  it('5. 右侧面板：各视图渲染无报错，专注模式下编辑器正常换行', async () => {
    await openChapter('001-启程', '林舟背起行囊');
    await ensureRightPanelOpen(page);

    const views: Array<[string, string]> = [
      ['本章大纲', '章纲'],
      ['卷规划', '剧情板'],
      ['三签卡', '三签创作法'],
      ['成长', '角色成长记录器'],
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
      { timeout: 6_000, message: '还原后自动保存' }
    );
  });

  it('6. 成长记录器：建卡、加经验写入 资料/记忆，子页可切换，AI 推演未配置时友好提示', async () => {
    const memoryDir = fixture.resolve('资料/记忆');
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

    await page.click({ text: '创建记忆库', exact: true });
    await page.waitUntil(() => existsSync(path.join(memoryDir, '规则.json')), {
      message: '规则.json 已创建',
    });

    await page.click('input[aria-label="新角色名"]');
    await page.type('林舟');
    await page.press('Enter');
    await page.waitForTarget({ text: '距下一级' });

    await page.click('input[aria-label="数值"]');
    await page.type('500');
    await page.click('input[aria-label="章节"]');
    await page.type('1');
    await page.click({ text: '记录', exact: true });

    await page.waitForTarget({ text: '林舟 升到 2 级' });
    const sheetFile = path.join(memoryDir, '角色', '林舟.json');
    const sheet = await page.waitUntil(
      async () => {
        const data = JSON.parse(await readFile(sheetFile, 'utf-8')) as {
          name: string;
          level: number;
          exp: number;
          events: Array<{ type: string; delta?: number; chapter?: number }>;
        };
        return data.exp === 500 ? data : null;
      },
      { message: '成长卡写入经验' }
    );
    expect(sheet).toMatchObject({ name: '林舟', level: 2, exp: 500 });
    expect(sheet.events).toEqual([
      expect.objectContaining({ type: 'exp', delta: 500, chapter: 1 }),
    ]);
    expect(existsSync(path.join(memoryDir, '角色', '林舟.md'))).toBe(true);
    // 页面展示等级与经验条：本级进度与累计经验分开标注
    await page.waitForTarget({ text: '本级 200 / 600 · 累计经验 500' });

    for (const [tab, marker] of [
      ['队伍', '组队历史'],
      ['地图', '地点'],
      ['规则', '核心规则'],
      ['角色卡', '距下一级'],
    ]) {
      await page.click({ text: tab, within: '[role="tablist"]', exact: true });
      await page.waitForTarget({ text: marker });
    }

    await page.click({ text: 'AI 推演', within: '[role="tablist"]', exact: true });
    await page.click({ text: '战士之道', exact: true });
    await page.click({ text: '法师之道', exact: true });
    await page.click({ text: '开始推演', exact: true });
    await page.waitForTarget('[role="alert"]', 20_000);
    const alertText = await page.evaluate<string>(
      () => (document.querySelector('[role="alert"]') as HTMLElement).innerText
    );
    expect(alertText).toMatch(/AI/);
    // 推演只产出提案，失败时不得改动成长卡
    const after = JSON.parse(await readFile(sheetFile, 'utf-8')) as { exp: number };
    expect(after.exp).toBe(500);
  });

  it('7. 记忆库同步生成 角色卡 / 设定 目录', async () => {
    await ensureRightPanelOpen(page);
    await switchStorylineMode(page, '成长');
    await page.click({ text: '同步到记忆文件夹', exact: true });
    await page.waitForTarget({ text: '已同步' });
    const memoryDir = fixture.resolve('资料/记忆');
    expect(existsSync(path.join(memoryDir, '角色卡'))).toBe(true);
    expect(existsSync(path.join(memoryDir, '设定'))).toBe(true);
  });

  it('8. 成长档案一级入口：文件面板分区新建 → 打开工作区标签 → 记录经验写入 JSON', async () => {
    // 用例 6 已创建记忆库并为林舟建卡：分区中应列出林舟及其等级
    await page.waitForTarget({ text: '成长档案', within: SEL.workspaceTree, exact: true });
    await page.waitForTarget({ text: '林舟', within: GROWTH_SECTION, exact: true });
    await page.waitForTarget({ text: 'Lv.2', within: GROWTH_SECTION, exact: true });

    await page.click('[aria-label="新建成长档案"]');
    await answerPrompt(page, '白芷');
    await page.waitForTarget({ text: '成长 · 白芷', exact: true });
    await page.waitForTarget({ text: '白芷', within: GROWTH_HERO, exact: true });
    await waitForSheet('白芷', (sheet) => sheet.exp === 0, '白芷 成长卡已创建');
    // 新建的档案出现在文件面板分区中
    await page.waitForTarget({ text: '白芷', within: GROWTH_SECTION, exact: true });

    await page.click(`${GROWTH_WORKSPACE} input[aria-label="数值"]`);
    await page.type('300');
    await page.click(`${GROWTH_WORKSPACE} input[aria-label="章节"]`);
    await page.type('2');
    await page.click({ text: '记录', within: GROWTH_WORKSPACE, exact: true });
    await page.waitForTarget({ text: '白芷 升到 2 级' });

    const sheet = await waitForSheet<{
      exp: number;
      level: number;
      events: Array<{ type: string; delta?: number; chapter?: number }>;
    }>('白芷', (data) => data.exp === 300, '白芷 成长卡写入经验');
    expect(sheet.level).toBe(2);
    expect(sheet.events).toEqual([
      expect.objectContaining({ type: 'exp', delta: 300, chapter: 2 }),
    ]);
    // 角色卡显示本级进度，头部显示累计经验，二者文案不再混淆
    await page.waitForTarget({ text: '本级 0 / 600 · 累计经验 300', within: GROWTH_WORKSPACE });
    await page.waitForTarget({ text: '累计经验 300', within: GROWTH_HERO, exact: true });
    // 写入后文件面板中的等级徽章同步刷新（白芷与林舟都是 Lv.2）
    await page.waitFor(
      (selector: string) =>
        (document.querySelector(selector) as HTMLElement | null)?.innerText.match(/Lv\.2/g)
          ?.length === 2,
      { args: [GROWTH_SECTION], message: '文件面板显示白芷 Lv.2' }
    );
    await captureForReview('growth-entry-tab');

    // 点击已有档案：切换到对应角色的标签
    await page.click({ text: '林舟', within: GROWTH_SECTION, exact: true });
    await page.waitForTarget({ text: '成长 · 林舟', exact: true });
    await page.waitForTarget({ text: '林舟', within: GROWTH_HERO, exact: true });

    // 快捷键打开总览
    await page.press('j', [PRIMARY_MODIFIER, 'Shift']);
    await page.waitForTarget({ text: '成长档案', within: '[class*="tabBar"]', exact: true });
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
    await page.waitForTarget({ text: '莉娜', within: GROWTH_HERO, exact: true });
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
      timeout: 6_000,
      message: '保存后会话清除未保存标记',
    });
    expect((await getTodayStats(fixture.root)).writes).toBeGreaterThan(today.writes);

    // 还原 fixture
    await undoUntilGone(page, '会话测试。');
    await page.waitUntil(
      async () => (await readProjectFile(FIXTURE_CHAPTERS.first.file)) === original,
      { timeout: 6_000, message: '还原后自动保存' }
    );
  });

  it('11. 单实例：第二次启动把文件夹转发给已有窗口', async () => {
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
