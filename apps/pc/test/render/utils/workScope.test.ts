// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { FileNode, WorkspaceProjectLayout } from '@/render/types';
import {
  UNASSIGNED_WORK_LABEL,
  findWorkScopeForPath,
  listWorkScopeOptions,
  readStoredWorkPath,
  resolveWorkScope,
  selectWorkScopeNodes,
  storeWorkPath,
} from '@/render/utils/workScope';
import { resolveDefaultWorkPath } from '@/render/utils/storyStructure';
import { splitWorkspaceFiles } from '@/render/utils/workspace';
import { collectMaterialDeletionTargets, findScopeMaterialRoot } from '@/render/app/fileTreeUtils';

const layout: WorkspaceProjectLayout = {
  name: '示例作品集',
  novelsDir: 'novels',
  novelsPath: '/s/novels',
  novels: ['剑与诗', '星河旅人'],
};

const file = (path: string): FileNode => ({
  name: path.split('/').pop() as string,
  path,
  type: 'file',
});
const dir = (path: string, children: FileNode[]): FileNode => ({
  name: path.split('/').pop() as string,
  path,
  type: 'directory',
  children,
});

const tree: FileNode[] = [
  file('/s/欢迎使用.md'),
  dir('/s/资料', [file('/s/资料/旧设定.md')]),
  dir('/s/novels', [
    dir('/s/novels/星河旅人', [
      dir('/s/novels/星河旅人/第一卷', [file('/s/novels/星河旅人/第一卷/001-启程.md')]),
      dir('/s/novels/星河旅人/资料', [
        file('/s/novels/星河旅人/资料/世界观.md'),
        dir('/s/novels/星河旅人/资料/记忆', [file('/s/novels/星河旅人/资料/记忆/规则.json')]),
      ]),
      file('/s/novels/星河旅人/封面.png'),
    ]),
    dir('/s/novels/剑与诗', [
      file('/s/novels/剑与诗/001-少年.md'),
      dir('/s/novels/剑与诗/资料', [file('/s/novels/剑与诗/资料/听雨楼.md')]),
    ]),
  ]),
];

afterEach(() => window.localStorage.clear());

describe('作品作用域选项', () => {
  it('项目模式列出作品；有旧数据时附加「未归属」；普通文件夹只有它自己', () => {
    expect(listWorkScopeOptions(null, layout)).toEqual([]);
    expect(listWorkScopeOptions('/s', layout).map((o) => [o.kind, o.name, o.path])).toEqual([
      ['work', '剑与诗', '/s/novels/剑与诗'],
      ['work', '星河旅人', '/s/novels/星河旅人'],
    ]);
    expect(
      listWorkScopeOptions('/s', { ...layout, hasProjectMaterials: true }).map((o) => o.kind)
    ).toEqual(['work', 'work', 'unassigned']);
    expect(listWorkScopeOptions('/s', layout, true).at(-1)).toMatchObject({
      name: UNASSIGNED_WORK_LABEL,
      path: '/s',
    });
    // 没有作品时只能落在项目根
    expect(listWorkScopeOptions('/s', { ...layout, novels: [] })).toEqual([
      { kind: 'unassigned', name: UNASSIGNED_WORK_LABEL, path: '/s' },
    ]);
    expect(listWorkScopeOptions('/p/我的书', null)).toEqual([
      { kind: 'folder', name: '我的书', path: '/p/我的书' },
    ]);
  });

  it('优先作者选择的作品，失效时回退第一部；按文件定位所属作品', () => {
    const options = listWorkScopeOptions('/s', layout, true);
    expect(resolveWorkScope(options, '/s/novels/星河旅人')?.name).toBe('星河旅人');
    expect(resolveWorkScope(options, '/s/novels/已删除')?.name).toBe('剑与诗');
    expect(resolveWorkScope([], null)).toBeNull();
    expect(findWorkScopeForPath(options, '/s/novels/星河旅人/第一卷/001-启程.md')?.name).toBe(
      '星河旅人'
    );
    expect(findWorkScopeForPath(options, '/s/欢迎使用.md')).toBeNull();
    expect(findWorkScopeForPath(options, '__workspace__:characters')).toBeNull();
  });

  it('上次选择的作品按项目保存', () => {
    storeWorkPath('/s', '/s/novels/星河旅人');
    expect(readStoredWorkPath('/s')).toBe('/s/novels/星河旅人');
    expect(readStoredWorkPath('/other')).toBeNull();
    storeWorkPath('/s', null);
    expect(readStoredWorkPath('/s')).toBeNull();
    expect(readStoredWorkPath(null)).toBeNull();
  });

  it('新建卷 / 章默认放进当前作品', () => {
    expect(resolveDefaultWorkPath(layout, null, '/s/novels/星河旅人')).toBe('/s/novels/星河旅人');
    expect(
      resolveDefaultWorkPath(layout, '/s/novels/剑与诗/001-少年.md', '/s/novels/星河旅人')
    ).toBe('/s/novels/剑与诗');
    expect(resolveDefaultWorkPath(layout, null, '/s')).toBe('/s/novels/剑与诗');
  });
});

describe('按作品筛选文件树', () => {
  it('作品的 资料/ 归入资料分区而不是卷；按作品 / 未归属筛选', () => {
    const { storyNodes, materialNodes } = splitWorkspaceFiles(tree, {
      storyRoots: ['/s/novels/剑与诗', '/s/novels/星河旅人'],
    });
    const options = listWorkScopeOptions('/s', { ...layout, hasProjectMaterials: true });
    const [sword, star, unassigned] = options;

    const starStory = selectWorkScopeNodes(storyNodes, star, layout);
    expect(starStory.map((node) => node.name)).toEqual(['第一卷']);
    const starMaterials = selectWorkScopeNodes(materialNodes, star, layout);
    expect(starMaterials.map((node) => node.name).sort()).toEqual(['封面.png', '资料'].sort());
    expect(selectWorkScopeNodes(materialNodes, sword, layout).map((node) => node.name)).toEqual([
      '资料',
    ]);
    const legacy = selectWorkScopeNodes(materialNodes, unassigned, layout);
    expect(legacy.map((node) => node.path)).toEqual(['/s/资料']);
    // 普通文件夹 / 无作用域时不筛选
    expect(selectWorkScopeNodes(materialNodes, null, layout)).toBe(materialNodes);
  });

  it('当前作用域的资料根目录；清空资料只删资料不删正文', () => {
    expect(findScopeMaterialRoot(tree, '/s/novels/星河旅人')?.path).toBe('/s/novels/星河旅人/资料');
    expect(findScopeMaterialRoot(tree, '/s')?.path).toBe('/s/资料');
    expect(findScopeMaterialRoot(tree, '/s/novels/星河旅人/第一卷')).toBeNull();

    const { materialNodes } = splitWorkspaceFiles(tree, {
      storyRoots: ['/s/novels/剑与诗', '/s/novels/星河旅人'],
    });
    // 整个资料树：novels / 作品目录里还有正文，只能逐层深入删资料
    const targets = collectMaterialDeletionTargets(materialNodes, tree).map((node) => node.path);
    expect(targets.sort()).toEqual(
      [
        '/s/资料',
        '/s/novels/星河旅人/资料',
        '/s/novels/星河旅人/封面.png',
        '/s/novels/剑与诗/资料',
      ].sort()
    );
    expect(targets).not.toContain('/s/novels');
    expect(targets).not.toContain('/s/novels/星河旅人');
  });
});
