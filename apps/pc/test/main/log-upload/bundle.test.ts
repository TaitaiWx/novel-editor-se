import JSZip from 'jszip';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildLogBundle } from '../../../src/main/log-upload/bundle';
import { createRedactor, redactValue } from '../../../src/main/log-upload/redact';

let root: string;
let home: string;
let logDir: string;
let userData: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'ne-log-bundle-'));
  home = path.join(root, 'Users', 'alice');
  logDir = path.join(home, 'Library', 'Logs', 'Novel Editor');
  userData = path.join(home, 'Library', 'Application Support', 'Novel Editor');
  await mkdir(logDir, { recursive: true });
  await mkdir(userData, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function unzip(buffer: Buffer): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(buffer);
  const files = new Map<string, string>();
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!entry.dir) files.set(name, await entry.async('string'));
  }
  return files;
}

describe('createRedactor', () => {
  it('把主目录替换成 ~（正斜杠、反斜杠、JSON 转义）', () => {
    const redact = createRedactor('/Users/alice', 'darwin');
    expect(redact('打开 /Users/alice/Documents/a.md 与 /Users/alicex')).toBe(
      '打开 ~/Documents/a.md 与 ~x'
    );
    const win = createRedactor('C:\\Users\\Alice', 'win32');
    expect(win('C:\\Users\\alice\\AppData 和 c:/users/ALICE/x')).toBe('~\\AppData 和 ~/x');
    expect(win(JSON.stringify({ p: 'C:\\Users\\Alice\\a' }))).toBe('{"p":"~\\\\a"}');
  });

  it('主目录为空或根目录时不替换', () => {
    expect(createRedactor('')('/a/b')).toBe('/a/b');
    expect(createRedactor('/')('/a/b')).toBe('/a/b');
  });

  it('redactValue 递归处理对象与数组', () => {
    const redact = createRedactor('/home/bob', 'linux');
    expect(redactValue({ a: ['/home/bob/x', 1, null], b: { c: '/home/bob' } }, redact)).toEqual({
      a: ['~/x', 1, null],
      b: { c: '~' },
    });
  });
});

describe('buildLogBundle', () => {
  it('打包 diagnostics.json、日志与状态文件，并脱敏主目录', async () => {
    await writeFile(path.join(logDir, 'main.log'), `[info] 打开 ${home}/文稿/作品\n`);
    await writeFile(path.join(logDir, 'renderer.log'), '[warn] 渲染进程日志\n');
    await writeFile(path.join(logDir, 'notes.txt'), '不是日志');
    // 数据库与作品正文即便出现在日志目录也不会打包
    await writeFile(path.join(logDir, 'novel.db'), 'SQLite format 3');
    await writeFile(path.join(logDir, '第一章.md'), '正文内容');
    const statePath = path.join(userData, 'updater-state.json');
    await writeFile(statePath, JSON.stringify({ cachedInstallerPath: `${home}/cache/x.dmg` }));
    await writeFile(path.join(userData, 'novel-editor.db'), 'SQLite format 3');

    const bundle = await buildLogBundle({
      reason: 'manual',
      diagnostics: { deviceId: 'dev-1', directories: { userData } },
      logDir,
      stateFiles: [
        statePath,
        path.join(userData, 'novel-editor.db'),
        path.join(userData, 'none.json'),
      ],
      homeDir: home,
      platform: 'darwin',
      now: new Date('2026-10-06T01:02:03.000Z'),
    });

    const files = await unzip(bundle.buffer);
    expect([...files.keys()].sort()).toEqual(
      ['diagnostics.json', 'logs/main.log', 'logs/renderer.log', 'state/updater-state.json'].sort()
    );
    expect(bundle.entries[0]).toBe('diagnostics.json');
    expect(files.get('logs/main.log')).toBe('[info] 打开 ~/文稿/作品\n');
    expect(files.get('state/updater-state.json')).toContain('"~/cache/x.dmg"');

    const diagnostics = JSON.parse(files.get('diagnostics.json') ?? '{}');
    expect(diagnostics.deviceId).toBe('dev-1');
    expect(diagnostics.directories.userData).toBe('~/Library/Application Support/Novel Editor');
    expect(diagnostics.bundle).toMatchObject({
      reason: 'manual',
      generatedAt: '2026-10-06T01:02:03.000Z',
      truncated: [],
    });
    expect(diagnostics.bundle.files).toEqual(bundle.entries);
    for (const content of files.values()) {
      expect(content).not.toContain(home);
      expect(content).not.toContain('SQLite format 3');
      expect(content).not.toContain('正文内容');
    }
  });

  it('大日志只保留末尾，超过总量上限时舍弃较旧的日志', async () => {
    const big = Array.from({ length: 200 }, (_, i) => `line-${i}`).join('\n');
    await writeFile(path.join(logDir, 'main.log'), big);
    await writeFile(path.join(logDir, 'main.old.log'), 'old');
    const old = new Date(Date.now() - 60_000);
    await utimes(path.join(logDir, 'main.old.log'), old, old);

    const bundle = await buildLogBundle({
      reason: 'crash',
      diagnostics: {},
      logDir,
      stateFiles: [],
      homeDir: home,
      crash: { kind: 'uncaughtException', message: 'boom', stack: `at ${home}/app.js:1` },
      limits: { maxLogFileBytes: 100, maxTotalLogBytes: 100 },
    });
    const files = await unzip(bundle.buffer);
    const main = files.get('logs/main.log') ?? '';
    expect(main.startsWith('[… 已截断')).toBe(true);
    expect(main).toContain('line-199');
    expect(main).not.toContain('line-0\n');
    expect(bundle.truncated).toEqual(['logs/main.log']);
    expect(files.has('logs/main.old.log')).toBe(false);

    const diagnostics = JSON.parse(files.get('diagnostics.json') ?? '{}');
    expect(diagnostics.bundle.skipped).toEqual(['logs/main.old.log']);
    const crash = JSON.parse(files.get('crash.json') ?? '{}');
    expect(crash).toEqual({ kind: 'uncaughtException', message: 'boom', stack: 'at ~/app.js:1' });
  });

  it('日志目录不存在时只打包 diagnostics.json', async () => {
    const bundle = await buildLogBundle({
      reason: 'manual',
      diagnostics: {},
      logDir: path.join(root, 'missing'),
      stateFiles: [],
      homeDir: home,
    });
    expect([...(await unzip(bundle.buffer)).keys()]).toEqual(['diagnostics.json']);
  });
});
