import { describe, expect, it, vi } from 'vitest';
import {
  PREVIZ_JOINTS,
  validatePrevizScript,
  type PrevizMotionTracks,
  type PrevizScript,
} from '@novel-editor/video';
import {
  pendingMotionRequests,
  resolvePrevizMotionRequests,
  type MotionCompletion,
  type MotionProvider,
} from '../src/motion';
import {
  PREVIZ_MOTION_EXAMPLE,
  PREVIZ_MOTION_PROMPT_TAG,
  buildMotionPrompt,
  buildPrevizPrompt,
  parseMotionResponse,
  parsePrevizResponse,
} from '../src/prompts';

const NOD: PrevizMotionTracks = {
  tracks: {
    head: [
      [0, 0, 0, 0],
      [0.3, 20, 0, 0],
      [0.6, 0, 0, 0],
    ],
  },
};

function scriptOf(raw: unknown): PrevizScript {
  const result = validatePrevizScript(raw);
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.script;
}

/** 两个人物：林舟「点头」两次（相同描述），苏晴「搓手」 */
const SCRIPT = scriptOf({
  durationSec: 4,
  figures: [
    {
      name: '林舟',
      keys: [
        { t: 0, x: 0, z: 0, pose: 'stand', motion: { generate: '点头' } },
        { t: 2, x: 0, z: 0, pose: 'talk', motion: { generate: '点头' } },
      ],
    },
    {
      name: '苏晴',
      keys: [{ t: 1, x: 1, z: 0, pose: 'stand', motion: { generate: '紧张地搓手' } }],
    },
  ],
  camera: [{ t: 0, shotSize: 'full' }],
});

describe('预演提示词：关节轨迹', () => {
  it('系统提示词列出全部关节、范围、轴约定与紧凑示例；不再有动作片段 / 动作库', () => {
    const prompt = buildPrevizPrompt({ action: '林舟挥手', shotSize: 'medium', durationSec: 4 });
    for (const joint of PREVIZ_JOINTS) expect(prompt.systemPrompt).toContain(`- ${joint}: x `);
    expect(prompt.systemPrompt).toContain('rightUpperArm: x -180..60, y -90..90, z -180..30');
    expect(prompt.systemPrompt).toContain('motion.tracks');
    expect(prompt.systemPrompt).toContain('[t, rx, ry, rz]');
    expect(prompt.systemPrompt).toContain(JSON.stringify({ motion: PREVIZ_MOTION_EXAMPLE }));
    expect(prompt.systemPrompt).toContain('"generate"');
    const all = `${prompt.systemPrompt}\n${prompt.prompt}`;
    expect(all).not.toMatch(/motion\.clip|builtin:|lib:|BVH/);
    // schema 里 motion 有 tracks / rootBob / lean
    expect(prompt.prompt).toContain('"rootBob"');
    expect(prompt.prompt).toContain('"lean"');
  });

  it('AI 写的轨迹经解析写进脚本', () => {
    const reply = JSON.stringify({
      durationSec: 2,
      figures: [
        {
          name: 'A',
          keys: [{ t: 0, x: 0, z: 0, pose: 'stand', motion: PREVIZ_MOTION_EXAMPLE }],
        },
      ],
      camera: [{ t: 0, shotSize: 'full' }],
    });
    const parsed = parsePrevizResponse(reply);
    if (!parsed.ok) throw new Error(parsed.errors.join(';'));
    expect(parsed.script.figures[0].keys[0].motion).toEqual(PREVIZ_MOTION_EXAMPLE);
  });

  it('追加请求的提示词：标记、描述、时长、关节表、示例与 schema', () => {
    const prompt = buildMotionPrompt({ description: '点头', durationSec: 2, figure: '林舟' });
    expect(prompt.systemPrompt.startsWith(`[${PREVIZ_MOTION_PROMPT_TAG}]`)).toBe(true);
    expect(prompt.systemPrompt).toContain('- head: x -45..45');
    expect(prompt.prompt).toContain('【动作】点头');
    expect(prompt.prompt).toContain('2 秒');
    expect(prompt.prompt).toContain(JSON.stringify(PREVIZ_MOTION_EXAMPLE));
    expect(prompt.messages[0]).toEqual({ role: 'system', content: prompt.systemPrompt });
  });

  it('parseMotionResponse：从代码块提取并夹值；不是 JSON / 没有轨迹时报错', () => {
    const ok = parseMotionResponse('```json\n{"tracks":{"head":[[0,90,0,0]]},"loop":true}\n```');
    expect(ok.ok && ok.motion).toEqual({ tracks: { head: [[0, 45, 0, 0]] }, loop: true });
    expect(parseMotionResponse('做不到').ok).toBe(false);
    expect(parseMotionResponse('{"tracks":{}}').ok).toBe(false);
  });
});

describe('resolvePrevizMotionRequests', () => {
  it('收集待生成的动作：时长取到下一关键帧（最少 1 秒）；已有轨迹的不再生成', () => {
    expect(pendingMotionRequests(SCRIPT)).toEqual([
      { figure: 0, key: 0, description: '点头', durationSec: 2 },
      { figure: 0, key: 1, description: '点头', durationSec: 2 },
      { figure: 1, key: 0, description: '紧张地搓手', durationSec: 3 },
    ]);
    const done = scriptOf({
      durationSec: 2,
      figures: [
        {
          name: 'A',
          keys: [{ t: 0, x: 0, z: 0, pose: 'stand', motion: { ...NOD, generate: '点头' } }],
        },
      ],
      camera: [{ t: 0, shotSize: 'full' }],
    });
    expect(pendingMotionRequests(done)).toEqual([]);
  });

  it('配置了动作生成服务（假服务）：相同描述只生成一次，轨迹写回脚本且描述保留；不修改原脚本', async () => {
    const generateMotion = vi.fn<MotionProvider['generateMotion']>(async (request) => {
      expect(request.joints).toEqual(PREVIZ_JOINTS);
      return request.description === '点头' ? NOD : { tracks: { leftHand: [[0, 0, 0, 999]] } };
    });
    const complete = vi.fn<MotionCompletion>();
    const result = await resolvePrevizMotionRequests(SCRIPT, {
      provider: { id: 'fake', kind: 'motion', generateMotion },
      complete,
    });
    expect(generateMotion).toHaveBeenCalledTimes(2);
    expect(complete).not.toHaveBeenCalled();
    expect(result.generated).toEqual(['点头', '紧张地搓手']);
    expect(result.notes).toEqual([]);
    const lin = result.script.figures[0].keys;
    expect(lin[0].motion).toEqual({ generate: '点头', ...NOD });
    expect(lin[1].motion?.tracks).toEqual(NOD.tracks);
    // 服务的输出同样校验 / 夹值
    expect(result.script.figures[1].keys[0].motion?.tracks?.leftHand).toEqual([[0, 0, 0, 60]]);
    expect(SCRIPT.figures[0].keys[0].motion).toEqual({ generate: '点头' });
    // 结果缓存在脚本里：再处理一次不会再请求
    const again = await resolvePrevizMotionRequests(result.script, {
      provider: { id: 'fake', kind: 'motion', generateMotion },
    });
    expect(generateMotion).toHaveBeenCalledTimes(2);
    expect(again.script).toBe(result.script);
  });

  it('没有动作生成服务：每个不同的描述追加一次文本请求；坏回复只影响那一个动作', async () => {
    const complete = vi.fn<MotionCompletion>(async (request) => {
      const user = request.messages[1].content;
      expect(request.messages[0].content).toContain(PREVIZ_MOTION_PROMPT_TAG);
      return user.includes('【动作】点头') ? `好的：\n${JSON.stringify(NOD)}` : '抱歉';
    });
    const result = await resolvePrevizMotionRequests(SCRIPT, { complete });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[0][0].messages[1].content).toContain('【人物】林舟');
    expect(result.script.figures[0].keys[0].motion?.tracks).toEqual(NOD.tracks);
    expect(result.script.figures[0].keys[1].motion?.tracks).toEqual(NOD.tracks);
    expect(result.script.figures[1].keys[0].motion).toEqual({ generate: '紧张地搓手' });
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain('紧张地搓手');
  });

  it('服务报错：保留 generate 并提示；什么都没有时只提示暂用姿势', async () => {
    const generateMotion = vi.fn<MotionProvider['generateMotion']>(async () => {
      throw new Error('boom');
    });
    const failed = await resolvePrevizMotionRequests(SCRIPT, {
      provider: { id: 'fake', kind: 'motion', generateMotion },
    });
    expect(failed.notes.some((note) => note.includes('boom'))).toBe(true);
    expect(failed.script.figures[0].keys[0].motion).toEqual({ generate: '点头' });
    const none = await resolvePrevizMotionRequests(SCRIPT);
    expect(none.script).toBe(SCRIPT);
    expect(none.notes[0]).toContain('暂用姿势代替');
  });
});
