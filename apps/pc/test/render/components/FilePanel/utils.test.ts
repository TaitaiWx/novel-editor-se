import { describe, expect, it } from 'vitest';
import type { FileNode } from '@/render/types';
import type { Character, LoreEntry } from '@/render/components/RightPanel/types';
import {
  countFiles,
  countStoryStats,
  filterCharacters,
  filterLoreEntries,
  filterTree,
  findAncestorPaths,
  findNodeByPath,
  getCharacterCategoryLabel,
  getFolderName,
  groupCharacters,
  isExternalFileDrag,
  resolvePasteTargetDir,
  resolveStoryDropMode,
  shouldShowCharactersSection,
  shouldShowLoreSection,
} from '@/render/components/FilePanel/utils';

const tree: FileNode[] = [
  {
    name: '第一卷',
    path: '/p/第一卷',
    type: 'directory',
    children: [
      { name: '第一章.md', path: '/p/第一卷/第一章.md', type: 'file' },
      { name: '草稿.md', path: '/p/第一卷/草稿.md', type: 'file' },
      {
        name: '支线',
        path: '/p/第一卷/支线',
        type: 'directory',
        children: [{ name: '第二章.md', path: '/p/第一卷/支线/第二章.md', type: 'file' }],
      },
    ],
  },
  { name: 'readme.txt', path: '/p/readme.txt', type: 'file' },
];

const makeCharacter = (overrides: Partial<Character>): Character => ({
  id: 1,
  name: '林舟',
  role: '主角',
  category: 'major',
  description: '少年剑客',
  currentState: [],
  ...overrides,
});

const makeLore = (overrides: Partial<LoreEntry>): LoreEntry =>
  ({
    id: 1,
    title: '灵气体系',
    summary: '修炼规则',
    category: 'world',
    tags: [],
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }) as LoreEntry;

describe('FilePanel utils', () => {
  it('findNodeByPath 递归查找节点，找不到返回 null', () => {
    expect(findNodeByPath(tree, '/p/第一卷/支线/第二章.md')?.name).toBe('第二章.md');
    expect(findNodeByPath(tree, '/p/第一卷')?.type).toBe('directory');
    expect(findNodeByPath(tree, '/missing')).toBeNull();
  });

  it('filterTree 保留匹配文件及其父目录，目录名命中时保留原子节点', () => {
    const result = filterTree(tree, '第二章');
    expect(result).toHaveLength(1);
    expect(result[0].children?.map((n) => n.name)).toEqual(['支线']);
    expect(result[0].children?.[0].children?.[0].name).toBe('第二章.md');

    const byDir = filterTree(tree, '支线');
    expect(byDir[0].children?.[0].children).toHaveLength(1);

    expect(filterTree(tree, 'README')).toEqual([tree[1]]);
    expect(filterTree(tree, 'zzz')).toEqual([]);
  });

  it('countStoryStats 区分章与稿', () => {
    expect(countStoryStats(tree[0])).toEqual({ chapters: 2, drafts: 1 });
    expect(countStoryStats({ name: '第三章 草稿.md', path: 'x', type: 'file' })).toEqual({
      chapters: 1,
      drafts: 0,
    });
  });

  it('countFiles 只统计文件', () => {
    expect(countFiles(tree)).toBe(4);
    expect(countFiles([])).toBe(0);
  });

  it('getCharacterCategoryLabel', () => {
    expect(getCharacterCategoryLabel('major')).toBe('主要角色');
    expect(getCharacterCategoryLabel('secondary')).toBe('次要角色');
  });

  it('findAncestorPaths 返回祖先目录路径', () => {
    expect(findAncestorPaths(tree, '/p/第一卷/支线/第二章.md')).toEqual([
      '/p/第一卷',
      '/p/第一卷/支线',
    ]);
    expect(findAncestorPaths(tree, '/p/readme.txt')).toEqual([]);
    expect(findAncestorPaths(tree, '/missing')).toEqual([]);
  });

  it('isExternalFileDrag 判断是否携带 Files 类型', () => {
    expect(isExternalFileDrag({ dataTransfer: { types: ['Files'] } })).toBe(true);
    expect(isExternalFileDrag({ dataTransfer: { types: ['text/plain'] } })).toBe(false);
    expect(isExternalFileDrag({ dataTransfer: { types: null } })).toBe(false);
  });

  it('getFolderName 取最后一级目录名', () => {
    expect(getFolderName('/Users/a/novel')).toBe('novel');
    expect(getFolderName(null)).toBeNull();
    expect(getFolderName('novel')).toBe('novel');
  });

  it('filterCharacters / filterLoreEntries 按关键词过滤', () => {
    const characters = [
      makeCharacter({ id: 1 }),
      makeCharacter({ id: 2, name: '白芷', role: '医者', description: '' }),
    ];
    expect(filterCharacters(characters, '')).toHaveLength(2);
    expect(filterCharacters(characters, '医者').map((c) => c.id)).toEqual([2]);
    expect(filterCharacters(characters, '剑客').map((c) => c.id)).toEqual([1]);

    const lore = [makeLore({ id: 1 }), makeLore({ id: 2, title: '宗门', summary: '门派' })];
    expect(filterLoreEntries(lore, '')).toHaveLength(2);
    expect(filterLoreEntries(lore, '门派').map((l) => l.id)).toEqual([2]);
  });

  it('groupCharacters 按主要/次要分组', () => {
    const groups = groupCharacters([
      makeCharacter({ id: 1, category: 'major' }),
      makeCharacter({ id: 2, category: 'secondary' }),
      makeCharacter({ id: 3, category: 'secondary' }),
    ]);
    expect(groups.map((g) => [g.key, g.label, g.items.length])).toEqual([
      ['major', '主要角色', 1],
      ['secondary', '次要角色', 2],
    ]);
  });

  it('shouldShowCharactersSection / shouldShowLoreSection', () => {
    expect(shouldShowCharactersSection('', 0)).toBe(true);
    expect(shouldShowCharactersSection('abc', 1)).toBe(true);
    expect(shouldShowCharactersSection('角色', 0)).toBe(true);
    expect(shouldShowCharactersSection('坏人', 0)).toBe(true);
    expect(shouldShowCharactersSection('abc', 0)).toBe(false);

    expect(shouldShowLoreSection('', 0)).toBe(true);
    expect(shouldShowLoreSection('世界观', 0)).toBe(true);
    expect(shouldShowLoreSection('设', 0)).toBe(true);
    expect(shouldShowLoreSection('abc', 2)).toBe(true);
    expect(shouldShowLoreSection('abc', 0)).toBe(false);
  });

  it('resolveStoryDropMode 根据纵向位置区分前后，允许内部时固定 inside', () => {
    const rect = { top: 100, height: 40 };
    expect(resolveStoryDropMode(rect, 105, false)).toBe('before');
    expect(resolveStoryDropMode(rect, 120, false)).toBe('after');
    expect(resolveStoryDropMode(rect, 139, false)).toBe('after');
    expect(resolveStoryDropMode({ top: 0, height: 0 }, 10, false)).toBe('after');
    expect(resolveStoryDropMode(rect, 105, true)).toBe('inside');
  });

  it('resolvePasteTargetDir 目录粘贴到自身，文件粘贴到父目录', () => {
    expect(resolvePasteTargetDir(tree, '/p/第一卷')).toBe('/p/第一卷');
    expect(resolvePasteTargetDir(tree, '/p/第一卷/第一章.md')).toBe('/p/第一卷');
    expect(resolvePasteTargetDir(tree, 'loose.md')).toBe('');
  });
});
