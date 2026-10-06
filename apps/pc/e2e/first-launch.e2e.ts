/**
 * 首次启动：没有上次工作区时默认打开示例数据（sample-data）
 *
 * 使用全新的 userData 且不传项目目录，模拟新用户第一次打开应用：
 * - 示例数据从 apps/pc/sample-data 拷贝到「文稿/Novel Editor/sample-data」并自动打开
 * - 首次打开时把 .novel-editor/seed.json 中的人物 / 设定 / 大纲写入该项目的数据库
 * - 测试模式下「文稿」目录被重定向到 userData/documents，不会写入真实文稿目录
 */
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchApp, type ElectronApp } from './support/app';
import { SEL, expandTreePath, selectWork, treeTitles } from './support/workbench';

let app: ElectronApp;

beforeAll(async () => {
  app = await launchApp({});
});

afterAll(async () => {
  await app?.close();
});

describe('首次启动', () => {
  it('没有上次工作区时自动打开示例数据，且只写入隔离的文稿目录', async () => {
    const sampleDir = path.join(app.userDataDir, 'documents', 'Novel Editor', 'sample-data');

    await app.page.waitUntil(() => existsSync(path.join(sampleDir, '欢迎使用.md')), {
      timeout: 15_000,
      message: '示例数据已拷贝到隔离的文稿目录',
    });
    // 示例是 ne init 项目：顶部作品切换器，正文只显示当前作品的卷 / 章
    await app.page.waitForTarget(SEL.workSwitcher, 15_000);
    await selectWork(app.page, '星河旅人');
    await expandTreePath(app.page, ['第一卷-离乡', '001-启程']);
    const titles = await treeTitles(app.page);
    expect(titles).toEqual(expect.arrayContaining(['项目说明', '第一卷-离乡', '001-启程']));
    // 欢迎使用.md 是项目文档：在默认折叠的「项目说明」里，不是「未分卷」里的章
    expect(titles).not.toContain('欢迎使用');
    expect(titles).not.toContain('novels');
    expect(titles).not.toContain('未分卷');
    expect(titles).not.toContain('剑与诗');

    // 种子数据：人物卡按作品写入示例项目的数据库（渲染进程以作品路径查询）
    const charactersOf = (folder: string) =>
      app.page.evaluate<string[]>(async (target: string) => {
        const ipc = window.electron.ipcRenderer;
        const novel = (await ipc.invoke('db-novel-get-by-folder', target)) as {
          id: number;
        } | null;
        if (!novel) return [];
        const rows = (await ipc.invoke('db-character-list', novel.id)) as Array<{
          name: string;
        }>;
        return rows.map((row) => row.name);
      }, folder);
    const starDir = path.join(sampleDir, 'novels', '星河旅人');
    const poemDir = path.join(sampleDir, 'novels', '剑与诗');
    const names = await app.page.waitUntil(
      async () => {
        const result = await charactersOf(starDir);
        return result.length > 0 ? result : null;
      },
      { timeout: 15_000, message: '示例人物已写入数据库' }
    );
    expect(names).toEqual(expect.arrayContaining(['林舟', '苏晴', '白鸦', '秦伯']));
    expect(names).not.toContain('沈砚');
    expect(await charactersOf(poemDir)).toEqual(['沈砚', '听雨楼诗人']);
    // 项目根不再承载人物（人物跟随作品）
    expect(await charactersOf(sampleDir)).toEqual([]);
    // 预置的成长档案随示例一起拷贝，放在各作品自己的 资料/记忆/ 里
    expect(existsSync(path.join(starDir, '资料', '记忆', '角色', '林舟.json'))).toBe(true);
    expect(existsSync(path.join(poemDir, '资料', '记忆', '角色', '沈砚.json'))).toBe(true);
    expect(existsSync(path.join(sampleDir, '资料'))).toBe(false);

    expect((await readdir(sampleDir)).length).toBeGreaterThan(1);
    // 真实文稿目录不应被测试写入（只校验本次隔离路径不在其下）
    expect(sampleDir.startsWith(path.join(os.homedir(), 'Documents'))).toBe(false);
  });
});
