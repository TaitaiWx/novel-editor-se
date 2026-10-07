import { describe, expect, it } from 'vitest';
import type { FileNode } from '@/render/types';
import type { ReferenceItem } from '@/render/utils/referencePane';
import {
  buildMediaDirective,
  combineAutoItems,
  dropTargetIndex,
  extractDocumentMediaRefs,
  insertReferenceItems,
  moveReferenceItem,
  reconcileAutoItems,
  relativeToDir,
  resolveDocumentMedia,
  sceneVideoReferenceItems,
} from '@/render/utils/referenceSources';

const DOC = [
  '# 第一章',
  '::image[星港城 · 码头]{src="novels/星河旅人/资料/图集/设定/星港城商会/图片.webp"}',
  '正文 ![地图](./图/地图.png "标题") 与 ![网图](https://example.com/a.png)',
  '::video[离港]{src="novels/星河旅人/资料/视频/示例/离港.mp4"}',
  '::image[重复]{src="novels/星河旅人/资料/图集/设定/星港城商会/图片.webp"}',
  '::image[没有地址]',
  '`::video` 只是说明文字',
  '![说明文档](./说明.md)',
  '::audio[海港配乐]{src="novels/星河旅人/资料/音乐/海港.m4a" loop}',
].join('\n');

function auto(path: string, group: ReferenceItem['group']): ReferenceItem {
  return { path, title: path, kind: 'image', group, origin: 'auto' };
}

function user(path: string): ReferenceItem {
  return { path, title: path, kind: 'image', group: 'added', origin: 'user' };
}

describe('extractDocumentMediaRefs', () => {
  it('按出现顺序收集 ::image / ::video 与 Markdown 图片；跳过网址、重复与非媒体', () => {
    expect(extractDocumentMediaRefs(DOC)).toEqual([
      {
        src: 'novels/星河旅人/资料/图集/设定/星港城商会/图片.webp',
        caption: '星港城 · 码头',
        kind: 'image',
        syntax: 'directive',
      },
      { src: './图/地图.png', caption: '地图', kind: 'image', syntax: 'markdown' },
      {
        src: 'novels/星河旅人/资料/视频/示例/离港.mp4',
        caption: '离港',
        kind: 'video',
        syntax: 'directive',
      },
      {
        src: 'novels/星河旅人/资料/音乐/海港.m4a',
        caption: '海港配乐',
        kind: 'audio',
        syntax: 'directive',
      },
    ]);
  });

  it('空文档 / 没有媒体时为空', () => {
    expect(extractDocumentMediaRefs('')).toEqual([]);
    expect(extractDocumentMediaRefs('普通段落\n:char[林舟]')).toEqual([]);
  });
});

describe('resolveDocumentMedia', () => {
  it('指令从文档目录逐级向上找第一个存在的文件；Markdown 图片相对文档目录；找不到的跳过', async () => {
    const existing = new Set(['/p/novels/星河旅人/资料/视频/示例/离港.mp4', '/p/图/地图.png']);
    const checked: string[] = [];
    const items = await resolveDocumentMedia(
      extractDocumentMediaRefs(DOC),
      '/p/小说格式示例.md',
      async (path) => {
        checked.push(path);
        return existing.has(path);
      }
    );
    expect(items).toEqual([
      {
        path: '/p/图/地图.png',
        title: '地图',
        kind: 'image',
        group: 'chapter',
        origin: 'auto',
        refKey: 'markdown\n./图/地图.png',
      },
      {
        path: '/p/novels/星河旅人/资料/视频/示例/离港.mp4',
        title: '离港',
        kind: 'video',
        group: 'chapter',
        origin: 'auto',
        refKey: 'directive\nnovels/星河旅人/资料/视频/示例/离港.mp4',
      },
    ]);
    // 不存在的设定图：尝试了逐级向上的候选
    expect(checked).toContain('/p/novels/星河旅人/资料/图集/设定/星港城商会/图片.webp');
  });

  it('作品内的章节：指令地址相对作品目录（从章节目录向上找到）', async () => {
    const items = await resolveDocumentMedia(
      [{ src: '资料/图集/人物/林舟/三视图.webp', caption: '', kind: 'image', syntax: 'directive' }],
      '/p/novels/星河旅人/第一卷-离乡/001-启程.md',
      async (path) => path === '/p/novels/星河旅人/资料/图集/人物/林舟/三视图.webp'
    );
    expect(items.map((item) => [item.path, item.title])).toEqual([
      ['/p/novels/星河旅人/资料/图集/人物/林舟/三视图.webp', '三视图.webp'],
    ]);
  });
});

describe('sceneVideoReferenceItems', () => {
  const work = '/p/novels/星河旅人';
  const sceneDir = `${work}/资料/视频/001-启程/第一场 码头`;
  const files: FileNode[] = [
    {
      name: '资料',
      path: `${work}/资料`,
      type: 'directory',
      children: [
        {
          name: '视频',
          path: `${work}/资料/视频`,
          type: 'directory',
          children: [
            {
              name: '001-启程',
              path: `${work}/资料/视频/001-启程`,
              type: 'directory',
              children: [
                {
                  name: '第一场 码头',
                  path: sceneDir,
                  type: 'directory',
                  children: [
                    { name: '镜头1-v1.mp4', path: `${sceneDir}/镜头1-v1.mp4`, type: 'file' },
                    { name: '镜头1-v2.mp4', path: `${sceneDir}/镜头1-v2.mp4`, type: 'file' },
                    { name: '镜头2-v1.webm', path: `${sceneDir}/镜头2-v1.webm`, type: 'file' },
                    {
                      name: '镜头2-v1.prompt.json',
                      path: `${sceneDir}/镜头2-v1.prompt.json`,
                      type: 'file',
                    },
                    {
                      name: '样片-20261001-120000.mp4',
                      path: `${sceneDir}/样片-20261001-120000.mp4`,
                      type: 'file',
                    },
                    {
                      name: '样片-20261002-120000.mp4',
                      path: `${sceneDir}/样片-20261002-120000.mp4`,
                      type: 'file',
                    },
                    { name: '分镜.json', path: `${sceneDir}/分镜.json`, type: 'file' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ];

  it('每个镜头取最新版本，加最新一条样片；只看当前章节', () => {
    const items = sceneVideoReferenceItems(files, work, `${work}/第一卷/001-启程.md`);
    expect(items.map((item) => item.path)).toEqual([
      `${sceneDir}/镜头1-v2.mp4`,
      `${sceneDir}/镜头2-v1.webm`,
      `${sceneDir}/样片-20261002-120000.mp4`,
    ]);
    expect(items.every((item) => item.group === 'scene-video' && item.kind === 'video')).toBe(true);
    expect(sceneVideoReferenceItems(files, work, `${work}/第一卷/002-远航.md`)).toEqual([]);
    expect(sceneVideoReferenceItems(files, null, `${work}/001-启程.md`)).toEqual([]);
    expect(sceneVideoReferenceItems(files, work, null)).toEqual([]);
  });
});

describe('列表合并与排序', () => {
  it('combineAutoItems：按分组顺序拼接，同一路径只保留第一次', () => {
    const merged = combineAutoItems(
      [auto('/a', 'chapter')],
      [auto('/v', 'scene-video')],
      [auto('/a', 'character'), auto('/c', 'character')]
    );
    expect(merged.map((item) => [item.path, item.group])).toEqual([
      ['/a', 'chapter'],
      ['/v', 'scene-video'],
      ['/c', 'character'],
    ]);
  });

  it('reconcileAutoItems：保留作者加入的与排好的顺序，移除消失的自动项，新项插入同组之后', () => {
    const current = [auto('/c1', 'character'), user('/u'), auto('/a1', 'chapter')];
    const next = [
      auto('/a1', 'chapter'),
      auto('/a2', 'chapter'),
      auto('/v1', 'scene-video'),
      auto('/c2', 'character'),
    ];
    expect(reconcileAutoItems(current, next).map((item) => item.path)).toEqual([
      '/u',
      '/a1',
      '/a2',
      '/v1',
      '/c2',
    ]);
  });

  it('reconcileAutoItems：作者移除过的自动项不再出现；与作者加入的重复时保留作者的', () => {
    const current = [user('/a1')];
    const next = [auto('/a1', 'chapter'), auto('/a2', 'chapter'), auto('/c1', 'character')];
    const result = reconcileAutoItems(current, next, new Set(['/a2']));
    expect(result.map((item) => [item.path, item.origin])).toEqual([
      ['/a1', 'user'],
      ['/c1', 'auto'],
    ]);
  });

  it('reconcileAutoItems：同组没有项时插到后面分组之前', () => {
    const current = [auto('/c1', 'character')];
    const result = reconcileAutoItems(current, [auto('/c1', 'character'), auto('/a1', 'chapter')]);
    expect(result.map((item) => item.path)).toEqual(['/a1', '/c1']);
  });

  it('moveReferenceItem：移动并夹到两端；越界的 from 不变', () => {
    expect(moveReferenceItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveReferenceItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveReferenceItem(['a', 'b', 'c'], 1, 9)).toEqual(['a', 'c', 'b']);
    expect(moveReferenceItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveReferenceItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });

  it('dropTargetIndex：落在目标前 / 后，扣除被移走的那一项', () => {
    expect(dropTargetIndex(0, 2, false)).toBe(1);
    expect(dropTargetIndex(0, 2, true)).toBe(2);
    expect(dropTargetIndex(3, 0, false)).toBe(0);
    expect(dropTargetIndex(3, 0, true)).toBe(1);
    const items = ['a', 'b', 'c', 'd'];
    expect(moveReferenceItem(items, 0, dropTargetIndex(0, 3, true))).toEqual(['b', 'c', 'd', 'a']);
  });

  it('insertReferenceItems：在指定位置插入，同一路径先移除', () => {
    const result = insertReferenceItems([user('/a'), user('/b'), user('/c')], [user('/c')], 1);
    expect(result.map((item) => item.path)).toEqual(['/a', '/c', '/b']);
  });
});

describe('插入正文的指令', () => {
  it('relativeToDir：只在目录内时返回相对路径；Windows 路径忽略大小写', () => {
    expect(relativeToDir('/p/w/资料/a.png', '/p/w')).toBe('资料/a.png');
    expect(relativeToDir('/p/x/a.png', '/p/w')).toBeNull();
    expect(relativeToDir('C:\\P\\W\\资料\\a.png', 'c:\\p\\w')).toBe('资料/a.png');
  });

  it('文档在作品内：相对作品目录；在项目根：相对文档目录；都不行时用绝对路径', () => {
    const image = {
      path: '/p/novels/星河旅人/资料/图集/人物/林舟/三视图.webp',
      title: '林舟 · 三视图',
      kind: 'image' as const,
    };
    expect(
      buildMediaDirective(image, '/p/novels/星河旅人/第一卷/001.md', '/p/novels/星河旅人')
    ).toBe('::image[林舟 · 三视图]{src="资料/图集/人物/林舟/三视图.webp"}');
    expect(buildMediaDirective(image, '/p/小说格式示例.md', '/p/novels/星河旅人')).toBe(
      '::image[林舟 · 三视图]{src="novels/星河旅人/资料/图集/人物/林舟/三视图.webp"}'
    );
    const video = { path: '/other/离港.mp4', title: '离[港]', kind: 'video' as const };
    expect(buildMediaDirective(video, null, null)).toBe('::video[离 港]{src="/other/离港.mp4"}');
  });
});
