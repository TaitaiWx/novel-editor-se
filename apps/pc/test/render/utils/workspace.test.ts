import { describe, expect, it } from 'vitest';
import type { FileNode } from '@/render/types';
import {
  WORKSPACE_TAB_CHARACTERS,
  WORKSPACE_TAB_LORE,
  buildStoryDisplayNodes,
  compareStoryNodesForDisplay,
  createAssistantArtifactStorageKey,
  createChapterMaterialsStorageKey,
  createCharacterWorkspaceTab,
  createLoreWorkspaceTab,
  createStoryOrderStorageKey,
  createVolumeWorkspaceTab,
  findStoryParentPath,
  flattenFileNodes,
  getWorkspaceTabLabel,
  isChapterLikeStoryName,
  isDraftLikeStoryName,
  isStoryFilePath,
  isUntitledWritingTab,
  isVolumeLikeStoryName,
  isWorkspaceTab,
  parseCharacterWorkspaceTab,
  parseLoreWorkspaceTab,
  parseVolumeWorkspaceTab,
  resolveOrderedStoryChildren,
  shouldEnableChapterAssistant,
  sortStoryNodesForDisplay,
  splitWorkspaceFiles,
  stripStoryFileExtension,
} from '@/render/utils/workspace';

const file = (path: string): FileNode => ({
  name: path.split('/').pop() || path,
  path,
  type: 'file',
});
const dir = (path: string, children: FileNode[] = []): FileNode => ({
  name: path.split('/').pop() || path,
  path,
  type: 'directory',
  children,
});

const names = (nodes: FileNode[]) => nodes.map((n) => n.name);

describe('story name classifiers', () => {
  it('去掉扩展名', () => {
    expect(stripStoryFileExtension('第一章 风起.md')).toBe('第一章 风起');
    expect(stripStoryFileExtension('无扩展名')).toBe('无扩展名');
  });

  it('识别草稿、章节与卷', () => {
    expect(isDraftLikeStoryName('灵感碎片.md')).toBe(true);
    expect(isDraftLikeStoryName('Outline.txt')).toBe(true);
    expect(isDraftLikeStoryName('第一章.md')).toBe(false);

    expect(isChapterLikeStoryName('第十二章 夜雨.md')).toBe(true);
    expect(isChapterLikeStoryName('Chapter 3.md')).toBe(true);
    expect(isChapterLikeStoryName('scene 2')).toBe(true);
    expect(isChapterLikeStoryName('人物小传.md')).toBe(false);

    expect(isVolumeLikeStoryName('第一卷 青云')).toBe(true);
    expect(isVolumeLikeStoryName('Volume 2')).toBe(true);
    expect(isVolumeLikeStoryName('Part 1')).toBe(true);
    expect(isVolumeLikeStoryName('act 3')).toBe(true);
    expect(isVolumeLikeStoryName('卷_4')).toBe(true);
    expect(isVolumeLikeStoryName('正文')).toBe(false);
  });
});

describe('compareStoryNodesForDisplay / sortStoryNodesForDisplay', () => {
  it('按卷 → 章节文件 → 普通目录 → 草稿目录 → 草稿文件排序', () => {
    const nodes = [
      file('/n/草稿.md'),
      dir('/n/草稿箱'),
      dir('/n/番外合集'),
      file('/n/第2章 夜雨.md'),
      file('/n/第1章 风起.md'),
      dir('/n/第2卷'),
      dir('/n/第1卷', [file('/n/第1卷/第10章.md'), file('/n/第1卷/第9章.md')]),
    ];
    const sorted = sortStoryNodesForDisplay(nodes, '/n');
    expect(names(sorted)).toEqual([
      '第1卷',
      '第2卷',
      '第1章 风起.md',
      '第2章 夜雨.md',
      '番外合集',
      '草稿箱',
      '草稿.md',
    ]);
    expect(names(sorted[0].children || [])).toEqual(['第9章.md', '第10章.md']);
  });

  it('手动排序优先于自动排序', () => {
    const a = file('/n/第1章.md');
    const b = file('/n/第2章.md');
    const c = file('/n/第3章.md');
    const order = { '/n': ['/n/第3章.md', '/n/第1章.md'] };
    expect(names(sortStoryNodesForDisplay([a, b, c], '/n', order))).toEqual([
      '第3章.md',
      '第1章.md',
      '第2章.md',
    ]);
    // parentPath 为空时忽略手动顺序
    expect(compareStoryNodesForDisplay(c, a, null, order)).toBeGreaterThan(0);
    expect(compareStoryNodesForDisplay(b, c, '/n', order)).toBe(1);
  });

  it('英文 Chapter / Volume 编号按数字比较', () => {
    expect(
      names(sortStoryNodesForDisplay([file('/n/Chapter 10.md'), file('/n/Chapter 2.md')], '/n'))
    ).toEqual(['Chapter 2.md', 'Chapter 10.md']);
    expect(
      names(sortStoryNodesForDisplay([dir('/n/Volume 10'), dir('/n/Volume 2')], '/n'))
    ).toEqual(['Volume 2', 'Volume 10']);
  });

  // 回归：extractStoryOrder 只解析阿拉伯数字，“第四章/第十章”等中文数字章节
  // 回退到拼音排序，导致“第十章”(shi) 排在“第四章”(si) 之前。
  it('中文数字章节应按数值顺序排列', () => {
    const sorted = sortStoryNodesForDisplay(
      [file('/n/第十章.md'), file('/n/第四章.md'), file('/n/第二章.md')],
      '/n'
    );
    expect(names(sorted)).toEqual(['第二章.md', '第四章.md', '第十章.md']);
  });

  it('百位中文数字、“两”与阿拉伯数字混排按数值排序', () => {
    const sorted = sortStoryNodesForDisplay(
      [
        file('/n/第一百零三章.md'),
        file('/n/第两百章.md'),
        file('/n/第99章.md'),
        file('/n/第十二章.md'),
      ],
      '/n'
    );
    expect(names(sorted)).toEqual(['第十二章.md', '第99章.md', '第一百零三章.md', '第两百章.md']);
    expect(names(sortStoryNodesForDisplay([dir('/n/第十卷'), dir('/n/第三卷')], '/n'))).toEqual([
      '第三卷',
      '第十卷',
    ]);
  });
});

describe('buildStoryDisplayNodes', () => {
  it('卷目录单独展示，其余内容归入“未分卷”', () => {
    const nodes = [file('/n/楔子.md'), dir('/n/第2卷'), dir('/n/第1卷')];
    const display = buildStoryDisplayNodes(nodes, '/n');
    expect(names(display)).toEqual(['第1卷', '第2卷', '未分卷']);
    expect(display[2]).toMatchObject({ path: '/n', type: 'directory' });
    expect(names(display[2].children || [])).toEqual(['楔子.md']);
  });

  it('无 folderPath 时不生成“未分卷”', () => {
    expect(buildStoryDisplayNodes([file('/n/楔子.md')], null)).toEqual([]);
  });
});

describe('findStoryParentPath / resolveOrderedStoryChildren', () => {
  const tree = [
    dir('/n/第1卷', [
      dir('/n/第1卷/上', [file('/n/第1卷/上/第2章.md'), file('/n/第1卷/上/第1章.md')]),
    ]),
    file('/n/楔子.md'),
  ];

  it('查找父目录', () => {
    expect(findStoryParentPath(tree, '/n', '/n/楔子.md')).toBe('/n');
    expect(findStoryParentPath(tree, '/n', '/n/第1卷/上/第1章.md')).toBe('/n/第1卷/上');
    expect(findStoryParentPath(tree, '/n', '/n/不存在.md')).toBeNull();
  });

  it('根目录只返回非卷节点', () => {
    expect(names(resolveOrderedStoryChildren(tree, '/n', '/n'))).toEqual(['楔子.md']);
  });

  it('顶层目录直接返回排序后的子节点', () => {
    expect(names(resolveOrderedStoryChildren(tree, '/n', '/n/第1卷'))).toEqual(['上']);
  });

  it('深层目录通过遍历查找', () => {
    expect(names(resolveOrderedStoryChildren(tree, '/n', '/n/第1卷/上'))).toEqual([
      '第1章.md',
      '第2章.md',
    ]);
  });

  it('目标是文件或不存在时返回空数组', () => {
    expect(resolveOrderedStoryChildren(tree, '/n', '/n/楔子.md')).toEqual([]);
    expect(resolveOrderedStoryChildren(tree, '/n', '/n/第1卷/上/第1章.md')).toEqual([]);
    expect(resolveOrderedStoryChildren(tree, '/n', '/missing')).toEqual([]);
  });
});

describe('workspace tabs', () => {
  it('识别工作区标签并返回标签名', () => {
    expect(isWorkspaceTab(null)).toBe(false);
    expect(isWorkspaceTab(WORKSPACE_TAB_CHARACTERS)).toBe(true);
    expect(isWorkspaceTab(createCharacterWorkspaceTab({ id: 3 }))).toBe(true);
    expect(isWorkspaceTab(createLoreWorkspaceTab({ id: 4 }))).toBe(true);
    expect(isWorkspaceTab(createVolumeWorkspaceTab('/n/第1卷'))).toBe(true);
    expect(isWorkspaceTab('/n/第一章.md')).toBe(false);
    expect(getWorkspaceTabLabel(WORKSPACE_TAB_LORE)).toBe('设定');
    expect(getWorkspaceTabLabel('/x')).toBeNull();
  });

  it('解析人物、设定与卷标签', () => {
    expect(parseCharacterWorkspaceTab(createCharacterWorkspaceTab({ id: 12 }))).toBe(12);
    expect(parseCharacterWorkspaceTab('__workspace__:character:abc')).toBeNull();
    expect(parseCharacterWorkspaceTab(null)).toBeNull();
    expect(parseLoreWorkspaceTab(createLoreWorkspaceTab({ id: 7 }))).toBe(7);
    expect(parseLoreWorkspaceTab('__workspace__:lore-entry:x')).toBeNull();
    expect(parseLoreWorkspaceTab('/n')).toBeNull();
    expect(parseVolumeWorkspaceTab(createVolumeWorkspaceTab('/n/第1卷'))).toBe('/n/第1卷');
    expect(parseVolumeWorkspaceTab(createVolumeWorkspaceTab(''))).toBeNull();
    expect(parseVolumeWorkspaceTab(null)).toBeNull();
  });

  it('判断未命名标签、正文文件与章节助手开关', () => {
    expect(isUntitledWritingTab('__untitled__:1')).toBe(true);
    expect(isUntitledWritingTab(null)).toBe(false);
    expect(isStoryFilePath('C:\\小说\\第一章.MD')).toBe(true);
    expect(isStoryFilePath('/n/封面.png')).toBe(false);
    expect(isStoryFilePath('__workspace__:x.md')).toBe(false);
    expect(isStoryFilePath(null)).toBe(false);
    expect(shouldEnableChapterAssistant('__untitled__:2')).toBe(true);
    expect(shouldEnableChapterAssistant('/n/a.txt')).toBe(true);
    expect(shouldEnableChapterAssistant('/n/a.pdf')).toBe(false);
  });
});

describe('splitWorkspaceFiles / flattenFileNodes', () => {
  it('按目录提示把文件分到正文区与资料区', () => {
    const nodes = [
      dir('/n/正文', [file('/n/正文/第一章.md'), file('/n/正文/插图.png')]),
      dir('/n/资料', [file('/n/资料/地图.md')]),
      dir('/n/杂项', [file('/n/杂项/随笔.md'), file('/n/杂项/封面.jpg')]),
      dir('/n/空目录'),
      file('/n/楔子.md'),
      file('/n/说明.pdf'),
    ];
    const { storyNodes, materialNodes } = splitWorkspaceFiles(nodes);

    expect(names(storyNodes)).toEqual(['正文', '杂项', '楔子.md']);
    expect(names(storyNodes[0].children || [])).toEqual(['第一章.md']);
    expect(names(storyNodes[1].children || [])).toEqual(['随笔.md']);
    expect(names(materialNodes)).toEqual(['资料', '杂项', '说明.pdf']);
    expect(names(materialNodes[0].children || [])).toEqual(['地图.md']);
  });

  it('展平文件树只保留文件', () => {
    const nodes = [
      dir('/n/a', [file('/n/a/1.md'), dir('/n/a/b', [file('/n/a/b/2.md')])]),
      dir('/n/c'),
    ];
    expect(flattenFileNodes(nodes).map((n) => n.path)).toEqual(['/n/a/1.md', '/n/a/b/2.md']);
  });
});

describe('storage keys', () => {
  it('生成存储键并拒绝虚拟路径', () => {
    expect(createChapterMaterialsStorageKey('/n/a.md')).toBe(
      'novel-editor:chapter-materials:/n/a.md'
    );
    expect(createChapterMaterialsStorageKey('__untitled__:1')).toBeNull();
    expect(createChapterMaterialsStorageKey(null)).toBeNull();
    expect(createStoryOrderStorageKey('/n')).toBe('novel-editor:story-order:/n');
    expect(createStoryOrderStorageKey(null)).toBeNull();
    expect(createStoryOrderStorageKey('__x')).toBeNull();
    expect(createAssistantArtifactStorageKey('lore', 'volume', '/n/第1卷')).toBe(
      'novel-editor:assistant-artifact:lore:volume:/n/第1卷'
    );
    expect(createAssistantArtifactStorageKey('lore', 'volume', null)).toBeNull();
    expect(createAssistantArtifactStorageKey('lore', 'volume', '__x')).toBeNull();
  });
});
