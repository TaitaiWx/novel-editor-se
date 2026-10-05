import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CoreError,
  buildFileTree,
  isSameEntry,
  listTree,
  readFolderTree,
  renamePath,
  type FileNode,
} from '../src';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'ne-core-tree-'));
});

afterEach(async () => {
  await chmod(path.join(dir, 'locked'), 0o755).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

async function touch(rel: string, content = ''): Promise<string> {
  const full = path.join(dir, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, 'utf-8');
  return full;
}

function names(nodes: FileNode[] | undefined): string[] {
  return (nodes ?? []).map((node) => node.name).sort();
}

const isPosixNonRoot = process.platform !== 'win32' && process.getuid?.() !== 0;

describe('buildFileTree', () => {
  it('默认：目录优先 + 自然排序、带 size、隐藏条目与默认排除项被过滤', async () => {
    await touch('第10章.md', 'abc');
    await touch('第2章.md');
    await touch('a-dir/x.md');
    await touch('.hidden');
    await touch('node_modules/pkg/index.js');
    await touch('outline.md');

    const nodes = await buildFileTree(dir);
    expect(nodes.map((node) => node.name)).toEqual([
      'a-dir',
      '第2章.md',
      '第10章.md',
      'outline.md',
    ]);
    expect(nodes.find((node) => node.name === '第10章.md')?.size).toBe(3);
    expect(nodes[0].children?.map((node) => node.name)).toEqual(['x.md']);
  });

  it('depth 限制递归，超出深度的目录没有 children', async () => {
    await touch('a/b/c.md');
    const nodes = await buildFileTree(dir, { depth: 1 });
    expect(nodes).toEqual([{ name: 'a', path: path.join(dir, 'a'), type: 'directory' }]);
  });

  it('exclude 额外排除名称，includeHidden 包含隐藏条目', async () => {
    await touch('keep.md');
    await touch('drop.md');
    await touch('.env');
    const nodes = await buildFileTree(dir, { exclude: ['drop.md'], includeHidden: true });
    expect(names(nodes)).toEqual(['.env', 'keep.md']);
  });

  it('includeSize=false 时文件节点不带 size', async () => {
    await touch('a.md', 'hello');
    const [node] = await buildFileTree(dir, { includeSize: false });
    expect(node).toEqual({ name: 'a.md', path: path.join(dir, 'a.md'), type: 'file' });
  });

  it('sort=none 保持 readdir 顺序（与 natural 排序结果集合一致）', async () => {
    await touch('b.md');
    await touch('a/x.md');
    await touch('c.md');
    const unsorted = await buildFileTree(dir, { sort: 'none' });
    const sorted = await buildFileTree(dir);
    expect(names(unsorted)).toEqual(names(sorted));
  });

  it.runIf(process.platform !== 'win32')(
    '默认忽略符号链接，followSymlinks 时展开且不会死循环',
    async () => {
      await touch('real/a.md');
      await symlink(path.join(dir, 'real'), path.join(dir, 'link'));
      await symlink(dir, path.join(dir, 'real', 'loop'));
      await symlink(path.join(dir, 'missing'), path.join(dir, 'broken'));

      expect(names(await buildFileTree(dir))).toEqual(['real']);

      await expect(buildFileTree(dir, { followSymlinks: true })).rejects.toBeInstanceOf(CoreError);

      const followed = await buildFileTree(dir, { followSymlinks: true, skipUnreadable: true });
      expect(names(followed)).toEqual(['link', 'real']);
      const link = followed.find((node) => node.name === 'link');
      expect(link?.type).toBe('directory');
      expect(link?.children?.some((node) => node.name === 'a.md')).toBe(true);
    }
  );

  it.runIf(isPosixNonRoot)('skipUnreadable 跳过无权限目录，否则抛错', async () => {
    await touch('locked/secret.md');
    await touch('open.md');
    await chmod(path.join(dir, 'locked'), 0o000);

    const nodes = await buildFileTree(dir, { skipUnreadable: true });
    expect(names(nodes)).toEqual(['open.md']);
    await expect(buildFileTree(dir)).rejects.toBeInstanceOf(CoreError);
  });

  it('目录不存在时抛 NOT_FOUND', async () => {
    await expect(buildFileTree(path.join(dir, 'nope'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('listTree（CLI）', () => {
  it('返回根节点并保持原有行为：resolve 根路径、自然排序、隐藏过滤', async () => {
    await touch('b.md', 'xy');
    await touch('a/c.md');
    await touch('.secret');
    const tree = await listTree(dir);
    expect(tree.name).toBe(path.basename(dir));
    expect(tree.path).toBe(path.resolve(dir));
    expect(tree.type).toBe('directory');
    expect(tree.children?.map((node) => node.name)).toEqual(['a', 'b.md']);
    expect(tree.children?.[1].size).toBe(2);
  });

  it('根不是目录时抛 NOT_A_DIRECTORY', async () => {
    const file = await touch('a.md');
    await expect(listTree(file)).rejects.toMatchObject({ code: 'NOT_A_DIRECTORY' });
  });
});

describe('readFolderTree（GUI 文件浏览器）', () => {
  it('返回 { path, files }，节点无 size，目录总有 children，包含隐藏文件', async () => {
    await touch('正文/第一章.md', '内容');
    await mkdir(path.join(dir, '空目录'));
    await touch('.novelrc');
    await touch('.git/HEAD');
    await touch('.DS_Store');
    await touch('dist/a.js');

    const tree = await readFolderTree(dir);
    expect(tree.path).toBe(dir);
    expect(names(tree.files)).toEqual(['.novelrc', '正文', '空目录']);
    const empty = tree.files.find((node) => node.name === '空目录');
    expect(empty).toEqual({
      name: '空目录',
      path: path.join(dir, '空目录'),
      type: 'directory',
      children: [],
    });
    const chapter = tree.files.find((node) => node.name === '正文')?.children?.[0];
    expect(chapter).toEqual({
      name: '第一章.md',
      path: path.join(dir, '正文', '第一章.md'),
      type: 'file',
    });
  });

  it('排除规则按名称精确匹配，不误伤 outline / about / build 前缀的普通文件', async () => {
    await touch('outline.md');
    await touch('about.md');
    await touch('builder-notes.md');
    await touch('build/x.js');
    const tree = await readFolderTree(dir);
    expect(names(tree.files)).toEqual(['about.md', 'builder-notes.md', 'outline.md']);
  });

  it('根路径本身包含 out/build 等字样时仍能正常列出', async () => {
    await touch('output-build/novel/a.md');
    const tree = await readFolderTree(path.join(dir, 'output-build', 'novel'));
    expect(names(tree.files)).toEqual(['a.md']);
  });

  it('保留调用方传入的根路径形态（不 resolve）', async () => {
    await touch('a.md');
    const withSlash = `${dir}${path.sep}`;
    const tree = await readFolderTree(withSlash);
    expect(tree.path).toBe(withSlash);
    expect(tree.files[0].path).toBe(path.join(dir, 'a.md'));
  });

  it('根目录不存在或是文件时返回空列表', async () => {
    const missing = path.join(dir, 'missing');
    expect(await readFolderTree(missing)).toEqual({ path: missing, files: [] });
    const file = await touch('a.md');
    expect(await readFolderTree(file)).toEqual({ path: file, files: [] });
  });

  it.runIf(process.platform !== 'win32')('跟随符号链接，断链被跳过', async () => {
    await touch('real/a.md');
    await symlink(path.join(dir, 'real'), path.join(dir, 'alias'));
    await symlink(path.join(dir, 'gone'), path.join(dir, 'dangling'));
    const tree = await readFolderTree(dir);
    expect(names(tree.files)).toEqual(['alias', 'real']);
  });
});

describe('renamePath / isSameEntry', () => {
  it('目标已存在时拒绝覆盖，overwrite 时允许', async () => {
    const a = await touch('a.md', 'A');
    const b = await touch('b.md', 'B');
    await expect(renamePath(a, b)).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
    await expect(renamePath(a, b, { overwrite: true })).resolves.toEqual({ from: a, to: b });
  });

  it('自动创建目标父目录（移动到新目录）', async () => {
    const a = await touch('a.md');
    const target = path.join(dir, 'new', 'deep', 'a.md');
    await renamePath(a, target);
    expect(await isSameEntry(target, target)).toBe(true);
  });

  it('仅改大小写的重命名在大小写不敏感文件系统上也能成功', async () => {
    const lower = await touch('chapter.md', 'x');
    const upper = path.join(dir, 'Chapter.md');
    await expect(renamePath(lower, upper)).resolves.toEqual({ from: lower, to: upper });
  });

  it('isSameEntry 区分不同文件，路径不存在时返回 false', async () => {
    const a = await touch('a.md');
    const b = await touch('b.md');
    expect(await isSameEntry(a, a)).toBe(true);
    expect(await isSameEntry(a, b)).toBe(false);
    expect(await isSameEntry(a, path.join(dir, 'none'))).toBe(false);
  });

  it('源不存在时抛 NOT_FOUND', async () => {
    await expect(renamePath(path.join(dir, 'x'), path.join(dir, 'y'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
