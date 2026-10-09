import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { copyProjectTo } from '../src/fs-workspace';

let root: string;
let source: string;
let output: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ne-export-'));
  source = path.join(root, 'project');
  output = path.join(root, 'output');
  await mkdir(path.join(source, '.novel-editor'), { recursive: true });
  await mkdir(output);
  await writeFile(path.join(source, 'chapter.md'), '最新正文');
});
afterEach(async () => rm(root, { recursive: true, force: true }));

it('publishes only a completed snapshot and omits live SQLite companions and GUI sessions', async () => {
  const meta = path.join(source, '.novel-editor');
  for (const name of [
    'novel-editor.db',
    'novel-editor.db-wal',
    'novel-editor.db-shm',
    'session.json',
  ]) {
    await writeFile(path.join(meta, name), 'live runtime state');
  }
  await writeFile(path.join(meta, 'config.json'), '{"name":"作者"}');
  const dest = await copyProjectTo(source, output, {
    backupDatabase: async (_source, destination) => {
      expect((await readdir(output)).filter((name) => !name.startsWith('.'))).toEqual([]);
      await writeFile(destination, 'consistent SQLite backup');
    },
  });
  expect(await readFile(path.join(dest, 'chapter.md'), 'utf8')).toBe('最新正文');
  expect(await readFile(path.join(dest, '.novel-editor/novel-editor.db'), 'utf8')).toBe(
    'consistent SQLite backup'
  );
  expect((await readdir(path.join(dest, '.novel-editor'))).sort()).toEqual([
    'config.json',
    'novel-editor.db',
  ]);
  expect(await readdir(output)).toEqual(['project']);
});

it('cleans staging on backup failure and leaves previous exports untouched', async () => {
  await mkdir(path.join(output, 'project'));
  await writeFile(path.join(output, 'project/keep.md'), 'earlier export');
  await writeFile(path.join(source, '.novel-editor/novel-editor.db'), 'live db');
  await expect(
    copyProjectTo(source, output, {
      backupDatabase: async () => {
        throw new Error('snapshot failed');
      },
    })
  ).rejects.toThrow('snapshot failed');
  expect(await readdir(output)).toEqual(['project']);
  expect(await readFile(path.join(output, 'project/keep.md'), 'utf8')).toBe('earlier export');
});

it('fails closed without a SQLite backup implementation instead of copying live database pages', async () => {
  await writeFile(path.join(source, '.novel-editor/novel-editor.db'), 'live db');
  await expect(copyProjectTo(source, output)).rejects.toThrow('SQLite');
  expect(await readdir(output)).toEqual([]);
});

it('rejects output inside the source including a symlink alias before creating staging files', async () => {
  const alias = path.join(root, 'alias');
  await symlink(source, alias);
  await expect(copyProjectTo(source, alias)).rejects.toThrow('项目目录');
  expect((await readdir(source)).sort()).toEqual(['.novel-editor', 'chapter.md']);
});

it('rejects symbolic links that would keep an exported project attached to live source data', async () => {
  const external = path.join(root, 'external');
  await mkdir(external);
  await writeFile(path.join(external, 'chapter.md'), 'live external data');
  await symlink(external, path.join(source, 'linked-chapters'));
  await expect(copyProjectTo(source, output)).rejects.toThrow('符号链接');
  expect(await readdir(output)).toEqual([]);
});

it('provides the final collision-free export root to the database backup adapter', async () => {
  await mkdir(path.join(output, 'project'));
  await writeFile(path.join(source, '.novel-editor/novel-editor.db'), 'live db');
  await copyProjectTo(source, output, {
    backupDatabase: async (_source, destination, roots) => {
      expect(roots).toEqual({
        sourceRoot: source,
        destinationRoot: path.join(output, 'project (2)'),
      });
      await writeFile(destination, 'snapshot');
    },
  });
});
