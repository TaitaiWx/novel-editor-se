import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildGuiSession,
  markGuiSessionClosed,
  recordStoryFileSave,
  writeGuiSession,
} from '@novel-editor/core';
import type { GuiStatus } from '../src/commands/project';
import { runCli } from '../src/run';

interface RunOutput {
  exitCode: number;
  stdout: string;
  json: { ok: boolean; data?: unknown };
}

let dir: string;

async function ne(argv: string[]): Promise<RunOutput> {
  let stdout = '';
  const { exitCode, envelope } = await runCli(argv, {
    cwd: dir,
    io: {
      stdout: (text) => {
        stdout += text;
      },
      stderr: () => {},
      readStdin: async () => '',
    },
  });
  return { exitCode, stdout, json: envelope as RunOutput['json'] };
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'ne-cli-status-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('ne status 读取 GUI 会话', () => {
  it('GUI 运行中：报告打开的文件与未保存变更（文本与 --json）', async () => {
    await ne(['init']);
    const chapter = path.join(dir, 'novels', '书', '001.md');
    await writeGuiSession(
      buildGuiSession(
        {
          workspaceRoot: dir,
          activeFile: chapter,
          openFiles: [
            { path: chapter, dirty: true },
            { path: path.join(dir, 'novels', '书', '002.md'), dirty: false },
            { path: '__untitled__:未命名-1', dirty: true },
          ],
        },
        { pid: process.pid, appVersion: '1.2.3' }
      )
    );

    const json = await ne(['status', '--json']);
    const gui = (json.json.data as { gui: GuiStatus }).gui;
    expect(gui).toMatchObject({
      status: 'active',
      pid: process.pid,
      appVersion: '1.2.3',
      activeFile: 'novels/书/001.md',
      openFiles: ['novels/书/001.md', 'novels/书/002.md', '__untitled__:未命名-1'],
      unsavedFiles: ['novels/书/001.md', '__untitled__:未命名-1'],
    });

    const text = await ne(['status']);
    expect(text.stdout).toContain('GUI: 运行中');
    expect(text.stdout).toContain('当前文件: novels/书/001.md');
    expect(text.stdout).toContain('未保存: novels/书/001.md, __untitled__:未命名-1');
  });

  it('GUI 已关闭 / 进程不存在 / 从未打开', async () => {
    await ne(['init']);
    const none = await ne(['status', '--json']);
    expect((none.json.data as { gui: GuiStatus }).gui.status).toBe('none');

    // 不存在的 pid：视为失效
    await writeGuiSession(
      buildGuiSession({ workspaceRoot: dir, activeFile: null, openFiles: [] }, { pid: 2 ** 22 + 7 })
    );
    const stale = await ne(['status', '--json']);
    expect((stale.json.data as { gui: GuiStatus }).gui).toMatchObject({
      status: 'stale',
      reason: 'pid-not-alive',
    });
    expect((await ne(['status'])).stdout).toContain('会话已失效');

    await writeGuiSession(
      buildGuiSession({ workspaceRoot: dir, activeFile: null, openFiles: [] }, { pid: process.pid })
    );
    await markGuiSessionClosed(dir, process.pid);
    const closed = await ne(['status', '--json']);
    expect((closed.json.data as { gui: GuiStatus }).gui.status).toBe('closed');
  });

  it('未 ne init 的文件夹也能看到 GUI 会话', async () => {
    await writeGuiSession(
      buildGuiSession(
        {
          workspaceRoot: dir,
          activeFile: null,
          openFiles: [{ path: path.join(dir, 'a.md'), dirty: true }],
        },
        { pid: process.pid }
      )
    );
    const output = await ne(['status', '--json']);
    expect(output.json.data).toMatchObject({
      project: null,
      gui: { status: 'active', unsavedFiles: ['a.md'] },
    });
  });
});

describe('ne stats today / history 包含 GUI 保存', () => {
  it('CLI 写入与 GUI 保存合并统计', async () => {
    await ne(['init']);
    await ne(['file', 'write', 'novels/书/001.md', '一二三']);
    // 模拟 GUI 主进程保存
    await recordStoryFileSave({
      path: path.join(dir, 'novels', '书', '001.md'),
      previousContent: '一二三',
      content: '一二三四五六',
    });

    const today = await ne(['stats', 'today', '--json']);
    expect(today.json.data).toMatchObject({ added: 6, writes: 2, net: 6 });
    const text = await ne(['stats', 'today']);
    expect(text.stdout).toContain('GUI 保存');

    const history = await ne(['stats', 'history', '--days', '2', '--json']);
    expect((history.json.data as { totals: { net: number } }).totals.net).toBe(6);
  });

  it('CLI 写入 资料/ 中的 md 不计入写作日志', async () => {
    await ne(['init']);
    await ne(['file', 'write', '资料/设定.md', '很多设定内容']);
    const today = await ne(['stats', 'today', '--json']);
    expect(today.json.data).toMatchObject({ writes: 0 });
  });
});
