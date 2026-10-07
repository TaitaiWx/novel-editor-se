/**
 * 表单控件（独立的 Electron 实例）
 *
 * - 人物详情「关系与高亮」里的「仅在每章第一次出现时高亮」是自绘开关（components/Switch），不是浏览器原生 checkbox
 * - 点击开关本体 / 点击标签文字都能切换，aria-checked 同步，修改写入数据库（人物 attributes）
 */
import { describe, expect, it } from 'vitest';
import {
  GROWTH_SECTION,
  captureForReview,
  ensureSidebarOpen,
  setupAppSuite,
} from './support/suite';
import { selectWork } from './support/workbench';
import { FIXTURE_WORK, FIXTURE_WORK_DIR } from './support/fixture';

const suite = setupAppSuite({ fixture: { prefix: 'novel-editor-e2e-controls-' } });

const DETAIL_TABS = '[role="tablist"][aria-label="人物详情"]';
const PANEL = '[role="tabpanel"][aria-label="关系与高亮"]';
// 真实 checkbox 完全透明（定位器只认可见元素），交互目标是自绘轨道与整个 label
const SWITCH = `${PANEL} input[role="switch"]`;
const TRACK = `${SWITCH} + span`;
const LABEL = '仅在每章第一次出现时高亮';

describe('自绘复选框 / 开关', () => {
  it('人物「仅在每章第一次出现时高亮」开关：点击切换并持久化', async () => {
    const { page } = suite;
    await ensureSidebarOpen(page);
    await selectWork(page, FIXTURE_WORK);
    // 角色列表在头像 / 等级加载后可能重排：点完确认打开的是林舟，否则重点一次
    const openedLinZhou = () =>
      page.evaluate<boolean>(() =>
        Array.from(document.querySelectorAll('h2')).some((el) => el.textContent?.trim() === '林舟')
      );
    await page.waitUntil(
      async () => {
        if (await openedLinZhou()) return true;
        await page.click({ text: '林舟', within: GROWTH_SECTION, exact: true });
        await page.waitForTarget(DETAIL_TABS);
        return openedLinZhou();
      },
      { message: '打开林舟的人物详情' }
    );
    await page.click({ text: '关系与高亮', within: DETAIL_TABS, exact: true });
    await page.waitForTarget(TRACK);

    // 原生 checkbox 只作语义载体（完全透明），看到的是自绘轨道
    const look = await page.evaluate<{ opacity: string; trackVisible: boolean; type: string }>(
      (selector: string) => {
        const input = document.querySelector<HTMLInputElement>(selector);
        const track = input?.nextElementSibling as HTMLElement | null;
        const rect = track?.getBoundingClientRect();
        return {
          opacity: input ? getComputedStyle(input).opacity : '',
          trackVisible: Boolean(rect && rect.width > 0 && rect.height > 0),
          type: input?.type ?? '',
        };
      },
      SWITCH
    );
    expect(look).toEqual({ opacity: '0', trackVisible: true, type: 'checkbox' });

    const ariaChecked = () =>
      page.evaluate<string | null>(
        (selector: string) =>
          document.querySelector(selector)?.getAttribute('aria-checked') ?? null,
        SWITCH
      );
    // 持久化的值：读数据库中林舟的 attributes.highlightFirstMentionOnly（默认 true）
    const workDir = suite.fixture.resolve(FIXTURE_WORK_DIR);
    const persisted = () =>
      page.evaluate<boolean | null>(async (folder: string) => {
        const ipc = window.electron.ipcRenderer;
        const novel = (await ipc.invoke('db-novel-get-by-folder', folder)) as {
          id: number;
        } | null;
        if (!novel) return null;
        const rows = (await ipc.invoke('db-character-list', novel.id)) as Array<{
          name: string;
          attributes?: string | null;
        }>;
        const row = rows.find((item) => item.name === '林舟');
        const attrs = JSON.parse(row?.attributes || '{}') as {
          highlightFirstMentionOnly?: boolean;
        };
        return attrs.highlightFirstMentionOnly ?? true;
      }, workDir);

    expect(await ariaChecked()).toBe('true');
    expect(await persisted()).toBe(true);

    // 点击开关本体 → 关闭
    await page.click(TRACK);
    await page.waitFor(
      (selector: string) =>
        document.querySelector(selector)?.getAttribute('aria-checked') === 'false',
      { args: [SWITCH], message: '开关变为关闭' }
    );
    await page.waitUntil(async () => (await persisted()) === false, {
      message: '关闭状态写入数据库',
    });
    await captureForReview(page, 'settings-controls-switch-off');

    // 点击标签文字 → 重新打开
    await page.click({ text: LABEL, within: PANEL, exact: true });
    await page.waitFor(
      (selector: string) =>
        document.querySelector(selector)?.getAttribute('aria-checked') === 'true',
      { args: [SWITCH], message: '开关重新打开' }
    );
    await page.waitUntil(async () => (await persisted()) === true, {
      message: '打开状态写入数据库',
    });
    expect(await ariaChecked()).toBe('true');
  });
});
