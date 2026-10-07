/**
 * 小说编辑器界面相关的高层操作（文件树、编辑器、状态栏、右侧面板）
 *
 * 选择器优先使用 aria-label / title / role 等语义属性，其次是可见文本；
 * 只有在没有语义信息时才使用 CSS Modules 的类名前缀（`[class*="xxx"]`）。
 */
import { PRIMARY_MODIFIER, type Page } from './page';

export const SEL = {
  workspaceTree: '[class*="workspaceTree"]',
  /** 项目名（项目菜单触发器「示例作品集 ▾」） */
  workspaceName: '[data-testid="project-menu-trigger"]',
  storyNodeTitle: '[class*="storyNodeTitle"]',
  editor: '.cm-content',
  statusBar: '[class*="statusBar"]',
  dialog: '[role="dialog"]',
  dialogInput: '[role="dialog"] input',
  menu: '[role="menu"]',
  storyline: '[class*="storylineView"]',
  /** 灵感抽签弹窗 */
  inspiration: '[role="dialog"][aria-label="灵感"]',
  /** 文件面板顶部的作品切换器与它的下拉列表 */
  workSwitcher: '[data-testid="work-switcher"]',
  workList: '[role="listbox"][aria-label="作品"]',
  /** 文件面板顶部（项目名 + 操作按钮） */
  workspaceHeader: '[class*="workspaceHeader"]',
  /** 项目菜单（单击项目名打开）与其中的「项目说明」分组（根目录说明文档，带数量） */
  projectMenuTrigger: '[data-testid="project-menu-trigger"]',
  projectMenu: '[role="menu"][aria-label="项目菜单"]',
  projectNotes: '[role="group"][aria-label^="项目说明（"]',
  /** 行内重命名输入框（双击名称 / F2） */
  renameInput: 'input[aria-label^="重命名"]',
} as const;

/** 等待主界面加载完成并打开了指定项目（以目录名判断） */
export async function waitForWorkspace(page: Page, folderName: string, timeout = 30_000) {
  await page.waitFor(
    (selector: string, name: string) =>
      document.querySelector(selector)?.textContent?.trim() === name,
    { timeout, args: [SEL.workspaceName, folderName], message: `工作区「${folderName}」加载` }
  );
}

/** 文件树中当前可见的节点标题 */
export function treeTitles(page: Page): Promise<string[]> {
  return page.evaluate(
    (selector: string) =>
      Array.from(document.querySelectorAll(selector)).map((node) => node.textContent ?? ''),
    SEL.storyNodeTitle
  );
}

/** 正文树中某个节点整行的可见文本（含类型徽章与章数统计）与悬停提示 */
export function storyRow(page: Page, title: string): Promise<{ text: string; tooltip: string }> {
  return page.evaluate<{ text: string; tooltip: string }>(
    (selector: string, wanted: string) => {
      const titleNode = Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
        (node) => node.textContent === wanted
      );
      const row = titleNode?.closest<HTMLElement>('[role="button"]');
      return {
        text: (row?.innerText ?? '').replace(/\s+/g, ' ').trim(),
        tooltip: titleNode?.getAttribute('title') ?? '',
      };
    },
    SEL.storyNodeTitle,
    title
  );
}

/**
 * 按路径展开文件树，直到路径中最后一个节点可见。
 * 只点击「子节点尚不可见」的目录，已展开的目录不会被误折叠
 */
export async function expandTreePath(page: Page, names: string[]): Promise<void> {
  for (let index = 0; index < names.length - 1; index += 1) {
    const next = names[index + 1];
    if ((await treeTitles(page)).includes(next)) continue;
    await page.click({ text: names[index], within: SEL.workspaceTree, exact: true });
    await page.waitForTarget({ text: next, within: SEL.workspaceTree, exact: true });
  }
}

/** 作品切换器上显示的当前作品名 */
export function currentWork(page: Page): Promise<string> {
  return page.evaluate<string>(
    (selector: string) =>
      document.querySelector(`${selector} [class*="name"]`)?.textContent?.trim() ?? '',
    SEL.workSwitcher
  );
}

/**
 * 切换当前作品（角色 / 设定 / 成长档案 / 资料跟随作品）：已是该作品时不做任何操作
 */
export async function selectWork(page: Page, name: string): Promise<void> {
  await page.waitForTarget(SEL.workSwitcher);
  if ((await currentWork(page)) === name) return;
  await page.click(SEL.workSwitcher);
  await page.click({ text: name, within: SEL.workList, exact: true });
  await page.waitFor(
    (selector: string, wanted: string) =>
      document.querySelector(`${selector} [class*="name"]`)?.textContent?.trim() === wanted,
    { args: [SEL.workSwitcher, name], message: `当前作品切换为「${name}」` }
  );
}

/** 单击项目名打开项目菜单 */
export async function openProjectMenu(page: Page): Promise<void> {
  if (!(await page.exists(SEL.projectMenu))) await page.click(SEL.projectMenuTrigger);
  await page.waitForTarget(SEL.projectMenu);
}

/** 打开项目菜单并等待「项目说明」分组（根目录说明文档列表） */
export async function openProjectDocs(page: Page): Promise<void> {
  await openProjectMenu(page);
  await page.waitForTarget(SEL.projectNotes);
}

/** 项目菜单 →「刷新」（重新扫描作品目录） */
export async function refreshWorkspace(page: Page): Promise<void> {
  await openProjectMenu(page);
  await page.click({ text: '刷新', within: SEL.projectMenu, exact: true });
  await page.waitForGone(SEL.projectMenu);
}

/** 在已出现的行内重命名输入框中输入新名称并回车提交 */
export async function commitInlineRename(page: Page, value: string): Promise<void> {
  await page.waitForTarget(SEL.renameInput);
  // macOS 上 Cmd+A 依赖原生菜单命令，CDP 按键不会触发；直接选中输入框内容再输入
  await page.evaluate((selector: string) => {
    const input = document.querySelector(selector) as HTMLInputElement;
    input.focus();
    input.select();
  }, SEL.renameInput);
  await page.type(value);
  await page.waitFor(
    (selector: string, expected: string) =>
      (document.querySelector(selector) as HTMLInputElement | null)?.value === expected,
    { args: [SEL.renameInput, value], message: `重命名输入框内容为「${value}」` }
  );
  await page.press('Enter');
  await page.waitForGone(SEL.renameInput);
}

/** 双击文件树中的名称，行内重命名为 value */
export async function renameByDoubleClick(page: Page, name: string, value: string) {
  await page.doubleClick({ text: name, within: SEL.workspaceTree, exact: true });
  await commitInlineRename(page, value);
}

/** 文件面板顶部按钮（按显示顺序）：有 data-testid 的取 testid，否则取 aria-label */
export function workspaceHeaderButtons(page: Page): Promise<string[]> {
  return page.evaluate<string[]>(
    (selector: string) =>
      Array.from(document.querySelector(selector)?.querySelectorAll('button') ?? []).map(
        (button) => button.getAttribute('data-testid') ?? button.getAttribute('aria-label') ?? ''
      ),
    SEL.workspaceHeader
  );
}

/** 编辑器当前文档内容（逐行拼接，适用于不超过一屏视口的短文档） */
export function editorText(page: Page): Promise<string> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.cm-content .cm-line'))
      .map((line) => line.textContent ?? '')
      .join('\n')
  );
}

export async function waitForEditorText(page: Page, predicate: string, timeout = 10_000) {
  await page.waitFor(
    (text: string) =>
      Array.from(document.querySelectorAll('.cm-content .cm-line'))
        .map((line) => line.textContent ?? '')
        .join('\n')
        .includes(text),
    { timeout, args: [predicate], message: `编辑器包含「${predicate}」` }
  );
}

/** 把光标移动到文档末尾 */
export async function focusEditorEnd(page: Page): Promise<void> {
  await page.click(SEL.editor);
  await page.press('End', [PRIMARY_MODIFIER]);
}

export async function undo(page: Page): Promise<void> {
  await page.press('z', [PRIMARY_MODIFIER]);
}

/** 反复撤销直到编辑器中不再包含指定文本（CodeMirror 会合并相邻输入，撤销次数不固定） */
export async function undoUntilGone(page: Page, text: string, maxSteps = 10): Promise<void> {
  // 快捷键需要编辑器持有焦点（例如刚点击过标题栏按钮时）
  await page.evaluate(() => (document.querySelector('.cm-content') as HTMLElement | null)?.focus());
  for (let step = 0; step < maxSteps; step += 1) {
    if (!(await editorText(page)).includes(text)) return;
    await undo(page);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`撤销 ${maxSteps} 次后编辑器仍包含「${text}」`);
}

/** CodeMirror 默认重做：macOS Cmd+Shift+Z、Linux Ctrl+Shift+Z、Windows Ctrl+Y */
export async function redo(page: Page): Promise<void> {
  if (process.platform === 'win32') await page.press('y', [PRIMARY_MODIFIER]);
  else await page.press('z', [PRIMARY_MODIFIER, 'Shift']);
}

export interface StatusBarStats {
  lines: number;
  words: number;
  raw: string;
}

export async function statusBarStats(page: Page): Promise<StatusBarStats> {
  const raw = await page.evaluate<string>(
    (selector: string) => (document.querySelector(selector) as HTMLElement | null)?.innerText ?? '',
    SEL.statusBar
  );
  const flat = raw.replace(/\s+/g, ' ');
  // 形如「行 1, 列 1 | 6 行 | 29 字」：光标位置的「行 N」在数字之前，不会被匹配
  const lines = Number(/(\d+)\s*行/.exec(flat)?.[1] ?? NaN);
  const words = Number(/(\d+)\s*字/.exec(flat)?.[1] ?? NaN);
  return { lines, words, raw: flat };
}

/** 在自定义 Prompt 对话框中输入内容并确认 */
export async function answerPrompt(page: Page, value: string): Promise<void> {
  await page.waitForTarget(SEL.dialogInput);
  // macOS 上 Cmd+A 依赖原生菜单命令，CDP 按键不会触发；直接选中输入框内容再输入
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
  await page.waitForGone(SEL.dialog);
}

export async function confirmDialog(page: Page, expectText?: string): Promise<void> {
  await page.waitForTarget(SEL.dialog);
  if (expectText) await page.waitForTarget({ text: expectText, within: SEL.dialog });
  await page.click({ text: '确定', within: SEL.dialog, exact: true });
  await page.waitForGone(SEL.dialog);
}

/** 右键文件树节点并选择菜单项 */
export async function contextMenuAction(page: Page, nodeText: string, action: string) {
  await page.rightClick({ text: nodeText, within: SEL.workspaceTree, exact: true });
  await page.click({ text: action, within: SEL.menu, exact: true });
}

export async function ensureRightPanelOpen(page: Page): Promise<void> {
  if (await page.exists(SEL.storyline)) return;
  await page.click('[title="展开辅助面板"]');
  await page.waitForTarget(SEL.storyline);
}

/** 右侧「大纲」面板的视图 */
export type StorylineModeLabel = '目录' | '章纲' | '卷纲';

/** 切换右侧「大纲」面板的视图（目录 / 章纲 / 卷纲） */
export async function switchStorylineMode(page: Page, label: StorylineModeLabel): Promise<void> {
  await page.click({ text: label, within: SEL.storyline, exact: true });
}

/** 通过编辑器文件栏的「灵感」按钮打开灵感抽签弹窗 */
export async function openInspiration(page: Page): Promise<void> {
  await page.click('button[aria-label="灵感"]');
  await page.waitForTarget(SEL.inspiration);
}
