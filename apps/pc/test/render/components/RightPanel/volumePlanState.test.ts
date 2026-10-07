import { describe, expect, it } from 'vitest';
import { deriveVolumeOutline } from '@novel-editor/basic-algorithm';
import {
  EMPTY_VOLUME_PLAN,
  chapterTitleFromPath,
  compareChapterPaths,
  createVolumePlanStorageKey,
  mergeBeatOrder,
  migrateLegacyPlotBoards,
  parseVolumePlanState,
  resolveVolumeTarget,
} from '@/render/components/RightPanel/VolumePlanView/volumePlanState';

describe('volumePlanState', () => {
  it('存储键按卷目录区分', () => {
    expect(createVolumePlanStorageKey(null)).toBeNull();
    expect(createVolumePlanStorageKey('/w/第一卷')).toBe('novel-editor:volume-plan:/w/第一卷');
  });

  it('容错解析：缺失或类型不对的字段回退为默认值', () => {
    expect(parseVolumePlanState('不是 JSON')).toBeNull();
    expect(parseVolumePlanState('[]')).toBeNull();
    expect(parseVolumePlanState('{}')).toEqual(EMPTY_VOLUME_PLAN);
    const parsed = parseVolumePlanState({
      intent: '林舟离家',
      structure: 'hero-journey',
      beatEdits: { a: '改写', b: 3 },
      beatOrder: { '/x.md': ['a', 1, 'b'], '/y.md': 'bad', '/z.md': [] },
      suggestions: { '/x.md': ['建议'] },
      actNotes: 'bad',
      generatedBy: 'robot',
      generatedAt: '2026-01-01',
    });
    expect(parsed).toEqual({
      ...EMPTY_VOLUME_PLAN,
      intent: '林舟离家',
      structure: 'hero-journey',
      beatEdits: { a: '改写' },
      beatOrder: { '/x.md': ['a', 'b'] },
      suggestions: { '/x.md': ['建议'] },
      generatedAt: '2026-01-01',
    });
    expect(parseVolumePlanState({ structure: 'unknown' })?.structure).toBeNull();
  });

  it('拖拽排序只改本段的 key，保留同章其他段落的顺序', () => {
    expect(mergeBeatOrder(['x', 'a'], ['a', 'b', 'c'], 'c', 'a')).toEqual(['x', 'c', 'a', 'b']);
    expect(mergeBeatOrder(undefined, ['a', 'b'], 'a', 'b')).toEqual(['b', 'a']);
    expect(mergeBeatOrder(undefined, ['a', 'b'], 'a', 'a')).toBeNull();
    expect(mergeBeatOrder(undefined, ['a', 'b'], 'z', 'a')).toBeNull();
  });

  it('定位当前卷：章节 → 所在目录，卷 → 自身，作品 → 作品目录', () => {
    expect(resolveVolumeTarget(null, '/w')).toBeNull();
    expect(resolveVolumeTarget({ kind: 'chapter', path: '/w/第一卷/001-启程.md' }, '/w')).toEqual({
      volumePath: '/w/第一卷',
      label: '第一卷',
      activePath: '/w/第一卷/001-启程.md',
    });
    expect(resolveVolumeTarget({ kind: 'chapter', path: '/w/001.md' }, '/w/')).toMatchObject({
      volumePath: '/w',
      label: '整部作品',
    });
    expect(resolveVolumeTarget({ kind: 'volume', path: 'C:\\w\\第二卷' }, null)).toEqual({
      volumePath: 'C:\\w\\第二卷',
      label: '第二卷',
      activePath: null,
    });
    expect(resolveVolumeTarget({ kind: 'project', path: '/w' }, '/w', '星河旅人')).toEqual({
      volumePath: '/w',
      label: '星河旅人',
      activePath: null,
    });
  });

  it('章节标题与排序：按卷序号再按章序号', () => {
    expect(chapterTitleFromPath('/w/第一卷/001-启程.md')).toBe('启程');
    expect(chapterTitleFromPath('/w/番外.md')).toBe('番外');
    const paths = [
      '/w/第二卷/004-星港城.md',
      '/w/第一卷/010-尾声.md',
      '/w/序章.md',
      '/w/第一卷/002-迷雾.md',
      '/w/第十卷/001-终章.md',
    ];
    expect([...paths].sort((a, b) => compareChapterPaths(a, b, '/w'))).toEqual([
      '/w/序章.md',
      '/w/第一卷/002-迷雾.md',
      '/w/第一卷/010-尾声.md',
      '/w/第二卷/004-星港城.md',
      '/w/第十卷/001-终章.md',
    ]);
  });

  it('旧版剧情板迁移：按幕标题匹配，场景目标 → 结果成为节拍改写', () => {
    const outline = deriveVolumeOutline([
      {
        path: '/w/卷/001.md',
        title: '启程',
        content: '第一幕 离乡\n第一场 清晨\n一\n第二场 夜\n二\n第二幕 迷雾\n第一场 入林\n三',
      },
    ]);
    const legacy = {
      '0:1:第一幕 离乡': {
        premise: '平静的小镇',
        goal: '',
        twist: '收到碎片',
        sceneBoards: [
          { title: '第二场 夜', objective: '交代身世', outcome: '决定出发', beats: ['炉火', ''] },
          { title: '第一场 清晨', objective: '', outcome: '' },
          'bad',
        ],
      },
      '1:7:不存在的幕': { goal: '忽略' },
      broken: 'x',
    };
    const migrated = migrateLegacyPlotBoards(JSON.stringify(legacy), outline);
    expect(migrated).toEqual({
      actNotes: { 'markers:0:第一幕 离乡': '前提：平静的小镇；转折：收到碎片' },
      beatEdits: { '001.md#scene:第二场 夜': '交代身世 → 决定出发' },
      suggestions: { '/w/卷/001.md': ['炉火'] },
    });
    expect(migrateLegacyPlotBoards('{bad', outline)).toBeNull();
    expect(migrateLegacyPlotBoards({ '0:1:第一幕 离乡': { goal: '' } }, outline)).toBeNull();
  });
});
