import { describe, expect, it } from 'vitest';
import {
  classifyWorkspaceEntry,
  classifyWorkspacePath,
  filterInternalDataTree,
  INTERNAL_PROJECT_META_DIR,
  isDerivedDataPath,
  isInternalDataPath,
  isManagedDataPath,
  isSceneVideoDirPath,
  PROJECT_META_DIR,
  sceneStateFilePath,
  workspaceRelativePath,
  type FileNode,
} from '../src';

describe('classifyWorkspaceEntry：内部数据', () => {
  it.each([
    '资料/记忆/规则.json',
    '资料/记忆/队伍.json',
    '资料/记忆/地图.json',
    '资料/记忆/角色/林舟.json',
    'novels/星河旅人/资料/记忆/角色/林舟.json',
    'novels\\星河旅人\\资料\\记忆\\规则.json',
    '资料/视频/001-启程/第一场/分镜.json',
    'novels/星河旅人/资料/视频/001-启程/第一场/镜头1-v1.prompt.json',
    '资料/图集/人物/林舟/形象图-1.prompt.json',
    '.novel-editor/config.json',
    '.novel-editor/session.json',
    '.novel-editor',
  ])('%s 是内部数据', (relative) => {
    expect(isInternalDataPath(relative)).toBe(true);
    expect(isManagedDataPath(relative)).toBe(true);
  });

  it('给出归属界面', () => {
    expect(classifyWorkspaceEntry('资料/记忆/规则.json')).toEqual({
      kind: 'internal',
      owner: 'growth',
    });
    expect(classifyWorkspaceEntry('资料/视频/章/场/分镜.json').owner).toBe('scene-video');
    expect(classifyWorkspaceEntry('资料/图集/设定/北境/a.prompt.json').owner).toBe('entity-media');
    expect(classifyWorkspaceEntry('.novel-editor/structure.json').owner).toBe('project-meta');
  });
});

describe('classifyWorkspaceEntry：派生摘要（显示但只读）', () => {
  it.each([
    '资料/记忆/README.md',
    '资料/记忆/角色/林舟.md',
    '资料/记忆/角色卡/林舟.md',
    '资料/记忆/设定/北境.md',
    'novels/星河旅人/资料/视频/001-启程/第一场/分镜.md',
  ])('%s 是派生摘要', (relative) => {
    expect(isDerivedDataPath(relative)).toBe(true);
    expect(isInternalDataPath(relative)).toBe(false);
  });
});

describe('classifyWorkspaceEntry：作者自己的文件保持可见', () => {
  it.each([
    '资料/设定.json',
    '资料/我的数据/人物表.json',
    'novels/星河旅人/资料/素材/地图.json',
    '资料/记忆/笔记.txt',
    '资料/记忆/角色/草稿/林舟.md',
    '资料/视频/分镜.json',
    '资料/视频/001-启程/分镜.json',
    '资料/视频/001-启程/第一场/镜头1-v1.mp4',
    '资料/视频/001-启程/第一场/样片-20261007-153000.mp4',
    '资料/图集/人物/林舟/形象图-1.png',
    '资料/动作库/挥剑.bvh',
    '记忆/规则.json',
    '分镜.json',
    'novels/星河旅人/001-启程.md',
    'config.json',
    '资料/记忆',
    '资料/视频/001-启程/第一场',
    '',
  ])('%s 是作者文件', (relative) => {
    expect(classifyWorkspaceEntry(relative).kind).toBe('user');
  });
});

describe('路径工具', () => {
  it('常量与 project.ts 一致', () => {
    expect(INTERNAL_PROJECT_META_DIR).toBe(PROJECT_META_DIR);
  });

  it('workspaceRelativePath / classifyWorkspacePath', () => {
    expect(workspaceRelativePath('/w/资料/a.md', '/w')).toBe('资料/a.md');
    expect(workspaceRelativePath('/w', '/w/')).toBe('');
    expect(workspaceRelativePath('/other/a.md', '/w')).toBeNull();
    expect(workspaceRelativePath('C:\\w\\资料\\a.md', 'C:\\w')).toBe('资料/a.md');
    expect(classifyWorkspacePath('/w/资料/记忆/规则.json', '/w').kind).toBe('internal');
    // 工作区根目录上层恰好叫 .novel-editor 时，不会误伤
    expect(classifyWorkspacePath('/x/.novel-editor/proj/a.md', '/x/.novel-editor/proj').kind).toBe(
      'user'
    );
    // 没有根目录时按完整路径判定
    expect(classifyWorkspacePath('/w/资料/视频/章/场/分镜.json', null).kind).toBe('internal');
  });

  it('场景目录判定与状态文件路径', () => {
    expect(isSceneVideoDirPath('/w/novels/星河旅人/资料/视频/001-启程/第一场')).toBe(true);
    expect(isSceneVideoDirPath('资料/视频/001-启程')).toBe(false);
    expect(isSceneVideoDirPath('资料/视频/001-启程/第一场/镜头')).toBe(false);
    expect(sceneStateFilePath('/w/资料/视频/章/场')).toBe('/w/资料/视频/章/场/分镜.json');
    expect(sceneStateFilePath('C:\\w\\资料\\视频\\章\\场')).toBe(
      'C:\\w\\资料\\视频\\章\\场\\分镜.json'
    );
  });
});

describe('filterInternalDataTree', () => {
  const file = (p: string): FileNode => ({ name: p.split('/').pop() ?? p, path: p, type: 'file' });
  const dir = (p: string, children: FileNode[]): FileNode => ({
    name: p.split('/').pop() ?? p,
    path: p,
    type: 'directory',
    children,
  });

  it('去掉内部数据、保留派生摘要与作者文件，并标记场景视频目录', () => {
    const tree = [
      dir('/w/资料', [
        file('/w/资料/设定.json'),
        dir('/w/资料/记忆', [
          file('/w/资料/记忆/规则.json'),
          file('/w/资料/记忆/README.md'),
          dir('/w/资料/记忆/角色', [
            file('/w/资料/记忆/角色/林舟.json'),
            file('/w/资料/记忆/角色/林舟.md'),
          ]),
        ]),
        dir('/w/资料/视频', [
          dir('/w/资料/视频/001-启程', [
            dir('/w/资料/视频/001-启程/第一场', [
              file('/w/资料/视频/001-启程/第一场/分镜.json'),
              file('/w/资料/视频/001-启程/第一场/分镜.md'),
              file('/w/资料/视频/001-启程/第一场/镜头1-v1.mp4'),
              file('/w/资料/视频/001-启程/第一场/镜头1-v1.prompt.json'),
            ]),
            dir('/w/资料/视频/001-启程/空场景', [file('/w/资料/视频/001-启程/空场景/x.mp4')]),
          ]),
        ]),
      ]),
    ];
    const result = filterInternalDataTree(tree, '/w');
    const paths: string[] = [];
    const walk = (nodes: FileNode[]) =>
      nodes.forEach((node) => {
        paths.push(node.path);
        if (node.children) walk(node.children);
      });
    walk(result);
    expect(paths).not.toContain('/w/资料/记忆/规则.json');
    expect(paths).not.toContain('/w/资料/记忆/角色/林舟.json');
    expect(paths).not.toContain('/w/资料/视频/001-启程/第一场/分镜.json');
    expect(paths).not.toContain('/w/资料/视频/001-启程/第一场/镜头1-v1.prompt.json');
    expect(paths).toEqual(
      expect.arrayContaining([
        '/w/资料/设定.json',
        '/w/资料/记忆/README.md',
        '/w/资料/记忆/角色/林舟.md',
        '/w/资料/视频/001-启程/第一场/分镜.md',
        '/w/资料/视频/001-启程/第一场/镜头1-v1.mp4',
      ])
    );
    const scene = result[0].children?.[2].children?.[0].children?.[0];
    expect(scene?.name).toBe('第一场');
    expect(scene?.sceneVideo).toBe(true);
    const empty = result[0].children?.[2].children?.[0].children?.[1];
    expect(empty?.sceneVideo).toBeUndefined();
    // 不修改传入的树
    expect(tree[0].children?.[1].children).toHaveLength(3);
  });

  it('没有内部数据时原样返回（保持引用）', () => {
    const tree = [dir('/w/正文', [file('/w/正文/001.md')]), file('/w/data.json')];
    expect(filterInternalDataTree(tree, '/w')).toBe(tree);
  });

  it('已标记的场景目录再次过滤保持标记（主进程与渲染进程各过滤一次）', () => {
    const tree = [
      { ...dir('/w/资料/视频/章/场', [file('/w/资料/视频/章/场/镜头1-v1.mp4')]), sceneVideo: true },
    ];
    expect(filterInternalDataTree(tree, '/w')[0].sceneVideo).toBe(true);
  });
});
