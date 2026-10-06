import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GENERATED_MATERIAL_ROOT_NAME,
  cleanupEmptyGeneratedMaterialDirectories,
  copyProjectTo,
  deleteDirectory,
  deleteFile,
  ensureSeededDirectory,
  readSeedVersion,
  syncSeededDirectory,
  getFileInfo,
  isSeedRuntimeArtifact,
  getFileInfoBatch,
  guessMimeType,
  nextAvailablePath,
  pastePaths,
  readFileBinary,
  readTextFileWithEncoding,
  resolvePasteDestination,
  saveTextFile,
} from '../src';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'ne-core-ws-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function touch(rel: string, content: string | Buffer = ''): Promise<string> {
  const full = path.join(dir, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content);
  return full;
}

async function exists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false
  );
}

describe('guessMimeType', () => {
  it('按扩展名（大小写不敏感）推断，未知回退 octet-stream', () => {
    expect(guessMimeType('/a/b.PNG')).toBe('image/png');
    expect(guessMimeType('x.jpeg')).toBe('image/jpeg');
    expect(guessMimeType('x.svg')).toBe('image/svg+xml');
    expect(guessMimeType('x.pdf')).toBe('application/pdf');
    expect(guessMimeType('x.m4a')).toBe('audio/mp4');
    expect(guessMimeType('x.mov')).toBe('video/quicktime');
    expect(guessMimeType('x.md')).toBe('application/octet-stream');
    expect(guessMimeType('noext')).toBe('application/octet-stream');
  });
});

describe('readTextFileWithEncoding', () => {
  it('默认 / UTF-8（任意大小写）按 UTF-8 读取', async () => {
    const file = await touch('a.md', '你好');
    expect(await readTextFileWithEncoding(file)).toBe('你好');
    expect(await readTextFileWithEncoding(file, 'utf-8')).toBe('你好');
    expect(await readTextFileWithEncoding(file, 'UTF-8')).toBe('你好');
  });

  it('GBK 编码文件按指定编码解码', async () => {
    // “你好” 的 GBK 字节
    const file = await touch('gbk.txt', Buffer.from([0xc4, 0xe3, 0xba, 0xc3]));
    expect(await readTextFileWithEncoding(file, 'GBK')).toBe('你好');
    expect(await readTextFileWithEncoding(file, 'gb18030')).toBe('你好');
  });

  it('不支持的编码抛 UNSUPPORTED，文件不存在抛 NOT_FOUND', async () => {
    const file = await touch('a.md', 'x');
    await expect(readTextFileWithEncoding(file, 'no-such-encoding')).rejects.toMatchObject({
      code: 'UNSUPPORTED',
    });
    await expect(readTextFileWithEncoding(path.join(dir, 'nope.md'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('readFileBinary', () => {
  it('返回 base64、字节数与 MIME', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const file = await touch('img.png', bytes);
    expect(await readFileBinary(file)).toEqual({
      base64Content: bytes.toString('base64'),
      byteSize: 6,
      mimeType: 'image/png',
    });
  });

  it('文件不存在时抛 NOT_FOUND', async () => {
    await expect(readFileBinary(path.join(dir, 'x.png'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('saveTextFile', () => {
  it('覆盖写入 UTF-8 内容', async () => {
    const file = await touch('a.md', 'old');
    await saveTextFile(file, '新内容');
    expect(await readFile(file, 'utf-8')).toBe('新内容');
  });

  it('不自动创建父目录（与编辑器保存语义一致）', async () => {
    await expect(saveTextFile(path.join(dir, 'missing', 'a.md'), 'x')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('getFileInfo / getFileInfoBatch', () => {
  it('返回 size / created / modified / isDirectory / isFile', async () => {
    const file = await touch('a.md', 'abcd');
    const info = await getFileInfo(file);
    expect(Object.keys(info).sort()).toEqual(
      ['created', 'isDirectory', 'isFile', 'modified', 'size'].sort()
    );
    expect(info.size).toBe(4);
    expect(info.isFile).toBe(true);
    expect(info.isDirectory).toBe(false);
    expect(info.created).toBeInstanceOf(Date);
    expect(info.modified).toBeInstanceOf(Date);

    const dirInfo = await getFileInfo(dir);
    expect(dirInfo.isDirectory).toBe(true);
    expect(dirInfo.isFile).toBe(false);
  });

  it('不存在时抛 NOT_FOUND', async () => {
    await expect(getFileInfo(path.join(dir, 'x'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('批量查询跳过失败项并保持输入顺序', async () => {
    const b = await touch('b.md', 'bb');
    const a = await touch('a.md', 'a');
    const result = await getFileInfoBatch([b, path.join(dir, 'missing'), a]);
    expect(result.map((item) => item.path)).toEqual([b, a]);
    expect(result.map((item) => item.info.size)).toEqual([2, 1]);
    expect(await getFileInfoBatch([])).toEqual([]);
  });
});

describe('deleteFile / deleteDirectory', () => {
  it('deleteFile 删除文件，目标是目录时拒绝', async () => {
    const file = await touch('a.md');
    await deleteFile(file);
    expect(await exists(file)).toBe(false);
    await mkdir(path.join(dir, 'd'));
    await expect(deleteFile(path.join(dir, 'd'))).rejects.toMatchObject({ code: 'NOT_A_FILE' });
    await expect(deleteFile(path.join(dir, 'missing'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it.runIf(process.platform !== 'win32')(
    'deleteFile 对符号链接只删链接本身（含断链）',
    async () => {
      const target = await touch('target.md', 'keep');
      const link = path.join(dir, 'link.md');
      await symlink(target, link);
      await deleteFile(link);
      expect(await readFile(target, 'utf-8')).toBe('keep');

      const dangling = path.join(dir, 'dangling.md');
      await symlink(path.join(dir, 'nope'), dangling);
      await deleteFile(dangling);
      expect(await readdir(dir)).toEqual(['target.md']);
    }
  );

  it('deleteDirectory 递归删除，不存在时抛 NOT_FOUND', async () => {
    await touch('d/sub/a.md');
    await deleteDirectory(path.join(dir, 'd'));
    expect(await exists(path.join(dir, 'd'))).toBe(false);
    await expect(deleteDirectory(path.join(dir, 'd'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('resolvePasteDestination / pastePaths', () => {
  it('目标无同名时使用原名', async () => {
    const src = await touch('src/a.md');
    await mkdir(path.join(dir, 'dest'));
    expect(await resolvePasteDestination(src, path.join(dir, 'dest'), false)).toBe(
      path.join(dir, 'dest', 'a.md')
    );
  });

  it('同名文件依次生成 copy / copy 2 / copy 3，保留扩展名', async () => {
    const src = await touch('a.md', 'x');
    const first = await pastePaths([src], dir);
    expect(first).toEqual([{ source: src, dest: path.join(dir, 'a copy.md') }]);
    const second = await pastePaths([src], dir);
    expect(second[0].dest).toBe(path.join(dir, 'a copy 2.md'));
    const third = await pastePaths([src], dir);
    expect(third[0].dest).toBe(path.join(dir, 'a copy 3.md'));
    expect(await readFile(third[0].dest, 'utf-8')).toBe('x');
  });

  it('目录递归复制，同名目录不拆扩展名', async () => {
    await touch('卷.一/第一章.md', '内容');
    const src = path.join(dir, '卷.一');
    const result = await pastePaths([src], dir);
    expect(result[0].dest).toBe(path.join(dir, '卷.一 copy'));
    expect(await readFile(path.join(dir, '卷.一 copy', '第一章.md'), 'utf-8')).toBe('内容');
    const again = await pastePaths([src], dir);
    expect(again[0].dest).toBe(path.join(dir, '卷.一 copy 2'));
  });

  it('无扩展名文件与隐藏文件的命名', async () => {
    const plain = await touch('README');
    const dot = await touch('.env');
    const result = await pastePaths([plain, dot], dir);
    expect(result.map((item) => path.basename(item.dest))).toEqual(['README copy', '.env copy']);
  });

  it('多个源依次复制到目标目录', async () => {
    const a = await touch('src/a.md', 'A');
    const b = await touch('src/b.txt', 'B');
    await mkdir(path.join(dir, 'dest'));
    const result = await pastePaths([a, b], path.join(dir, 'dest'));
    expect(result).toEqual([
      { source: a, dest: path.join(dir, 'dest', 'a.md') },
      { source: b, dest: path.join(dir, 'dest', 'b.txt') },
    ]);
    expect(await readFile(a, 'utf-8')).toBe('A');
  });

  it('目标目录或源不存在时抛出与 GUI 一致的中文错误', async () => {
    const src = await touch('a.md');
    await expect(pastePaths([src], path.join(dir, 'nope'))).rejects.toThrow('目标目录不存在: nope');
    await expect(pastePaths([path.join(dir, 'ghost.md')], dir)).rejects.toThrow(
      '源文件不存在: ghost.md'
    );
  });

  it('复制失败时抛出「粘贴失败 (名称)」', async () => {
    await touch('d/a.md');
    // 把目录复制进自身子目录会失败
    await expect(pastePaths([path.join(dir, 'd')], path.join(dir, 'd'))).rejects.toThrow(
      /^粘贴失败 \(d\): /
    );
  });
});

describe('nextAvailablePath / copyProjectTo', () => {
  it('nextAvailablePath 追加 (2)、(3)', async () => {
    const base = path.join(dir, 'proj');
    expect(nextAvailablePath(base)).toBe(base);
    await mkdir(base);
    expect(nextAvailablePath(base)).toBe(`${base} (2)`);
    await mkdir(`${base} (2)`);
    expect(nextAvailablePath(base)).toBe(`${base} (3)`);
  });

  it('copyProjectTo 复制整个项目并处理重名', async () => {
    await touch('work/我的小说/第一章.md', '正文');
    await mkdir(path.join(dir, 'out'));
    const src = path.join(dir, 'work', '我的小说');
    const first = await copyProjectTo(src, path.join(dir, 'out'));
    expect(first).toBe(path.join(dir, 'out', '我的小说'));
    expect(await readFile(path.join(first, '第一章.md'), 'utf-8')).toBe('正文');
    const second = await copyProjectTo(src, path.join(dir, 'out'));
    expect(second).toBe(`${path.join(dir, 'out', '我的小说')} (2)`);
  });

  it('copyProjectTo 源不存在时抛「项目目录不存在」', async () => {
    await expect(copyProjectTo(path.join(dir, 'none'), dir)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: '项目目录不存在',
    });
  });
});

describe('ensureSeededDirectory', () => {
  it('首次调用从种子目录复制（自动创建父目录）', async () => {
    await touch('seed/sample/a.md', 'seed');
    const target = path.join(dir, 'docs', 'Novel Editor', 'sample-data');
    expect(await ensureSeededDirectory(target, path.join(dir, 'seed'))).toBe(target);
    expect(await readFile(path.join(target, 'sample', 'a.md'), 'utf-8')).toBe('seed');
  });

  it('已存在时不覆盖', async () => {
    await touch('seed/a.md', 'new');
    const existing = await touch('target/a.md', 'mine');
    await ensureSeededDirectory(path.join(dir, 'target'), path.join(dir, 'seed'));
    expect(await readFile(existing, 'utf-8')).toBe('mine');
  });

  it('已存在但只有隐藏项（此前误建的空目录）时补齐示例内容，保留已有隐藏数据', async () => {
    await touch('seed/第1卷/001.md', 'seed');
    const marker = await touch('target/.novel-editor/novel-editor.db', 'db');
    await ensureSeededDirectory(path.join(dir, 'target'), path.join(dir, 'seed'));
    expect(await readFile(path.join(dir, 'target', '第1卷', '001.md'), 'utf-8')).toBe('seed');
    expect(await readFile(marker, 'utf-8')).toBe('db');
  });

  it('不拷贝种子目录里的本机运行产物（数据库、会话、写作日志、.DS_Store）', async () => {
    await touch('seed/.novel-editor/config.json', '{}');
    await touch('seed/.novel-editor/seed.json', '{}');
    for (const name of [
      'novel-editor.db',
      'novel-editor.db-wal',
      'novel-editor.db-shm',
      'session.json',
      'writing-log.json',
    ]) {
      await touch(`seed/.novel-editor/${name}`, 'x');
    }
    await touch('seed/.DS_Store', 'x');
    await touch('seed/资料/.DS_Store', 'x');
    await touch('seed/资料/世界观.md', '# 世界观');
    const target = path.join(dir, 'target');
    await ensureSeededDirectory(target, path.join(dir, 'seed'));
    expect((await readdir(path.join(target, '.novel-editor'))).sort()).toEqual([
      'config.json',
      'seed.json',
    ]);
    expect(await readdir(target)).not.toContain('.DS_Store');
    expect(await readdir(path.join(target, '资料'))).toEqual(['世界观.md']);
  });

  it('isSeedRuntimeArtifact 只匹配 .novel-editor 下的运行产物', () => {
    expect(isSeedRuntimeArtifact('.novel-editor/novel-editor.db')).toBe(true);
    expect(isSeedRuntimeArtifact(path.join('.novel-editor', 'session.json'))).toBe(true);
    expect(isSeedRuntimeArtifact('资料/session.json')).toBe(false);
    expect(isSeedRuntimeArtifact('资料/表格.db')).toBe(false);
    expect(isSeedRuntimeArtifact('Thumbs.db')).toBe(true);
    expect(isSeedRuntimeArtifact('')).toBe(false);
  });

  it('种子不存在时创建空目录', async () => {
    const target = path.join(dir, 'x', 'sample-data');
    await ensureSeededDirectory(target, path.join(dir, 'no-seed'));
    expect(await readdir(target)).toEqual([]);
  });
});

describe('syncSeededDirectory（示例数据版本同步）', () => {
  const seedVersion = (dir: string, version: number) =>
    touch(`${dir}/.novel-editor/sample.json`, JSON.stringify({ sampleVersion: version }));

  it('目标不存在时整体拷贝 → created，并跳过数据库等运行产物', async () => {
    await touch('seed/欢迎使用.md', 'v2');
    await seedVersion('seed', 2);
    await touch('seed/.novel-editor/novel-editor.db', 'dev-db');
    const target = path.join(dir, 'docs', 'sample-data');
    const result = await syncSeededDirectory(target, path.join(dir, 'seed'));
    expect(result).toMatchObject({ status: 'created', version: 2 });
    expect(await readFile(path.join(target, '欢迎使用.md'), 'utf-8')).toBe('v2');
    expect(await readSeedVersion(target)).toBe(2);
    await expect(readFile(path.join(target, '.novel-editor', 'novel-editor.db'))).rejects.toThrow();
  });

  it('旧版副本（无版本文件）升级：整体备份后换成新版，备份保留用户改动与数据库', async () => {
    await touch('seed/欢迎使用.md', 'v2');
    await seedVersion('seed', 2);
    await touch('target/第1卷/first-draft.md', '用户改过的旧稿');
    await touch('target/.novel-editor/novel-editor.db', 'user-db');
    const target = path.join(dir, 'target');
    const now = new Date(2026, 9, 7, 9, 30, 5);

    const result = await syncSeededDirectory(target, path.join(dir, 'seed'), now);

    expect(result.status).toBe('upgraded');
    expect(result.backupPath).toBe(`${target}-旧版-20261007-093005`);
    expect(await readFile(path.join(target, '欢迎使用.md'), 'utf-8')).toBe('v2');
    await expect(readFile(path.join(target, '第1卷', 'first-draft.md'))).rejects.toThrow();
    const backup = result.backupPath as string;
    expect(await readFile(path.join(backup, '第1卷', 'first-draft.md'), 'utf-8')).toBe(
      '用户改过的旧稿'
    );
    expect(await readFile(path.join(backup, '.novel-editor', 'novel-editor.db'), 'utf-8')).toBe(
      'user-db'
    );
  });

  it('同名备份已存在时追加序号，不覆盖之前的备份', async () => {
    await seedVersion('seed', 3);
    await touch('seed/a.md', 'v3');
    await touch('target/old.md', 'old');
    const now = new Date(2026, 9, 7, 9, 30, 5);
    await touch('target-旧版-20261007-093005/keep.md', 'earlier backup');
    const result = await syncSeededDirectory(path.join(dir, 'target'), path.join(dir, 'seed'), now);
    expect(result.backupPath).toBe(`${path.join(dir, 'target')}-旧版-20261007-093005-2`);
    expect(await readFile(path.join(dir, 'target-旧版-20261007-093005', 'keep.md'), 'utf-8')).toBe(
      'earlier backup'
    );
  });

  it('版本相同或本机更新时保持不动 → unchanged', async () => {
    await seedVersion('seed', 2);
    await touch('seed/a.md', 'seed');
    await seedVersion('target', 2);
    const mine = await touch('target/a.md', 'mine');
    const result = await syncSeededDirectory(path.join(dir, 'target'), path.join(dir, 'seed'));
    expect(result.status).toBe('unchanged');
    expect(await readFile(mine, 'utf-8')).toBe('mine');
  });

  it('只有隐藏项的空目录补齐 → filled', async () => {
    await seedVersion('seed', 2);
    await touch('seed/a.md', 'seed');
    await touch('target/.novel-editor/novel-editor.db', 'db');
    const result = await syncSeededDirectory(path.join(dir, 'target'), path.join(dir, 'seed'));
    expect(result.status).toBe('filled');
    expect(await readFile(path.join(dir, 'target', 'a.md'), 'utf-8')).toBe('seed');
  });
});

describe('cleanupEmptyGeneratedMaterialDirectories', () => {
  const root = (): string => path.join(dir, GENERATED_MATERIAL_ROOT_NAME);

  it('删除空的作用域目录，资料根随之变空也一并删除', async () => {
    await mkdir(path.join(root(), 'AI资料'), { recursive: true });
    await mkdir(path.join(root(), '章上下文'), { recursive: true });
    const removed = await cleanupEmptyGeneratedMaterialDirectories(dir);
    expect([...removed].sort()).toEqual(
      [path.join(root(), 'AI资料'), path.join(root(), '章上下文'), root()].sort()
    );
    expect(removed[removed.length - 1]).toBe(root());
    expect(await exists(root())).toBe(false);
  });

  it('保留非空作用域目录、非作用域目录与文件', async () => {
    await touch(`${GENERATED_MATERIAL_ROOT_NAME}/项目上下文/note.md`, 'x');
    await mkdir(path.join(root(), '卷上下文'));
    await mkdir(path.join(root(), '用户目录'));
    await touch(`${GENERATED_MATERIAL_ROOT_NAME}/AI资料`, 'not a dir');

    const removed = await cleanupEmptyGeneratedMaterialDirectories(dir);
    expect(removed).toEqual([path.join(root(), '卷上下文')]);
    expect((await readdir(root())).sort()).toEqual(['AI资料', '用户目录', '项目上下文'].sort());
  });

  it('资料目录不存在或是文件时返回空数组', async () => {
    expect(await cleanupEmptyGeneratedMaterialDirectories(dir)).toEqual([]);
    await touch(GENERATED_MATERIAL_ROOT_NAME, 'file');
    expect(await cleanupEmptyGeneratedMaterialDirectories(dir)).toEqual([]);
  });

  it('资料根目录本就为空时也会被清理', async () => {
    await mkdir(root());
    expect(await cleanupEmptyGeneratedMaterialDirectories(dir)).toEqual([root()]);
  });
});
