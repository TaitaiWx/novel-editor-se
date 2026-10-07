import { describe, expect, it } from 'vitest';
import { PREVIZ_JSON_SCHEMA, PREVIZ_POSES } from '@novel-editor/video';
import {
  PREVIZ_PROMPT_TAG,
  PREVIZ_SYSTEM_PROMPT,
  buildPrevizPrompt,
  parsePrevizResponse,
} from '../src/prompts';

describe('buildPrevizPrompt', () => {
  it('系统提示词带标记、坐标约定与全部姿势；用户提示词带动作、人物、时长与 Schema', () => {
    const prompt = buildPrevizPrompt({
      action: '林舟从左侧走到树下，回头看苏晴',
      shotTitle: '镜头 2',
      characters: [{ name: '林舟', appearance: '黑发少年' }, { name: '苏晴' }, { name: ' ' }],
      shotSize: 'medium',
      durationSec: 30,
      aspectRatio: '16:9',
      cameraNote: '缓慢推近',
      location: '镇口',
    });
    expect(prompt.systemPrompt).toBe(PREVIZ_SYSTEM_PROMPT);
    expect(prompt.systemPrompt.startsWith(`[${PREVIZ_PROMPT_TAG}]`)).toBe(true);
    for (const pose of PREVIZ_POSES) expect(prompt.systemPrompt).toContain(pose);
    expect(prompt.messages).toEqual([
      { role: 'system', content: PREVIZ_SYSTEM_PROMPT },
      { role: 'user', content: prompt.prompt },
    ]);
    expect(prompt.prompt).toContain('林舟从左侧走到树下');
    expect(prompt.prompt).toContain('- 林舟：黑发少年');
    expect(prompt.prompt).toContain('- 苏晴');
    // 时长夹到 10 秒
    expect(prompt.prompt).toContain('durationSec = 10');
    expect(prompt.prompt).toContain('缓慢推近');
    expect(prompt.prompt).toContain(JSON.stringify(PREVIZ_JSON_SCHEMA));
    expect(prompt.schema).toBe(PREVIZ_JSON_SCHEMA);
  });

  it('没有写动作时给出提示，不留空', () => {
    const prompt = buildPrevizPrompt({ action: '  ', shotSize: 'full', durationSec: 4 });
    expect(prompt.prompt.split('\n')[1].length).toBeGreaterThan(0);
  });
});

describe('parsePrevizResponse', () => {
  it('从代码块 / 解释文字中提取 JSON 并校验', () => {
    const text = [
      '好的，这是预演：',
      '```json',
      JSON.stringify({
        duration: 6,
        figures: [
          {
            name: '林舟',
            keys: [
              { t: 0, x: -3, z: 0, pose: 'walk' },
              { t: 4, x: 0, z: 0, pose: 'stand' },
            ],
          },
        ],
        camera: [{ t: 0, shotSize: 'full' }],
      }),
      '```',
    ].join('\n');
    const result = parsePrevizResponse(text, { characters: ['林舟'], durationSec: 8 });
    if (!result.ok) throw new Error(result.errors.join(';'));
    expect(result.script.durationSec).toBe(6);
    expect(result.script.figures[0].keys).toHaveLength(2);
  });

  it('缺少时长时用默认值；不是 JSON / 结构不对时返回错误', () => {
    const ok = parsePrevizResponse('{"figures":[],"camera":[{"shotSize":"wide"}]}', {
      characters: ['A'],
      durationSec: 7,
    });
    expect(ok.ok && ok.script.durationSec).toBe(7);
    expect(ok.ok && ok.script.figures[0].name).toBe('A');
    expect(parsePrevizResponse('抱歉，我做不到').ok).toBe(false);
    expect(parsePrevizResponse('{"mood":"day"}').ok).toBe(false);
  });
});
