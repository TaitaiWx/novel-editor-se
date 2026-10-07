import { describe, expect, it } from 'vitest';
import {
  detectCharacters,
  findSceneBlockAtLine,
  findSceneBlockByTitle,
  groupEvenly,
  listSceneBlocks,
  resolveSceneSource,
  selectionSceneName,
  splitSceneIntoShots,
  splitSentences,
  suggestLocation,
} from '@/render/components/SceneVideoView/sceneSource';

const CHAPTER = [
  '# 启程', // 1
  '', // 2
  '林舟背起行囊，走出了小镇。', // 3
  '', // 4
  '第一幕 离乡', // 5
  '', // 6
  '第一场 清晨的青石镇', // 7
  '', // 8
  '石板路还湿着，昨夜的雨把老槐树洗得发亮。林舟回头看了一眼。', // 9
  '', // 10
  '“舟哥！”小石头光着脚从巷子里跑出来。', // 11
  '', // 12
  '林舟接过饼：“替我看好铁匠铺，等我回来。”', // 13
  '', // 14
  '第二场 铁匠铺的夜', // 15
  '', // 16
  '炉火映得秦伯满脸通红。', // 17
  '“这把剑叫青石。”秦伯说。', // 18
].join('\n');

describe('场景正文提取', () => {
  it('列出「第X场」段落：到下一个场 / 幕 / 标题为止，去掉首尾空行', () => {
    const blocks = listSceneBlocks(CHAPTER);
    expect(blocks.map((block) => block.title)).toEqual([
      '第一场 清晨的青石镇',
      '第二场 铁匠铺的夜',
    ]);
    expect(blocks[0]).toMatchObject({ startLine: 7, endLine: 14 });
    expect(blocks[0].text.startsWith('石板路还湿着')).toBe(true);
    expect(blocks[0].text).not.toContain('第二场');
    expect(blocks[1].text).toBe('炉火映得秦伯满脸通红。\n“这把剑叫青石。”秦伯说。');
  });

  it('按光标行与场景名定位；只改了小标题时按「第X场」前缀找到', () => {
    expect(findSceneBlockAtLine(CHAPTER, 11)?.title).toBe('第一场 清晨的青石镇');
    expect(findSceneBlockAtLine(CHAPTER, 3)).toBeNull();
    expect(findSceneBlockByTitle(CHAPTER, '第二场 铁匠铺的夜')?.startLine).toBe(15);
    expect(findSceneBlockByTitle(CHAPTER, '第二场 改过的名字')?.startLine).toBe(15);
    expect(findSceneBlockByTitle(CHAPTER, '不存在')).toBeNull();
  });

  it('选区优先：场景名取所在的场，不在场内时为「选段-前 10 个字」', () => {
    const selected = resolveSceneSource({
      docText: CHAPTER,
      selectionText: '  “舟哥！”小石头光着脚从巷子里跑出来。 ',
      selectionLine: 11,
      cursorLine: 17,
    });
    expect(selected).toEqual({
      scene: '第一场 清晨的青石镇',
      text: '“舟哥！”小石头光着脚从巷子里跑出来。',
      origin: 'selection',
    });
    expect(
      resolveSceneSource({ docText: CHAPTER, selectionText: '林舟背起行囊', selectionLine: 3 })
        .scene
    ).toBe('选段-林舟背起行囊');
    expect(selectionSceneName('#/\\', null)).toBe('选段');
  });

  it('没有选区时：指定场景名 > 光标所在的场 > 整章（去掉标题与幕场标记）', () => {
    expect(resolveSceneSource({ docText: CHAPTER, sceneTitle: '第二场 铁匠铺的夜' })).toMatchObject(
      { scene: '第二场 铁匠铺的夜', origin: 'scene-block' }
    );
    expect(resolveSceneSource({ docText: CHAPTER, cursorLine: 9 })).toMatchObject({
      scene: '第一场 清晨的青石镇',
      origin: 'scene-block',
    });
    const whole = resolveSceneSource({ docText: CHAPTER, cursorLine: 3 });
    expect(whole.scene).toBe('全章');
    expect(whole.origin).toBe('chapter');
    expect(whole.text).not.toMatch(/第一场|# 启程|第一幕/);
  });
});

describe('人物与地点', () => {
  it('按首次出现排序，别名也算', () => {
    expect(
      detectCharacters('小石头跑来，舟哥回头。秦伯不在。', [
        { name: '林舟', aliases: ['舟哥'] },
        { name: '小石头' },
        { name: '苏晴' },
        { name: ' ' },
      ])
    ).toEqual(['小石头', '林舟']);
  });

  it('地点：正文中最先出现的设定标题；太短的标题忽略', () => {
    expect(suggestLocation('他从青石镇出发，前往迷雾森林。', ['迷雾森林', '青石镇', '镇'])).toBe(
      '青石镇'
    );
    expect(suggestLocation('什么都没有', ['星港城'])).toBe('');
  });
});

describe('没有 AI 时的分镜拆分', () => {
  it('切句保留句末标点与引号', () => {
    expect(splitSentences('他说：“走吧。”她点头。然后呢？')).toEqual([
      '他说：“走吧。”',
      '她点头。',
      '然后呢？',
    ]);
    expect(groupEvenly([1, 2, 3, 4, 5], 3)).toEqual([[1, 2], [3, 4], [5]]);
    expect(groupEvenly([1], 4)).toEqual([[1]]);
  });

  it('段落足够时按段落拆：首镜全景、对白近景、带台词与人物，结果确定', () => {
    const scene = findSceneBlockByTitle(CHAPTER, '第一场')?.text ?? '';
    const options = {
      durationSec: 6,
      characters: [{ name: '林舟' }, { name: '小石头' }],
      location: '青石镇',
    };
    const shots = splitSceneIntoShots(scene, options);
    expect(shots).toHaveLength(3);
    expect(shots.map((shot) => shot.id)).toEqual(['shot-1', 'shot-2', 'shot-3']);
    expect(shots[0]).toMatchObject({ shotSize: '全景', camera: '缓慢推近', durationSec: 6 });
    expect(shots[1]).toMatchObject({
      shotSize: '近景',
      // 只有一个人物出场：引号里的话算作他说的
      dialogue: [{ id: 'l1', speaker: '小石头', text: '舟哥！' }],
      characters: ['小石头'],
    });
    expect(shots.every((shot) => shot.location === '青石镇')).toBe(true);
    expect(splitSceneIntoShots(scene, options)).toEqual(shots);
  });

  it('段落太少时按句子拆，至多 maxShots 个；空正文没有镜头', () => {
    const text = '一。二。三。四。五。六。七。八。';
    const shots = splitSceneIntoShots(text, { maxShots: 4 });
    expect(shots).toHaveLength(4);
    expect(shots[0].description).toBe('一。二。');
    expect(splitSceneIntoShots('只有一句话。')).toHaveLength(1);
    expect(splitSceneIntoShots('  \n第一场 标题\n')).toEqual([]);
  });

  it('画面描述最长 160 字', () => {
    const shots = splitSceneIntoShots('长'.repeat(400));
    expect(Array.from(shots[0].description)).toHaveLength(160);
  });
});
