/**
 * 设置中心弹窗：打开后稳定不消失；从弹窗里拖到遮罩上不会误关；弹窗里的下拉列表浮在弹窗之上、可以切换；
 * 不带 key 的 keydown（输入框自动填充等）不会让全局快捷键报错
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
