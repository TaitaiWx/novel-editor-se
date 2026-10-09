import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveTextFile } from '../src/fs-workspace';
import { writeTextFile } from '../src/fs-ops';

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
}));

const realFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
let dir: string;
let target: string;

beforeEach(async () => {
  dir = await realFs.realpath(await realFs.mkdtemp(path.join(tmpdir(), 'ne-atomic-save-')));
  target = path.join(dir, 'chapter.md');
  await realFs.writeFile(target, '原稿\r\n不可丢失');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await realFs.rm(dir, { recursive: true, force: true });
});

describe.each([
  ['编辑器保存', saveTextFile],
  ['核心文本写入', writeTextFile],
] as const)('%s 原子替换', (_label, save) => {
  it.each(['write', 'sync', 'rename'] as const)('%s 失败保留原文并清理临时文件', async (stage) => {
    const failure = Object.assign(new Error(`${stage} failed`), { code: 'EIO' });
    if (stage === 'rename') {
      vi.spyOn(fs, 'rename').mockImplementation((source, destination) =>
        String(destination) === target
          ? Promise.reject(failure)
          : realFs.rename(source, destination)
      );
    } else {
      vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
        const handle = await realFs.open(...args);
        if (!String(args[0]).startsWith(dir + path.sep)) return handle;
        if (stage === 'write') {
          const write = handle.writeFile.bind(handle);
          vi.spyOn(handle, 'writeFile').mockImplementation(async () => {
            await write('写到一半');
            throw failure;
          });
        } else {
          vi.spyOn(handle, 'sync').mockRejectedValue(failure);
        }
        return handle;
      });
      // 旧的直接覆盖实现会先破坏原文，同样模拟真实的部分写失败。
      if (stage === 'write') {
        vi.spyOn(fs, 'writeFile').mockImplementation(async (file, ...rest) => {
          if (!String(file).startsWith(dir + path.sep)) return realFs.writeFile(file, ...rest);
          await realFs.writeFile(file, '写到一半');
          throw failure;
        });
      }
    }

    await expect(save(target, '新正文')).rejects.toMatchObject({ code: 'IO_ERROR' });
    expect(await realFs.readFile(target, 'utf8')).toBe('原稿\r\n不可丢失');
    expect(await realFs.readdir(dir)).toEqual(['chapter.md']);
  });

  it('写入 UTF-8 正文并保留现有文件的权限位', async () => {
    await realFs.chmod(target, 0o640);
    await save(target, '新正文\r\n第二段 🖋');
    expect(await realFs.readFile(target, 'utf8')).toBe('新正文\r\n第二段 🖋');
    if (process.platform !== 'win32') expect((await realFs.stat(target)).mode & 0o777).toBe(0o640);
    expect(await realFs.readdir(dir)).toEqual(['chapter.md']);
  });

  it('独占创建失败时不覆盖或删除其他写入者的临时文件', async () => {
    let occupied = '';
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (!String(args[0]).startsWith(dir + path.sep)) return realFs.open(...args);
      occupied = String(args[0]);
      await realFs.writeFile(occupied, '其他写入者的内容');
      return realFs.open(...args);
    });
    await expect(save(target, '新正文')).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
    expect(await realFs.readFile(target, 'utf8')).toBe('原稿\r\n不可丢失');
    expect(await realFs.readFile(occupied, 'utf8')).toBe('其他写入者的内容');
  });

  it('可以新建 UTF-8 文件', async () => {
    const created = path.join(dir, 'new.md');
    await save(created, '新的章节');
    expect(await realFs.readFile(created, 'utf8')).toBe('新的章节');
    expect((await realFs.readdir(dir)).sort()).toEqual(['chapter.md', 'new.md']);
  });

  it.skipIf(process.platform === 'win32')('保存符号链接时替换真实目标并保留链接', async () => {
    const link = path.join(dir, 'linked.md');
    await realFs.symlink('chapter.md', link);
    await save(link, '通过链接保存');
    expect((await realFs.lstat(link)).isSymbolicLink()).toBe(true);
    expect(await realFs.readlink(link)).toBe('chapter.md');
    expect(await realFs.readFile(target, 'utf8')).toBe('通过链接保存');
    expect((await realFs.readdir(dir)).sort()).toEqual(['chapter.md', 'linked.md']);
  });

  it.skipIf(process.platform === 'win32')('悬空符号链接保存时创建目标而不是覆盖链接', async () => {
    const link = path.join(dir, 'linked.md');
    await realFs.symlink('missing.md', link);
    await save(link, '新目标正文');
    expect((await realFs.lstat(link)).isSymbolicLink()).toBe(true);
    expect(await realFs.readFile(path.join(dir, 'missing.md'), 'utf8')).toBe('新目标正文');
  });

  it.each(['EPERM', 'EACCES', 'EBUSY'])(
    '锁票发布遇到短暂 %s 时保留选择标记并重试后保存',
    async (code) => {
      let attempts = 0;
      let ticket = '';
      vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
        if (!String(destination).endsWith('.ticket')) return realFs.rename(source, destination);
        attempts++;
        ticket = String(destination);
        if (attempts <= 3) {
          // Readers must keep seeing the choosing ticket until publication succeeds.
          expect(await realFs.readFile(ticket, 'utf8')).toBe('');
          expect(await realFs.readFile(target, 'utf8')).toBe('原稿\r\n不可丢失');
          throw Object.assign(new Error('Windows sharing contention'), { code });
        }
        return realFs.rename(source, destination);
      });
      await save(target, '完整新正文');
      expect(attempts).toBe(4);
      expect(await realFs.readFile(target, 'utf8')).toBe('完整新正文');
      expect(await realFs.lstat(ticket).catch(() => null)).toBeNull();
      expect(await realFs.lstat(`${ticket}.tmp`).catch(() => null)).toBeNull();
    }
  );

  it.each(['EPERM', 'EIO'])('锁票发布持续 %s 时有界失败并清理票据且保留原文', async (code) => {
    let attempts = 0;
    let ticket = '';
    vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
      if (!String(destination).endsWith('.ticket')) return realFs.rename(source, destination);
      attempts++;
      ticket = String(destination);
      throw Object.assign(new Error('publication denied'), { code });
    });
    await expect(save(target, '不能发布')).rejects.toBeDefined();
    expect(attempts).toBe(code === 'EPERM' ? 9 : 1);
    expect(await realFs.readFile(target, 'utf8')).toBe('原稿\r\n不可丢失');
    expect(await realFs.lstat(ticket).catch(() => null)).toBeNull();
    expect(await realFs.lstat(`${ticket}.tmp`).catch(() => null)).toBeNull();
    expect(await realFs.readdir(dir)).toEqual(['chapter.md']);
  });

  it('并发保存使用互不冲突的同目录临时文件，最终正文完整', async () => {
    const pendingPaths: string[] = [];
    const contents = Array.from({ length: 8 }, (_, index) => `${index}:` + '正文'.repeat(4096));
    vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
      if (String(destination) !== target) return realFs.rename(source, destination);
      pendingPaths.push(String(source));
      expect(path.dirname(String(source))).toBe(dir);
      expect(contents).toContain(await realFs.readFile(source, 'utf8'));
      return realFs.rename(source, destination);
    });
    await Promise.all(contents.map((content) => save(target, content)));
    expect(contents).toContain(await realFs.readFile(target, 'utf8'));
    expect(new Set(pendingPaths).size).toBe(8);
    expect(await realFs.readdir(dir)).toEqual(['chapter.md']);
  });
});
