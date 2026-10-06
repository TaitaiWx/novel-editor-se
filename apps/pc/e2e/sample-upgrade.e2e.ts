/**
 * 示例作品集升级：本机已有旧版示例副本（没有 .novel-editor/sample.json），且上次打开的就是它。
 * 启动时应把旧副本整体备份为「sample-data-旧版-<时间>」，换成新版示例，并提示一次备份位置。
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchApp, type ElectronApp } from './support/app';
import { SEL, currentWork } from './support/workbench';

let app: ElectronApp;
let userDataDir: string;
let novelEditorDocs: string;
let sampleDir: string;

beforeAll(async () => {
  userDataDir = await mkdtemp(path.join(tmpdir(), 'novel-editor-e2e-upgrade-'));
  // 测试模式下「文稿」目录被重定向到 userData/documents
  novelEditorDocs = path.join(userDataDir, 'documents', 'Novel Editor');
  sampleDir = path.join(novelEditorDocs, 'sample-data');
  // 旧版示例：第1卷 / monica / test.docx 等，并带有用户改动与旧数据库
  const oldFiles: Record<string, string> = {
    '第1卷/first-draft.md': '# 旧示例\n\n用户在旧示例里写过的内容。\n',
    monica: '',
    'config.json': '{"name":"Novel Editor SE"}\n',
    '.novel-editor/novel-editor.db': '',
  };
  for (const [relative, content] of Object.entries(oldFiles)) {
    const absolute = path.join(sampleDir, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content, 'utf-8');
  }
  await writeFile(
    path.join(userDataDir, 'recent-folders.json'),
    JSON.stringify({ lastFolder: sampleDir, folders: [sampleDir] }),
    'utf-8'
  );
  app = await launchApp({ userDataDir });
});

afterAll(async () => {
  await app?.close();
});

describe('示例作品集升级', () => {
  it('上次打开的旧版示例被备份并替换为新版，且提示备份位置', async () => {
    // 新版示例（v3）：作品切换器出现，资料与成长档案跟随作品
    await app.page.waitForTarget(SEL.workSwitcher, 15_000);
    expect(['剑与诗', '星河旅人']).toContain(await currentWork(app.page));
    expect(existsSync(path.join(sampleDir, '欢迎使用.md'))).toBe(true);
    expect(existsSync(path.join(sampleDir, 'monica'))).toBe(false);
    expect(
      existsSync(path.join(sampleDir, 'novels', '星河旅人', '资料', '记忆', '规则.json'))
    ).toBe(true);
    expect(existsSync(path.join(sampleDir, 'novels', '剑与诗', '资料', '记忆', '规则.json'))).toBe(
      true
    );
    expect(existsSync(path.join(sampleDir, '资料'))).toBe(false);

    const backups = (await readdir(novelEditorDocs)).filter((name) =>
      name.startsWith('sample-data-旧版-')
    );
    expect(backups).toHaveLength(1);
    const backupDir = path.join(novelEditorDocs, backups[0]);
    expect(await readFile(path.join(backupDir, '第1卷', 'first-draft.md'), 'utf-8')).toContain(
      '用户在旧示例里写过的内容'
    );

    await app.page.waitFor((text: string) => document.body.innerText.includes(text), {
      timeout: 10_000,
      args: ['示例作品集已更新到新版'],
      message: '升级提示 toast',
    });
  });
});
