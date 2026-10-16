import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it } from 'vitest';
import { launchUiHost } from './host';
import { PRIMARY_MODIFIER } from '../../../apps/pc/e2e/support/page';

describe('共享 UI：真实 Electron Chromium 交互', () => {
  let host: Awaited<ReturnType<typeof launchUiHost>>;
  beforeAll(async () => {
    host = await launchUiHost();
  });
  afterAll(async () => {
    await host?.stop();
  });
  beforeEach(async () => {
    await host.page.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1080,
      height: 860,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const previousOrigin = await host.page.evaluate<number>(() => performance.timeOrigin);
    await host.page.cdp.send('Page.reload');
    await host.page.waitFor(
      '(origin) => performance.timeOrigin !== origin && document.readyState === "complete" && !!document.querySelector("#open-modal")',
      { args: [previousOrigin] }
    );
  });
  afterEach(async (context) => {
    if (!host) return;
    const issues = host.page.takeIssues();
    if (context.task.result?.state === 'fail' || issues.length) {
      await host.page.screenshot(context.task.name);
      await host.saveLog();
    }
    expect(issues, '浏览器不应产生未捕获异常或 console.error').toEqual([]);
  });

  it('表单输入、提交、数值边界与开关', async () => {
    const { page } = host;
    await page.click('[aria-label="名称"]');
    // CDP does not dispatch macOS menu accelerators; send Chromium's native edit command.
    await page.cdp.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: 'a',
      commands: ['selectAll'],
    });
    await page.type('苏晴');
    await page.click({ text: '保存表单', exact: true });
    await page.waitFor(() => document.querySelector('#saved')?.textContent === '苏晴');
    await page.click('[aria-label="状态"][role="combobox"]');
    await page.press('End');
    await page.press('Enter');
    await page.waitFor(
      () => document.querySelector('[aria-label="状态"][role="combobox"]')?.textContent === '完成'
    );
    await page.click('[aria-label="数量"]');
    await page.press('End');
    await page.press('ArrowUp');
    expect(
      await page.evaluate(() =>
        document.querySelector('[aria-label="数量"]')?.getAttribute('aria-valuenow')
      )
    ).toBe('5');
    await page.click({ text: '常驻', exact: true });
    await page.click({ text: '启用', exact: true });
    expect(
      await page.evaluate(() =>
        [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map(
          (element) => element.checked
        )
      )
    ).toEqual([true, true]);
  });

  it('Tabs 跳过禁用项，多选搜索与移除', async () => {
    const { page } = host;
    await page.click('[role="tab"]');
    await page.press('ArrowRight');
    await page.waitFor(() => document.querySelector('#tab')?.textContent === 'done');
    await page.click('[aria-label="关联人物"][role="combobox"]');
    await page.type('苏');
    await page.press('Enter');
    await page.waitFor(() => document.querySelector('#selected')?.textContent === 'su');
    await page.press('Escape');
    await page.click('[aria-label="移除苏晴"]');
    await page.waitFor(() => document.querySelector('#selected')?.textContent === '');
  });

  it('差异文本真实输入和撤销，重命名保留扩展名', async () => {
    const { page } = host;
    await page.click('[aria-label="差异文本"]');
    await page.press('a', [PRIMARY_MODIFIER]);
    await page.type('新称呼');
    await page.waitFor(() => document.querySelector('#current-text')?.textContent === '新称呼');
    expect(await page.evaluate(() => document.querySelector('del')?.textContent)).toBe('旧');
    await page.press('z', [PRIMARY_MODIFIER]);
    await page.waitFor(() => document.querySelector('#current-text')?.textContent === '旧称呼');
    await page.click({ text: '旧名.md', exact: true });
    await page.type('新名');
    await page.press('Enter');
    await page.waitForTarget({ text: '新名.md', exact: true });
  });

  it('嵌套 Select 的选中和 Escape 不会误关父浮层', async () => {
    const { page } = host;
    await page.click({ text: '打开浮层', exact: true });
    await page.click('[aria-label="浮层状态"][role="combobox"]');
    await page.click({ text: '持有', within: '[role="listbox"]', exact: true });
    await page.waitForTarget({ text: '父浮层', exact: true });
    await page.click('[aria-label="浮层状态"][role="combobox"]');
    await page.press('Escape');
    await page.waitForGone('[role="listbox"]');
    await page.waitForTarget({ text: '父浮层', exact: true });
    await page.press('Escape');
    await page.waitForGone({ text: '父浮层', exact: true });
  });

  it('原生 Modal 内下拉可点击，Tab 焦点约束、Escape 与焦点恢复', async () => {
    const { page } = host;
    await page.click('#open-modal');
    await page.waitFor(() => document.activeElement?.getAttribute('aria-label') === '弹窗名称');
    await page.click('[aria-label="弹窗状态"][role="combobox"]');
    await page.click({ text: '完成', within: '[role="listbox"]', exact: true });
    await page.waitFor(
      () => document.querySelector('[aria-label="弹窗状态"]')?.textContent === '完成'
    );
    await page.click('[aria-label="弹窗状态"][role="combobox"]');
    await page.press('Escape');
    await page.waitForGone('[role="listbox"]');
    await page.waitForTarget('dialog');
    for (let i = 0; i < 6; i++) {
      await page.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
    }
    await page.press('Escape');
    await page.waitForGone('dialog');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('open-modal');
  });

  it('颜色确认与取消，通知可关闭', async () => {
    const { page } = host;
    await page.click('[aria-label="选择高亮颜色"]');
    await page.click('[aria-label="选择 #A2C5AF"]');
    await page.click({ text: '取消', exact: true });
    expect(await page.evaluate(() => document.querySelector('#color')?.textContent)).toBe(
      '#112233'
    );
    await page.click('[aria-label="选择高亮颜色"]');
    await page.click('[aria-label="选择 #A2C5AF"]');
    await page.click({ text: '应用颜色', exact: true });
    await page.waitFor(() => document.querySelector('#color')?.textContent === '#A2C5AF');
    await page.click({ text: '确认与通知', exact: true });
    await page.waitForTarget('[role="dialog"]');
    await page.press('Enter');
    await page.waitForTarget({ text: '已保存', exact: true });
    await page.click('[aria-label="关闭通知"]');
    await page.waitForGone({ text: '已保存', exact: true });
  });

  it('窄窗口控件不撑破布局，文本域禁止拖动尺寸', async () => {
    const { page } = host;
    await page.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 420,
      height: 860,
      deviceScaleFactor: 1,
      mobile: false,
    });
    expect(
      await page.evaluate(() => getComputedStyle(document.querySelector('textarea')!).resize)
    ).toBe('none');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await page.click('[aria-label="状态"][role="combobox"]');
    expect(
      await page.evaluate(() => {
        const rect = document.querySelector('[role="listbox"]')!.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= window.innerWidth;
      })
    ).toBe(true);
  });
});
