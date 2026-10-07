/**
 * 视频播放器（独立的 Electron 实例）：小说格式示例.md 里就地渲染的 ::video
 *
 * - 截图：控制条「截图」→ 主进程另存为（media-save-generated）→ 写出 PNG
 * - 录制：开始约 1 秒后停止 → 写出 WebM / MP4
 * - 设置菜单：播放速度 1.5x 生效
 * - 全屏：控制按钮的悬停提示挂在全屏元素里（挂到 body 的提示在全屏时看不见）
 * - 纯音频：测试内生成的 WAV 经参考窗格打开，显示音频界面（波形 + 常显控制条）并真正播放
 * 另存为对话框由 NOVEL_EDITOR_E2E_SAVE_PATH 替代（不带扩展名，主进程按格式补上）。
 */
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { captureForReview, ensureSidebarOpen, setupAppSuite } from './support/suite';
import { SEL, openProjectDocs, selectWork, waitForEditorText } from './support/workbench';
import { FIXTURE_MATERIAL_DIR, FIXTURE_WORK } from './support/fixture';

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

/** 生成单声道 16 位 PCM 的 WAV（正弦波），不依赖任何样本文件 */
function sineWav(seconds: number, frequency = 440, sampleRate = 8000): Buffer {
  const samples = Math.round(seconds * sampleRate);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // fmt 块长度
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // 单声道
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // 字节率
  buffer.writeUInt16LE(2, 32); // 块对齐
  buffer.writeUInt16LE(16, 34); // 位深
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    const value = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.3;
    buffer.writeInt16LE(Math.round(value * 32767), 44 + index * 2);
  }
  return buffer;
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

  it('纯音频：参考窗格打开 WAV，显示音频界面并播放', async () => {
    const { page, fixture } = suite;
    const wavPath = fixture.resolve(FIXTURE_MATERIAL_DIR, 'e2e-提示音.wav');
    await writeFile(wavPath, sineWav(4));
    // 参考窗格在编辑区旁边：单独运行本用例时先打开一个文档
    if (!(await page.exists('.cm-content'))) {
      await ensureSidebarOpen(page);
      await selectWork(page, FIXTURE_WORK);
      await openProjectDocs(page);
      await page.click({ text: '小说格式示例', within: SEL.projectNotes, exact: true });
      await waitForEditorText(page, '星港城的黄昏是橘红色的');
    }
    try {
      await page.evaluate((filePath: string) => {
        window.dispatchEvent(
          new CustomEvent('novel-editor:open-reference', {
            detail: { items: [{ path: filePath, title: '提示音', kind: 'video' }] },
          })
        );
      }, wavPath);
      const AUDIO_PLAYER = '[data-testid="reference-pane"] [role="group"][data-media="audio"]';
      await page.waitForTarget(AUDIO_PLAYER, 15_000);
      const ui = await page.evaluate<{ label: string; wave: boolean; controls: string[] }>(
        (selector: string) => {
          const group = document.querySelector(selector) as HTMLElement;
          return {
            label: group.getAttribute('aria-label') ?? '',
            wave: !!group.querySelector('[data-testid="audio-visual"]'),
            controls: Array.from(group.querySelectorAll('button[aria-label]')).map(
              (button) => button.getAttribute('aria-label') ?? ''
            ),
          };
        },
        AUDIO_PLAYER
      );
      expect(ui.label).toBe('音频 提示音');
      expect(ui.wave).toBe(true);
      expect(ui.controls).not.toContain('截图');
      expect(ui.controls).not.toContain('全屏');
      // 自动播放（静音起播）；若被策略拦下则手动播放
      await page.evaluate((selector: string) => {
        const media = document.querySelector(`${selector} video`) as HTMLVideoElement;
        if (media.paused) void media.play();
      }, AUDIO_PLAYER);
      await page.waitFor(
        (selector: string) =>
          ((document.querySelector(`${selector} video`) as HTMLVideoElement | null)?.currentTime ??
            0) > 0.5,
        { args: [AUDIO_PLAYER], timeout: 15_000, message: '音频在播放（currentTime 前进）' }
      );
      await captureForReview(page, 'media-player-audio');
      await page.click('[data-testid="reference-pane"] [aria-label="关闭参考"]');
      await page.waitForGone('[data-testid="reference-pane"]');
    } finally {
      await rm(wavPath, { force: true });
    }
  });
});
