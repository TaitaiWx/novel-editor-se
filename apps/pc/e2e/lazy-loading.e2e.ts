/** Actual Electron module loading and reopen state; bundle bytes are checked separately. */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PC_ROOT } from './support/app';
import { FIXTURE_CHAPTERS } from './support/fixture';
import { openChapter, setupAppSuite } from './support/suite';
import { SEL, openInspiration } from './support/workbench';

const suite = setupAppSuite({ fixture: { prefix: 'novel-editor-e2e-lazy-loading-' } });
const dialogModules = [
  'AppSettingsCenter/index.tsx',
  'ShortcutsHelp/index.tsx',
  'AboutDialog/index.tsx',
  'RightPanel/AIAssistantDialog.tsx',
  'InspirationDialog/index.tsx',
  'EditorGrowthRecord/index.tsx',
  'KnowledgeExportDialog/index.tsx',
];
interface Chunk {
  file: string;
  modules: string[];
}
let chunks: Chunk[];
const loadedScripts = new Set<string>();
let stopObserving: (() => void) | undefined;

beforeAll(async () => {
  const report = JSON.parse(
    await readFile(path.join(PC_ROOT, 'dist/bundle-renderer.json'), 'utf8')
  );
  expect(report.target).toBe('renderer');
  expect(report.mode).toBe('production');
  chunks = report.chunks;
  // file: modules have no ResourceTiming entries. Enabling Debugger replays existing
  // parsed scripts and reports subsequent imports without application test hooks.
  stopObserving = suite.page.cdp.on('Debugger.scriptParsed', (event) => {
    if (typeof event.url !== 'string' || !event.url.startsWith('file:')) return;
    loadedScripts.add(decodeURIComponent(new URL(event.url).pathname.split('/').pop() ?? ''));
  });
  await suite.page.cdp.send('Debugger.enable');
});
afterAll(() => stopObserving?.());

function owner(module: string): string {
  const owners = chunks.filter((chunk) => chunk.modules.includes(module));
  expect(owners).toHaveLength(1);
  return owners[0].file;
}
const mathFiles = () =>
  chunks
    .filter((chunk) => chunk.modules.some((module) => module.includes('node_modules/katex/')))
    .map((chunk) => chunk.file);
async function loadedFiles() {
  return [...loadedScripts];
}

describe('按需加载窗口与公式', () => {
  it('启动与普通 Markdown 不加载七个窗口和 KaTeX；灵感首次打开后关闭重开保留签与选项', async () => {
    const { page } = suite;
    const appFile = owner('apps/pc/src/render/App.tsx');
    const dialogFiles = dialogModules.map((module) =>
      owner(`apps/pc/src/render/components/${module}`)
    );
    const katexFiles = mathFiles();
    expect(katexFiles.length).toBeGreaterThan(0);
    await page.waitForTarget(SEL.workspaceTree);
    const initial = await page.waitUntil(
      async () => {
        const files = await loadedFiles();
        return files.includes(appFile) ? files : null;
      },
      { message: '应用入口已在 Chromium 中加载' }
    );
    // Prevent a vacuous "nothing loaded" assertion if the browser stops reporting parsed modules.
    expect(initial).toContain(appFile);
    expect(
      initial.filter((file) => dialogFiles.includes(file) || katexFiles.includes(file))
    ).toEqual([]);

    await openChapter(page, '001-启程', '林舟背起行囊');
    const previewFile = owner('apps/pc/src/render/components/TextEditor/live-preview/index.ts');
    const markdown = await page.waitUntil(
      async () => {
        const files = await loadedFiles();
        return files.includes(previewFile) ? files : null;
      },
      { message: '普通 Markdown 的实时预览依赖已加载' }
    );
    expect(markdown.filter((file) => katexFiles.includes(file))).toEqual([]);

    await openInspiration(page);
    expect(await loadedFiles()).toContain(
      owner('apps/pc/src/render/components/InspirationDialog/index.tsx')
    );
    await page.click({ text: '抽一签', within: SEL.inspiration, exact: true });
    const readDraw = () =>
      page.evaluate<string[]>(
        (selector: string) =>
          ['person', 'place', 'conflict'].map(
            (slot) =>
              document
                .querySelector(`${selector} [data-testid="inspiration-${slot}"]`)
                ?.textContent?.trim() ?? ''
          ),
        SEL.inspiration
      );
    const drawn = await page.waitUntil(
      async () => {
        const value = await readDraw();
        return value.every(Boolean) ? value : null;
      },
      { message: '三张灵感签已抽出' }
    );
    await page.click(`${SEL.inspiration} button[aria-expanded]`);
    await page.click(`${SEL.inspiration} [aria-label="关闭"]`);
    await page.waitForGone(SEL.inspiration);
    await openInspiration(page);
    expect(await readDraw()).toEqual(drawn);
    expect(
      await page.evaluate(
        (selector: string) =>
          document.querySelector(`${selector} [aria-expanded]`)?.getAttribute('aria-expanded'),
        SEL.inspiration
      )
    ).toBe('true');
    await page.click(`${SEL.inspiration} [aria-label="关闭"]`);
    await page.waitForGone(SEL.inspiration);
  });

  it('首次出现公式时加载 KaTeX，行内与表格公式都恢复渲染且正文不被替换', async () => {
    const { page, fixture } = suite;
    if (await page.exists(SEL.inspiration)) {
      await page.click(`${SEL.inspiration} [aria-label="关闭"]`);
      await page.waitForGone(SEL.inspiration);
    }
    const source = '# 懒加载验证\n\n$x^2$\n\n| 能量 |\n|---|\n| $E=mc^2$ |\n\n正文保持不变。\n';
    // The second chapter has not been opened yet; use its existing tree entry so
    // this case exercises module loading rather than an unrelated folder refresh.
    const target = fixture.resolve(FIXTURE_CHAPTERS.second.file);
    await writeFile(target, source);
    await openChapter(page, '002-迷雾森林', '正文保持不变');
    await page.waitFor(() => document.querySelectorAll('.cm-content math').length >= 2, {
      message: '行内和表格公式都已渲染',
    });
    const loaded = await loadedFiles();
    expect(loaded.filter((file) => mathFiles().includes(file)).length).toBeGreaterThan(0);
    expect(
      await page.evaluate(() => document.querySelector('.cm-lp-table math annotation')?.textContent)
    ).toBe('E=mc^2');
    expect(await readFile(target, 'utf8')).toBe(source);
  });
});
