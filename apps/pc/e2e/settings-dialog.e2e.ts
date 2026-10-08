/**
 * 设置中心弹窗：打开后稳定不消失；从弹窗里拖到遮罩上不会误关；弹窗里的下拉列表浮在弹窗之上、可以切换；
 * 不带 key 的 keydown（输入框自动填充等）不会让全局快捷键报错；
 * 每个分区都是同一套无边框的行式版式（分组之间只有分隔线），AI 总开关醒目
 */
import { describe, expect, it } from 'vitest';
import { captureForReview, setupAppSuite } from './support/suite';

const suite = setupAppSuite({ fixture: { prefix: 'novel-editor-e2e-settings-dialog-' } });
const DIALOG = '[role="dialog"][aria-label="设置中心"]';

/** 打开后连续 1.5 秒逐帧采样：弹窗一直存在，位置与尺寸不变 */
async function sampleDialog(): Promise<string[]> {
  return suite.page.evaluate<string[]>(
    (selector: string) =>
      new Promise((resolve) => {
        const samples: string[] = [];
        const start = performance.now();
        const tick = () => {
          const dialog = document.querySelector(selector) as HTMLElement | null;
          const rect = dialog?.getBoundingClientRect();
          samples.push(
            rect
              ? `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}`
              : 'none'
          );
          if (performance.now() - start < 1500) requestAnimationFrame(tick);
          else resolve(samples);
        };
        requestAnimationFrame(tick);
      }),
    DIALOG
  );
}

async function closeDialog() {
  await suite.page.click('[aria-label="关闭设置"]');
  await suite.page.waitForGone(DIALOG);
}

/** 每个分区：侧栏标签 → 分区标题 */
const SETTINGS_TABS: ReadonlyArray<readonly [string, string, string]> = [
  ['通用', '通用设置', 'general'],
  ['正文结构', '正文结构', 'structure'],
  ['AI', 'AI 设置', 'ai'],
  ['数据与缓存', '数据与缓存', 'data'],
  ['快捷键', '快捷键', 'shortcuts'],
  ['关于', '关于', 'about'],
];

interface LayoutReport {
  groups: number;
  rows: number;
  /** 分区 / 分组 / 行容器自身左右下边框不为 0 的 */
  boxedContainers: string[];
  /** 包住设置行的、四边都有边框的祖先（卡片盒子） */
  boxedAncestors: string[];
  /** 第 2 个起的分组是否都有 1px 顶部分隔线 */
  dividersOk: boolean;
}

/** 在页面里检查当前分区的版式（计算样式） */
function inspectLayout(dialogSelector: string): LayoutReport {
  const dialog = document.querySelector(dialogSelector) as HTMLElement;
  const section = dialog.querySelector('[data-settings-section]') as HTMLElement;
  const width = (el: Element, side: string) =>
    parseFloat(getComputedStyle(el).getPropertyValue(`border-${side}-width`)) || 0;
  const nameOf = (el: Element) =>
    `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`;
  const containers = [
    section,
    ...Array.from(section.querySelectorAll('[data-settings-group], [data-settings-row]')),
  ];
  const boxedContainers = containers
    .filter((el) => ['left', 'right', 'bottom'].some((side) => width(el, side) > 0))
    .map(nameOf);
  const boxedAncestors = new Set<string>();
  for (const row of Array.from(section.querySelectorAll('[data-settings-row]'))) {
    for (let el = row.parentElement; el && el !== section; el = el.parentElement) {
      if (['top', 'right', 'bottom', 'left'].every((side) => width(el as Element, side) > 0)) {
        boxedAncestors.add(nameOf(el));
      }
    }
  }
  const groups = Array.from(section.querySelectorAll('[data-settings-group]'));
  const dividersOk = groups.every((group) => {
    const prev = group.previousElementSibling;
    if (!prev || !prev.hasAttribute('data-settings-group')) return true;
    return width(group, 'top') === 1 && getComputedStyle(group).borderTopStyle === 'solid';
  });
  return {
    groups: groups.length,
    rows: section.querySelectorAll('[data-settings-row]').length,
    boxedContainers,
    boxedAncestors: Array.from(boxedAncestors),
    dividersOk,
  };
}

describe('设置中心弹窗', () => {
  it('从头像与齿轮菜单打开都稳定：一直存在、不跳动', async () => {
    const { page } = suite;
    await page.click('[aria-label="打开设置中心"]');
    await page.waitForTarget(DIALOG);
    const first = await sampleDialog();
    expect(first.includes('none')).toBe(false);
    expect(new Set(first).size).toBe(1);
    await closeDialog();

    await page.click('[aria-label="打开设置"]');
    await page.click({ text: '设置中心', exact: true });
    await page.waitForTarget(DIALOG);
    const second = await sampleDialog();
    expect(second.includes('none')).toBe(false);
    expect(new Set(second).size).toBe(1);
  });

  it('从弹窗里按下、在遮罩上松开（拖选文字拖出去）不会关闭；在遮罩上点击才关闭', async () => {
    const { page } = suite;
    if (!(await page.exists(DIALOG))) {
      await page.click('[aria-label="打开设置中心"]');
      await page.waitForTarget(DIALOG);
    }
    await page.evaluate((selector: string) => {
      const dialog = document.querySelector(selector) as HTMLElement;
      const overlay = dialog.parentElement as HTMLElement;
      dialog.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    }, DIALOG);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await page.exists(DIALOG)).toBe(true);
    await page.evaluate((selector: string) => {
      const overlay = (document.querySelector(selector) as HTMLElement)
        .parentElement as HTMLElement;
      overlay.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    }, DIALOG);
    await page.waitForGone(DIALOG);
  });

  it('弹窗里的下拉列表浮在弹窗之上：配音默认语言可以切换并保存', async () => {
    const { page } = suite;
    await page.click('[aria-label="打开设置中心"]');
    await page.waitForTarget(DIALOG);
    await page.click({ text: 'AI', within: DIALOG, exact: true });
    const trigger = `${DIALOG} [role="combobox"][aria-label="配音默认语言"]`;
    await page.waitForTarget(trigger);
    // 模型列表与代理设置异步读取完成后再定位（读完会改变布局，点击坐标可能落空）
    await page.waitForTarget({
      text: '添加模型',
      within: '[data-testid="ai-section-speech"]',
      exact: true,
    });
    await page.waitForTarget(`${DIALOG} [role="combobox"][aria-label="代理方式"]`);
    await page.evaluate((selector: string) => {
      document.querySelector(selector)?.scrollIntoView({ block: 'center' });
      return true;
    }, trigger);
    await page.click(trigger);
    await page.waitForTarget('[role="listbox"][aria-label="配音默认语言"]');
    // 选项中心点上最上层的元素就是选项本身（没有被弹窗遮住）
    const topmost = await page.evaluate<{ label: string; ok: boolean }>(() => {
      const options = Array.from(
        document.querySelectorAll('[role="listbox"][aria-label="配音默认语言"] [role="option"]')
      ) as HTMLElement[];
      const target = options.find((option) => option.getAttribute('aria-selected') !== 'true')!;
      const rect = target.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { label: target.textContent ?? '', ok: Boolean(hit && target.contains(hit)) };
    });
    expect(topmost.ok).toBe(true);
    await captureForReview(page, 'settings-language-select');
    await page.click({
      text: topmost.label,
      within: '[role="listbox"][aria-label="配音默认语言"]',
      exact: true,
    });
    await page.waitForGone('[role="listbox"][aria-label="配音默认语言"]');
    expect(await page.exists(DIALOG)).toBe(true);
    await page.waitFor(
      async () => {
        const result = (await window.electron.ipcRenderer.invoke('video-settings-get')) as {
          ok: boolean;
          data?: { voiceLanguage?: string };
        };
        return result.ok && result.data?.voiceLanguage && result.data.voiceLanguage !== 'zh-CN'
          ? result.data.voiceLanguage
          : null;
      },
      { message: '配音默认语言已保存' }
    );
    await closeDialog();
  });

  it('每个分区都是无边框的行式版式：分组之间只有分隔线；AI 总开关醒目、能力分组之间有分隔线', async () => {
    const { page } = suite;
    if (!(await page.exists(DIALOG))) {
      await page.click('[aria-label="打开设置中心"]');
      await page.waitForTarget(DIALOG);
    }
    for (const [tab, title, id] of SETTINGS_TABS) {
      await page.click({ text: tab, within: `${DIALOG} [class*="sidebar"]`, exact: true });
      await page.waitFor(
        (selector: string, heading: string) => {
          const h4 = document.querySelector(`${selector} [data-settings-section] h4`);
          const rows = document.querySelectorAll(`${selector} [data-settings-row]`).length;
          return h4?.textContent?.trim() === heading && rows > 0;
        },
        { args: [DIALOG, title], message: `「${tab}」分区已渲染` }
      );
      const report = await page.evaluate<LayoutReport>(inspectLayout, DIALOG);
      expect(report.groups, tab).toBeGreaterThan(0);
      expect(report.boxedContainers, tab).toEqual([]);
      expect(report.boxedAncestors, tab).toEqual([]);
      expect(report.dividersOk, tab).toBe(true);
      await captureForReview(page, `settings-tab-${id}`);

      if (id !== 'ai') continue;
      const ai = await page.evaluate<{
        tone: string | null;
        checked: boolean;
        labelColor: string;
        background: string;
        shadow: string;
        hint: boolean;
        dividers: string[];
      }>(() => {
        const row = document.querySelector('[data-testid="ai-master-row"]') as HTMLElement;
        const input = row.querySelector('input[role="switch"]') as HTMLInputElement;
        const label = row.querySelector('[class*="rowLabel"]') as HTMLElement;
        const style = getComputedStyle(row);
        return {
          tone: row.getAttribute('data-tone'),
          checked: input.checked,
          labelColor: getComputedStyle(label).color,
          background: style.backgroundImage,
          shadow: style.boxShadow,
          hint: (row.textContent ?? '').includes('已关闭：AI 功能不会发送请求'),
          dividers: ['text', 'image', 'video', 'speech'].map((capability) => {
            const group = document.querySelector(
              `[data-testid="ai-section-${capability}"]`
            ) as HTMLElement;
            const groupStyle = getComputedStyle(group);
            return `${groupStyle.borderTopWidth} ${groupStyle.borderTopStyle}`;
          }),
        };
      });
      // 标签为强调色文字（--ui-interaction-accent-fg）
      expect(ai.labelColor).toBe('rgb(140, 196, 236)');
      if (ai.checked) {
        expect(ai.tone).toBe('emphasis');
        expect(ai.background).not.toBe('none');
        expect(ai.hint).toBe(false);
      } else {
        expect(ai.tone).toBe('attention');
        expect(ai.shadow).not.toBe('none');
        expect(ai.hint).toBe(true);
      }
      // 总开关之后的每个能力分组上方都有一条 1px 分隔线
      expect(ai.dividers).toEqual(Array(4).fill('1px solid'));
    }
    await closeDialog();
  });

  it('不带 key 的 keydown（输入框自动填充等）不会让全局快捷键报错', async () => {
    await suite.page.evaluate(() => {
      window.dispatchEvent(new Event('keydown'));
      document.dispatchEvent(new Event('keydown', { bubbles: true }));
      return true;
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    // 未捕获异常由 setupAppSuite 在用例结束时检查
  });
});
