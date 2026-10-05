/**
 * 首次启动：没有上次工作区时默认打开示例数据（sample-data）
 *
 * 使用全新的 userData 且不传项目目录，模拟新用户第一次打开应用：
 * - 示例数据从 apps/pc/sample-data 拷贝到「文稿/Novel Editor/sample-data」并自动打开
 * - 测试模式下「文稿」目录被重定向到 userData/documents，不会写入真实文稿目录
 */
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchApp, type ElectronApp } from './support/app';
import { treeTitles } from './support/workbench';

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

    await app.page.waitUntil(() => existsSync(path.join(sampleDir, '第1卷')), {
      timeout: 15_000,
      message: '示例数据已拷贝到隔离的文稿目录',
    });
    await app.page.waitUntil(
      async () => (await treeTitles(app.page)).some((title) => title.includes('第1卷')),
      { timeout: 15_000, message: '文件树展示示例数据的「第1卷」' }
    );

    expect((await readdir(sampleDir)).length).toBeGreaterThan(1);
    // 真实文稿目录不应被测试写入（只校验本次隔离路径不在其下）
    expect(sampleDir.startsWith(path.join(os.homedir(), 'Documents'))).toBe(false);
  });
});
