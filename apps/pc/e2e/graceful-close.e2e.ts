/** Native close must persist the last keystroke without waiting for the 2s autosave timer. */
import { afterEach, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { readGuiSession } from '@novel-editor/core';
import { launchApp, type ElectronApp } from './support/app';
import { createFixtureProject, FIXTURE_CHAPTERS, type FixtureProject } from './support/fixture';
import { openChapter } from './support/suite';
import { focusEditorEnd, waitForEditorText, SEL } from './support/workbench';
let app: ElectronApp | undefined;
let fixture: FixtureProject | undefined;
afterEach(async () => {
  await app?.close();
  await fixture?.dispose();
  app = undefined;
  fixture = undefined;
});
async function launch() {
  fixture = await createFixtureProject();
  app = await launchApp({ projectDir: fixture.root });
  await openChapter(app.page, FIXTURE_CHAPTERS.first.title, '林舟');
  return app.page;
}
it('native window close saves the last keystroke and closes the GUI session', async () => {
  const page = await launch();
  const marker = `关闭前最后输入-${Date.now()}`;
  await focusEditorEnd(page);
  await page.type(`\n${marker}`);
  // A real native close event follows immediately; do not wait for autosave.
  await page.evaluate(() => {
    void window.electron.ipcRenderer.invoke('window-close');
  });
  await expect
    .poll(async () => readFile(fixture!.resolve(FIXTURE_CHAPTERS.first.file), 'utf8'), {
      timeout: 10000,
    })
    .toContain(marker);
  await expect
    .poll(async () => (await readGuiSession(fixture!.root))?.status, { timeout: 10000 })
    .toBe('closed');
});
it('a hidden untitled draft cancels native close and remains available', async () => {
  const page = await launch();
  await page.evaluate(() => window.dispatchEvent(new Event('app:new-file')));
  await page.waitForTarget(SEL.editor);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const editor = document.querySelector('.cm-content')?.cloneNode(true) as
          | HTMLElement
          | undefined;
        editor?.querySelectorAll('.cm-placeholder').forEach((placeholder) => placeholder.remove());
        return editor?.textContent?.trim();
      })
    )
    .toBe('');
  await focusEditorEnd(page);
  await page.type('未命名草稿必须保留');
  await page.click(`[title=${JSON.stringify(fixture!.resolve(FIXTURE_CHAPTERS.first.file))}]`);
  await waitForEditorText(page, '林舟');
  await page.evaluate(() => {
    void window.electron.ipcRenderer.invoke('window-close');
  });
  await page.waitForTarget({
    text: '尚有未保存的内容，已取消操作。请先保存未命名草稿，或重试保存失败的文件。',
  });
  expect(await page.evaluate(() => Boolean(document.body.inert))).toBe(false);
  expect(app!.process.exitCode).toBeNull();
  await page.click('[title^="__untitled__:"]');
  await waitForEditorText(page, '未命名草稿必须保留');
});
