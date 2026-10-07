import { describe, expect, it, vi } from 'vitest';
import {
  BUILTIN_MOTIONS,
  builtinMotionBvh,
  validatePrevizScript,
  type PrevizScript,
} from '@novel-editor/video';
import {
  pendingMotionRequests,
  resolvePrevizMotionRequests,
  type MotionProvider,
} from '../src/motion';
import { buildPrevizPrompt, parsePrevizResponse } from '../src/prompts';

const CLIPS = BUILTIN_MOTIONS.map((item) => ({
  id: item.id,
  label: item.label,
  description: item.description,
  durationSec: item.durationSec,
  loop: item.loop,
}));

describe('预演提示词：动作片段', () => {
  it('列出可用动作片段 id；配置了动作生成服务时才提示 generate', () => {
    const base = { action: '林舟挥手', shotSize: 'medium' as const, durationSec: 4 };
    const prompt = buildPrevizPrompt({
      ...base,
      motionClips: [...CLIPS, { id: 'lib:wave-test', label: 'wave-test', durationSec: 1 }],
    });
    expect(prompt.prompt).toContain('- builtin:wave：挥手，raise the right hand and wave (loop)');
    expect(prompt.prompt).toContain('- lib:wave-test：wave-test（1s）');
    expect(prompt.prompt).not.toContain('"generate": "');
    expect(prompt.systemPrompt).toContain('motion.clip');
    expect(prompt.systemPrompt).toContain('lookAt');
    expect(buildPrevizPrompt({ ...base, canGenerateMotion: true }).prompt).toContain(
      'motion: { "generate"'
    );
    expect(buildPrevizPrompt(base).prompt).toContain('没有可用片段');
  });

  it('解析时按可用列表去掉不存在的片段', () => {
    const reply = JSON.stringify({
      durationSec: 2,
      figures: [
        {
          name: 'A',
          keys: [
            { t: 0, x: 0, z: 0, pose: 'stand', motion: { clip: 'wave' } },
            { t: 1, x: 0, z: 0, pose: 'stand', motion: { clip: 'nope' } },
          ],
        },
      ],
      camera: [{ t: 0, shotSize: 'medium' }],
    });
    const parsed = parsePrevizResponse(reply, { availableClips: CLIPS.map((clip) => clip.id) });
    if (!parsed.ok) throw new Error('应当解析成功');
    expect(parsed.script.figures[0].keys.map((key) => key.motion)).toEqual([
      { clip: 'builtin:wave' },
      undefined,
    ]);
  });
});

function scriptWithRequests(): PrevizScript {
  const result = validatePrevizScript({
    durationSec: 6,
    figures: [
      {
        name: 'A',
        keys: [
          { t: 0, x: 0, z: 0, pose: 'stand', motion: { generate: '跳舞' } },
          { t: 4, x: 0, z: 0, pose: 'stand', motion: { generate: '鞠躬', loop: false } },
        ],
      },
      { name: 'B', keys: [{ t: 1, x: 1, z: 0, pose: 'stand', motion: { generate: '跳舞' } }] },
    ],
    camera: [{ t: 0, shotSize: 'full' }],
  });
  if (!result.ok) throw new Error('脚本无效');
  return result.script;
}

describe('MotionProvider 扩展点', () => {
  it('收集待生成的动作，时长取到下一关键帧（至少 1 秒）', () => {
    expect(pendingMotionRequests(scriptWithRequests())).toEqual([
      { figure: 0, key: 0, description: '跳舞', durationSec: 4 },
      { figure: 0, key: 1, description: '鞠躬', durationSec: 2 },
      { figure: 1, key: 0, description: '跳舞', durationSec: 5 },
    ]);
  });

  it('没有服务时原样返回并提示', async () => {
    const script = scriptWithRequests();
    const result = await resolvePrevizMotionRequests(script, null);
    expect(result.script).toBe(script);
    expect(result.notes[0]).toContain('跳舞');
  });

  it('假服务：相同描述只请求一次，校验 BVH 后保存并改写为片段 id，失败的保留 generate', async () => {
    const bvh = builtinMotionBvh('builtin:bow') ?? '';
    const generateMotion = vi.fn<MotionProvider['generateMotion']>(async (request) => {
      if (request.description === '鞠躬') return { format: 'bvh', data: 'not a bvh' };
      return { format: 'bvh', data: bvh };
    });
    const provider: MotionProvider = { id: 'fake-motion', kind: 'motion', generateMotion };
    const save = vi.fn(async ({ index }: { index: number }) => `lib:generated-${index}`);
    const script = scriptWithRequests();
    const result = await resolvePrevizMotionRequests(script, provider, { save });

    expect(generateMotion).toHaveBeenCalledTimes(2);
    expect(generateMotion.mock.calls[0][0]).toEqual({
      description: '跳舞',
      durationSec: 4,
      skeleton: 'mannequin-v1',
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.generated.map((item) => item.clipId)).toEqual(['lib:generated-1']);
    expect(result.generated[0].clip.mapped).toContain('spine');
    const keys = result.script.figures.map((track) => track.keys.map((key) => key.motion));
    expect(keys).toEqual([
      [
        { generate: '跳舞', clip: 'lib:generated-1' },
        { generate: '鞠躬', loop: false },
      ],
      [{ generate: '跳舞', clip: 'lib:generated-1' }],
    ]);
    expect(result.notes[0]).toContain('鞠躬');
    // 原脚本不被修改
    expect(script.figures[0].keys[0].motion?.clip).toBeUndefined();
  });
});
