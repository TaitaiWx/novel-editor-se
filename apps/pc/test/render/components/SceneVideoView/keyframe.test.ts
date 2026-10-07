import { describe, expect, it } from 'vitest';
import type { Shot } from '@novel-editor/video';
import {
  KEYFRAME_REFERENCE_LIMIT,
  buildKeyframePrompt,
  keyframeReferences,
} from '@/render/components/SceneVideoView/keyframe';

const scene = { style: '水墨', location: '青石镇', characters: ['林舟', '苏晴'] };

function shot(partial: Partial<Shot> = {}): Shot {
  return {
    id: 'shot-1',
    shotSize: '中景',
    durationSec: 6,
    description: '林舟站在镇口',
    ...partial,
  };
}

describe('buildKeyframePrompt', () => {
  it('画风 + 景别运镜 + 地点 + 人物外貌 + 画面描述 + 人物一致性', () => {
    const prompt = buildKeyframePrompt(
      shot({ camera: '缓慢推近' }),
      scene,
      { 林舟: '黑发少年' },
      false
    );
    expect(prompt).toBe(
      [
        '影视分镜的首帧画面，电影感构图，不要文字',
        '水墨风格',
        '中景，缓慢推近',
        '地点：青石镇',
        '人物：林舟（黑发少年）、苏晴',
        '林舟站在镇口',
        '人物外貌、发型与服装与人物参考图保持一致',
      ].join('。')
    );
    expect(prompt).not.toContain('预演截图');
  });

  it('镜头自带人物与地点时优先；有预演时要求按参考图构图', () => {
    const prompt = buildKeyframePrompt(
      shot({ characters: ['苏晴'], location: '码头' }),
      scene,
      { 林舟: '黑发少年', 苏晴: '红衣' },
      true
    );
    expect(prompt).toContain('地点：码头');
    expect(prompt).toContain('人物：苏晴（红衣）');
    expect(prompt).not.toContain('林舟（');
    expect(prompt).toContain('人物站位、朝向与镜头角度按第一张参考图（预演截图）的构图');
  });

  it('没有风格 / 地点 / 人物时省略对应部分；描述末尾句号不重复', () => {
    const prompt = buildKeyframePrompt(
      shot({ description: '  雪落无声。 ' }),
      { style: '', location: '', characters: [] },
      {},
      false
    );
    expect(prompt).toBe('影视分镜的首帧画面，电影感构图，不要文字。中景。雪落无声。');
    expect(prompt).not.toContain('。。');
    expect(prompt).not.toContain('人物');
  });
});

describe('keyframeReferences', () => {
  it('预演截图在前，去重后最多 4 张', () => {
    expect(keyframeReferences('资料/预演.png', ['a.png', 'b.png', 'a.png'])).toEqual([
      '资料/预演.png',
      'a.png',
      'b.png',
    ]);
    expect(keyframeReferences(undefined, ['a.png'])).toEqual(['a.png']);
    expect(keyframeReferences('p.png', ['p.png', '1', '2', '3', '4'])).toEqual([
      'p.png',
      '1',
      '2',
      '3',
    ]);
    expect(keyframeReferences(undefined, [])).toEqual([]);
    expect(KEYFRAME_REFERENCE_LIMIT).toBe(4);
  });
});
