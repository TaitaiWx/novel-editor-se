import { describe, expect, it } from 'vitest';
import type { FileNode } from '@/render/types';
import {
  buildUniqueMarkdownName,
  buildUniqueMovedName,
  ensureMarkdownFileName,
  findNodeInTree,
  getFileExtension,
  getNodeDisplayName,
  getParentDirectory,
  getPathBaseName,
  isChangelogTabPath,
  isDraftLikeName,
  isMaterialLikeName,
  isPathInWorkspace,
  isPathSameOrDescendant,
  isUntitledTabPath,
  isVolumeLikeName,
  joinSiblingPath,
  normalizeWorkspacePath,
  remapWorkspaceTabPath,
  replacePathPrefix,
  sanitizeBaseName,
  stripExtension,
} from '@/render/app/fileTreeUtils';
import { createVolumeWorkspaceTab } from '@/render/utils/workspace';

const tree: FileNode[] = [
  {
    name: '第一卷',
    path: '/n/第一卷',
    type: 'directory',
    children: [{ name: '第一章.md', path: '/n/第一卷/第一章.md', type: 'file' }],
  },
  { name: '楔子.md', path: '/n/楔子.md', type: 'file' },
];

describe('findNodeInTree', () => {
  it('递归查找节点', () => {
    expect(findNodeInTree(tree, '/n/第一卷/第一章.md')?.name).toBe('第一章.md');
    expect(findNodeInTree(tree, '/n/楔子.md')?.name).toBe('楔子.md');
    expect(findNodeInTree(tree, '/n/不存在.md')).toBeNull();
  });
});

describe('名称分类', () => {
  it('草稿、卷、资料', () => {
    expect(isDraftLikeName('提纲.md')).toBe(true);
    expect(isDraftLikeName('第一章.md')).toBe(false);
    expect(isVolumeLikeName('第二卷.md')).toBe(true);
    expect(isVolumeLikeName('Volume 1')).toBe(true);
    expect(isVolumeLikeName('第二章')).toBe(false);
    expect(isMaterialLikeName('人物素材')).toBe(true);
    expect(isMaterialLikeName('Research')).toBe(true);
    expect(isMaterialLikeName('第一章')).toBe(false);
  });
});

describe('文件名处理', () => {
  it('补全 .md 扩展名', () => {
    expect(ensureMarkdownFileName('第一章')).toBe('第一章.md');
    expect(ensureMarkdownFileName('设定.txt')).toBe('设定.txt');
  });

  it('清洗非法字符与控制字符', () => {
    expect(sanitizeBaseName('  第一章: 风起/云涌?\u0001 ')).toBe('第一章 风起 云涌');
    expect(sanitizeBaseName('<>|*')).toBe('');
  });

  it('生成唯一 Markdown 文件名并写回集合', () => {
    const existing = new Set(['第一章.md', '第一章-2.md']);
    expect(buildUniqueMarkdownName('第一章', existing)).toBe('第一章-3.md');
    expect(existing.has('第一章-3.md')).toBe(true);
    expect(buildUniqueMarkdownName('第二章', existing)).toBe('第二章.md');
    expect(buildUniqueMarkdownName('???', existing)).toBe('未命名.md');
  });

  it('生成唯一移动后名称', () => {
    expect(buildUniqueMovedName('第一章.md', new Set())).toBe('第一章.md');
    expect(buildUniqueMovedName('第一章.md', new Set(['第一章.md', '第一章-2.md']))).toBe(
      '第一章-3.md'
    );
    expect(buildUniqueMovedName('资料', new Set(['资料']))).toBe('资料-2');
  });

  it('扩展名工具', () => {
    expect(getFileExtension('第一章.md')).toBe('.md');
    expect(getFileExtension('README')).toBe('');
    expect(stripExtension('a.b.txt')).toBe('a.b');
  });
});

describe('路径工具', () => {
  it('getParentDirectory 保留分隔符风格', () => {
    expect(getParentDirectory('/n/第一卷/第一章.md')).toBe('/n/第一卷');
    expect(getParentDirectory('C:\\小说\\第一章.md')).toBe('C:\\小说');
    expect(getParentDirectory('/第一章.md')).toBeNull();
    expect(getParentDirectory('第一章.md')).toBeNull();
  });

  it('getPathBaseName 支持两种分隔符', () => {
    expect(getPathBaseName('/n/第一章.md')).toBe('第一章.md');
    expect(getPathBaseName('C:\\n\\第一章.md')).toBe('第一章.md');
    expect(getPathBaseName('第一章.md')).toBe('第一章.md');
  });

  it('joinSiblingPath 按原路径选择分隔符', () => {
    expect(joinSiblingPath('/n', 'b.md', '/n/a.md')).toBe('/n/b.md');
    expect(joinSiblingPath('C:\\n', 'b.md', 'C:\\n\\a.md')).toBe('C:\\n\\b.md');
  });

  it('标签类型判断', () => {
    expect(isUntitledTabPath('__untitled__:1')).toBe(true);
    expect(isUntitledTabPath(null)).toBe(false);
    expect(isChangelogTabPath('__changelog__:1.1.0')).toBe(true);
    expect(isChangelogTabPath('/n/a.md')).toBe(false);
  });

  it('工作区包含关系', () => {
    expect(normalizeWorkspacePath('C:\\Novel\\A.md')).toBe('c:/novel/a.md');
    expect(isPathInWorkspace('C:\\Novel\\A.md', 'c:/novel/')).toBe(true);
    expect(isPathInWorkspace('/novel', '/novel')).toBe(true);
    expect(isPathInWorkspace('/novel-2/a.md', '/novel')).toBe(false);
  });

  it('getNodeDisplayName 去掉扩展名', () => {
    expect(getNodeDisplayName('/n/第一卷/第一章.md')).toBe('第一章');
  });

  // 回归：getNodeDisplayName 先按 '/' 分割，Windows 路径中不含 '/' 时 pop() 返回整条路径（真值），
  // 后面的 '\\' 分支永远不会执行，结果是 "C:\\小说\\第一章"。
  it('getNodeDisplayName 应支持 Windows 路径', () => {
    expect(getNodeDisplayName('C:\\小说\\第一章.md')).toBe('第一章');
  });

  it('replacePathPrefix 只替换完整路径段', () => {
    expect(replacePathPrefix('/n/卷一', '/n/卷一', '/n/卷1')).toBe('/n/卷1');
    expect(replacePathPrefix('/n/卷一/第一章.md', '/n/卷一', '/n/卷1')).toBe('/n/卷1/第一章.md');
    expect(replacePathPrefix('C:\\n\\卷一\\a.md', 'C:\\n\\卷一', 'C:\\n\\卷1')).toBe(
      'C:\\n\\卷1\\a.md'
    );
    expect(replacePathPrefix('/n/卷一外传/a.md', '/n/卷一', '/n/卷1')).toBe('/n/卷一外传/a.md');
  });

  it('remapWorkspaceTabPath 处理卷标签与普通路径', () => {
    expect(remapWorkspaceTabPath(createVolumeWorkspaceTab('/n/卷一'), '/n/卷一', '/n/卷1')).toBe(
      createVolumeWorkspaceTab('/n/卷1')
    );
    const unrelated = createVolumeWorkspaceTab('/n/卷二');
    expect(remapWorkspaceTabPath(unrelated, '/n/卷一', '/n/卷1')).toBe(unrelated);
    expect(remapWorkspaceTabPath('/n/卷一/a.md', '/n/卷一', '/n/卷1')).toBe('/n/卷1/a.md');
  });

  it('isPathSameOrDescendant', () => {
    expect(isPathSameOrDescendant('/n/a', '/n/a')).toBe(true);
    expect(isPathSameOrDescendant('/n/a/b', '/n/a')).toBe(true);
    expect(isPathSameOrDescendant('C:\\n\\a\\b', 'C:\\n\\a')).toBe(true);
    expect(isPathSameOrDescendant('/n/ab', '/n/a')).toBe(false);
  });
});
