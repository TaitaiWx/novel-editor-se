/**
 * 一个 *.e2e.ts 文件 = 一个 Electron 实例 + 一份从示例作品集拷贝的 fixture。
 *
 * setupAppSuite 统一注册生命周期钩子：启动 / 关闭应用、失败截图与日志、
 * 每个用例结束时检查非预期的控制台错误。返回的对象在 beforeAll 之后可用。
 */
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import { launchApp, writeLogs, type ElectronApp } from './app';
import {
  FIXTURE_CHAPTER_TREE,
  FIXTURE_MEMORY_DIR,
  FIXTURE_WORK,
  createFixtureProject,
  type FixtureOptions,
  type FixtureProject,
} from './fixture';
import type { ConsoleIssue, Page } from './page';
import { SEL, expandTreePath, selectWork, waitForEditorText } from './workbench';

export interface AppSuite {
  readonly fixture: FixtureProject;
  readonly app: ElectronApp;
  readonly page: Page;
}

export interface SuiteOptions {
  fixture?: FixtureOptions;
  /** 已知且可接受的控制台错误（新增条目时写明原因） */
  allowedIssues?: RegExp[];
}

export function setupAppSuite(options: SuiteOptions = {}): AppSuite {
  let fixture: FixtureProject | undefined;
  let app: ElectronApp | undefined;
  const allowed = options.allowedIssues ?? [];
  const suite: AppSuite = {
    get fixture() {
      if (!fixture) throw new Error('fixture 尚未创建');
      return fixture;
    },
    get app() {
      if (!app) throw new Error('应用尚未启动');
      return app;
    },
    get page() {
      return suite.app.page;
    },
  };

  beforeAll(async () => {
    fixture = await createFixtureProject(options.fixture);
    app = await launchApp({ projectDir: fixture.root });
  });

  afterAll(async () => {
    await app?.close();
    await fixture?.dispose();
  });

  beforeEach(({ task, onTestFailed }) => {
    onTestFailed(async () => {
      const name = `${Date.now()}-${task.name}`;
      const shot = await app?.page.screenshot(name);
      if (app) await writeLogs(name, app.logs);
      if (shot) console.error(`[e2e] 失败截图: ${shot}`);
    });
  });

  afterEach(() => {
    // 每个用例结束时检查控制台错误 / 未捕获异常，出现非预期错误直接判定失败
    const issues = (app?.page.takeIssues() ?? []).filter(
      (issue: ConsoleIssue) => !allowed.some((pattern) => pattern.test(issue.text))
    );
    expect(issues, `控制台出现非预期错误:\n${issues.map((i) => i.text).join('\n')}`).toEqual([]);
  });

  return suite;
}

// ─── 通用高层操作 ───────────────────────────────────────────────────────────

/** 文件面板「成长档案」分区 / 成长档案工作区标签 / 成长卡标题 / 使用说明弹窗 */
/** 文件面板「角色」分区：人物与成长档案合为一体（人物行带等级徽章，只有成长卡的单独列出） */
export const GROWTH_SECTION = `${SEL.workspaceTree} section[aria-label="角色"]`;
export const GROWTH_WORKSPACE = '[class*="growthWorkspace"]';
export const GROWTH_TITLE = `${GROWTH_WORKSPACE} header`;
export const GROWTH_HELP = '[role="dialog"][aria-label="成长档案使用说明"]';
/** 从文件面板「角色」打开人物详情，切到「成长档案」分页（成长档案属于人物） */
export async function openCharacterGrowth(page: Page, name: string): Promise<void> {
  await page.click({ text: name, within: GROWTH_SECTION, exact: true });
  await page.waitForTarget('[role="tablist"][aria-label="人物详情"]');
  await page.click({ text: '成长档案', within: '[role="tablist"][aria-label="人物详情"]' });
  await page.waitForTarget({ text: name, within: GROWTH_TITLE, exact: true });
}

export const CHARACTER_OVERVIEW = '[data-testid="character-overview"]';
/** 文件面板「角色」头部的「人物总览」：人物维度（人物 / 成长 / 关系），切到指定分页 */
export async function openCharacterOverview(
  page: Page,
  tab: '人物' | '成长' | '关系' = '人物'
): Promise<void> {
  await page.click('[aria-label="打开人物总览"]');
  await page.waitForTarget(CHARACTER_OVERVIEW);
  await page.click({
    text: tab,
    within: `${CHARACTER_OVERVIEW} [role="tablist"]`,
    exact: true,
  });
  await page.waitForTarget(`${CHARACTER_OVERVIEW} [role="tabpanel"][aria-label="${tab}"]`);
}

/**
 * 截图供人工检查样式：设置 NOVEL_EDITOR_E2E_SCREENSHOT_DIR 时额外复制一份到该目录
 * （默认只写入 e2e/.artifacts/）
 */
export async function captureForReview(page: Page, name: string): Promise<void> {
  const dir = process.env.NOVEL_EDITOR_E2E_SCREENSHOT_DIR;
  if (!dir) return;
  const shot = await page.screenshot(name);
  if (!shot) return;
  await mkdir(dir, { recursive: true });
  await copyFile(shot, path.join(dir, `${name}.png`));
}

/** 打开「星河旅人 / 第一卷」下的某一章并等待编辑器加载出内容（先切到「星河旅人」） */
export async function openChapter(page: Page, title: string, expectText: string): Promise<void> {
  await selectWork(page, FIXTURE_WORK);
  await expandTreePath(page, [...FIXTURE_CHAPTER_TREE, title]);
  await page.click({ text: title, within: SEL.workspaceTree, exact: true });
  await waitForEditorText(page, expectText);
}

/** 成长档案入口在左侧文件面板：若侧边栏被折叠（例如退出专注模式后），先展开 */
export async function ensureSidebarOpen(page: Page): Promise<void> {
  if (await page.exists('[title="展开侧边栏"]')) {
    await page.click('[title="展开侧边栏"]');
  }
  await page.waitForTarget(SEL.workspaceTree);
}

/** 回答连续弹出的 Prompt 中标题为 title 的那一个，并等待它被下一个替换或关闭 */
export async function answerChainedPrompt(page: Page, title: string, value: string): Promise<void> {
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

/** 等待成长卡 JSON 满足条件 */
export async function waitForSheet<T extends { exp: number; level: number }>(
  suite: AppSuite,
  name: string,
  predicate: (sheet: T) => boolean,
  message: string
): Promise<T> {
  const file = suite.fixture.resolve(FIXTURE_MEMORY_DIR, '角色', `${name}.json`);
  return suite.page.waitUntil(
    async () => {
      if (!existsSync(file)) return null;
      const data = JSON.parse(await readFile(file, 'utf-8')) as T;
      return predicate(data) ? data : null;
    },
    { message }
  );
}
