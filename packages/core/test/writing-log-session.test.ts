import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildGuiSession,
  getGuiSessionPath,
  getTodayStats,
  initProject,
  isTrackedStoryPath,
  markGuiSessionClosed,
  readGuiSession,
  readWritingLog,
  recordProjectWrites,
  recordStoryFileSave,
  recordWrites,
  resolveWritingLogRoot,
  toDateKey,
  writeGuiSession,
} from '../src';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'ne-core-log-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('写作日志：GUI 保存增量', () => {
  it('按状态栏口径（不计空白）计算增量，并与 CLI 写入合并到同一天', async () => {
    const { project } = await initProject(dir);
    const chapter = path.join(project.novelsPath, '书', '001-开端.md');
    const t0 = new Date(2026, 9, 6, 10, 0, 0);

    // CLI 写入
    await recordWrites(project.root, [{ path: chapter, previousChars: 0, chars: 10, at: t0 }]);
    // GUI 两次保存：+3（空格不计）与 -2
    await recordStoryFileSave({
      path: chapter,
      previousContent: '一二三四五六七八九十',
      content: '一二三四五六七八九十 甲乙丙\n',
      at: new Date(t0.getTime() + 60_000),
    });
    await recordStoryFileSave({
      path: chapter,
      previousContent: '一二三四五六七八九十甲乙丙',
      content: '一二三四五六七八九十甲',
      at: new Date(t0.getTime() + 120_000),
    });

    const day = await getTodayStats(project.root, t0);
    expect(day.date).toBe(toDateKey(t0));
    expect(day.added).toBe(13);
    expect(day.removed).toBe(2);
    expect(day.net).toBe(11);
    expect(day.writes).toBe(3);
    expect(day.files).toEqual(['novels/书/001-开端.md']);
    // 相邻写入间隔 1 分钟，计入活跃时长
    expect(day.activeMs).toBe(120_000);
  });

  it('内容未变化、非正文、资料/ 与 .novel-editor/ 中的文件不记录', async () => {
    const { project } = await initProject(dir);
    const same = await recordStoryFileSave({
      path: path.join(dir, 'a.md'),
      previousContent: 'x',
      content: 'x',
    });
    expect(same).toEqual([]);
    for (const file of [
      path.join(dir, 'notes.json'),
      path.join(dir, '资料', '记忆', '人物.md'),
      path.join(dir, '.novel-editor', 'x.md'),
    ]) {
      await recordStoryFileSave({ path: file, previousContent: null, content: '新增内容' });
    }
    const log = await readWritingLog(project.root);
    expect(Object.keys(log.days)).toHaveLength(0);
    expect(isTrackedStoryPath(path.join(dir, '资料', 'a.md'), dir)).toBe(false);
    expect(isTrackedStoryPath(path.join(dir, 'novels', 'a.md'), dir)).toBe(true);
  });

  it('未 ne init 的文件夹回退到 GUI 打开的文件夹', async () => {
    const file = path.join(dir, '第一卷', '001.md');
    expect(await resolveWritingLogRoot(file)).toBeNull();
    expect(await resolveWritingLogRoot(file, dir)).toBe(path.resolve(dir));
    expect(await resolveWritingLogRoot('/elsewhere/a.md', dir)).toBeNull();

    await recordStoryFileSave({
      path: file,
      previousContent: null,
      content: '你好世界',
      workspaceRoot: dir,
    });
    const log = await readWritingLog(dir);
    const day = Object.values(log.days)[0];
    expect(day.added).toBe(4);
    expect(day.files).toEqual(['第一卷/001.md']);
  });

  it('并发记录按项目串行化，不丢失写入', async () => {
    const { project } = await initProject(dir);
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        recordProjectWrites([
          {
            path: path.join(project.novelsPath, `${index}.md`),
            previousChars: 0,
            chars: 1,
          },
        ])
      )
    );
    const today = await getTodayStats(project.root);
    expect(today.writes).toBe(12);
    expect(today.added).toBe(12);
  });
});

describe('GUI 会话文件', () => {
  const alive = () => true;
  const dead = () => false;

  it('构造会话：去重、相对路径、未保存列表', () => {
    const session = buildGuiSession(
      {
        workspaceRoot: dir,
        activeFile: path.join(dir, 'a.md'),
        openFiles: [
          { path: path.join(dir, 'a.md'), dirty: true },
          { path: path.join(dir, 'a.md'), dirty: false },
          { path: path.join(dir, 'sub', 'b.md'), dirty: false },
          { path: '__untitled__:未命名-1', dirty: true },
        ],
      },
      { pid: 123, appVersion: '1.0.0', now: new Date('2026-10-06T00:00:00Z') }
    );
    expect(session.openFiles.map((file) => file.relativePath)).toEqual(['a.md', 'sub/b.md', null]);
    expect(session.openFiles[2].untitled).toBe(true);
    expect(session.dirtyFiles).toEqual([path.join(dir, 'a.md'), '__untitled__:未命名-1']);
    expect(session.state).toBe('open');
    expect(session.updatedAt).toBe('2026-10-06T00:00:00.000Z');
  });

  it('读取：active / stale（pid 不存在 / 过久未刷新）/ closed / none', async () => {
    expect((await readGuiSession(dir)).status).toBe('none');
    const now = new Date('2026-10-06T10:00:00Z');
    const session = buildGuiSession(
      { workspaceRoot: dir, activeFile: null, openFiles: [] },
      { pid: 4242, now }
    );
    await writeGuiSession(session);
    expect(await readFile(getGuiSessionPath(dir), 'utf-8')).toContain('"pid": 4242');

    expect((await readGuiSession(dir, { now, isPidAlive: alive })).status).toBe('active');
    expect(await readGuiSession(dir, { now, isPidAlive: dead })).toMatchObject({
      status: 'stale',
      reason: 'pid-not-alive',
    });
    const later = new Date(now.getTime() + 6 * 60 * 1000);
    expect(await readGuiSession(dir, { now: later, isPidAlive: alive })).toMatchObject({
      status: 'stale',
      reason: 'outdated',
    });

    // pid 不匹配时不关闭
    expect(await markGuiSessionClosed(dir, 1)).toBe(false);
    expect(await markGuiSessionClosed(dir, 4242)).toBe(true);
    const closed = await readGuiSession(dir, { isPidAlive: alive });
    expect(closed.status).toBe('closed');
    expect(closed.session?.pid).toBe(4242);
  });

  it('默认 pid 检测：当前进程存活', async () => {
    const session = buildGuiSession(
      { workspaceRoot: dir, activeFile: null, openFiles: [] },
      { pid: process.pid }
    );
    await writeGuiSession(session);
    expect((await readGuiSession(dir)).status).toBe('active');
  });

  it('损坏的会话文件视为不存在', async () => {
    await mkdir(path.join(dir, '.novel-editor'), { recursive: true });
    await writeFile(getGuiSessionPath(dir), '{oops', 'utf-8');
    expect((await readGuiSession(dir)).status).toBe('none');
  });
});
