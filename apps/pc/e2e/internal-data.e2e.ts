/**
 * 内部数据不对用户展示（独立的 Electron 实例，fixture 拷贝自示例作品集）
 *
 * - 资料 → 记忆：成长档案 JSON（规则 / 队伍 / 地图 / 角色成长卡）不在资料树里，派生的可读摘要（README、角色 .md）还在；
 *   成长档案照常通过「角色 → 成长档案」使用
 * - 场景视频：分镜状态（分镜.json）与提示词记录不在资料树里；场景目录带「场景视频」标记，单击直接打开画布
 * - 搜索「分镜」不返回任何 JSON 文件
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  captureForReview,
  ensureSidebarOpen,
  openCharacterGrowth,
  setupAppSuite,
} from './support/suite';
import { SEL, refreshWorkspace, searchWorkspace, selectWork } from './support/workbench';
import { FIXTURE_CHAPTERS, FIXTURE_WORK } from './support/fixture';

const suite = setupAppSuite({ fixture: { prefix: 'novel-editor-e2e-internal-data-' } });

const SECTION_MATERIALS = `${SEL.workspaceTree} [aria-label="资料"]`;
const SCENE = '第一场 清晨的青石镇';
const SCENE_DIR = ['novels', '星河旅人', '资料', '视频', '001-启程', SCENE];

/** 资料分区里当前可见的全部行（绝对路径） */
function materialRowPaths(): Promise<string[]> {
  return suite.page.evaluate<string[]>(
    (selector: string) =>
      Array.from(document.querySelectorAll<HTMLElement>(`${selector} [data-path]`)).map(
        (row) => row.dataset.path ?? ''
      ),
    SECTION_MATERIALS
  );
}

async function expandMaterial(name: string, expectChild: string): Promise<void> {
  const { page } = suite;
  if (await page.exists({ text: expectChild, within: SECTION_MATERIALS, exact: true })) return;
  await page.click({ text: name, within: SECTION_MATERIALS, exact: true });
  await page.waitForTarget({ text: expectChild, within: SECTION_MATERIALS, exact: true });
}

describe('内部数据不对用户展示', () => {
  it('资料 → 记忆：没有 JSON，只有可读摘要；成长档案照常可用', async () => {
    const { page } = suite;
    await ensureSidebarOpen(page);
    await selectWork(page, FIXTURE_WORK);
    await expandMaterial('记忆', 'README.md');
    await expandMaterial('角色', '林舟.md');
    const rows = await materialRowPaths();
    expect(rows.some((row) => row.endsWith(`${path.sep}记忆${path.sep}README.md`))).toBe(true);
    expect(rows.filter((row) => row.toLowerCase().endsWith('.json'))).toEqual([]);
    for (const name of ['规则.json', '队伍.json', '地图.json', '林舟.json', '苏晴.json']) {
      expect(await page.exists({ text: name, within: SECTION_MATERIALS, exact: true })).toBe(false);
    }
    await captureForReview(page, 'internal-data-memory');

    // 成长档案只通过可视化界面使用：角色 → 成长档案
    await openCharacterGrowth(page, '林舟');
    // 第一次打开成长卡会弹出引导，跳过以免遮挡后续操作
    const tour = '[role="dialog"][aria-label^="引导"]';
    await page.waitForTarget(tour).catch(() => undefined);
    if (await page.exists(tour)) {
      await page.click({ text: '跳过', within: tour, exact: true });
      await page.waitForGone(tour);
    }
  }, 60_000);

  it('场景视频：目录带标记、没有 分镜.json，单击目录打开画布；搜索「分镜」不返回 JSON', async () => {
    const { page, fixture } = suite;
    const sceneDir = fixture.resolve(...SCENE_DIR);
    await mkdir(sceneDir, { recursive: true });
    await writeFile(
      path.join(sceneDir, '分镜.json'),
      JSON.stringify({
        schemaVersion: 1,
        chapterPath: fixture.resolve(FIXTURE_CHAPTERS.first.file),
        chapter: '001-启程',
        scene: SCENE,
        sourceText: '雨后清晨，林舟背着行囊走出青石镇。',
        storyboard: {
          version: 1,
          aspectRatio: '16:9',
          shots: [
            {
              id: 'shot-1',
              shotSize: '远景',
              durationSec: 6,
              description: '雨后清晨，青石镇镇口的老槐树湿漉漉地发亮',
            },
          ],
        },
        nextShotNumber: 2,
      }),
      'utf-8'
    );
    await writeFile(path.join(sceneDir, '分镜.md'), '# 分镜\n\n| 镜头 | 画面 |\n', 'utf-8');
    await writeFile(path.join(sceneDir, '镜头1-v1.prompt.json'), '{"prompt":"x"}', 'utf-8');
    await refreshWorkspace(page);

    await ensureSidebarOpen(page);
    await expandMaterial('视频', '001-启程');
    await expandMaterial('001-启程', SCENE);
    const sceneRow = `${SECTION_MATERIALS} [data-scene-video="true"]`;
    await page.waitForTarget(sceneRow);
    const badge = await page.evaluate<string>(
      (selector: string) => document.querySelector<HTMLElement>(selector)?.innerText ?? '',
      sceneRow
    );
    expect(badge).toContain(SCENE);
    expect(badge).toContain('场景视频');
    expect(await page.exists({ text: '分镜.json', within: SECTION_MATERIALS, exact: true })).toBe(
      false
    );
    expect((await materialRowPaths()).filter((row) => row.endsWith('.json'))).toEqual([]);
    await captureForReview(page, 'internal-data-scene-folder');

    // 单击场景目录：直接打开这一场的画布（不是 JSON）
    await page.click({ text: SCENE, within: SECTION_MATERIALS, exact: true });
    await page.waitForTarget('[data-testid="scene-canvas"]', 15_000);
    await page.waitForTarget({ text: `视频 · ${SCENE}`, exact: true });
    expect(await page.exists('.cm-content')).toBe(false);

    // 搜索「分镜」：只有可读的分镜表，没有任何 JSON
    await searchWorkspace(page, '分镜');
    await page.waitForTarget({ text: '分镜.md', within: SEL.searchResults });
    const titles = await page.evaluate<string[]>(
      (selector: string) =>
        Array.from(document.querySelectorAll<HTMLElement>(`${selector} [title]`)).map(
          (item) => item.getAttribute('title') ?? ''
        ),
      SEL.searchResults
    );
    expect(titles.filter((title) => title.toLowerCase().endsWith('.json'))).toEqual([]);
    await page.press('Escape');
  }, 90_000);
});
