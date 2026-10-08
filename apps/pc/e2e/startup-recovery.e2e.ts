/**
 * 启动恢复：主帧加载失败（例如构建产物正被重建、文件暂时不存在）时等一会儿自动重试并恢复；
 * 安全模式错误页的「重试启动」（改 hash）会让主进程重新加载渲染界面
 */
import { describe, expect, it } from 'vitest';
import { setupAppSuite } from './support/suite';

const suite = setupAppSuite({
  fixture: { prefix: 'novel-editor-e2e-startup-recovery-' },
  // 主帧加载失败时主进程会打印错误日志，渲染进程本身没有错误
  allowedIssues: [/ERR_FILE_NOT_FOUND/, /Failed to load resource/],
});

const WORKBENCH = '[aria-label="打开设置中心"]';

/** 在当前页面放一个标记：页面被重新加载后标记消失 */
async function markPage(): Promise<void> {
  await suite.page.evaluate(() => {
    (window as unknown as { __recoveryMark?: boolean }).__recoveryMark = true;
    return true;
  });
}

async function waitForReloadedWorkbench(timeout: number): Promise<void> {
  await suite.page.waitFor(
    (selector: string) =>
      !(window as unknown as { __recoveryMark?: boolean }).__recoveryMark &&
      Boolean(document.querySelector(selector)),
    { args: [WORKBENCH], timeout, message: '渲染界面重新加载完成' }
  );
}

describe('启动恢复', () => {
  it('主帧加载失败（文件不存在）后自动等待重试，回到正常界面', async () => {
    const { page } = suite;
    await page.waitForTarget(WORKBENCH, 20_000);
    await markPage();
    // 让主帧导航到一个不存在的文件：触发 did-fail-load（ERR_FILE_NOT_FOUND）
    await page.evaluate(() => {
      setTimeout(() => {
        window.location.href = 'file:///novel-editor-e2e-missing/index.html';
      }, 0);
      return true;
    });
    await waitForReloadedWorkbench(20_000);
    expect(await page.exists('#retry')).toBe(false);
  });

  it('安全模式错误页的「重试启动」（改 hash）让主进程重新加载渲染界面', async () => {
    const { page } = suite;
    await page.waitForTarget(WORKBENCH, 20_000);
    await markPage();
    await page.evaluate(() => {
      window.location.hash = 'retry-startup';
      return true;
    });
    await waitForReloadedWorkbench(20_000);
  });
});
