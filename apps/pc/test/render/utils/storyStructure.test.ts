import { describe, expect, it } from 'vitest';
import type { FileNode, WorkspaceProjectLayout } from '@/render/types';
import { splitWorkspaceFiles } from '@/render/utils/workspace';
import {
  buildStoryStructure,
  findContainingWorkPath,
  getProjectDocPathSet,
  getSplitWorkspaceOptions,
  resolveDefaultWorkPath,
  type StoryDisplayNode,
} from '@/render/utils/storyStructure';

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

/** 与 apps/pc/sample-data 相同的结构（readFolderTree 不保证顺序，这里故意打乱） */
const sampleFiles: FileNode[] = [
  dir('/p/资料', [file('/p/资料/世界观.md'), dir('/p/资料/素材', [file('/p/资料/素材/图.png')])]),
  file('/p/欢迎使用.md'),
  dir('/p/novels', [
    dir('/p/novels/星河旅人', [
      dir('/p/novels/星河旅人/第二卷-星海', [
        file('/p/novels/星河旅人/第二卷-星海/006-灯塔.md'),
        file('/p/novels/星河旅人/第二卷-星海/004-星港城.md'),
        file('/p/novels/星河旅人/第二卷-星海/005-风暴航线.md'),
      ]),
      dir('/p/novels/星河旅人/第一卷-离乡', [
        file('/p/novels/星河旅人/第一卷-离乡/002-迷雾森林.md'),
        file('/p/novels/星河旅人/第一卷-离乡/001-启程.md'),
        file('/p/novels/星河旅人/第一卷-离乡/003-狼王之夜.md'),
      ]),
    ]),
    dir('/p/novels/剑与诗', [
      file('/p/novels/剑与诗/002-听雨楼.md'),
      file('/p/novels/剑与诗/001-少年.md'),
    ]),
  ]),
];

const sampleLayout: WorkspaceProjectLayout = {
  name: '示例作品集',
  novelsDir: 'novels',
  novelsPath: '/p/novels',
  novels: ['剑与诗', '星河旅人'],
};

function structureOf(
  files: FileNode[],
  layout: WorkspaceProjectLayout | null,
  storyOrderMap: Record<string, string[]> = {}
) {
  const { storyNodes, materialNodes } = splitWorkspaceFiles(
    files,
    getSplitWorkspaceOptions(layout)
  );
  return {
    structure: buildStoryStructure(storyNodes, '/p', layout, storyOrderMap),
    materialNodes,
  };
}

const names = (nodes: StoryDisplayNode[] | undefined) => (nodes ?? []).map((node) => node.name);

describe('buildStoryStructure · ne init 项目', () => {
  it('作品为顶层节点（不展示 novels 容器），子目录是卷、文件是章', () => {
    const { structure } = structureOf(sampleFiles, sampleLayout);
    expect(structure.mode).toBe('project');
    expect(structure.worksParentPath).toBe('/p/novels');
    expect(structure.unassignedNode).toBeNull();
    expect(names(structure.displayNodes)).toEqual(['剑与诗', '星河旅人']);
    expect(structure.displayNodes.map((node) => node.storyKind)).toEqual(['work', 'work']);

    const [sword, star] = structure.displayNodes;
    expect(names(sword.children)).toEqual(['001-少年.md', '002-听雨楼.md']);
    expect(sword.children?.every((node) => node.storyKind === 'chapter')).toBe(true);

    // 卷按中文数字序号排序，卷内章节按数字前缀排序
    expect(names(star.children)).toEqual(['第一卷-离乡', '第二卷-星海']);
    expect(star.children?.every((node) => node.storyKind === 'volume')).toBe(true);
    expect(names(star.children?.[0].children)).toEqual([
      '001-启程.md',
      '002-迷雾森林.md',
      '003-狼王之夜.md',
    ]);
  });

  it('根目录文档是项目文档，不出现在正文树中', () => {
    const { structure } = structureOf(sampleFiles, sampleLayout);
    expect(structure.projectDocs.map((node) => node.path)).toEqual(['/p/欢迎使用.md']);
    expect(getProjectDocPathSet(structure).has('/p/欢迎使用.md')).toBe(true);
    const flat = JSON.stringify(structure.displayNodes);
    expect(flat).not.toContain('欢迎使用');
    expect(flat).not.toContain('资料');
  });

  it('作品名含资料类关键词时仍是作品；作品里的图片归资料分区', () => {
    const files: FileNode[] = [
      dir('/p/novels', [
        dir('/p/novels/素材之王', [file('/p/novels/素材之王/001-开端.md')]),
        dir('/p/novels/书', [file('/p/novels/书/封面.png'), file('/p/novels/书/001.md')]),
      ]),
    ];
    const layout = { ...sampleLayout, novels: ['书', '素材之王'] };
    const { structure, materialNodes } = structureOf(files, layout);
    expect(names(structure.displayNodes)).toEqual(['书', '素材之王']);
    expect(names(structure.displayNodes[1].children)).toEqual(['001-开端.md']);
    expect(JSON.stringify(materialNodes)).toContain('封面.png');
    expect(JSON.stringify(materialNodes)).not.toContain('001-开端');
  });

  it('作品之外的正文目录保留展示；novelsDir 为 "." 时根目录子目录即作品', () => {
    const files: FileNode[] = [
      file('/p/README.md'),
      dir('/p/书', [dir('/p/书/卷A', [file('/p/书/卷A/第一章.md')])]),
      dir('/p/草稿箱', [file('/p/草稿箱/想法.md')]),
    ];
    const layout: WorkspaceProjectLayout = {
      name: 'x',
      novelsDir: '.',
      novelsPath: '/p',
      novels: ['书'],
    };
    const { structure } = structureOf(files, layout);
    expect(names(structure.displayNodes)).toEqual(['书', '草稿箱']);
    expect(structure.displayNodes[1].storyKind).toBeUndefined();
    expect(structure.displayNodes[0].children?.[0].storyKind).toBe('volume');
    expect(structure.projectDocs.map((node) => node.name)).toEqual(['README.md']);
  });

  it('作品的手动排序（storyOrderMap）优先', () => {
    const { structure } = structureOf(sampleFiles, sampleLayout, {
      '/p/novels': ['/p/novels/星河旅人', '/p/novels/剑与诗'],
    });
    expect(names(structure.displayNodes)).toEqual(['星河旅人', '剑与诗']);
  });

  it('新建卷 / 章的默认作品：当前内容所在作品，否则第一部作品', () => {
    expect(findContainingWorkPath(sampleLayout, '/p/novels/星河旅人/第一卷-离乡/001.md')).toBe(
      '/p/novels/星河旅人'
    );
    expect(findContainingWorkPath(sampleLayout, '/p/欢迎使用.md')).toBeNull();
    expect(resolveDefaultWorkPath(sampleLayout, '/p/欢迎使用.md')).toBe('/p/novels/剑与诗');
    expect(resolveDefaultWorkPath(null, '/p/a.md')).toBeNull();
  });
});

describe('buildStoryStructure · 普通文件夹', () => {
  it('子目录装着章节时，根目录的非章节文档是项目文档，不计入未分卷', () => {
    const files: FileNode[] = [
      file('/p/欢迎使用.md'),
      file('/p/灵感.md'),
      dir('/p/第一卷', [file('/p/第一卷/第一章.md')]),
      dir('/p/番外', [file('/p/番外/外传.md')]),
    ];
    const { structure } = structureOf(files, null);
    expect(structure.mode).toBe('folder');
    expect(structure.projectDocs.map((node) => node.name)).toEqual(['欢迎使用.md', '灵感.md']);
    expect(names(structure.displayNodes)).toEqual(['第一卷', '未分卷']);
    expect(names(structure.unassignedNode?.children)).toEqual(['番外']);
  });

  it('根目录本身放章节时保持原样（只有 README 这类说明文档被移出）', () => {
    const files: FileNode[] = [
      file('/p/README.md'),
      file('/p/第一章.md'),
      file('/p/序言.md'),
      dir('/p/第一卷', [file('/p/第一卷/第二章.md')]),
    ];
    const { structure } = structureOf(files, null);
    expect(structure.projectDocs.map((node) => node.name)).toEqual(['README.md']);
    expect(names(structure.unassignedNode?.children)).toEqual(['第一章.md', '序言.md']);
  });

  it('只有根目录文件、没有子目录时都是正文', () => {
    const { structure } = structureOf([file('/p/开篇.md'), file('/p/随笔.md')], null);
    expect(structure.projectDocs).toEqual([]);
    expect(names(structure.unassignedNode?.children)).toEqual(['开篇.md', '随笔.md']);
  });

  it('中文数字卷名按序号排序', () => {
    const files: FileNode[] = [
      dir('/p/第十卷', [file('/p/第十卷/a.md')]),
      dir('/p/第二卷', [file('/p/第二卷/a.md')]),
      dir('/p/第一百零一卷', [file('/p/第一百零一卷/a.md')]),
    ];
    const { structure } = structureOf(files, null);
    expect(names(structure.displayNodes)).toEqual(['第二卷', '第十卷', '第一百零一卷']);
  });
});
