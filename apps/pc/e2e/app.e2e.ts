/**
 * 小说编辑器 GUI 端到端测试
 *
 * fixture 是示例作品集（apps/pc/sample-data）的完整拷贝：首次启动展示给用户的内容就是 E2E 验证的内容。
 * 整个文件共用一个 Electron 实例（启动约 2~3 秒），用例按顺序执行并共享界面状态，
 * 因此每个用例开头都要自己把界面带到需要的位置（打开章节、展开面板等），不要依赖上一个用例的结尾。
 * 成长档案的「首次使用」流程需要不含记忆库的项目，见 growth.e2e.ts。
 * 运行：pnpm test:e2e（会先构建）。
 */
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { beforeAll, describe, expect, it } from 'vitest';
import { getTodayStats, readGuiSession } from '@novel-editor/core';
import {
  buildAppEnv,
  spawnElectron,
  stopProcess,
  waitForExit,
  type ElectronApp,
} from './support/app';
import {
  FIXTURE_CHAPTERS,
  FIXTURE_CHAPTER_TREE,
  FIXTURE_MATERIAL_DIR,
  FIXTURE_VOLUME_DIR,
  FIXTURE_WORK,
  createFixtureProject,
  type FixtureProject,
} from './support/fixture';
import { PRIMARY_MODIFIER, type Page } from './support/page';
import {
  CHARACTER_OVERVIEW,
  GROWTH_SECTION,
  GROWTH_TITLE,
  openCharacterGrowth,
  openCharacterOverview as openCharacterOverviewIn,
  GROWTH_WORKSPACE,
  captureForReview as captureShot,
  ensureSidebarOpen as ensureSidebarOpenIn,
  openChapter as openChapterIn,
  setupAppSuite,
} from './support/suite';
import {
  SEL,
  answerPrompt,
  confirmDialog,
  contextMenuAction,
  currentWork,
  editorText,
  ensureRightPanelOpen,
  commitInlineRename,
  expandTreePath,
  openProjectDocs,
  openProjectMenu,
  refreshWorkspace,
  renameByDoubleClick,
  searchGroup,
  searchWorkspace,
  selectWork,
  storyRow,
  focusEditorEnd,
  openInspiration,
  redo,
  statusBarStats,
  switchStorylineMode,
  type StorylineModeLabel,
  treeTitles,
  undo,
  undoUntilGone,
  waitForEditorText,
  waitForWorkspace,
  workspaceHeaderButtons,
} from './support/workbench';

const suite = setupAppSuite();
/** 示例作品集的作品名（.novel-editor/seed.json） */
const SAMPLE_PROJECT_NAME = '示例作品集';

// 用例中直接使用 fixture / app / page（setupAppSuite 的 beforeAll 先执行）
let fixture: FixtureProject;
let app: ElectronApp;
let page: Page;
beforeAll(() => {
  ({ fixture, app, page } = suite);
});

const captureForReview = (name: string) => captureShot(page, name);

/** 文件面板各对象分区（aria-label）；资料等分区标题上的数字是当前作品的条目数 */
const SECTION_CHARACTERS = `${SEL.workspaceTree} [aria-label="角色"]`;
const SECTION_LORE = `${SEL.workspaceTree} [aria-label="设定"]`;
const SECTION_MATERIALS = `${SEL.workspaceTree} [aria-label="资料"]`;
const sectionCount = (section: string) =>
  page.evaluate<string>(
    (selector: string) =>
      document.querySelector(`${selector} [class*="supportNodeCount"]`)?.textContent ?? '',
    section
  );
const openChapter = (title: string, expectText: string) => openChapterIn(page, title, expectText);
const ensureSidebarOpen = () => ensureSidebarOpenIn(page);

async function readProjectFile(relative: string): Promise<string> {
  return readFile(fixture.resolve(relative), 'utf-8');
}

describe('小说编辑器 GUI', () => {
  it('1. 启动：主窗口打开 fixture 项目并展示章节', async () => {
    // 示例项目首次打开时由 seed.json 写入作品记录，标题栏显示作品名而不是目录名
    await waitForWorkspace(page, SAMPLE_PROJECT_NAME);
    // ne init 项目：顶部作品切换器，默认第一部作品（按名称排序）
    await page.waitForTarget(SEL.workSwitcher);
    expect(await currentWork(page)).toBe('剑与诗');
    await selectWork(page, FIXTURE_WORK);
    await expandTreePath(page, [...FIXTURE_CHAPTER_TREE, '001-启程']);
    const titles = await treeTitles(page);
    expect(titles).toEqual(
      expect.arrayContaining([
        '第一卷-离乡',
        '第二卷-星海',
        '001-启程',
        '002-迷雾森林',
        '003-狼王之夜',
      ])
    );
    expect(titles).toContain('资料');
    // 正文只列当前作品的卷 / 章：不显示 novels 容器、作品节点、其他作品，也没有「未分卷」
    expect(titles).not.toContain('novels');
    expect(titles).not.toContain('未分卷');
    expect(titles).not.toContain('剑与诗');
    // 根目录说明文档在「搜索」左侧的「项目说明」图标里（不在正文树中）
    expect(titles).not.toContain('欢迎使用');
    expect(await page.exists(SEL.projectNotes)).toBe(false);

    // 顶部：项目名 | 项目说明 / 搜索 / 新建 / ⋯ 更多 | 折叠侧边栏（最右侧）；
    // 打开文件夹 / 刷新等收进「⋯」，没有铅笔按钮（双击项目名重命名）
    const headerButtons = await workspaceHeaderButtons(page);
    expect(headerButtons[0]).toBe('project-docs-trigger');
    expect(headerButtons[1]).toMatch(/^搜索文件/);
    expect(headerButtons.slice(2)).toEqual(['新建', 'project-menu-trigger', '折叠侧边栏']);
    for (const gone of ['修改作品名', '更换文件夹', '重新扫描作品目录']) {
      expect(headerButtons).not.toContain(gone);
    }
    expect(await page.exists('[aria-label$="（双击或按 F2 重命名）"]')).toBe(true);

    // 开发构建同样应能读到仓库里的 release-notes.json
    const changelog = await page.evaluate<string>(() =>
      window.electron.ipcRenderer.invoke('get-changelog')
    );
    expect(changelog).not.toContain('发布说明不可用');
    // 全新安装不是「刚更新」，不应自动弹出更新日志
    expect(await page.exists({ text: '更新日志', exact: true })).toBe(false);
  });

  it('2. 示例作品集开箱即用：欢迎使用、成长档案、人物与设定、幕剧与大纲都已预置', async () => {
    await ensureSidebarOpen();
    // 作品切换器：两部作品（星河旅人两卷六章、剑与诗两章），新建作品入口
    await page.click(SEL.workSwitcher);
    await page.waitForTarget(SEL.workList);
    const workOptions = await page.evaluate<string[]>(
      (selector: string) =>
        Array.from(document.querySelectorAll(`${selector} [role="option"]`)).map((node) =>
          (node as HTMLElement).innerText.replace(/\s+/g, '')
        ),
      SEL.workList
    );
    expect(workOptions).toEqual(['剑与诗2章', '星河旅人6章']);
    expect(await page.exists({ text: '新建作品', exact: true })).toBe(true);
    await captureForReview('sample-work-switcher');
    await page.press('Escape');
    await page.waitForGone(SEL.workList);

    // 《剑与诗》：自己的章节、人物、设定、成长档案与资料
    await selectWork(page, '剑与诗');
    expect((await storyRow(page, '001-少年')).text).toMatch(/^章 001-少年$/);
    await page.waitForTarget({ text: '沈砚', within: GROWTH_SECTION, exact: true });
    await page.waitForTarget({ text: '听雨楼诗人', within: SECTION_CHARACTERS, exact: true });
    await page.waitForTarget({ text: '听雨楼', within: SECTION_LORE, exact: true });
    expect(await page.exists({ text: '林舟', within: SECTION_CHARACTERS, exact: true })).toBe(
      false
    );
    expect(await page.exists({ text: '林舟', within: GROWTH_SECTION, exact: true })).toBe(false);
    expect(await sectionCount(SECTION_MATERIALS)).toBe('7');
    await captureForReview('sample-work-poem');

    // 《星河旅人》：卷 / 章徽章与统计；角色、设定、成长档案、资料随之切换
    await selectWork(page, FIXTURE_WORK);
    await expandTreePath(page, ['第二卷-星海', '004-星港城']);
    await captureForReview('sample-tree');
    expect((await storyRow(page, '第一卷-离乡')).text).toMatch(/^卷 第一卷-离乡 3章$/);
    expect((await storyRow(page, '第二卷-星海')).text).toMatch(/^卷 第二卷-星海 3章$/);
    expect(await page.exists({ text: '001-少年', within: SEL.workspaceTree, exact: true })).toBe(
      false
    );
    await page.waitForTarget({ text: '林舟', within: SECTION_CHARACTERS, exact: true });
    await page.waitForTarget({ text: '星河大陆', within: SECTION_LORE, exact: true });
    // 人物有形象图：行内显示图片头像（经 read-file-binary 读取的 data URL）
    await page.waitFor(
      (selector: string) =>
        Array.from(document.querySelectorAll<HTMLImageElement>(`${selector} img`)).some((img) =>
          img.src.startsWith('data:image/webp')
        ),
      { args: [SECTION_CHARACTERS], message: '人物行显示形象图头像' }
    );
    expect(await page.exists({ text: '沈砚', within: SECTION_CHARACTERS, exact: true })).toBe(
      false
    );
    expect(await page.exists({ text: '听雨楼', within: SECTION_LORE, exact: true })).toBe(false);
    expect(Number(await sectionCount(SECTION_MATERIALS))).toBeGreaterThan(10);

    // 「⋯ 更多」：在访达中显示、重命名项目、打开其他文件夹、打开最近使用、刷新（不含项目说明）
    await openProjectMenu(page);
    const revealLabel =
      process.platform === 'darwin'
        ? '在访达中显示'
        : process.platform === 'win32'
          ? '在资源管理器中显示'
          : '在文件管理器中显示';
    expect(await page.exists({ text: revealLabel, within: SEL.projectMenu, exact: true })).toBe(
      true
    );
    for (const item of ['重命名项目', '打开其他文件夹…', '打开最近使用', '刷新']) {
      expect(await page.exists({ text: item, within: SEL.projectMenu, exact: true })).toBe(true);
    }
    expect(await page.exists({ text: '项目说明', within: SEL.projectMenu })).toBe(false);
    await captureForReview('project-menu');
    await page.press('Escape');
    await page.waitForGone(SEL.projectMenu);

    // 欢迎使用.md 是项目文档，不是「章」：在「项目说明」图标的列表里（悬停像公告一样提示）
    await page.evaluate((sel: string) => {
      document
        .querySelector(sel)
        ?.parentElement?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    }, SEL.projectNotesTrigger);
    await page.waitFor(
      () => (document.querySelector('[role="tooltip"]')?.textContent ?? '').includes('欢迎使用'),
      { message: '项目说明图标的悬停提示列出文档' }
    );
    await openProjectDocs(page);
    expect(await page.exists({ text: '欢迎使用', within: SEL.projectNotes, exact: true })).toBe(
      true
    );
    expect(await page.exists({ text: '排版示例', within: SEL.projectNotes, exact: true })).toBe(
      true
    );
    await captureForReview('project-docs');
    await page.press('Escape');
    await page.waitForGone(SEL.projectNotes);

    // 长卷名：默认侧边栏宽度下省略显示，完整名称在悬停提示中；双击名称进入行内重命名
    const longVolume = '第三卷-群星尽头的漫长归途与未竟之约';
    await mkdir(fixture.resolve('novels/星河旅人', longVolume), { recursive: true });
    await writeFile(fixture.resolve('novels/星河旅人', longVolume, '007-归途.md'), '归途\n');
    try {
      await refreshWorkspace(page);
      await page.waitForTarget({ text: longVolume, within: SEL.workspaceTree, exact: true });
      expect(
        await page.evaluate<string>(
          (sel: string) => document.querySelector(sel)?.textContent ?? '',
          SEL.workSwitcher
        )
      ).toContain('7章');
      const titleClipped = await page.evaluate<boolean>(
        (selector: string, wanted: string) => {
          const node = Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
            (item) => item.textContent === wanted
          );
          return Boolean(node && node.scrollWidth > node.clientWidth && node.clientWidth > 60);
        },
        SEL.storyNodeTitle,
        longVolume
      );
      expect(titleClipped, '长卷名省略显示，且仍保留足够的可见宽度').toBe(true);
      expect(await page.exists(`button[aria-label="修改 ${longVolume}"]`)).toBe(false);
      await page.doubleClick({ text: longVolume, within: SEL.workspaceTree, exact: true });
      await page.waitFor(
        (selector: string, wanted: string) =>
          (document.querySelector(selector) as HTMLInputElement | null)?.value === wanted,
        { args: [SEL.renameInput, longVolume], message: '行内重命名输入框显示完整卷名' }
      );
      await captureForReview('tree-long-volume-rename');
      // Esc 取消，不改名
      await page.press('Escape');
      await page.waitForGone(SEL.renameInput);
      expect(existsSync(fixture.resolve('novels/星河旅人', longVolume))).toBe(true);
    } finally {
      await rm(fixture.resolve('novels/星河旅人', longVolume), { recursive: true, force: true });
      await refreshWorkspace(page);
      await page.waitForGone({ text: longVolume, within: SEL.workspaceTree, exact: true });
    }

    // 欢迎使用.md：功能导览（从「项目说明」列表打开）
    await openProjectDocs(page);
    await page.click({ text: '欢迎使用', within: SEL.projectNotes, exact: true });
    await waitForEditorText(page, '欢迎使用小说编辑器');
    await captureForReview('sample-welcome');

    // 成长档案：预置林舟 / 苏晴两张成长卡
    await page.waitForTarget({ text: '林舟', within: GROWTH_SECTION, exact: true });
    await page.waitForTarget({ text: '苏晴', within: GROWTH_SECTION, exact: true });
    await page.waitForTarget({ text: 'Lv.4', within: GROWTH_SECTION, exact: true });
    await page.waitForTarget({ text: 'Lv.3', within: GROWTH_SECTION, exact: true });
    await page.evaluate((selector: string) => {
      document.querySelector(selector)?.scrollIntoView({ block: 'center' });
    }, GROWTH_SECTION);
    await captureForReview('sample-growth-list');

    // 成长档案属于人物：点人物 → 人物详情 →「成长档案」分页
    await openCharacterGrowth(page, '林舟');
    // 本实例第一次打开成长卡会显示引导，跳过即可（引导本身在 growth.e2e.ts 中验证）
    await page.waitForTarget('[role="dialog"][aria-label^="引导 1/"]');
    await page.click({ text: '跳过', exact: true });
    await page.waitForGone('[role="dialog"][aria-label^="引导"]');
    await page.waitForTarget({ text: 'Lv.4', within: GROWTH_WORKSPACE, exact: true });
    await page.waitForTarget({ text: '斩杀独眼狼王', within: GROWTH_WORKSPACE, exact: true });
    // 被遗忘的配角提醒：秦伯 / 小石头与林舟同过队，已 5 章未出场
    await page.waitForTarget(`${GROWTH_WORKSPACE} [aria-label="需要留意"]`);
    await captureForReview('sample-growth-sheet');

    await openCharacterOverviewIn(page, '成长');
    await page.waitForTarget('[aria-label="打开 林舟 的成长卡"]');
    await page.waitForTarget('[aria-label="打开 苏晴 的成长卡"]');
    await captureForReview('sample-growth-overview');

    // 人物与设定：来自 .novel-editor/seed.json，首次打开项目时写入数据库
    // 人物总览（人物维度）：每个人物一张卡片，「关系」分页里是人物编辑与关系网络
    await contextMenuAction(page, '角色', '查看详情');
    await page.waitForTarget(CHARACTER_OVERVIEW);
    await page.click({
      text: '人物',
      within: `${CHARACTER_OVERVIEW} [role="tablist"]`,
      exact: true,
    });
    for (const name of ['林舟', '苏晴', '白鸦', '秦伯']) {
      await page.waitForTarget(`${CHARACTER_OVERVIEW} [aria-label="打开人物 ${name}"]`);
    }
    await captureForReview('sample-character-overview');
    await page.click({
      text: '关系',
      within: `${CHARACTER_OVERVIEW} [role="tablist"]`,
      exact: true,
    });
    await page.waitForTarget({ text: '秦伯', within: `${CHARACTER_OVERVIEW} [role="tabpanel"]` });
    await captureForReview('sample-characters');
    await contextMenuAction(page, '设定', '查看详情');
    await page.waitForTarget({ text: '星河大陆', exact: true });
    await captureForReview('sample-lore');

    // 卷纲：从本卷章节里的「第X幕 / 第X场」自动推导
    await openChapter('003-狼王之夜', '月亮升起来的时候');
    await ensureRightPanelOpen(page);
    await switchStorylineMode(page, '卷纲');
    await page.waitForTarget({ text: '第三幕 狼王之夜', within: SEL.storyline });
    await captureForReview('sample-acts');

    // 章纲：001-启程 预置两条
    await openChapter('001-启程', '林舟背起行囊');
    await switchStorylineMode(page, '章纲');
    await page.waitForTarget({ text: '第二场 铁匠铺的夜', within: SEL.storyline });
    await captureForReview('sample-chapter-outline');
    await switchStorylineMode(page, '目录');

    // 打开另一部作品的章节时，当前作品自动切过去（切回原作品的标签也一样）
    await selectWork(page, '剑与诗');
    await page.click({ text: '001-少年', within: SEL.workspaceTree, exact: true });
    await waitForEditorText(page, '少年握紧了手中的木剑');
    await selectWork(page, FIXTURE_WORK);
    // 标签多时可能在标签栏可见区域之外：先滚到可见再点
    await page.evaluate((title: string) => {
      document
        .querySelector(`[title="${title}"]`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return true;
    }, fixture.resolve(FIXTURE_CHAPTERS.other.file));
    await page.click({ text: fixture.resolve(FIXTURE_CHAPTERS.other.file), exact: true });
    await page.waitFor(
      (sel: string) => document.querySelector(`${sel} [class*="name"]`)?.textContent === '剑与诗',
      { args: [SEL.workSwitcher], message: '打开《剑与诗》的章节后当前作品切换为剑与诗' }
    );
    await page.click({ text: fixture.resolve(FIXTURE_CHAPTERS.first.file), exact: true });
    await page.waitFor(
      (sel: string) => document.querySelector(`${sel} [class*="name"]`)?.textContent === '星河旅人',
      { args: [SEL.workSwitcher], message: '切回星河旅人的标签后当前作品切回' }
    );
  });

  it('3. 编辑章节：自动保存到磁盘，撤销 / 重做生效', async () => {
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

  it('4. 文件操作：新建、重命名、删除与磁盘保持一致', async () => {
    const chapterDir = fixture.resolve(FIXTURE_VOLUME_DIR);
    const before = (await readdir(chapterDir)).sort();
    await openChapter('002-迷雾森林', '森林里的雾气');

    // 新建章：落在当前章节所在目录
    await page.click('button[aria-label="新建"]');
    await page.click({ text: '新建章', within: SEL.menu, exact: true });
    await answerPrompt(page, '003-归来');
    await page.waitUntil(() => existsSync(path.join(chapterDir, '003-归来.md')), {
      message: '新章节写入磁盘',
    });
    await page.waitForTarget({ text: '003-归来', within: SEL.workspaceTree, exact: true });

    // 重命名：双击名称行内编辑（没有铅笔按钮），回车提交，扩展名自动保留
    expect(await page.exists('button[aria-label="修改 003-归来"]')).toBe(false);
    await renameByDoubleClick(page, '003-归来', '003-重逢');
    await page.waitUntil(() => existsSync(path.join(chapterDir, '003-重逢.md')), {
      message: '双击重命名写入磁盘',
    });
    expect(existsSync(path.join(chapterDir, '003-归来.md'))).toBe(false);
    await page.waitForTarget({ text: '003-重逢', within: SEL.workspaceTree, exact: true });

    // F2：选中（聚焦）行后按 F2 行内重命名
    await page.click({ text: '003-重逢', within: SEL.workspaceTree, exact: true });
    await page.press('F2');
    await commitInlineRename(page, '003-重聚');
    await page.waitUntil(() => existsSync(path.join(chapterDir, '003-重聚.md')), {
      message: 'F2 重命名写入磁盘',
    });
    await page.waitForTarget({ text: '003-重聚', within: SEL.workspaceTree, exact: true });

    // 右键菜单同样可以重命名（对话框）
    await contextMenuAction(page, '003-重聚', '重命名');
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
    expect((await readdir(chapterDir)).sort()).toEqual(before);
  });

  it('5. 状态栏字数统计随输入变化', async () => {
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

  it('6. 右侧面板：各视图渲染无报错，专注模式下编辑器正常换行、渐进淡化、Esc 退出', async () => {
    await openChapter('001-启程', '林舟背起行囊');
    await ensureRightPanelOpen(page);

    // 「大纲」面板只有 目录 / 章纲 / 卷纲 三个视图，标题与右侧按钮垂直居中对齐
    const header = await page.evaluate<{ toggles: string[]; offset: number }>(() => {
      const toggles = Array.from(
        document.querySelectorAll<HTMLElement>('[class*="storylineToolbar"] > button')
      ).map((button) => button.innerText.trim());
      const title = document.querySelector<HTMLElement>('[class*="panelTitle"]');
      const collapse = document.querySelector<HTMLElement>(
        '[data-pane="right"] [title="折叠面板"]'
      );
      const center = (el: HTMLElement | null) => {
        const rect = el?.getBoundingClientRect();
        return rect ? rect.top + rect.height / 2 : NaN;
      };
      return { toggles, offset: Math.abs(center(title) - center(collapse)) };
    });
    expect(header.toggles).toEqual(['目录', '章纲', '卷纲']);
    expect(header.offset).toBeLessThanOrEqual(2);
    expect(await page.exists({ text: '当前章人物', within: '[data-pane="right"]' })).toBe(false);
    // 目录跟随当前章（面板折叠期间切换过文件，展开后也必须是 001-启程 的目录）
    await page.waitForTarget({ text: '第一幕 离乡', within: '[data-pane="right"]' });
    expect(
      await page.exists({ text: '迷雾森林', within: '[data-pane="right"]', exact: true })
    ).toBe(false);
    await captureForReview('right-panel-outline');

    const views: Array<[StorylineModeLabel, string]> = [
      ['章纲', '章纲'],
      ['卷纲', '生成卷纲'],
      ['目录', '启程'],
    ];
    for (const [label, marker] of views) {
      await switchStorylineMode(page, label);
      await page.waitForTarget({ text: marker, within: SEL.storyline });
    }

    // 人物 / 设定中枢通过文件树右键「查看详情」打开
    await contextMenuAction(page, '角色', '查看详情');
    await page.waitForTarget(CHARACTER_OVERVIEW);
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

    const EXIT_FOCUS = '[title="退出聚焦模式 (Esc / F11)"]';
    const ENTER_FOCUS = '[title="进入专注模式 (F11)"]';
    await page.click(ENTER_FOCUS);
    await page.waitForTarget(EXIT_FOCUS);
    const focused = await measure();
    expect(focused.wrapping).toBe(true);
    expect(focused.overflow).toBeLessThanOrEqual(1);
    expect(focused.lastLineHeight).toBeGreaterThan(40);

    // 渐进淡化：光标段落全亮，上方第 1~2 段清晰可读，第 5 段及更远处明显变淡（读计算样式，等待过渡结束）
    const readFade = () =>
      page.evaluate<{ active: number; near: number[]; far: number[]; blurred: boolean }>(() => {
        const lines = Array.from(document.querySelectorAll<HTMLElement>('.cm-content > .cm-line'));
        const opacity = (el: HTMLElement) => Number(getComputedStyle(el).opacity);
        const index = lines.findIndex((line) => line.classList.contains('cm-focus-d0'));
        const near: number[] = [];
        const far: number[] = [];
        let distance = 0;
        for (let i = index - 1; index > 0 && i >= 0; i -= 1) {
          if (!lines[i].textContent?.trim()) continue;
          distance += 1;
          if (distance <= 2) near.push(opacity(lines[i]));
          else if (distance >= 5) far.push(opacity(lines[i]));
        }
        return {
          active: index < 0 ? -1 : opacity(lines[index]),
          near,
          far,
          blurred: lines.some((line) => getComputedStyle(line).filter.includes('blur')),
        };
      });
    const fade = await page.waitUntil(
      async () => {
        const value = await readFade();
        const settled =
          value.active === 1 &&
          value.near.length === 2 &&
          value.near.every((o) => o >= 0.6) &&
          value.far.length > 0 &&
          value.far.every((o) => o <= 0.4);
        return settled ? value : null;
      },
      { timeout: 5_000, message: '专注模式渐进淡化' }
    );
    expect(fade.blurred).toBe(false);
    await captureForReview('focus-mode-fade');

    // 专注模式完全隐藏滚动条（滚轮 / 键盘仍可滚动）
    const scrollbar = await page.evaluate<{ width: string; gutter: number }>(() => {
      const scroller = document.querySelector('.cm-scroller') as HTMLElement;
      return {
        width: getComputedStyle(scroller).getPropertyValue('scrollbar-width'),
        gutter: scroller.offsetWidth - scroller.clientWidth,
      };
    });
    expect(scrollbar.width).toBe('none');
    expect(scrollbar.gutter).toBe(0);

    // 打字机滚动：光标所在行始终停在视口垂直中央（偏差不超过视口高度的 ±15%）
    const cursorOffset = () =>
      page.evaluate<number | null>(() => {
        const scroller = document.querySelector('.cm-scroller') as HTMLElement;
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return null;
        let rect = selection.getRangeAt(0).getBoundingClientRect();
        if (rect.height === 0) {
          const node = selection.focusNode;
          const el = node instanceof Element ? node : node?.parentElement;
          const line = el?.closest('.cm-line');
          if (!line) return null;
          rect = line.getBoundingClientRect();
        }
        const box = scroller.getBoundingClientRect();
        return ((rect.top + rect.bottom) / 2 - (box.top + box.height / 2)) / box.height;
      });
    const waitCentered = (message: string) =>
      page.waitUntil(
        async () => {
          const offset = await cursorOffset();
          return offset !== null && Math.abs(offset) <= 0.15 ? true : null;
        },
        { timeout: 5_000, message }
      );
    // 点击过「进入专注模式」按钮，快捷键需要先把焦点还给编辑器
    await page.evaluate(() =>
      (document.querySelector('.cm-content') as HTMLElement | null)?.focus()
    );
    await page.press('Home', [PRIMARY_MODIFIER]);
    await waitCentered('回到开头后首行也停在中央');
    // 点击视口下部的一行：松开鼠标后平滑滚到中央
    const lowerLine = await page.evaluate<{ x: number; y: number } | null>(() => {
      const box = (document.querySelector('.cm-scroller') as HTMLElement).getBoundingClientRect();
      const lines = Array.from(document.querySelectorAll<HTMLElement>('.cm-content > .cm-line'));
      for (const line of lines) {
        if (!line.textContent?.trim()) continue;
        const rect = line.getBoundingClientRect();
        const y = rect.top + Math.min(rect.height, 30) / 2;
        if (y > box.top + box.height * 0.72 && y < box.top + box.height * 0.92) {
          return { x: rect.left + Math.min(rect.width / 2, 120), y };
        }
      }
      return null;
    });
    expect(lowerLine, '视口下部应有可点击的正文行').not.toBeNull();
    if (lowerLine) await page.mouseClick(lowerLine.x, lowerLine.y);
    await waitCentered('点击下方的行后居中');
    for (let i = 0; i < 6; i += 1) await page.press('ArrowDown');
    await waitCentered('连续按下方向键后仍居中');
    await captureForReview('focus-mode-typewriter');

    // Esc 退出专注模式
    await page.press('Escape');
    await page.waitForTarget(ENTER_FOCUS);
    expect(await page.exists(EXIT_FOCUS)).toBe(false);

    // 右上角按钮同样可以退出
    await page.click(ENTER_FOCUS);
    await page.waitForTarget(EXIT_FOCUS);
    await page.click(EXIT_FOCUS);
    await page.waitForTarget(ENTER_FOCUS);
    const normal = await measure();
    expect(normal.overflow).toBeLessThanOrEqual(1);

    await undoUntilGone(page, '很长的一段话');
    await page.waitUntil(
      async () => (await readProjectFile(FIXTURE_CHAPTERS.first.file)) === original,
      { timeout: 10_000, message: '还原后自动保存' }
    );
  });

  it('6.1 灵感：工具栏按钮打开，抽一签无需任何输入即出三张签，插入写入编辑器光标处', async () => {
    await openChapter('001-启程', '林舟背起行囊');
    const original = await readProjectFile(FIXTURE_CHAPTERS.first.file);
    await focusEditorEnd(page);

    // 入口一眼可见：文件栏上是「图标 + 灵感」胶囊，而不是只有图标
    const pill = await page.evaluate<{ text: string; visible: boolean; first: boolean }>(() => {
      const button = document.querySelector<HTMLElement>('[data-testid="inspiration-pill"]');
      const rect = button?.getBoundingClientRect();
      const slot = button?.closest('[class*="pillSlot"]') as HTMLElement | null;
      const actions = slot?.parentElement;
      // 文件栏操作区是 flex，胶囊排在最左（保存 / 设置图标之前）
      const leftmost = Array.from(actions?.children ?? []).every(
        (child) =>
          child === slot ||
          child.getBoundingClientRect().left >= (slot?.getBoundingClientRect().right ?? 0)
      );
      return {
        text: button?.textContent?.trim() ?? '',
        visible: Boolean(rect && rect.width > 30 && rect.height > 0),
        first: leftmost,
      };
    });
    expect(pill).toEqual({ text: '灵感', visible: true, first: true });

    await openInspiration(page);
    await captureForReview('inspiration-open');
    // 零输入：弹窗里没有任何需要填写的输入框（高级选项默认收起）
    const inputs = await page.evaluate<number>(
      (selector: string) =>
        document.querySelectorAll(`${selector} input, ${selector} textarea, ${selector} select`)
          .length,
      SEL.inspiration
    );
    expect(inputs).toBe(0);
    await page.click({ text: '抽一签', within: SEL.inspiration, exact: true });
    const readDraw = () =>
      page.evaluate<string[]>(
        (selector: string) =>
          ['person', 'place', 'conflict'].map(
            (slot) =>
              document
                .querySelector(`${selector} [data-testid="inspiration-${slot}"]`)
                ?.textContent?.trim() ?? ''
          ),
        SEL.inspiration
      );
    const drawn = await page.waitUntil(
      async () => {
        const value = await readDraw();
        return value.every(Boolean) ? value : null;
      },
      { message: '三张签都已抽出' }
    );
    expect(drawn).toHaveLength(3);
    await captureForReview('inspiration-drawn');

    // 换一签只改冲突那一张
    await page.click(`${SEL.inspiration} [aria-label="换一张冲突签"]`);
    const rerolled = await page.waitUntil(
      async () => {
        const value = await readDraw();
        return value[2] && value[2] !== drawn[2] ? value : null;
      },
      { message: '冲突签已换' }
    );
    expect(rerolled.slice(0, 2)).toEqual(drawn.slice(0, 2));

    await page.click({ text: '插入到光标处', within: SEL.inspiration, exact: true });
    await page.waitForGone(SEL.inspiration);
    await waitForEditorText(
      page,
      `人物：${rerolled[0]}｜地点：${rerolled[1]}｜冲突：${rerolled[2]}`
    );

    await undoUntilGone(page, `人物：${rerolled[0]}`);
    await page.waitUntil(
      async () => (await readProjectFile(FIXTURE_CHAPTERS.first.file)) === original,
      { timeout: 10_000, message: '撤销插入后自动保存还原' }
    );
  });

  it('6.2 卷纲：零输入从本卷章节推导结构，人物线显示林舟', async () => {
    await selectWork(page, FIXTURE_WORK);
    await openChapter('001-启程', '林舟背起行囊');
    await ensureRightPanelOpen(page);
    await switchStorylineMode(page, '卷纲');

    // 不填任何内容：卷名、三幕（来自三章正文的幕标记）、场景节拍都已就位
    await page.waitForTarget({ text: '第一卷-离乡', within: SEL.storyline, exact: true });
    for (const act of ['第一幕 离乡', '第二幕 迷雾', '第三幕 狼王之夜']) {
      await page.waitForTarget(`${SEL.storyline} section[aria-label="${act}"]`);
    }
    await page.waitForTarget({ text: '第一场 清晨的青石镇', within: SEL.storyline, exact: true });
    await page.waitForTarget({ text: '石板路还湿着', within: SEL.storyline });
    const intent = await page.evaluate<string>(
      () =>
        document.querySelector<HTMLInputElement>('input[aria-label="这一卷想写什么"]')?.value ??
        'missing'
    );
    expect(intent).toBe('');
    // 本卷只有第一卷的三章，不混入第二卷
    expect(await page.exists({ text: '星港城', within: SEL.storyline, exact: true })).toBe(false);
    // 总览条：每一幕一段；头部汇总 段数 · 章数 · 字数
    await page.waitForTarget(`${SEL.storyline} [role="list"][aria-label="卷纲结构总览"]`);
    expect(
      await page.evaluate<number>(
        (sel: string) =>
          document.querySelectorAll(`${sel} [aria-label="卷纲结构总览"] [role="listitem"]`).length,
        SEL.storyline
      )
    ).toBe(3);
    expect(
      await page.evaluate<string>(
        (sel: string) => document.querySelector(`${sel} [class*="volumeMeta"]`)?.textContent ?? '',
        SEL.storyline
      )
    ).toMatch(/^3 段 · 3 章 · .+ 字$/);
    // 节拍图标悬停有说明（tooltip）
    // 节拍图标（悬停行时才显示）：悬停图标出现说明。直接在 Tooltip 包裹层上派发 mouseover
    await page.evaluate((sel: string) => {
      const button = document.querySelector(
        `${sel} button[aria-label="插入到章纲 第一场 清晨的青石镇"]`
      );
      button?.parentElement?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    }, SEL.storyline);
    await page.waitFor(
      () =>
        (document.querySelector('[role="tooltip"]')?.textContent ?? '').startsWith('加入本章章纲'),
      { message: '节拍「加入章纲」图标的悬停说明' }
    );
    await page.evaluate((sel: string) => {
      const button = document.querySelector(
        `${sel} button[aria-label="插入到章纲 第一场 清晨的青石镇"]`
      );
      button?.parentElement?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    }, SEL.storyline);
    await page.waitForGone('[role="tooltip"]');
    // 结构菜单：直接列出全部结构（不再盲目轮换）
    await page.click(`${SEL.storyline} button[aria-label^="卷纲结构："]`);
    await page.waitForTarget('[role="menu"][aria-label="卷纲结构"]');
    for (const label of ['按正文幕标记', '三幕式', '起承转合', '英雄之旅']) {
      expect(
        await page.exists({
          text: label,
          within: '[role="menu"][aria-label="卷纲结构"]',
          exact: true,
        })
      ).toBe(true);
    }
    await captureForReview('volume-plan-structure-menu');
    await page.press('Escape');
    await page.waitForGone('[role="menu"][aria-label="卷纲结构"]');
    await captureForReview('volume-plan-list');

    // 生成卷纲：一次给出 3 种结构的方案（没有 AI 时按结构模板），挑一个采用
    await page.click({ text: '生成卷纲', within: SEL.storyline, exact: true });
    await page.waitForTarget(`${SEL.storyline} [data-testid="plan-variants"]`);
    expect(
      await page.evaluate<string[]>(
        (sel: string) =>
          Array.from(
            document.querySelectorAll(
              `${sel} [data-testid="plan-variants"] li[aria-label^="方案 "]`
            )
          ).map((item) => item.getAttribute('aria-label') ?? ''),
        SEL.storyline
      )
    ).toEqual(['方案 按正文幕标记', '方案 三幕式', '方案 起承转合']);
    await captureForReview('volume-plan-variants');
    // 都不要：关闭后结构不变
    await page.click(`${SEL.storyline} [aria-label="关闭方案"]`);
    await page.waitForGone(`${SEL.storyline} [data-testid="plan-variants"]`);
    await page.waitForTarget(`${SEL.storyline} section[aria-label="第一幕 离乡"]`);

    // 同一份数据派生人物线：林舟（种子人物）出现在泳道里
    await page.click({ text: '人物线', within: SEL.storyline, exact: true });
    await page.waitForTarget(`${SEL.storyline} [role="row"][aria-label="人物线 林舟"]`);
    await captureForReview('volume-plan-lanes');

    await page.click({ text: '节奏', within: SEL.storyline, exact: true });
    await page.waitForTarget(`${SEL.storyline} [aria-label="张力曲线"]`);

    await page.click({ text: '列表', within: SEL.storyline, exact: true });
    await switchStorylineMode(page, '目录');
  });

  it('6.3 设定：多级目录、标签、图集；文件面板按目录分组显示', async () => {
    await ensureSidebarOpen();
    await selectWork(page, FIXTURE_WORK);
    await page.click({ text: '青石', within: SECTION_LORE, exact: true });
    const detail = '[data-testid="lore-detail"]';
    await page.waitForTarget(detail);
    await page.waitFor(
      (sel: string) =>
        (document.querySelector(`${sel} input[aria-label="设定标题"]`) as HTMLInputElement | null)
          ?.value === '青石',
      { args: [detail], message: '设定详情显示「青石」' }
    );
    // 目录：失焦保存，文件面板出现「物品 / 兵器」目录
    await page.click(`${detail} input[aria-label="设定目录"]`);
    await page.type('物品/兵器');
    await page.click(`${detail} textarea[aria-label="设定内容"]`);
    await page.waitForTarget(`${SECTION_LORE} [role="group"][aria-label="设定目录 物品/兵器"]`);
    // 标签：回车添加，行内显示 #标签
    await page.click(`${detail} input[aria-label="添加标签"]`);
    await page.type('旧剑');
    await page.press('Enter');
    await page.waitForTarget({ text: '#旧剑', within: SECTION_LORE });
    // 图集分页：上传 / AI 生成入口
    await page.click({ text: '图集', within: `${detail} [role="tablist"]` });
    await page.waitForTarget(`${detail} [data-testid="entity-gallery"]`);
    await captureForReview('lore-detail-gallery');

    // 还原：清空目录、移除标签
    await page.click({ text: '内容', within: `${detail} [role="tablist"]`, exact: true });
    await page.evaluate((sel: string) => {
      const input = document.querySelector(
        `${sel} input[aria-label="设定目录"]`
      ) as HTMLInputElement;
      input.focus();
      input.select();
    }, detail);
    await page.press('Backspace');
    await page.click(`${detail} textarea[aria-label="设定内容"]`);
    await page.waitForGone(`${SECTION_LORE} [role="group"][aria-label="设定目录 物品"]`);
    await page.click(`${detail} [aria-label="移除标签 旧剑"]`);
    await page.waitForGone({ text: '#旧剑', within: SECTION_LORE });
  });

  it('7. GUI 与 CLI 共享：保存计入写作日志，会话文件反映打开 / 未保存的文件', async () => {
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

  it('8. 关于：设置分区显示完整设备 ID；小窗口隐藏设备 ID，复制与上传日志同行并用 toast 反馈', async () => {
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

    // 「检查更新」在关于分区；更新通道 / 灰度分组 / 崩溃上传开关由我们决定，「通用」里不再出现
    await page.waitForTarget({
      text: '检查更新',
      within: '[role="dialog"][aria-label="设置中心"]',
      exact: true,
    });
    await page.click({ text: '通用', within: '[class*="sidebar"]', exact: true });
    expect(
      await page.evaluate<boolean>(() =>
        Boolean(
          document.querySelector('[role="radiogroup"][aria-label="更新通道"]') ||
            document.querySelector('[role="switch"][aria-label="崩溃时自动上传日志"]') ||
            /更新与诊断|灰度分组/.test(document.body.textContent ?? '')
        )
      )
    ).toBe(false);
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
    // 先悬停：显示本按钮的说明提示（与用户「先看提示再点击」的顺序一致）
    await page.hover({ text: '复制设备 ID', within: DIALOG, exact: true });
    await page.waitFor(
      (text: string) =>
        Array.from(document.querySelectorAll('[role="tooltip"]')).some(
          (node) => node.textContent === text
        ),
      {
        args: ['复制本机设备 ID，用于问题排查'],
        message: '复制设备 ID 的悬停提示',
      }
    );
    // 再点击：toast 提示已复制
    await page.click({ text: '复制设备 ID', within: DIALOG, exact: true });
    await page.waitForTarget({ text: '设备 ID 已复制', exact: true });
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

  it('9. 资料：哈希 / GUID 文件名中间省略并保留扩展名，按类型显示图标、类型标签与悬停信息', async () => {
    // 示例项目首次打开时由 seed.json 写入作品记录，标题栏显示作品名而不是目录名
    await waitForWorkspace(page, SAMPLE_PROJECT_NAME);
    // 资料跟随作品：写进「星河旅人」自己的 资料/
    await ensureSidebarOpen();
    await selectWork(page, FIXTURE_WORK);
    const materialDir = fixture.resolve(FIXTURE_MATERIAL_DIR);
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
      // 「资料」分区直接展示作品资料目录的内容（不再多套一层「资料」文件夹），等待刷新出新文件
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

  it('10. Markdown 实时渲染：标题、表格、公式就地渲染，坏公式只影响自身，光标处显示源码', async () => {
    await ensureSidebarOpen();
    // 排版示例.md 在项目根目录：从「项目说明」列表打开
    await openProjectDocs(page);
    await page.click({ text: '排版示例', within: SEL.projectNotes, exact: true });
    await waitForEditorText(page, '角色属性表');

    // 行内 + 块级公式、表格都已渲染
    await page.waitFor(() => document.querySelectorAll('.cm-content .katex').length >= 3, {
      message: '公式已渲染',
    });
    await page.waitForTarget('.cm-content .cm-lp-table table');
    expect(
      await page.evaluate<string>(
        () => document.querySelector('.cm-content .cm-lp-table th')?.textContent ?? ''
      )
    ).toBe('角色');

    // 坏公式：就地显示原文 + 错误标记，其它公式照常渲染
    const broken = await page.evaluate<{ title: string; text: string; count: number }>(() => {
      const markers = document.querySelectorAll('.cm-content .cm-lp-error-marker');
      const marker = markers[0];
      return {
        title: marker?.getAttribute('title') ?? '',
        text: marker?.parentElement?.textContent ?? '',
        count: markers.length,
      };
    });
    expect(broken.count).toBe(1);
    expect(broken.title).toContain('公式错误');
    expect(broken.text).toContain('\\frac{1}{2');

    // 光标不在标题行时隐藏「#」，移到文档开头（标题行）后显示源码
    const firstLine = () =>
      page.evaluate<string>(
        () => document.querySelector('.cm-content .cm-line')?.textContent ?? ''
      );
    await focusEditorEnd(page);
    await page.waitUntil(async () => (await firstLine()) === '排版示例', {
      message: '标题的 # 已隐藏',
    });
    await page.press('Home', [PRIMARY_MODIFIER]);
    await page.waitUntil(async () => (await firstLine()).startsWith('# 排版示例'), {
      message: '光标移入标题后显示 #',
    });
    await captureForReview('markdown-live-preview');

    // .md 始终实时渲染：文件头不再有「源码 / 实时预览」切换
    expect(await page.exists('[aria-label="Markdown 显示方式"]')).toBe(false);
    expect(
      await page.exists({ text: '实时预览', within: '[class*="fileHeader"]', exact: true })
    ).toBe(false);
  });

  it('10.1 复杂公式：公式示例.md 的对齐 / 矩阵 / 分段等全部渲染，只有故意写错的一条显示错误标记', async () => {
    await ensureSidebarOpen();
    await openProjectDocs(page);
    await page.click({ text: '公式示例', within: SEL.projectNotes, exact: true });
    await waitForEditorText(page, '对齐环境');

    // 文档开头的行内公式与前几个公式块（视口附近的内容）都已渲染
    await page.waitFor(() => document.querySelectorAll('.cm-content .katex').length >= 8, {
      message: '复杂公式已渲染',
    });
    await page.waitForTarget('.cm-content .cm-lp-math-display math');
    await captureForReview('latex-demo-top');

    // 跳到文末：坏公式就地显示原文 + 一个错误标记，过宽的公式在自身内部横向滚动
    await focusEditorEnd(page);
    const tail = await page.waitFor<{
      count: number;
      title: string;
      text: string;
      katex: number;
      wideScrollable: boolean;
      wideOverflowX: string;
      editorOverflow: number;
    }>(
      () => {
        const markers = document.querySelectorAll('.cm-content .cm-lp-error-marker');
        if (markers.length === 0) return null;
        const scroller = document.querySelector('.cm-scroller') as HTMLElement;
        const wide = Array.from(
          document.querySelectorAll<HTMLElement>('.cm-content .cm-lp-math-display')
        ).find((el) => el.textContent?.includes('a30') || el.scrollWidth > el.clientWidth + 1);
        return {
          count: markers.length,
          title: markers[0].getAttribute('title') ?? '',
          text: markers[0].parentElement?.textContent ?? '',
          katex: document.querySelectorAll('.cm-content .katex').length,
          wideScrollable: wide ? wide.scrollWidth > wide.clientWidth + 1 : false,
          wideOverflowX: wide ? getComputedStyle(wide).overflowX : '',
          editorOverflow: scroller.scrollWidth - scroller.clientWidth,
        };
      },
      { message: '文末的坏公式显示错误标记' }
    );
    expect(tail.count).toBe(1);
    expect(tail.title).toContain('公式错误');
    expect(tail.text).toContain('\\sqrt{x^2 + y^2');
    expect(tail.katex).toBeGreaterThanOrEqual(3);
    expect(tail.wideScrollable).toBe(true);
    expect(tail.wideOverflowX).toBe('auto');
    expect(tail.editorOverflow).toBeLessThanOrEqual(1);
    await captureForReview('latex-demo-tail');
  });

  it('10.2 小说格式与参考窗格：章标题 / 场景条 / 图片 / 视频就地渲染；「参考」按钮与资料图片在编辑器旁边打开；章纲有使用说明', async () => {
    await ensureSidebarOpen();
    await openProjectDocs(page);
    await page.click({ text: '小说格式示例', within: SEL.projectNotes, exact: true });
    await waitForEditorText(page, '星港城的黄昏是橘红色的');
    // 不用 # 的章节名显示为章标题；:::scene 显示为场景条；:char 显示称呼
    await page.waitFor(
      () =>
        Array.from(document.querySelectorAll('.cm-content .cm-lp-chapter-title')).some((el) =>
          el.textContent?.includes('第一章 离港')
        ),
      { message: '章标题样式' }
    );
    await page.waitFor(
      () =>
        Array.from(document.querySelectorAll('.cm-content .cm-lp-scene')).some((el) =>
          el.textContent?.includes('星港城的黄昏')
        ),
      { message: '场景条已渲染' }
    );
    expect(
      await page.evaluate<string[]>(() =>
        Array.from(document.querySelectorAll('.cm-content .cm-lp-char')).map(
          (el) => el.textContent ?? ''
        )
      )
    ).toContain('阿舟');
    // ::image 就地显示示例图片，::video 就地显示可播放的视频（示例里的真实文件）
    await page.waitFor(
      () =>
        (document.querySelector('.cm-content img.cm-lp-image-directive') as HTMLImageElement | null)
          ?.naturalWidth ?? 0,
      { timeout: 10_000, message: '示例图片已加载' }
    );
    await page.waitFor(
      () =>
        ((document.querySelector('.cm-content video.cm-lp-video-player') as HTMLVideoElement | null)
          ?.readyState ?? 0) >= 1,
      { timeout: 10_000, message: '示例视频已加载' }
    );
    await captureForReview('novel-format-demo');
    // 自定义播放器：没有原生控制条，容器贴合视频比例；播放按钮切换 paused
    expect(
      await page.evaluate<{ controls: boolean; aspect: string | null }>(() => {
        const video = document.querySelector(
          '.cm-content video.cm-lp-video-player'
        ) as HTMLVideoElement;
        const group = video.closest('[role="group"]');
        return { controls: video.controls, aspect: group?.getAttribute('data-aspect') ?? null };
      })
    ).toMatchObject({ controls: false, aspect: expect.stringMatching(/^\d/) });
    await page.click('.cm-content .cm-lp-video button[aria-label="播放"]');
    await page.waitFor(
      () =>
        (document.querySelector('.cm-content video.cm-lp-video-player') as HTMLVideoElement | null)
          ?.paused === false,
      { message: '点击播放按钮后开始播放' }
    );
    // 暂停后控制条与「在旁边看」常显
    await page.evaluate(() => {
      (document.querySelector('.cm-content video.cm-lp-video-player') as HTMLVideoElement).pause();
    });
    await page.waitForTarget('.cm-content .cm-lp-video button[aria-label="播放"]');
    // 视频「在旁边看」→ 参考窗格播放
    await page.click('.cm-content .cm-lp-video .cm-lp-media-beside');
    await page.waitFor(
      () =>
        (
          document.querySelector(
            '[data-testid="reference-pane"] [data-testid="reference-video"]'
          ) as HTMLVideoElement | null
        )?.src.startsWith('blob:') ?? false,
      { timeout: 10_000, message: '参考窗格播放示例视频' }
    );
    await page.click('[data-testid="reference-pane"] [aria-label="关闭参考"]');
    await page.waitForGone('[data-testid="reference-pane"]');

    // 文件栏「参考」：没有内容时先放当前作品人物的三视图 / 形象图，再按一次收起
    await page.click('[data-testid="reference-pill"]');
    await page.waitFor(
      () =>
        (
          document.querySelector(
            '[data-testid="reference-pane"] [data-testid="reference-image"]'
          ) as HTMLImageElement | null
        )?.src.startsWith('blob:') ?? false,
      { timeout: 10_000, message: '参考窗格显示人物参考' }
    );
    expect(
      await page.evaluate<string>(
        () => document.querySelector('[data-testid="reference-pane"] header')?.textContent ?? ''
      )
    ).toContain('三视图');
    // 主画面贴在窗格顶部（不再垂直居中留大块空白），下方是信息行与缩略图网格
    const layout = await page.evaluate<{ gap: number; options: number; info: boolean }>(() => {
      const pane = document.querySelector('[data-testid="reference-pane"]') as HTMLElement;
      const header = pane.querySelector('header') as HTMLElement;
      const stage = pane.querySelector('[data-testid="reference-stage"]') as HTMLElement;
      return {
        gap: stage.getBoundingClientRect().top - header.getBoundingClientRect().bottom,
        options: pane.querySelectorAll('[role="listbox"][aria-label="参考列表"] [role="option"]')
          .length,
        info: !!pane.querySelector('[data-testid="reference-info"]'),
      };
    });
    expect(layout.gap).toBeLessThan(24);
    expect(layout.options).toBeGreaterThan(1);
    expect(layout.info).toBe(true);
    await page.waitFor(
      () =>
        (
          document.querySelector(
            '[data-testid="reference-pane"] [role="option"] img'
          ) as HTMLImageElement | null
        )?.src.startsWith('blob:') ?? false,
      { timeout: 10_000, message: '缩略图网格显示图片' }
    );
    await captureForReview('reference-pane-characters');
    await page.click('[data-testid="reference-pill"]');
    await page.waitForGone('[data-testid="reference-pane"]');

    // 资料里的图片：右键「在编辑器旁边打开」→ 编辑器右侧的参考窗格
    await selectWork(page, FIXTURE_WORK);
    await page.click({ text: '素材', within: SECTION_MATERIALS, exact: true });
    await page.waitForTarget(`${SECTION_MATERIALS} [title^="场景截图.png"]`);
    await page.rightClick(`${SECTION_MATERIALS} [title^="场景截图.png"]`);
    await page.click({ text: '在编辑器旁边打开', within: SEL.menu, exact: true });
    await page.waitFor(
      () =>
        (
          document.querySelector(
            '[data-testid="reference-pane"] [data-testid="reference-image"]'
          ) as HTMLImageElement | null
        )?.src.startsWith('blob:') ?? false,
      { timeout: 10_000, message: '参考窗格显示图片' }
    );
    // 编辑器仍可见（并排，不是替换）
    expect(await page.exists('.cm-editor')).toBe(true);
    await captureForReview('reference-pane-image');
    await page.click('[data-testid="reference-pane"] [aria-label="关闭参考"]');
    await page.waitForGone('[data-testid="reference-pane"]');

    // 章纲：摘要 +「怎么用」三步说明，减轻学习负担
    await openChapter('001-启程', '林舟背起行囊');
    await ensureRightPanelOpen(page);
    await switchStorylineMode(page, '章纲');
    await page.waitForTarget(`${SEL.storyline} [data-testid="plan-guide"]`);
    await page.click(`${SEL.storyline} button[aria-label="章纲怎么用"]`);
    const steps = await page.waitFor<number>(
      () => {
        const panel = Array.from(document.querySelectorAll('[aria-label="章纲怎么用"]')).find(
          (el) => el.tagName !== 'BUTTON'
        );
        const count = panel?.querySelectorAll('li').length ?? 0;
        return count > 0 ? count : null;
      },
      { message: '章纲使用说明弹出' }
    );
    expect(steps).toBe(3);
    await page.press('Escape');
  });

  it('10b. 文件面板搜索：按文件名找到项目说明，按正文内容找到章节，Esc 关闭', async () => {
    await ensureSidebarOpen();
    await selectWork(page, FIXTURE_WORK);

    // 按文件名：根目录的项目说明（不在正文树里）也能搜到，关键词高亮
    await searchWorkspace(page, '小说格式');
    const docOption = `${searchGroup('项目说明')} [role="option"]`;
    await page.waitForTarget(docOption);
    expect(
      await page.evaluate(
        (selector: string) => document.querySelector(`${selector} mark`)?.textContent ?? '',
        docOption
      )
    ).toBe('小说格式');
    await page.click({ text: '小说格式示例.md', within: searchGroup('项目说明'), exact: true });
    // 打开后搜索关闭，面板恢复为完整的树
    await page.waitForGone(SEL.searchInput);
    await page.waitForTarget(SEL.workspaceTree);
    await waitForEditorText(page, '星港城的黄昏是橘红色的');

    // 按正文内容：主进程全文搜索，命中行带高亮，点击打开章节
    await searchWorkspace(page, '林舟背起行囊');
    await page.waitForTarget({ text: '001-启程', within: searchGroup('内容'), exact: true });
    const preview = await page.evaluate(
      (selector: string) =>
        Array.from(document.querySelectorAll(`${selector} mark`)).map((node) => node.textContent),
      searchGroup('内容')
    );
    expect(preview).toContain('林舟背起行囊');
    await captureForReview('file-panel-search');
    await page.click({ text: '001-启程', within: searchGroup('内容'), exact: true });
    await page.waitForGone(SEL.searchInput);
    await waitForEditorText(page, '林舟背起行囊');

    // Esc 关闭搜索：清空关键词并恢复树
    await searchWorkspace(page, '不存在的关键词');
    await page.waitForTarget({ text: '没有找到「不存在的关键词」', within: SEL.searchResults });
    await page.press('Escape');
    await page.waitForGone(SEL.searchResults);
    await page.waitForTarget(SEL.workspaceTree);
  });

  it('10c. 多次切换作品后，主进程没有读图失败（人物 / 设定图片按它们所属的作品解析）', async () => {
    for (const work of ['剑与诗', FIXTURE_WORK, '剑与诗', FIXTURE_WORK]) {
      await selectWork(page, work);
      await page.waitForTarget({
        text: work === FIXTURE_WORK ? '林舟' : '沈砚',
        within: SECTION_CHARACTERS,
        exact: true,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(
      suite.app.logs.join('').match(/Failed to read binary file: [^\n]*图集[^\n]*/g) ?? []
    ).toEqual([]);
  });

  it('11. 单实例：第二次启动把文件夹转发给已有窗口', async () => {
    const other = await createFixtureProject({
      prefix: 'novel-editor-e2e-second-',
      exclude: ['.novel-editor/seed.json'],
    });
    try {
      await mkdir(other.resolve('novels/另一部作品'), { recursive: true });
      await writeFile(other.resolve('novels/另一部作品/001-开端.md'), '# 开端\n', 'utf-8');

      const second = spawnElectron([other.root], buildAppEnv(app.userDataDir));
      const exited = await waitForExit(second, 15_000);
      if (!exited) await stopProcess(second);
      expect(exited, '第二个实例应在转发后立即退出').toBe(true);

      // 两个项目都源自示例（配置里的项目名相同），用第二个项目独有的作品确认已切换过去
      await selectWork(page, '另一部作品');
      await page.waitForTarget({ text: '001-开端', within: SEL.workspaceTree, exact: true });
      // 原 Electron 进程仍在运行
      expect(app.process.exitCode).toBeNull();
    } finally {
      await other.dispose();
    }
  });
});
