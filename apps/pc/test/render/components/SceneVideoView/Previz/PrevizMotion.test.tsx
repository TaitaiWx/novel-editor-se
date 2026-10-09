// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PrevizMotionTracks, PrevizSample } from '@novel-editor/video';
import type { MotionProvider } from '@novel-editor/ai/motion';
import { PREVIZ_MOTION_PROMPT_TAG, PREVIZ_PROMPT_TAG } from '@novel-editor/ai/prompts';
import PrevizDialog, {
  type CreatePrevizStage,
  type PrevizSaveOutput,
  type PrevizStageApi,
  type PrevizVideoEncoder,
} from '@/render/components/SceneVideoView/Previz';

const FRAME = { nodeName: 'CANVAS' } as unknown as CanvasImageSource;

function fakeStage() {
  const stage = {
    resize: vi.fn<PrevizStageApi['resize']>(),
    setFrame: vi.fn<PrevizStageApi['setFrame']>(),
    setSample: vi.fn<PrevizStageApi['setSample']>(),
    setHighlight: vi.fn<PrevizStageApi['setHighlight']>(),
    onLabels: vi.fn<PrevizStageApi['onLabels']>(),
    pick: vi.fn<PrevizStageApi['pick']>(() => null),
    capture: vi.fn<PrevizStageApi['capture']>(async () => new Uint8Array([137, 80, 78, 71])),
    beginExport: vi.fn<PrevizStageApi['beginExport']>(),
    renderExportFrame: vi.fn<PrevizStageApi['renderExportFrame']>(() => FRAME),
    endExport: vi.fn<PrevizStageApi['endExport']>(),
    dispose: vi.fn<() => void>(),
  } satisfies PrevizStageApi;
  const createStage = vi.fn<CreatePrevizStage>(async () => stage);
  return { stage, createStage };
}

type Stage = ReturnType<typeof fakeStage>['stage'];
const samples = (stage: Stage): PrevizSample[] => stage.setSample.mock.calls.map((call) => call[0]);

/** 挥手：AI 直接写在预演脚本里的关节轨迹 */
const WAVE: PrevizMotionTracks = {
  tracks: {
    rightUpperArm: [
      [0, 0, 0, -150],
      [0.4, 0, 0, -160],
      [0.8, 0, 0, -150],
    ],
    rightForearm: [
      [0, -20, 0, 25],
      [0.4, -20, 0, -25],
      [0.8, -20, 0, 25],
    ],
  },
  loop: true,
};

/** 追加请求返回的点头轨迹 */
const NOD: PrevizMotionTracks = {
  tracks: {
    head: [
      [0, 0, 0, 0],
      [0.3, 25, 0, 0],
      [0.6, 0, 0, 0],
    ],
  },
  loop: true,
};

const SCRIPT = {
  durationSec: 3,
  summary: '林舟挥手，苏晴点头',
  figures: [
    { name: '林舟', keys: [{ t: 0, x: 0, z: 0, pose: 'stand', motion: WAVE }] },
    { name: '苏晴', keys: [{ t: 0, x: 1, z: 0, pose: 'stand', motion: { generate: '点头回应' } }] },
  ],
  camera: [{ t: 0, shotSize: 'full' }],
};

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
let invoke: ReturnType<typeof vi.fn<Invoke>>;

const systemOf = (payload: unknown) =>
  (payload as { messages: { content: string }[] }).messages[0].content;

function mockIpc() {
  invoke = vi.fn<Invoke>(async (channel, payload) => {
    if (channel === 'ai-providers-list') {
      return {
        ok: true,
        data: [
          {
            id: 'grok',
            kind: 'text',
            label: 'Grok',
            configured: true,
            enabled: true,
            model: 'grok-4',
            models: [],
          },
        ],
      };
    }
    if (channel === 'ai-complete') {
      const system = systemOf(payload);
      if (system.includes(PREVIZ_MOTION_PROMPT_TAG)) {
        return { ok: true, data: { text: JSON.stringify(NOD) } };
      }
      if (system.includes(PREVIZ_PROMPT_TAG)) {
        return { ok: true, data: { text: JSON.stringify(SCRIPT) } };
      }
    }
    throw new Error(`unexpected ${channel}`);
  });
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { ipcRenderer: { invoke } },
  });
}

function renderDialog(
  createStage: CreatePrevizStage,
  extra: { motionProvider?: MotionProvider; onSave?: (output: PrevizSaveOutput) => Promise<void> }
) {
  const encodeVideo = vi.fn<PrevizVideoEncoder>(async (input) => {
    for (let index = 0; index < input.totalFrames; index += 1) input.drawFrame(index);
    return { data: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), ext: 'mp4' };
  });
  render(
    <PrevizDialog
      shotLabel="镜头 1"
      shot={{ shotSize: '全景', durationSec: 3, description: '林舟挥手' }}
      characters={[{ name: '林舟' }, { name: '苏晴' }]}
      aspectRatio="16:9"
      motionProvider={extra.motionProvider}
      onSave={extra.onSave ?? (async () => undefined)}
      onClose={() => undefined}
      createStage={createStage}
      encodeVideo={encodeVideo}
    />
  );
  return { encodeVideo };
}

async function generate() {
  // 请求发出不等于模型与舞台已经就绪；禁用按钮上的点击会被忽略。
  await waitFor(() => {
    expect((screen.getByLabelText('预演模型') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: '生成预演' }) as HTMLButtonElement).disabled).toBe(
      false
    );
  });
  fireEvent.click(screen.getByRole('button', { name: '生成预演' }));
  await waitFor(() => expect(screen.getByText(SCRIPT.summary, { selector: 'p' })).toBeTruthy());
}

describe('3D 预演 · AI 生成的动作', () => {
  beforeEach(() => {
    mockIpc();
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(560);
  });
  afterEach(() => vi.restoreAllMocks());

  it('提示词列出关节；AI 写的挥手轨迹在舞台上播放；generate 追加一次请求生成点头并播放', async () => {
    const { stage, createStage } = fakeStage();
    const saved: PrevizSaveOutput[] = [];
    renderDialog(createStage, {
      onSave: async (output) => {
        saved.push(output);
      },
    });
    await generate();
    const calls = invoke.mock.calls.filter(([channel]) => channel === 'ai-complete');
    // 预演脚本一次 + 「点头回应」追加一次
    expect(calls).toHaveLength(2);
    const previzPrompt = calls[0][1] as { messages: { content: string }[] };
    expect(previzPrompt.messages[0].content).toContain('- rightUpperArm: x ');
    expect(JSON.stringify(previzPrompt)).not.toMatch(/bvh|builtin:|lib:/i);
    expect(systemOf(calls[1][1])).toContain(PREVIZ_MOTION_PROMPT_TAG);
    expect((calls[1][1] as { messages: { content: string }[] }).messages[1].content).toContain(
      '点头回应'
    );
    // 生成后自动播放：舞台不断收到新的采样，挥手 / 点头的关节旋转随时间变化
    await waitFor(
      () => {
        const playing = samples(stage).filter(
          (sample) =>
            sample.t > 0 &&
            sample.figures[0].motion?.joints.rightUpperArm?.weight === 1 &&
            sample.figures[1].motion?.joints.head
        );
        const arms = new Set(
          playing.map((sample) =>
            sample.figures[0].motion?.joints.rightForearm?.q.map((v) => v.toFixed(3)).join(',')
          )
        );
        const heads = new Set(
          playing.map((sample) =>
            sample.figures[1].motion?.joints.head?.q.map((v) => v.toFixed(3)).join(',')
          )
        );
        expect(arms.size).toBeGreaterThan(2);
        expect(heads.size).toBeGreaterThan(2);
      },
      { timeout: 3000 }
    );
    // 保存：脚本带着两段轨迹（生成的轨迹缓存在脚本里）
    fireEvent.click(screen.getByRole('button', { name: '保存预演视频' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    const keys = saved[0].script.figures.map((figure) => figure.keys[0].motion);
    expect(keys[0]?.tracks).toEqual(WAVE.tracks);
    expect(keys[1]).toMatchObject({ generate: '点头回应', tracks: NOD.tracks });
  });

  it('配置了动作生成服务（假服务）：交给服务，不再追加文本请求', async () => {
    const generateMotion = vi.fn<MotionProvider['generateMotion']>(async () => NOD);
    const { stage, createStage } = fakeStage();
    renderDialog(createStage, { motionProvider: { id: 'fake', kind: 'motion', generateMotion } });
    await generate();
    expect(generateMotion).toHaveBeenCalledWith(
      expect.objectContaining({ description: '点头回应', durationSec: 3 }),
      expect.anything()
    );
    expect(invoke.mock.calls.filter(([channel]) => channel === 'ai-complete')).toHaveLength(1);
    await waitFor(() =>
      expect(
        samples(stage).some((sample) => sample.figures[1].motion?.joints.head?.weight === 1)
      ).toBe(true)
    );
  });
});
