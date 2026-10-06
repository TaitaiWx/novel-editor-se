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
import { expandTreePath, treeTitles } from './support/workbench';

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
    await app.page.waitUntil(async () => (await treeTitles(app.page)).includes('未分卷'), {
      timeout: 15_000,
      message: '文件树展示示例数据',
    });
    await expandTreePath(app.page, ['未分卷', 'novels', '星河旅人']);
    expect(await treeTitles(app.page)).toEqual(
      expect.arrayContaining(['欢迎使用', 'novels', '星河旅人', '剑与诗'])
    );

    // 种子数据：人物卡已写入示例项目的数据库（渲染进程以同一路径查询）
    const names = await app.page.waitUntil(
      async () => {
        const result = await app.page.evaluate<string[]>(async (folder: string) => {
          const ipc = window.electron.ipcRenderer;
          const novel = (await ipc.invoke('db-novel-get-by-folder', folder)) as {
            id: number;
          } | null;
          if (!novel) return [];
          const rows = (await ipc.invoke('db-character-list', novel.id)) as Array<{
            name: string;
          }>;
          return rows.map((row) => row.name);
        }, sampleDir);
        return result.length > 0 ? result : null;
      },
      { timeout: 15_000, message: '示例人物已写入数据库' }
    );
    expect(names).toEqual(expect.arrayContaining(['林舟', '苏晴', '白鸦', '秦伯']));
    // 预置的成长档案随示例一起拷贝
    expect(existsSync(path.join(sampleDir, '资料', '记忆', '角色', '林舟.json'))).toBe(true);

    expect((await readdir(sampleDir)).length).toBeGreaterThan(1);
    // 真实文稿目录不应被测试写入（只校验本次隔离路径不在其下）
    expect(sampleDir.startsWith(path.join(os.homedir(), 'Documents'))).toBe(false);
  });
});
