/**
 * 文件面板行布局：名字、可选角色标签、说明依次紧邻（靠左），不被推到行尾
 */
import { describe, expect, it } from 'vitest';
import { captureForReview, ensureSidebarOpen, setupAppSuite } from './support/suite';
import { SEL, selectWork } from './support/workbench';
import { FIXTURE_WORK } from './support/fixture';

const suite = setupAppSuite({ fixture: { prefix: 'novel-editor-e2e-panel-layout-' } });

interface RowGap {
  name: string;
  gaps: number[];
  metaLeftAligned: boolean;
}

/** 每一行：名字 → 可选角色标签 → 说明的相邻间距；标签自身宽度不是空隙。 */
function measureRows(section: string): Promise<RowGap[]> {
  return suite.page.evaluate<RowGap[]>((selector: string) => {
    return Array.from(document.querySelectorAll(`${selector} [class*="objectNodePrimary"]`)).map(
      (primary) => {
        const title = primary.querySelector('[class*="objectNodeTitle"]') as HTMLElement;
        const meta = primary.parentElement?.querySelector(
          '[class*="objectNodeMetaInline"]'
        ) as HTMLElement | null;
        const tag = primary.parentElement?.querySelector('[class*="objectNodeTag"]');
        const parts = [primary, tag, meta].filter((part): part is Element => !!part);
        const gaps = parts
          .slice(1)
          .map(
            (part, index) =>
              part.getBoundingClientRect().left - parts[index].getBoundingClientRect().right
          );
        return {
          name: title?.textContent ?? '',
          gaps,
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
        expect(row.gaps.length).toBeGreaterThan(0);
        for (const gap of row.gaps) {
          expect(gap, `${row.name} 的标签与说明应依次紧邻`).toBeGreaterThanOrEqual(0);
          expect(gap, `${row.name} 的标签与说明应依次紧邻`).toBeLessThanOrEqual(16);
        }
        expect(row.metaLeftAligned).toBe(true);
      }
    }
    await captureForReview(page, 'file-panel-rows-left-aligned');
  });
});
