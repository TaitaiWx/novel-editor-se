/**
 * 文件面板行布局：人物的「分类 · 定位」、设定的 #标签 紧跟在名字后面（靠左），不被推到行尾
 */
import { describe, expect, it } from 'vitest';
import { captureForReview, ensureSidebarOpen, setupAppSuite } from './support/suite';
import { SEL, selectWork } from './support/workbench';
import { FIXTURE_WORK } from './support/fixture';

const suite = setupAppSuite({ fixture: { prefix: 'novel-editor-e2e-panel-layout-' } });

interface RowGap {
  name: string;
  gap: number;
  metaLeftAligned: boolean;
}

/** 每一行：名字右边缘到说明文字左边缘的距离；说明文字左对齐 */
function measureRows(section: string): Promise<RowGap[]> {
  return suite.page.evaluate<RowGap[]>((selector: string) => {
    return Array.from(document.querySelectorAll(`${selector} [class*="objectNodePrimary"]`)).map(
      (primary) => {
        const title = primary.querySelector('[class*="objectNodeTitle"]') as HTMLElement;
        const meta = primary.parentElement?.querySelector(
          '[class*="objectNodeMetaInline"]'
        ) as HTMLElement | null;
        const primaryRect = primary.getBoundingClientRect();
        const metaRect = meta?.getBoundingClientRect();
        return {
          name: title?.textContent ?? '',
          gap: metaRect ? metaRect.left - primaryRect.right : -1,
          metaLeftAligned: meta ? getComputedStyle(meta).textAlign !== 'right' : false,
        };
      }
    );
  }, section);
}

describe('文件面板行布局', () => {
  it('人物与设定行：说明文字紧跟名字（间距 ≤ 16px），靠左显示', async () => {
    const { page } = suite;
    await ensureSidebarOpen(page);
    await selectWork(page, FIXTURE_WORK);
    const characters = `${SEL.workspaceTree} section[aria-label="角色"]`;
    const lore = `${SEL.workspaceTree} section[aria-label="设定"]`;
    await page.waitForTarget({ text: '林舟', within: characters, exact: true });
    await page.waitForTarget({ text: '星河大陆', within: lore, exact: true });
    for (const section of [characters, lore]) {
      const rows = await measureRows(section);
      expect(rows.length).toBeGreaterThan(2);
      for (const row of rows) {
        expect(row.gap, `${row.name} 的说明文字应紧跟名字`).toBeGreaterThanOrEqual(0);
        expect(row.gap, `${row.name} 的说明文字应紧跟名字`).toBeLessThanOrEqual(16);
        expect(row.metaLeftAligned).toBe(true);
      }
    }
    await captureForReview(page, 'file-panel-rows-left-aligned');
  });
});
