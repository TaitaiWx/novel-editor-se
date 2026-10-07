import { describe, expect, it } from 'vitest';
import {
  CHARACTER_MEDIA_KINDS,
  addMediaItems,
  buildCharacterImagePrompt,
  buildLoreFolderTree,
  buildLoreImagePrompt,
  describeCharacter,
  groupMediaItems,
  isDesignEmpty,
  isSafeMediaPath,
  normalizeLoreFolder,
  normalizeTags,
  parseCharacterDesign,
  parseMediaItems,
  removeMediaItem,
  resolveCover,
  type MediaItem,
} from '../src/entity-media';

const item = (id: string, kind: MediaItem['kind'], path = `资料/图集/人物/林舟/${id}.png`) =>
  ({ id, path, kind, source: 'upload', createdAt: '2026-10-07T00:00:00.000Z' }) as MediaItem;

describe('图集', () => {
  it('解析：丢弃越界路径 / 重复路径 / 非对象，未知类型归为 other，最多 60 张', () => {
    expect(isSafeMediaPath('资料/图集/a.png')).toBe(true);
    for (const bad of ['', '/abs.png', 'C:/x.png', '资料/../x.png', '资料//x.png', '\\x.png']) {
      expect(isSafeMediaPath(bad), bad).toBe(false);
    }
    const parsed = parseMediaItems([
      { id: 'a', path: '资料/a.png', kind: 'portrait', source: 'ai', prompt: ' p ', label: ' 主 ' },
      { path: '资料/a.png', kind: 'outfit' },
      { path: '../x.png' },
      'nope',
      { path: '资料/b.png', kind: 'weird' },
    ]);
    expect(parsed).toEqual([
      {
        id: 'a',
        path: '资料/a.png',
        kind: 'portrait',
        source: 'ai',
        prompt: 'p',
        label: '主',
        createdAt: '2026-10-07T00:00:00.000Z'.replace(/.*/, parsed[0].createdAt),
      },
      {
        id: '资料/b.png',
        path: '资料/b.png',
        kind: 'other',
        source: 'upload',
        createdAt: parsed[1].createdAt,
      },
    ]);
    expect(parseMediaItems(null)).toEqual([]);
    const many = Array.from({ length: 80 }, (_, index) => ({ path: `资料/${index}.png` }));
    expect(parseMediaItems(many)).toHaveLength(60);
  });

  it('新增放最前且去重，删除，按类型分组', () => {
    const items = addMediaItems(
      [item('a', 'portrait'), item('b', 'outfit')],
      [item('a', 'portrait'), item('c', 'turnaround')]
    );
    expect(items.map((entry) => entry.id)).toEqual(['a', 'c', 'b']);
    expect(removeMediaItem(items, 'c').map((entry) => entry.id)).toEqual(['a', 'b']);
    const groups = groupMediaItems([...items, item('z', 'concept')], CHARACTER_MEDIA_KINDS);
    expect(groups.map((group) => [group.option.label, group.items.length])).toEqual([
      ['形象图', 1],
      ['三视图', 1],
      ['服装', 1],
      ['其他', 1],
    ]);
  });

  it('封面：选过且仍存在 > 第一张形象图 / 概念图 > 第一张；空图集沿用旧头像', () => {
    const items = [item('o', 'outfit'), item('p', 'portrait')];
    expect(resolveCover(items, items[0].path)).toBe(items[0].path);
    expect(resolveCover(items, '资料/已删除.png')).toBe(items[1].path);
    expect(resolveCover([item('o', 'outfit')], undefined)).toBe('资料/图集/人物/林舟/o.png');
    expect(resolveCover([], undefined, ' 资料/人物头像/林舟.png ')).toBe('资料/人物头像/林舟.png');
    expect(resolveCover(undefined, 'data:image/png;base64,A')).toBe('data:image/png;base64,A');
    expect(resolveCover([], undefined)).toBeUndefined();
  });
});

describe('人物设计与出图提示词', () => {
  const design = parseCharacterDesign({
    appearance: ' 黑发束起，左眉有疤 ',
    outfit: '灰蓝短打',
    personality: '嘴硬心软',
    background: 'x'.repeat(900),
    unknown: 1,
  });

  it('解析：去空白、截断过长字段、忽略未知字段；判空', () => {
    expect(design.appearance).toBe('黑发束起，左眉有疤');
    expect(design.background).toHaveLength(800);
    expect(design).not.toHaveProperty('unknown');
    expect(isDesignEmpty(parseCharacterDesign(null))).toBe(true);
    expect(isDesignEmpty(design)).toBe(false);
  });

  it('人物描述（续写 / 分镜）带全部已填字段；没有设计时用简介', () => {
    expect(describeCharacter('林舟', parseCharacterDesign({ personality: '倔强' }))).toBe(
      '林舟（性格：倔强）'
    );
    expect(describeCharacter('苏晴', parseCharacterDesign(null), '星港来的少女')).toBe(
      '苏晴（星港来的少女）'
    );
    expect(describeCharacter('无名', parseCharacterDesign(null))).toBe('无名');
  });

  it('出图提示词只用外貌与服装（性格不进画面）；三视图有固定模板；作者补充放最后', () => {
    const prompt = buildCharacterImagePrompt({
      name: '林舟',
      design,
      kind: 'turnaround',
      style: '国漫',
      extra: '雪夜',
    });
    expect(prompt).toContain('国漫风格');
    expect(prompt).toContain('正面、侧面、背面');
    expect(prompt).toContain('黑发束起，左眉有疤；灰蓝短打');
    expect(prompt).not.toContain('嘴硬心软');
    expect(prompt.endsWith('雪夜')).toBe(true);
    expect(
      buildCharacterImagePrompt({
        name: '苏晴',
        design: parseCharacterDesign(null),
        description: '星港来的少女',
        kind: 'portrait',
      })
    ).toContain('星港来的少女');
    expect(
      buildLoreImagePrompt({
        title: '星港城',
        summary: '海边的港口',
        kind: 'background',
        style: '写实',
      })
    ).toBe(
      '写实风格。场景气氛图，宽画幅，可作为影视镜头背景，画面中不出现人物。主题：星港城。海边的港口'
    );
  });
});

describe('设定分类目录与标签', () => {
  it('目录：去空段、全角斜杠、控制字符与 ..，最多 4 级', () => {
    expect(normalizeLoreFolder(' 地理 / 北境 ／ 雪原 /')).toBe('地理/北境/雪原');
    expect(normalizeLoreFolder('a/../b/./c')).toBe('a/b/c');
    expect(normalizeLoreFolder('1/2/3/4/5')).toBe('1/2/3/4');
    expect(normalizeLoreFolder('a\u0001b')).toBe('ab');
    expect(normalizeLoreFolder(5)).toBe('');
  });

  it('标签：逗号 / 顿号 / 空白分隔，去 #，去重，最多 12 个', () => {
    expect(normalizeTags('#北境，禁地、 北境  雪')).toEqual(['北境', '禁地', '雪']);
    expect(normalizeTags(['a', 'a', 3, ''])).toEqual(['a']);
    expect(normalizeTags(Array.from({ length: 20 }, (_, i) => `t${i}`))).toHaveLength(12);
    expect(normalizeTags(null)).toEqual([]);
  });

  it('目录树：按名称排序，统计子树条目数，没有分类的条目在根上', () => {
    const tree = buildLoreFolderTree(
      [
        { title: '王都', folder: '地理' },
        { title: '雪原', folder: '地理/北境' },
        { title: '禁地', folder: '地理/北境' },
        { title: '星图', folder: '' },
      ],
      (entry) => entry.title
    );
    expect(tree.total).toBe(4);
    expect(tree.items.map((entry) => entry.title)).toEqual(['星图']);
    const geo = tree.folders[0];
    expect([geo.name, geo.total, geo.items.map((entry) => entry.title)]).toEqual([
      '地理',
      3,
      ['王都'],
    ]);
    expect(geo.folders[0]).toMatchObject({ name: '北境', path: '地理/北境', total: 2 });
    expect(geo.folders[0].items.map((entry) => entry.title)).toEqual(['禁地', '雪原']);
  });
});
