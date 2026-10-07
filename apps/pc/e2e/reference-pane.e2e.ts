/**
 * 参考窗格（独立的 Electron 实例）
 *
 * - 预解析：打开文档稍候再点「参考」，窗格在同一次点击后立即出现，第一张就是本章第一个引用，之后不重排
 * - 文件栏「参考」在 小说格式示例.md 上：本章 ::video[离港] 与 ::image、人物图，按来源分组
 * - 拖动缩略图排序；资料树拖来的文件加入窗格
 * - 「在资料中定位」：切换到所属作品、展开祖先目录、滚动到该行并高亮
 * - 磁盘上的图片被覆盖后窗格自动重新读取
 * - 单独导出：视频原样复制、图片原格式 / 转 JPEG（另存为对话框由 NOVEL_EDITOR_E2E_SAVE_PATH 替代）
 */
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { captureForReview, ensureSidebarOpen, setupAppSuite } from './support/suite';
import { SEL, openProjectDocs, selectWork, waitForEditorText } from './support/workbench';
import { FIXTURE_WORK } from './support/fixture';

// 另存为替身：不带扩展名，主进程按导出格式补上（.mp4 / .png / .jpg）
const SAVE_BASE = path.join(os.tmpdir(), `reference-pane-export-${process.pid}`);
process.env.NOVEL_EDITOR_E2E_SAVE_PATH = SAVE_BASE;

const suite = setupAppSuite({ fixture: { prefix: 'novel-editor-e2e-reference-' } });

const PANE = '[data-testid="reference-pane"]';
const TILE = `${PANE} [data-testid="reference-tile"]`;
const MATERIALS = `${SEL.workspaceTree} section[aria-label="资料"]`;

afterAll(async () => {
  delete process.env.NOVEL_EDITOR_E2E_SAVE_PATH;
  await Promise.all(
    ['.mp4', '.png', '.jpg'].map((ext) => rm(`${SAVE_BASE}${ext}`, { force: true }))
  );
});

/** 生成一张纯色 RGB PNG（width × height） */
function makePng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 位深
  header[9] = 2; // RGB
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) row.set([200, 120, 60], 1 + x * 3);
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function tilePaths(): Promise<string[]> {
  return suite.page.evaluate<string[]>(
    (selector: string) =>
      Array.from(document.querySelectorAll(selector)).map(
        (tile) => tile.getAttribute('data-path') ?? ''
      ),
    TILE
  );
}

async function selectTile(endsWith: string): Promise<void> {
  const { page } = suite;
  // 用 DOM 点击：导出后的提示条可能盖住窗格底部的缩略图
  await page.evaluate(
    (selector: string, suffix: string) => {
      const tile = Array.from(document.querySelectorAll<HTMLElement>(selector)).find((node) =>
        (node.getAttribute('data-path') ?? '').endsWith(suffix)
      );
      tile?.click();
    },
    TILE,
    endsWith
  );
  await page.waitFor(
    (selector: string) =>
      document.querySelector(selector)?.getAttribute('aria-selected') === 'true',
    { args: [`${TILE}[data-path$="${endsWith}"]`], message: `选中 ${endsWith}` }
  );
}

describe('参考窗格', () => {
  it('预解析后点「参考」立即打开：第一张是本章第一个引用，之后顺序不变', async () => {
    const { page } = suite;
    await ensureSidebarOpen(page);
    await selectWork(page, FIXTURE_WORK);
    await openProjectDocs(page);
    await page.click({ text: '小说格式示例', within: SEL.projectNotes, exact: true });
    await waitForEditorText(page, '星港城的黄昏是橘红色的');
    // 等预解析（防抖 300ms + 空闲）把本章引用放进缓存
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const opened = await page.evaluate<{
      elapsed: number;
      title: string;
      pending: boolean;
      paths: string[];
    }>(
      async (pill: string, pane: string, tile: string) => {
        const started = performance.now();
        (document.querySelector(pill) as HTMLElement).click();
        // React 在点击事件结束后的微任务里提交，最多等 50ms
        while (!document.querySelector(pane) && performance.now() - started < 50) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        const tiles = Array.from(document.querySelectorAll<HTMLElement>(tile));
        return {
          elapsed: document.querySelector(pane) ? performance.now() - started : -1,
          title: tiles[0]?.querySelector(':scope > span:last-of-type')?.textContent ?? '',
          pending: tiles.some((node) => node.getAttribute('data-pending') === 'true'),
          paths: tiles.map((node) => node.getAttribute('data-path') ?? ''),
        };
      },
      '[data-testid="reference-pill"]',
      PANE,
      TILE
    );
    expect(opened.elapsed).toBeGreaterThanOrEqual(0);
    expect(opened.elapsed).toBeLessThan(50);
    expect(opened.title).toBe('星港城 · 码头');
    expect(opened.pending).toBe(false);
    expect(opened.paths[0].endsWith('星港城商会/图片.webp')).toBe(true);
    expect(
      await page.evaluate<string>(
        (pane: string) => document.querySelector(`${pane} header span`)?.textContent ?? '',
        PANE
      )
    ).toBe('星港城 · 码头');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(await tilePaths()).toEqual(opened.paths);
    // 收起，后面的用例重新打开
    await page.click('[data-testid="reference-pill"]');
    await page.waitForGone(PANE);
  });

  it('「参考」按钮：本章的视频 离港 与图片、人物图，按来源分组', async () => {
    const { page } = suite;
    await ensureSidebarOpen(page);
    // 人物图跟随当前作品：先切到「星河旅人」（示例人物都有三视图 / 形象图）
    await selectWork(page, FIXTURE_WORK);
    await openProjectDocs(page);
    await page.click({ text: '小说格式示例', within: SEL.projectNotes, exact: true });
    await waitForEditorText(page, '星港城的黄昏是橘红色的');
    await page.click('[data-testid="reference-pill"]');
    await page.waitFor((selector: string) => document.querySelectorAll(selector).length >= 3, {
      args: [TILE],
      message: '参考网格出现本章与人物参考',
    });
    const paths = await tilePaths();
    expect(paths.some((item) => item.endsWith('离港.mp4'))).toBe(true);
    expect(paths.some((item) => item.endsWith('星港城商会/图片.webp'))).toBe(true);
    expect(paths.filter((item) => /\.(webp|png)$/.test(item)).length).toBeGreaterThan(1);
    // 本章引用在前
    expect(paths.slice(0, 2).every((item) => /离港\.mp4$|图片\.webp$/.test(item))).toBe(true);
    const groups = await page.evaluate<string[]>(() =>
      Array.from(document.querySelectorAll('[data-testid="reference-group"]')).map(
        (node) => node.textContent ?? ''
      )
    );
    expect(groups[0]).toBe('本章');
    expect(groups).toContain('人物');
    await captureForReview(page, 'reference-pane-auto');
  });

  it('拖动缩略图排序', async () => {
    const { page } = suite;
    const before = await tilePaths();
    // 把第一张拖到第三张的右半边（HTML5 拖放用脚本构造的 DataTransfer 派发）
    await page.evaluate((selector: string) => {
      const tiles = Array.from(document.querySelectorAll<HTMLElement>(selector));
      const source = tiles[0];
      const target = tiles[2].parentElement as HTMLElement;
      const data = new DataTransfer();
      const rect = target.getBoundingClientRect();
      const point = { clientX: rect.right - 4, clientY: rect.top + rect.height / 2 };
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data }));
      target.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data, ...point })
      );
      target.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data, ...point })
      );
      source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: data }));
    }, TILE);
    await page.waitFor(
      (selector: string, first: string) =>
        document.querySelectorAll(selector)[2]?.getAttribute('data-path') === first,
      { args: [TILE, before[0]], message: '第一张移到第三位' }
    );
    const after = await tilePaths();
    expect(after.slice(0, 3)).toEqual([before[1], before[2], before[0]]);
  });

  it('资料树拖来的文件加入窗格', async () => {
    const { page, fixture } = suite;
    const shot = path.join(fixture.root, 'novels', '星河旅人', '资料', '素材', '场景截图.png');
    await page.evaluate(
      (selector: string, filePath: string) => {
        const pane = document.querySelector(selector) as HTMLElement;
        const data = new DataTransfer();
        data.setData('application/x-novel-editor-path', filePath);
        pane.dispatchEvent(
          new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data })
        );
        pane.dispatchEvent(
          new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data })
        );
      },
      PANE,
      shot
    );
    await page.waitForTarget(`${TILE}[data-path$="场景截图.png"]`);
  });

  it('「在资料中定位」：展开祖先目录，滚动到该行并高亮', async () => {
    const { page } = suite;
    await selectTile('离港.mp4');
    await page.click(`${PANE} [aria-label="在资料中定位"]`);
    const row = `${MATERIALS} [data-path$="离港.mp4"]`;
    await page.waitFor(
      (selector: string) =>
        document.querySelector(selector)?.getAttribute('data-revealed') === 'true',
      { args: [row], message: '资料树高亮 离港.mp4' }
    );
    const visible = await page.evaluate<boolean>((selector: string) => {
      const element = document.querySelector(selector) as HTMLElement;
      let scroller = element.parentElement;
      while (scroller && scroller.scrollHeight <= scroller.clientHeight) {
        scroller = scroller.parentElement;
      }
      const rect = element.getBoundingClientRect();
      const box = (scroller ?? document.documentElement).getBoundingClientRect();
      return rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1 && rect.height > 0;
    }, row);
    expect(visible).toBe(true);
    // 作品切到「星河旅人」，祖先目录 视频 / 示例 都已展开
    expect(await page.exists({ text: '示例', within: MATERIALS, exact: true })).toBe(true);
    await captureForReview(page, 'reference-pane-reveal');
  });

  it('磁盘上的图片被覆盖后自动重新读取', async () => {
    const { page, fixture } = suite;
    await selectTile('场景截图.png');
    const image = `${PANE} [data-testid="reference-image"]`;
    await page.waitFor(
      (selector: string) =>
        (document.querySelector(selector) as HTMLImageElement | null)?.naturalWidth === 160,
      { args: [image], message: '原图 160 宽' }
    );
    const shot = path.join(fixture.root, 'novels', '星河旅人', '资料', '素材', '场景截图.png');
    await writeFile(shot, makePng(48, 32));
    await page.waitFor(
      (selector: string) =>
        (document.querySelector(selector) as HTMLImageElement | null)?.naturalWidth === 48,
      { args: [image], timeout: 10_000, message: '窗格显示新图片' }
    );
    expect(
      await page.evaluate<string>(
        () => document.querySelector('[data-testid="reference-info"]')?.textContent ?? ''
      )
    ).toContain('48×32');
  });

  it('单独导出：视频原样复制为 MP4，图片导出为 PNG / JPEG', async () => {
    const { page } = suite;
    await selectTile('离港.mp4');
    await page.click(`${PANE} [aria-label="导出"]`);
    const mp4 = await page.waitUntil(
      async () => (existsSync(`${SAVE_BASE}.mp4`) ? readFile(`${SAVE_BASE}.mp4`) : null),
      { message: '导出 mp4' }
    );
    expect(mp4.subarray(4, 8).toString('ascii')).toBe('ftyp');

    await selectTile('场景截图.png');
    await page.click(`${PANE} [aria-label="导出"]`);
    await page.click({ text: '导出为 PNG…', within: SEL.menu, exact: true });
    const png = await page.waitUntil(
      async () => (existsSync(`${SAVE_BASE}.png`) ? readFile(`${SAVE_BASE}.png`) : null),
      { message: '导出 png' }
    );
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    await page.click(`${PANE} [aria-label="导出"]`);
    await page.click({ text: '导出为 JPEG…', within: SEL.menu, exact: true });
    const jpg = await page.waitUntil(
      async () => (existsSync(`${SAVE_BASE}.jpg`) ? readFile(`${SAVE_BASE}.jpg`) : null),
      { message: '导出 jpg' }
    );
    expect([...jpg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });
});
