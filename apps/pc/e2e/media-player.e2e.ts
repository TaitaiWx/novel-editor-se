/**
 * 视频播放器（独立的 Electron 实例）：小说格式示例.md 里就地渲染的 ::video
 *
 * - 截图：控制条「截图」→ 主进程另存为（media-save-generated）→ 写出 PNG
 * - 录制：开始约 1 秒后停止 → 写出 WebM / MP4
 * - 设置菜单：播放速度 1.5x 生效
 * - 全屏：控制按钮的悬停提示挂在全屏元素里（挂到 body 的提示在全屏时看不见）
 * 另存为对话框由 NOVEL_EDITOR_E2E_SAVE_PATH 替代（不带扩展名，主进程按格式补上）。
 */
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { captureForReview, ensureSidebarOpen, setupAppSuite } from './support/suite';
import { SEL, openProjectDocs, selectWork, waitForEditorText } from './support/workbench';
import { FIXTURE_WORK } from './support/fixture';

const SAVE_BASE = path.join(os.tmpdir(), `media-player-save-${process.pid}`);
process.env.NOVEL_EDITOR_E2E_SAVE_PATH = SAVE_BASE;

const suite = setupAppSuite({ fixture: { prefix: 'novel-editor-e2e-media-player-' } });

const PLAYER = '.cm-content .cm-lp-video [role="group"]';
const VIDEO = '.cm-content video.cm-lp-video-player';

afterAll(async () => {
  delete process.env.NOVEL_EDITOR_E2E_SAVE_PATH;
  await Promise.all(
    ['.png', '.webm', '.mp4'].map((ext) => rm(`${SAVE_BASE}${ext}`, { force: true }))
  );
});

/** 控制条只在暂停 / 悬停时可点：先把鼠标移到播放器上，等按钮可交互再点击 */
async function clickControl(label: string): Promise<void> {
  const { page } = suite;
  const selector = `${PLAYER} button[aria-label="${label}"]`;
  await page.hover(PLAYER);
  await page.waitFor(
    (target: string) => {
      const button = document.querySelector(target);
      return !!button && getComputedStyle(button).pointerEvents !== 'none';
    },
    { args: [selector], message: `控制按钮可点击：${label}` }
  );
  await page.click(selector);
}

function hasPrefix(bytes: Buffer, prefix: number[], offset = 0): boolean {
  return prefix.every((value, index) => bytes[offset + index] === value);
}

describe('视频播放器', () => {
  it('打开小说格式示例，就地视频读到画面', async () => {
    const { page } = suite;
    await ensureSidebarOpen(page);
    await selectWork(page, FIXTURE_WORK);
    await openProjectDocs(page);
    await page.click({ text: '小说格式示例', within: SEL.projectNotes, exact: true });
    await waitForEditorText(page, '星港城的黄昏是橘红色的');
    await page.waitFor(
      (selector: string) =>
        ((document.querySelector(selector) as HTMLVideoElement | null)?.readyState ?? 0) >= 2,
      { args: [VIDEO], timeout: 15_000, message: '示例视频已有画面' }
    );
    // 控制条：截图、设置常在；录制 / 画中画按能力显示（Electron 都支持）
    for (const label of ['截图', '开始录制', '画中画', '设置', '全屏']) {
      expect(await page.exists(`${PLAYER} button[aria-label="${label}"]`)).toBe(true);
    }
  });

  it('截图：写出 PNG 文件', async () => {
    const { page } = suite;
    await clickControl('截图');
    const png = await page.waitUntil(
      async () => {
        if (!existsSync(`${SAVE_BASE}.png`)) return null;
        const bytes = await readFile(`${SAVE_BASE}.png`);
        return bytes.length > 100 ? bytes : null;
      },
      { timeout: 10_000, message: '截图已保存' }
    );
    expect(hasPrefix(png, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).toBe(true);
    await page.waitFor(
      (selector: string) =>
        document.querySelector(`${selector} [data-testid="video-notice"]`)?.textContent ===
        '已截图',
      { args: [PLAYER], message: '播放器提示已截图' }
    );
  });

  it('录制：开始约 1 秒后停止，写出 WebM / MP4', async () => {
    const { page } = suite;
    await clickControl('开始录制');
    await page.waitFor(
      (selector: string) =>
        document.querySelector(selector)?.getAttribute('data-recording') === 'true',
      { args: [PLAYER], timeout: 10_000, message: '开始录制' }
    );
    // 录制会自动开始播放
    expect(
      await page.evaluate<boolean>(
        (selector: string) => (document.querySelector(selector) as HTMLVideoElement).paused,
        VIDEO
      )
    ).toBe(false);
    await captureForReview(page, 'media-player-recording');
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await clickControl('停止录制');
    const saved = await page.waitUntil(
      async () => {
        for (const ext of ['.webm', '.mp4']) {
          const file = `${SAVE_BASE}${ext}`;
          if (!existsSync(file)) continue;
          const bytes = await readFile(file);
          if (bytes.length > 1000) return { ext, bytes };
        }
        return null;
      },
      { timeout: 15_000, message: '录制已保存' }
    );
    if (saved.ext === '.webm') expect(hasPrefix(saved.bytes, [0x1a, 0x45, 0xdf, 0xa3])).toBe(true);
    else expect(hasPrefix(saved.bytes, [0x66, 0x74, 0x79, 0x70], 4)).toBe(true);
    await page.waitFor(
      (selector: string) => !document.querySelector(selector)?.hasAttribute('data-recording'),
      { args: [PLAYER], message: '录制结束' }
    );
  });

  it('设置菜单：播放速度 1.5x', async () => {
    const { page } = suite;
    await page.evaluate((selector: string) => {
      (document.querySelector(selector) as HTMLVideoElement).pause();
    }, VIDEO);
    await clickControl('设置');
    await page.waitForTarget(`${PLAYER} [role="menu"][aria-label="播放设置"]`);
    await page.click({ text: '播放速度', within: `${PLAYER} [role="menu"]` });
    await page.click({ text: '1.5x', within: `${PLAYER} [role="menu"]`, exact: true });
    await page.waitForGone(`${PLAYER} [role="menu"]`);
    expect(
      await page.evaluate<number>(
        (selector: string) => (document.querySelector(selector) as HTMLVideoElement).playbackRate,
        VIDEO
      )
    ).toBe(1.5);
  });

  // 全屏时悬停提示挂在全屏元素里：真实的系统全屏在 macOS 上偶尔让渲染进程卡住超过 30 秒（CDP 超时），
  // 改由单元测试覆盖（packages/media-player/test/PlayerFeatures.test.tsx、test/render/components/Tooltip.test.tsx）
});
