import { describe, expect, it } from 'vitest';
import {
  STORYBOARD_JSON_SCHEMA,
  STORYBOARD_MAX_SHOTS,
  createShotId,
  normalizeShotSize,
  storyboardDurationSec,
  storyboardToMarkdown,
  validateStoryboard,
  type Storyboard,
} from '../src';

function expectOk(raw: unknown) {
  const result = validateStoryboard(raw);
  if (!result.ok) throw new Error(`应当通过校验: ${result.errors.join('; ')}`);
  return result;
}

describe('validateStoryboard', () => {
  it('解析标准结构', () => {
    const { storyboard, warnings } = expectOk({
      title: '离港',
      aspectRatio: '9:16',
      style: '写实',
      shots: [
        {
          id: 'a',
          shotSize: '特写',
          durationSec: 4,
          description: '林舟握紧舷窗把手',
          camera: '缓慢推近',
          characters: ['林舟', '苏晴'],
          location: '舰桥',
          dialogue: '林舟：出发吧',
        },
      ],
    });
    expect(warnings).toEqual([]);
    expect(storyboard).toEqual({
      version: 1,
      title: '离港',
      aspectRatio: '9:16',
      style: '写实',
      shots: [
        {
          id: 'a',
          shotSize: '特写',
          durationSec: 4,
          description: '林舟握紧舷窗把手',
          camera: '缓慢推近',
          characters: ['林舟', '苏晴'],
          location: '舰桥',
          // 旧版自由文本台词迁移为一句对白：「名字：台词」拆出说话人
          dialogue: [{ id: 'l1', speaker: '林舟', text: '出发吧' }],
        },
      ],
    });
  });

  it('接受字段别名、中文键、数组根与字符串数字', () => {
    const { storyboard } = expectOk([
      {
        景别: 'close-up',
        时长: '3秒',
        画面: '星光',
        运镜: '横移',
        人物: '林舟，苏晴、林舟',
        地点: '港口',
        台词: '走',
      },
      { size: 'ECU', duration: 2, prompt: '眼睛' },
      { shot_size: 'wide', seconds: 6.26, visual: '远处的星港', line: '……' },
    ]);
    expect(storyboard.aspectRatio).toBe('16:9');
    expect(storyboard.shots.map((s) => s.shotSize)).toEqual(['特写', '大特写', '远景']);
    expect(storyboard.shots[0]).toMatchObject({
      durationSec: 3,
      camera: '横移',
      characters: ['林舟', '苏晴'],
      location: '港口',
      dialogue: [{ id: 'l1', speaker: 'narrator', text: '走' }],
    });
    expect(storyboard.shots[2]?.durationSec).toBe(6.3);
    expect(storyboard.shots.map((s) => s.id)).toEqual(['shot-1', 'shot-2', 'shot-3']);
  });

  it('scenes / 镜头 作为 shots 别名，ratio 作为 aspectRatio 别名', () => {
    expect(
      expectOk({ scenes: [{ description: 'x', durationSec: 2 }] }).storyboard.shots
    ).toHaveLength(1);
    const result = expectOk({ ratio: '1:1', 镜头: [{ description: 'x', durationSec: 2 }] });
    expect(result.storyboard.aspectRatio).toBe('1:1');
  });

  it('越界时长截断并警告，缺少时长默认 5 秒', () => {
    const { storyboard, warnings } = expectOk({
      shots: [
        { description: 'a', durationSec: 0.2 },
        { description: 'b', durationSec: 99 },
        { description: 'c' },
      ],
    });
    expect(storyboard.shots.map((s) => s.durationSec)).toEqual([1, 15, 5]);
    expect(warnings).toHaveLength(3);
    expect(warnings[2]).toContain('默认 5 秒');
  });

  it('无法识别的景别默认中景并警告；缺省景别不警告', () => {
    const { storyboard, warnings } = expectOk({
      shots: [
        { description: 'a', durationSec: 2, shotSize: '奇怪' },
        { description: 'b', durationSec: 2 },
      ],
    });
    expect(storyboard.shots.map((s) => s.shotSize)).toEqual(['中景', '中景']);
    expect(warnings).toEqual(['镜头 1 的景别「奇怪」无法识别']);
  });

  it('不支持的比例回退到 16:9 并警告', () => {
    const { storyboard, warnings } = expectOk({
      aspectRatio: '2:1',
      shots: [{ description: 'a', durationSec: 2 }],
    });
    expect(storyboard.aspectRatio).toBe('16:9');
    expect(warnings[0]).toContain('2:1');
  });

  it('重复或缺失的 id 自动生成不冲突的 id', () => {
    const { storyboard } = expectOk({
      shots: [
        { id: 'shot-2', description: 'a', durationSec: 2 },
        { id: 'shot-2', description: 'b', durationSec: 2 },
        { description: 'c', durationSec: 2 },
      ],
    });
    expect(storyboard.shots.map((s) => s.id)).toEqual(['shot-2', 'shot-1', 'shot-3']);
  });

  it('超过上限的镜头只保留前 12 个', () => {
    const shots = Array.from({ length: STORYBOARD_MAX_SHOTS + 3 }, (_, i) => ({
      description: `镜头${i}`,
      durationSec: 2,
    }));
    const { storyboard, warnings } = expectOk({ shots });
    expect(storyboard.shots).toHaveLength(STORYBOARD_MAX_SHOTS);
    expect(warnings[0]).toContain('超过');
  });

  it('结构错误直接报错', () => {
    expect(validateStoryboard(null)).toEqual({ ok: false, errors: ['分镜必须是 JSON 对象'] });
    expect(validateStoryboard('x').ok).toBe(false);
    expect(validateStoryboard({ shots: [] })).toEqual({
      ok: false,
      errors: ['分镜至少需要一个镜头（shots）'],
    });
    const result = validateStoryboard({
      shots: [
        'not object',
        { durationSec: 2 },
        { description: 'a', durationSec: 'abc' },
        { description: '   ', durationSec: 2 },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        '镜头 1 不是对象',
        '镜头 2 缺少画面描述（description）',
        '镜头 3 的时长不是数字: abc',
        '镜头 4 缺少画面描述（description）',
      ]);
    }
  });

  it('空字符串字段被忽略、数字字段转文本', () => {
    const { storyboard } = expectOk({
      title: '  ',
      shots: [{ description: 42, durationSec: 2, camera: '', characters: [] }],
    });
    expect(storyboard.title).toBeUndefined();
    expect(storyboard.shots[0]).toEqual({
      id: 'shot-1',
      shotSize: '中景',
      durationSec: 2,
      description: '42',
    });
  });
});

describe('storyboard helpers', () => {
  const board: Storyboard = {
    version: 1,
    title: '离港',
    aspectRatio: '16:9',
    style: '国漫',
    shots: [
      {
        id: 'a',
        shotSize: '远景',
        durationSec: 3,
        description: '星港|远处',
        dialogue: [
          { id: 'l1', speaker: '林舟', text: '第一行' },
          { id: 'l2', speaker: 'narrator', text: '第二行' },
        ],
        sfx: [{ id: 's1', prompt: '汽笛', atSec: 1, volume: 0.8 }],
      },
      {
        id: 'b',
        shotSize: '特写',
        durationSec: 2.5,
        description: '眼睛',
        characters: ['林舟', '苏晴'],
      },
    ],
  };

  it('normalizeShotSize', () => {
    expect(normalizeShotSize('全景')).toBe('全景');
    expect(normalizeShotSize('MCU')).toBe('近景');
    expect(normalizeShotSize('')).toBeUndefined();
    expect(normalizeShotSize(3)).toBeUndefined();
  });

  it('createShotId 跳过已用 id', () => {
    expect(createShotId([])).toBe('shot-1');
    expect(createShotId(['shot-1', 'shot-3'])).toBe('shot-2');
  });

  it('总时长与 Markdown 分镜表（转义竖线与换行）', () => {
    expect(storyboardDurationSec(board)).toBe(5.5);
    const md = storyboardToMarkdown(board);
    expect(md).toContain('# 离港');
    expect(md).toContain('比例：16:9 · 风格：国漫 · 总时长：5.5 秒');
    expect(md).toContain('| 1 | 远景 | 3s | 星港\\|远处 |  |  | 林舟：第一行<br>旁白：第二行 | 汽笛@1s |');
    expect(md).toContain('| 2 | 特写 | 2.5s | 眼睛 |  | 林舟、苏晴 |  |  |');
    expect(md.endsWith('\n')).toBe(true);
    expect(storyboardToMarkdown({ ...board, title: undefined, style: undefined })).toContain(
      '# 分镜表'
    );
  });

  it('JSON schema 与常量一致', () => {
    expect(STORYBOARD_JSON_SCHEMA.properties.shots.maxItems).toBe(STORYBOARD_MAX_SHOTS);
    expect(STORYBOARD_JSON_SCHEMA.properties.shots.items.properties.shotSize.enum).toContain(
      '特写'
    );
  });
});
