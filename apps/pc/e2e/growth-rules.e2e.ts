/**
 * 规则之书可视化编辑（独立的 Electron 实例，fixture 拷贝自示例作品集，含星河旅人预置的记忆库）
 *
 * 林舟的成长档案 → 世界 → 规则：添加属性「气运」与技能「望气术」→ 保存 →
 * 资料/记忆/规则.json 落盘、成长卡显示新属性；全程界面上看不到原始 JSON。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GROWTH_WORKSPACE,
  captureForReview,
  ensureSidebarOpen,
  openCharacterGrowth,
  setupAppSuite,
} from './support/suite';
import { selectWork } from './support/workbench';
import { FIXTURE_MEMORY_DIR, FIXTURE_WORK } from './support/fixture';

const suite = setupAppSuite({ fixture: { prefix: 'novel-editor-e2e-growth-rules-' } });

const UNSAVED = '[role="region"][aria-label="未保存的更改"]';

interface RulesFile {
  attributes: Array<{ key: string; name: string; initial: number }>;
  skills: Array<{ id: string; name: string }>;
}

describe('规则之书：可视化编辑', () => {
  it('添加属性与技能 → 保存 → 规则.json 落盘、成长卡显示新属性，没有原始 JSON', async () => {
    const { page, fixture } = suite;
    const rulesFile = path.join(fixture.resolve(FIXTURE_MEMORY_DIR), '规则.json');
    await ensureSidebarOpen(page);
    await selectWork(page, FIXTURE_WORK);
    await openCharacterGrowth(page, '林舟');
    // 第一次打开成长卡会弹出引导，跳过以免遮挡后续操作
    const tour = '[role="dialog"][aria-label^="引导"]';
    await page.waitForTarget(tour, 3_000).catch(() => undefined);
    if (await page.exists(tour)) {
      await page.click({ text: '跳过', within: tour, exact: true });
      await page.waitForGone(tour);
    }

    await page.click({ text: '世界', within: GROWTH_WORKSPACE, exact: true });
    await page.click({ text: '规则', within: `${GROWTH_WORKSPACE} [role="tablist"]`, exact: true });
    await page.waitForTarget(`${GROWTH_WORKSPACE} [data-testid="growth-rules-attributes"]`);
    expect(await page.exists('textarea[aria-label="规则 JSON"]')).toBe(false);

    // 属性：示例有 6 项，新属性是第 7 项，键名自动生成
    await page.click({ text: '添加属性', within: GROWTH_WORKSPACE });
    await page.click('[aria-label="属性 7 名称"]');
    await page.type('气运');
    await page.click('[role="spinbutton"][aria-label="气运 初始值"]');
    await page.evaluate(() => {
      (
        document.querySelector('[role="spinbutton"][aria-label="气运 初始值"]') as HTMLInputElement
      ).select();
    });
    await page.type('3');
    await page.press('Enter');

    // 技能：示例有 4 个，新技能是第 5 个
    await page.click({ text: '添加技能', within: GROWTH_WORKSPACE });
    await page.click('[aria-label="技能 5 名称"]');
    await page.type('望气术');
    await page.waitForTarget({ text: '有未保存的更改', within: UNSAVED });
    await captureForReview(page, 'growth-rules-editor');
    await page.click({ text: '保存', within: UNSAVED, exact: true });
    await page.waitForGone(UNSAVED);

    const saved = await page.waitUntil(
      async () => {
        const data = JSON.parse(await readFile(rulesFile, 'utf-8')) as RulesFile;
        return data.attributes.some((attr) => attr.name === '气运') &&
          data.skills.some((skill) => skill.name === '望气术')
          ? data
          : null;
      },
      { message: '规则.json 写入新属性与技能' }
    );
    expect(saved.attributes.at(-1)).toMatchObject({ key: 'attr-1', name: '气运', initial: 3 });
    expect(saved.skills.at(-1)).toMatchObject({ id: 'skill-1', name: '望气术' });
    // 原有内容保留
    expect(saved.attributes.map((attr) => attr.key).slice(0, 6)).toEqual([
      'str',
      'dex',
      'con',
      'int',
      'wis',
      'cha',
    ]);

    // 成长卡（档案）显示新属性
    await page.click({ text: '档案', within: GROWTH_WORKSPACE, exact: true });
    await page.waitForTarget({ text: '气运', within: GROWTH_WORKSPACE, exact: true });
    await captureForReview(page, 'growth-rules-sheet');

    // 界面上没有原始 JSON
    const text = await page.bodyText();
    expect(text).not.toContain('"schemaVersion"');
    expect(text).not.toContain('规则.json');
  }, 90_000);
});
