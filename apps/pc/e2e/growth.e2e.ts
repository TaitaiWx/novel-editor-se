/**
 * 成长档案首次使用流程（独立的 Electron 实例）
 *
 * fixture 同样拷贝自示例作品集，但去掉了「星河旅人」预置的 `资料/记忆/`（成长档案跟随作品），从「开始使用」起验证：
 * 创建记忆库 → 新建成长卡 → 引导 → 记一笔 → 提醒 → 总览 → 右侧摘要 → 人物详情入口。
 * 预置成长档案的展示见 app.e2e.ts「示例作品集」用例。
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GROWTH_HELP,
  GROWTH_SECTION,
  GROWTH_TITLE,
  GROWTH_WORKSPACE,
  answerChainedPrompt,
  captureForReview,
  ensureSidebarOpen,
  openChapter,
  setupAppSuite,
  waitForSheet,
} from './support/suite';
import {
  SEL,
  contextMenuAction,
  ensureRightPanelOpen,
  selectWork,
  switchStorylineMode,
} from './support/workbench';
import { FIXTURE_MEMORY_DIR, FIXTURE_WORK } from './support/fixture';

const suite = setupAppSuite({
  fixture: { prefix: 'novel-editor-e2e-growth-', exclude: [FIXTURE_MEMORY_DIR] },
});

describe('成长档案：首次使用', () => {
  it('1. 成长档案：首次使用 → 新建成长卡 → 引导 → 记一笔写入 JSON；推演 / 世界可达，使用说明可打开', async () => {
    const { page, fixture } = suite;
    const memoryDir = fixture.resolve(FIXTURE_MEMORY_DIR);
    expect(existsSync(memoryDir), 'fixture 不含记忆库，模拟首次使用').toBe(false);
    // 「记一笔」的章节默认取最近打开的正文章节
    await openChapter(page, '001-启程', '林舟背起行囊');
    await ensureSidebarOpen(page);
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
    await captureForReview(page, 'storyline-toggle-default');
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
    await captureForReview(page, 'storyline-toggle-narrow');
    await page.evaluate(
      (selector: string, width: string) => {
        (document.querySelector(selector) as HTMLElement).style.width = width;
      },
      wrapperSelector,
      originalWidth
    );

    // 首次使用：右侧面板给出用途说明与「开始使用」
    await page.waitForTarget({ text: '开始使用', within: SEL.storyline, exact: true });
    await captureForReview(page, 'growth-v2-panel-setup');
    await page.click({ text: '开始使用', within: SEL.storyline, exact: true });
    await page.waitUntil(() => existsSync(path.join(memoryDir, '规则.json')), {
      message: '规则.json 已创建',
    });

    // 总览空状态：新建成长卡 / 查看使用说明
    await page.click('[aria-label="打开成长档案总览"]');
    await page.waitForTarget({ text: '还没有成长卡', within: GROWTH_WORKSPACE, exact: true });
    await captureForReview(page, 'growth-v2-overview-empty');
    await page.click({ text: '查看使用说明', within: GROWTH_WORKSPACE, exact: true });
    // 使用说明默认只展开「3 步上手」，进阶说明折叠
    await page.waitForTarget({ text: '3 步上手', within: GROWTH_HELP, exact: true });
    const helpState = await page.evaluate<{ details: number; open: number }>((sel: string) => {
      const items = Array.from(document.querySelectorAll(`${sel} details`));
      return {
        details: items.length,
        open: items.filter((item) => (item as HTMLDetailsElement).open).length,
      };
    }, GROWTH_HELP);
    expect(helpState.details).toBeGreaterThanOrEqual(5);
    expect(helpState.open).toBe(0);
    await page.click({ text: 'AI 推演', within: GROWTH_HELP, exact: true });
    await page.waitForTarget({ text: '需先在设置里开启 AI', within: GROWTH_HELP });
    await captureForReview(page, 'growth-v2-help');
    await page.click('[aria-label="关闭使用说明"]');
    await page.waitForGone(GROWTH_HELP);

    await page.click({ text: '+ 新建成长卡', within: GROWTH_WORKSPACE, exact: true });
    await answerChainedPrompt(page, '新建成长卡', '林舟');
    await page.waitForTarget({ text: '成长 · 林舟', exact: true });
    await page.waitForTarget({ text: '林舟', within: GROWTH_TITLE, exact: true });

    // 第一次打开成长卡：显示 3 步引导（记一笔 → 提醒 → 更多），看完后不再出现
    await page.waitForTarget('[role="dialog"][aria-label^="引导 1/"]');
    await captureForReview(page, 'growth-v2-tour');
    await page.click({ text: '下一步', exact: true });
    await page.waitForTarget('[role="dialog"][aria-label^="引导 2/"]');
    await captureForReview(page, 'growth-v2-tour-record');
    await page.click({ text: '跳过', exact: true });
    await page.waitForGone('[role="dialog"][aria-label^="引导"]');

    // 记一笔：章节默认取最近打开的正文章节（用例开头打开了 001-启程）
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
    await captureForReview(page, 'growth-v2-record-open');
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
    await captureForReview(page, 'growth-v2-sheet-linzhou');

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
    await captureForReview(page, 'growth-v2-world');

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
    await captureForReview(page, 'growth-v2-simulate');
    const after = JSON.parse(await readFile(sheetFile, 'utf-8')) as { exp: number };
    expect(after.exp).toBe(500);
    await page.click({ text: '档案', within: GROWTH_WORKSPACE, exact: true });

    // 标题区的「?」打开使用说明
    await page.click(`${GROWTH_WORKSPACE} [aria-label="使用说明"]`);
    await page.waitForTarget(GROWTH_HELP);
    await page.press('Escape');
    await page.waitForGone(GROWTH_HELP);
  });

  it('2. 「⋯」菜单同步人物卡 / 设定到记忆文件夹', async () => {
    const { page, fixture } = suite;
    await ensureSidebarOpen(page);
    await page.click({ text: '林舟', within: GROWTH_SECTION, exact: true });
    await page.waitForTarget({ text: '林舟', within: GROWTH_TITLE, exact: true });
    await page.click(`${GROWTH_WORKSPACE} [aria-label="更多操作"]`);
    await captureForReview(page, 'growth-v2-more-menu');
    await page.click({ text: '同步人物卡 / 设定到记忆文件夹', within: SEL.menu, exact: true });
    await page.waitForTarget({ text: '已同步' });
    const memoryDir = fixture.resolve(FIXTURE_MEMORY_DIR);
    expect(existsSync(path.join(memoryDir, '角色卡'))).toBe(true);
    expect(existsSync(path.join(memoryDir, '设定'))).toBe(true);
    // 只同步当前作品（星河旅人）的人物卡：《剑与诗》的沈砚不在这里
    expect(existsSync(path.join(memoryDir, '角色卡', '林舟.md'))).toBe(true);
    expect(existsSync(path.join(memoryDir, '角色卡', '沈砚.md'))).toBe(false);

    // 成长档案跟随作品：切到《剑与诗》看到它自己的成长卡，切回来仍是星河旅人的
    await selectWork(page, '剑与诗');
    await page.waitForTarget({ text: '沈砚', within: GROWTH_SECTION, exact: true });
    // 切换作品后列表立即只显示《剑与诗》的成长卡
    await page.waitForGone({ text: '林舟', within: GROWTH_SECTION, exact: true });
    // 「成长 · 林舟」标签仍开着：只提示新建，不能在《剑与诗》里凭空建出林舟的成长卡
    await page.waitForTarget({ text: '当前作品还没有「林舟」的成长卡', exact: true });
    expect(
      existsSync(fixture.resolve('novels', '剑与诗', '资料', '记忆', '角色', '林舟.json'))
    ).toBe(false);
    await selectWork(page, FIXTURE_WORK);
    await page.waitForTarget({ text: '林舟', within: GROWTH_SECTION, exact: true });
    await page.waitForGone({ text: '沈砚', within: GROWTH_SECTION, exact: true });
  });

  it('3. 成长档案一级入口：文件面板新建 → 记一笔写入 JSON → 提醒 → 总览 → 右侧摘要', async () => {
    const { page } = suite;
    // 用例 1 已创建记忆库并为林舟建卡：分区中应列出林舟及其等级
    await ensureSidebarOpen(page);
    await page.waitForTarget({ text: '成长档案', within: SEL.workspaceTree, exact: true });
    await page.waitForTarget({ text: '林舟', within: GROWTH_SECTION, exact: true });
    await page.waitForTarget({ text: 'Lv.2', within: GROWTH_SECTION, exact: true });

    await page.click('[aria-label="新建成长卡"]');
    await answerChainedPrompt(page, '新建成长卡', '白芷');
    await page.waitForTarget({ text: '成长 · 白芷', exact: true });
    await page.waitForTarget({ text: '白芷', within: GROWTH_TITLE, exact: true });
    await waitForSheet(suite, '白芷', (sheet) => sheet.exp === 0, '白芷 成长卡已创建');
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
    }>(suite, '白芷', (data) => data.exp === 300, '白芷 成长卡写入经验');
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
    await captureForReview(page, 'growth-v2-sheet');

    // 同一章连升 2 级以上 → 出现提醒横幅，展开后看到原因与建议
    await recordExp('2400', '2');
    await waitForSheet(suite, '白芷', (data) => data.exp === 2700, '白芷 一章内连升');
    await page.waitForTarget(`${GROWTH_WORKSPACE} [aria-label="需要留意"]`);
    await page.click(`${GROWTH_WORKSPACE} [aria-label="需要留意"] button[aria-expanded="false"]`);
    await page.waitForTarget({ text: '连升 3 级', within: GROWTH_WORKSPACE });
    await captureForReview(page, 'growth-v2-warnings');

    // 点击已有档案：切换到对应角色的标签
    await page.click({ text: '林舟', within: GROWTH_SECTION, exact: true });
    await page.waitForTarget({ text: '成长 · 林舟', exact: true });
    await page.waitForTarget({ text: '林舟', within: GROWTH_TITLE, exact: true });

    // 总览：卡片网格 + 提醒圆点
    await page.click('[aria-label="打开成长档案总览"]');
    await page.waitForTarget({ text: '成长档案', within: '[class*="tabBar"]', exact: true });
    await page.waitForTarget('[aria-label="打开 白芷 的成长卡"]');
    await page.waitForTarget('[aria-label="打开 林舟 的成长卡"]');
    await captureForReview(page, 'growth-v2-overview');

    // 右侧面板：本章出场角色的摘要 + 记一笔
    await openChapter(page, '001-启程', '林舟背起行囊');
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
    await captureForReview(page, 'growth-v2-panel-summary');
    await switchStorylineMode(page, '目录');
  });

  it('4. 人物详情的「成长档案」按钮：为人物新建并打开成长卡', async () => {
    const { page } = suite;
    await contextMenuAction(page, '角色', '新建人物');
    // 新建人物会连续弹出三个对话框，answerPrompt 等待对话框消失的判定不适用，按标题逐个回答
    await answerChainedPrompt(page, '新建人物', '莉娜');
    await answerChainedPrompt(page, '人物定位', '法师');
    await answerChainedPrompt(page, '人物分类', '次要角色');
    await page.waitForGone(SEL.dialog);
    // 新建人物后自动打开人物详情
    await page.waitForTarget('[aria-label="为 莉娜 新建成长档案"]', 15_000);
    await captureForReview(page, 'growth-entry-character-detail');
    await page.click('[aria-label="为 莉娜 新建成长档案"]');

    await page.waitForTarget({ text: '成长 · 莉娜', exact: true });
    await page.waitForTarget({ text: '莉娜', within: GROWTH_TITLE, exact: true });
    const sheet = await waitForSheet<{ exp: number; level: number; name: string }>(
      suite,
      '莉娜',
      () => true,
      '莉娜 成长卡已创建'
    );
    expect(sheet).toMatchObject({ name: '莉娜', level: 1, exp: 0 });
    await page.waitForTarget({ text: '莉娜', within: GROWTH_SECTION, exact: true });

    // 回到人物详情：按钮显示等级
    await page.click({ text: '莉娜', within: '[class*="tabBar"]', exact: true });
    await page.waitForTarget('[aria-label="打开 莉娜 的成长档案"]');
    await captureForReview(page, 'growth-entry-filepanel');
  });
});
