/**
 * 正文结构规则（独立的 Electron 实例）
 *
 * 设置中心 →「正文结构」：English 预设识别「Chapter 1: The Harbor」；关闭 / 打开 English 与添加自定义规则
 * （`^=== (.+) ===$` → 场）后，已打开的章节立即按新规则显示标题样式（不重新打开文件）；
 * 规则写进项目的 .novel-editor/config.json（`structure` 字段，CLI `ne structure` 读写同一份）。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { captureForReview, openChapter, setupAppSuite } from './support/suite';
import { FIXTURE_CHAPTERS } from './support/fixture';

const suite = setupAppSuite({ fixture: { prefix: 'novel-editor-e2e-structure-' } });

const DIALOG = '[role="dialog"][aria-label="设置中心"]';
// 开关的真实 checkbox 完全透明，点击自绘轨道
const ENGLISH_TRACK = `${DIALOG} input[role="switch"][aria-label="English 规则"] + span`;
const ENGLISH_INPUT = `${DIALOG} input[role="switch"][aria-label="English 规则"]`;

const CHAPTER_TEXT = [
  'Chapter 1: The Harbor',
  '',
  'Lin walked down to the dock before sunrise.',
  '',
  '=== Dawn ===',
  '',
  'The tide came in slowly.',
  '',
].join('\n');

/** 编辑器里某一行（按文字查找）的结构样式（在页面里执行） */
function lineKindInPage(text: string): string {
  const line = Array.from(document.querySelectorAll('.cm-content .cm-line')).find(
    (el) => (el.textContent || '').trim() === text
  );
  if (!line) return 'missing';
  if (line.classList.contains('cm-lp-chapter-title')) return 'chapter';
  if (line.classList.contains('cm-lp-act-title')) return 'act';
  if (line.classList.contains('cm-lp-scene-title')) return 'scene';
  return 'plain';
}

describe('正文结构规则', () => {
  it('English 预设与自定义规则：设置里修改后已打开的章节立即刷新，规则保存在 config.json', async () => {
    const { page, fixture } = suite;
    const chapterFile = fixture.resolve(FIXTURE_CHAPTERS.second.file);
    await writeFile(chapterFile, CHAPTER_TEXT, 'utf-8');
    await openChapter(page, FIXTURE_CHAPTERS.second.title, 'Chapter 1: The Harbor');

    const waitKind = (text: string, kind: string) =>
      page.waitUntil(async () => (await page.evaluate<string>(lineKindInPage, text)) === kind, {
        message: `「${text}」应为 ${kind}`,
      });

    // 默认规则（中文 + English）：Chapter 1 是章标题，=== Dawn === 是正文
    await waitKind('Chapter 1: The Harbor', 'chapter');
    expect(await page.evaluate<string>(lineKindInPage, '=== Dawn ===')).toBe('plain');

    // 主进程只允许修改窗口已上报的工作区（gui-session-publish 防抖 500ms 后上报，写入 session.json）
    await page.waitUntil(
      () =>
        readFile(fixture.resolve('.novel-editor', 'session.json'), 'utf-8').then(
          (text) => text.length > 0,
          () => false
        ),
      { message: '窗口上报工作区（session.json）', timeout: 15_000 }
    );
    await page.click('[aria-label="打开设置中心"]');
    await page.waitForTarget({ text: '设置中心', exact: true });
    await page.click({ text: '正文结构', within: '[class*="sidebar"]', exact: true });
    await page.waitForTarget(ENGLISH_TRACK);
    expect(
      await page.evaluate<boolean>(
        (selector: string) => document.querySelector<HTMLInputElement>(selector)?.checked ?? false,
        ENGLISH_INPUT
      )
    ).toBe(true);

    // 关闭 English 并保存 → 编辑器里 Chapter 1 不再是标题
    await page.click(ENGLISH_TRACK);
    await page.click({ text: '保存', within: DIALOG, exact: true });
    await page.waitForTarget({ text: '已保存', within: DIALOG });
    await waitKind('Chapter 1: The Harbor', 'plain');

    // 重新开启 English，并添加自定义规则「=== 标题 ===」→ 场
    await page.click(ENGLISH_TRACK);
    await page.click({ text: '添加规则', within: DIALOG, exact: true });
    await page.click(`${DIALOG} input[aria-label="规则 1 正则"]`);
    await page.type('^=== (.+) ===$');
    // 测试框即时显示识别结果（默认样例里有 === Dawn ===）
    await page.waitUntil(
      () =>
        page.evaluate<boolean>(() => {
          const list = document.querySelector('[aria-label="识别结果"]');
          return Array.from(list?.querySelectorAll('li') ?? []).some((item) =>
            /^场\s*=== Dawn ===/.test(item.textContent ?? '')
          );
        }),
      { message: '测试框把 === Dawn === 识别为场' }
    );
    await captureForReview(page, 'structure-settings');
    await page.click({ text: '保存', within: DIALOG, exact: true });
    await page.waitForTarget({ text: '已保存', within: DIALOG });

    await waitKind('=== Dawn ===', 'scene');
    await waitKind('Chapter 1: The Harbor', 'chapter');

    // 磁盘：ne init 项目写在 config.json 的 structure 字段，其他字段保留
    const config = JSON.parse(
      await readFile(fixture.resolve('.novel-editor', 'config.json'), 'utf-8')
    ) as { name?: string; structure?: unknown };
    expect(config.name).toBeTruthy();
    expect(config.structure).toEqual({
      presets: ['zh', 'en'],
      custom: [{ id: 'custom-1', kind: 'scene', pattern: '^=== (.+) ===$' }],
    });

    await page.click('[aria-label="关闭设置"]');
    await page.waitForGone({ text: '设置中心', exact: true });
    // 关闭设置后编辑器仍按新规则显示
    expect(await page.evaluate<string>(lineKindInPage, '=== Dawn ===')).toBe('scene');
  });
});
