import { describe, expect, it } from 'vitest';
import { deriveVolumeOutline, extractActs } from '../src';
import type { VolumeOutline } from '../src';
import { isDirectiveLine, sceneContainerTitle } from '../src/outline/novel-markers';

describe('sceneContainerTitle', () => {
  it('标题优先级：title 属性 > 方括号标签 > id > 「场景」', () => {
    expect(sceneContainerTitle(':::scene{#s-1 title=港口 pov=林舟}')).toBe('港口');
    expect(sceneContainerTitle(':::scene{title="雨夜 码头"}')).toBe('雨夜 码头');
    expect(sceneContainerTitle(":::scene{title='灯塔'}")).toBe('灯塔');
    expect(sceneContainerTitle(':::scene[集市]{#s-2}')).toBe('集市');
    expect(sceneContainerTitle(':::scene{#s-3}')).toBe('s-3');
    expect(sceneContainerTitle(':::scene')).toBe('场景');
    expect(sceneContainerTitle('   :::scene{title=港口}   ')).toBe('港口');
  });

  it('不是场景容器开始行时返回 null', () => {
    expect(sceneContainerTitle(':::')).toBeNull();
    expect(sceneContainerTitle(':::note{title=备注}')).toBeNull();
    expect(sceneContainerTitle('::scene{title=港口}')).toBeNull();
    expect(sceneContainerTitle(':::scene{title=港口} 后面有正文')).toBeNull();
    expect(sceneContainerTitle('第一场 港口')).toBeNull();
  });
});

describe('isDirectiveLine', () => {
  it('识别容器开始 / 结束与叶子指令', () => {
    expect(isDirectiveLine(':::')).toBe(true);
    expect(isDirectiveLine(':::scene{title=港口}')).toBe(true);
    expect(isDirectiveLine('::video[开场]{src="a.mp4"}')).toBe(true);
    expect(isDirectiveLine('  ::video{src=a.mp4}  ')).toBe(true);
  });

  it('正文、中文指令名、行内指令都不是指令行', () => {
    expect(isDirectiveLine('12:30 他到了港口')).toBe(false);
    expect(isDirectiveLine('::中文')).toBe(false);
    expect(isDirectiveLine('他喊:char[阿舟]{id=x}')).toBe(false);
    expect(isDirectiveLine('::video 后面还有正文')).toBe(false);
    expect(isDirectiveLine('')).toBe(false);
  });
});

const SCENE_TEXT = [
  '第一幕 离港',
  ':::scene{#s-1 title=港口 pov=林舟}',
  '::video[开场]{src="资料/视频/a.mp4"}',
  '雨夜，林舟站在码头。',
  ':::',
  ':::scene[灯塔]',
  ':::',
  '第一场 集市',
  '人声鼎沸。',
].join('\n');

describe('extractActs 识别场景容器', () => {
  it(':::scene 容器作为场景，预览跳过指令行', () => {
    const acts = extractActs(SCENE_TEXT);
    expect(acts).toHaveLength(1);
    expect(acts[0].title).toBe('第一幕 离港');
    expect(acts[0].scenes).toEqual([
      { title: '港口', line: 2, preview: '雨夜，林舟站在码头。' },
      { title: '灯塔', line: 6, preview: '' },
      { title: '第一场 集市', line: 8, preview: '人声鼎沸。' },
    ]);
  });

  it('没有幕时为场景容器创建默认幕', () => {
    const acts = extractActs(':::scene{title=港口}\n正文\n:::');
    expect(acts).toHaveLength(1);
    expect(acts[0].title).toBe('默认幕');
    expect(acts[0].scenes).toEqual([{ title: '港口', line: 1, preview: '正文' }]);
  });
});

function allBeats(outline: VolumeOutline) {
  return outline.acts.flatMap((act) => act.chapters.flatMap((chapter) => chapter.beats));
}

describe('deriveVolumeOutline 识别场景容器', () => {
  it('有幕标记时场景容器成为场景节拍，节拍文字跳过指令行', () => {
    const outline = deriveVolumeOutline([
      { path: '/书/001-离港.md', title: '离港', content: SCENE_TEXT },
    ]);
    expect(outline.structure).toBe('markers');
    const beats = allBeats(outline);
    expect(beats.map((beat) => [beat.title, beat.source, beat.line, beat.text])).toEqual([
      ['港口', 'scene', 2, '雨夜，林舟站在码头。'],
      ['灯塔', 'scene', 6, ''],
      ['第一场 集市', 'scene', 8, '人声鼎沸。'],
    ]);
  });

  it('没有幕标记时按模板分幕，场景容器同样作为节拍（而非开篇句兜底）', () => {
    const content = [
      ':::scene{title=港口}',
      '::video{src=a.mp4}',
      '雨夜。',
      ':::',
      ':::scene{#s-2}',
      '风停了。',
      ':::',
    ].join('\n');
    const outline = deriveVolumeOutline([{ path: '/书/001.md', title: '一', content }]);
    expect(outline.hasMarkers).toBe(false);
    const beats = allBeats(outline);
    expect(beats.every((beat) => beat.source === 'scene')).toBe(true);
    expect(beats.map((beat) => [beat.title, beat.text])).toEqual([
      ['港口', '雨夜。'],
      ['s-2', '风停了。'],
    ]);
  });
});
