import { describe, expect, it } from 'vitest';
import { extractActs } from '../outline/extract-acts';
import { extractOutline } from '../outline/extract-outline';
import type { StructureClassifier } from '../outline/types';
import { deriveVolumeOutline, hasActMarkers } from './derive';

/** 模拟作者配置的规则：English 幕 / 场 + 自定义「=== 标题 ===」场 */
const classify: StructureClassifier = (line) => {
  if (/^Chapter \d+/i.test(line)) return 'chapter';
  if (/^Act [IVX\d]+/i.test(line)) return 'act';
  if (/^Scene \d+/i.test(line) || /^=== .+ ===$/.test(line)) return 'scene';
  return null;
};

const chapterOne = [
  'Act I: Departure',
  'Scene 1 - Dawn',
  'Lin packed his bag before sunrise.',
  '=== The Dock ===',
  'Su waited by the boats.',
].join('\n');
const chapterTwo = ['Act II', 'Scene 2', 'The sea was calm.'].join('\n');

describe('结构识别器（作者配置的规则）', () => {
  it('默认（不传识别器）不认英文幕标记，行为不变', () => {
    const chapters = [{ path: '/w/001.md', title: '001', content: chapterOne }];
    expect(hasActMarkers(chapters)).toBe(false);
    expect(hasActMarkers(chapters, classify)).toBe(true);
  });

  it('deriveVolumeOutline 按识别器分幕 / 场，标题为整行', () => {
    const outline = deriveVolumeOutline(
      [
        { path: '/w/001.md', title: '001', content: chapterOne },
        { path: '/w/002.md', title: '002', content: chapterTwo },
      ],
      { classify }
    );
    expect(outline.structure).toBe('markers');
    expect(outline.acts.map((act) => act.title)).toEqual(['Act I: Departure', 'Act II']);
    const beats = outline.acts[0].chapters[0].beats;
    expect(beats.map((beat) => beat.title)).toEqual(['Scene 1 - Dawn', '=== The Dock ===']);
    expect(beats[0].text).toBe('Lin packed his bag before sunrise.');
  });

  it('中文标记在传入识别器时由识别器决定', () => {
    const zh = '第一幕 离乡\n正文';
    expect(hasActMarkers([{ path: 'a', title: 'a', content: zh }])).toBe(true);
    expect(hasActMarkers([{ path: 'a', title: 'a', content: zh }], () => null)).toBe(false);
  });

  it('extractActs 接受识别器', () => {
    const acts = extractActs(chapterOne, { classify });
    expect(acts).toHaveLength(1);
    expect(acts[0].title).toBe('Act I: Departure');
    expect(acts[0].scenes.map((scene) => scene.title)).toEqual([
      'Scene 1 - Dawn',
      '=== The Dock ===',
    ]);
    expect(extractActs(chapterOne).map((act) => act.title)).not.toContain('Act I: Departure');
  });

  it('extractOutline 把识别出的章 / 幕标为 1 级、场为 2 级', () => {
    const nodes = extractOutline('Chapter 7\ntext\nScene 1\nmore', {
      enableHeuristic: false,
      classify,
    });
    expect(nodes).toEqual([
      { level: 1, text: 'Chapter 7', line: 1, source: 'structure-rule' },
      { level: 2, text: 'Scene 1', line: 3, source: 'structure-rule' },
    ]);
  });
});
