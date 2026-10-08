// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PrevizSample } from '@novel-editor/video';
import { PREVIZ_PROMPT_TAG } from '@novel-editor/ai/prompts';
import PrevizDialog, {
  type CreatePrevizStage,
  type PrevizEncodeInput,
  type PrevizLabel,
  type PrevizStageApi,
  type PrevizVideoEncoder,
} from '@/render/components/SceneVideoView/Previz';
import type { PrevizSaveOutput } from '@/render/components/SceneVideoView/Previz';

const PNG = new Uint8Array([137, 80, 78, 71]);
const MP4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
const FRAME = { nodeName: 'CANVAS' } as unknown as CanvasImageSource;

function fakeStage(pickId: string | null = 'f2') {
  let labelListener: ((labels: PrevizLabel[]) => void) | null = null;
  const stage = {
    resize: vi.fn<PrevizStageApi['resize']>(),
    setFrame: vi.fn<PrevizStageApi['setFrame']>(),
    setSample: vi.fn<PrevizStageApi['setSample']>(),
    setHighlight: vi.fn<PrevizStageApi['setHighlight']>(),
    onLabels: vi.fn<PrevizStageApi['onLabels']>((listener) => {
      labelListener = listener;
    }),
    pick: vi.fn<PrevizStageApi['pick']>(() => pickId),
    capture: vi.fn<PrevizStageApi['capture']>(async () => PNG),
    beginExport: vi.fn<PrevizStageApi['beginExport']>(),
    renderExportFrame: vi.fn<PrevizStageApi['renderExportFrame']>(() => FRAME),
    endExport: vi.fn<PrevizStageApi['endExport']>(),
    dispose: vi.fn<() => void>(),
  } satisfies PrevizStageApi;
  const createStage = vi.fn<CreatePrevizStage>(async () => stage);
  const emitLabels = (labels: PrevizLabel[]) => act(() => labelListener?.(labels));
  return { stage, createStage, emitLabels };
}

type Stage = ReturnType<typeof fakeStage>['stage'];

const lastSample = (stage: Stage): PrevizSample => {
  const calls = stage.setSample.mock.calls;
  return calls[calls.length - 1][0];
};
const figure = (stage: Stage, id: string) => lastSample(stage).figures.find((f) => f.id === id);

const SHOT = {
  shotSize: '近景',
  durationSec: 4,
  description: '林舟回头望向铁匠铺',
  camera: '缓慢推近',
};

/** AI 返回的预演脚本：林舟从左走到中间，苏晴不动 */
const AI_SCRIPT = {
  durationSec: 3,
  mood: 'dusk',
  summary: '林舟走向苏晴',
  figures: [
    {
      name: '林舟',
      keys: [
        { t: 0, x: -2, z: 0, facing: 90, pose: 'walk' },
        { t: 3, x: -0.6, z: 0, facing: 90, pose: 'talk' },
      ],
    },
    { name: '苏晴', keys: [{ t: 0, x: 0.6, z: 0, facing: -90, pose: 'stand' }] },
  ],
  camera: [{ t: 0, shotSize: 'full', lens: 35 }],
};

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
let invoke: ReturnType<typeof vi.fn<Invoke>>;

function mockIpc(options: { providers?: boolean; reply?: string } = {}) {
  invoke = vi.fn<Invoke>(async (channel) => {
    if (channel === 'ai-providers-list') {
      return {
        ok: true,
        data:
          options.providers === false
            ? []
            : [
                {
                  id: 'grok',
                  kind: 'text',
                  label: 'xAI Grok · grok-4',
                  configured: true,
                  enabled: true,
                  model: 'grok-4',
                  models: ['grok-4', 'grok-3-mini'],
                },
                {
                  id: 'minimax-video',
                  kind: 'video',
                  label: 'MiniMax',
                  configured: true,
                  enabled: true,
                  model: 'm',
                  models: [],
                },
              ],
      };
    }
    if (channel === 'ai-complete') {
      return { ok: true, data: { text: options.reply ?? JSON.stringify(AI_SCRIPT) } };
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
  extra: {
    encodeVideo?: PrevizVideoEncoder;
    aspectRatio?: string;
    onSave?: (o: PrevizSaveOutput) => Promise<void>;
  } = {}
) {
  const onSave = vi.fn(extra.onSave ?? (async (_output: PrevizSaveOutput) => undefined));
  const onClose = vi.fn();
  const utils = render(
    <PrevizDialog
      shotLabel="镜头 2"
      shot={SHOT}
      characters={[{ name: '林舟', appearance: '黑发少年' }, { name: '苏晴' }]}
      aspectRatio={extra.aspectRatio ?? '16:9'}
      onSave={onSave}
      onClose={onClose}
      createStage={createStage}
      encodeVideo={extra.encodeVideo}
    />
  );
  return { ...utils, onSave, onClose };
}

async function ready(stage: Stage) {
  await waitFor(() => expect(stage.setSample).toHaveBeenCalled());
}

const viewport = () => screen.getByTestId('previz-viewport');

describe('PrevizDialog', () => {
  beforeEach(() => {
    mockIpc();
    // happy-dom 没有布局：给视口一个尺寸，拖动换算才有意义
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(560);
  });
  afterEach(() => vi.restoreAllMocks());

  it('打开时：动作描述预填画面描述 + 人物 + 运镜；舞台就绪后显示默认脚本（站成一排）', async () => {
    const { stage, createStage } = fakeStage();
    renderDialog(createStage);
    expect(screen.getByRole('dialog', { name: '3D 预演 · 镜头 2' })).toBeTruthy();
    expect(screen.getByTestId('previz-dialog').getAttribute('data-stage')).toBe('loading');
    const save = screen.getByRole('button', { name: '保存预演视频' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const action = screen.getByLabelText('镜头动作与走位') as HTMLTextAreaElement;
    expect(action.value).toBe('林舟回头望向铁匠铺\n出场人物：林舟、苏晴\n运镜：缓慢推近');

    await ready(stage);
    expect(screen.getByTestId('previz-dialog').getAttribute('data-stage')).toBe('ready');
    expect(createStage).toHaveBeenCalledWith(screen.getByTestId('previz-canvas'));
    expect(stage.setFrame).toHaveBeenCalledWith(16 / 9);
    const sample = lastSample(stage);
    expect(sample.t).toBe(0);
    expect(sample.figures.map((item) => [item.name, item.x, item.poseFrom])).toEqual([
      ['林舟', -0.45, 'stand'],
      ['苏晴', 0.45, 'stand'],
    ]);
    expect(save.disabled).toBe(false);
    // 不再有姿势 / 景别 / 滑块等手动面板
    expect(screen.queryByRole('radiogroup', { name: '姿势' })).toBeNull();
    expect(screen.queryByRole('slider', { name: '机位方向' })).toBeNull();
    // 模型下拉只列出已配置的文本模型（显示名称）
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: '预演模型' }).textContent).toContain(
        'xAI Grok · grok-4'
      )
    );
  });

  it('生成预演：用选中的模型请求 ai-complete（预演提示词），校验后的脚本应用到舞台并开始播放', async () => {
    const { stage, createStage } = fakeStage();
    renderDialog(createStage);
    await ready(stage);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('ai-providers-list'));
    const action = screen.getByLabelText('镜头动作与走位');
    fireEvent.change(action, { target: { value: '林舟走到苏晴面前和她说话' } });
    fireEvent.click(screen.getByRole('button', { name: '生成预演' }));
    await waitFor(() => expect(screen.getByText('林舟走向苏晴')).toBeTruthy());
    const call = invoke.mock.calls.find(([channel]) => channel === 'ai-complete');
    const payload = call?.[1] as {
      providerId: string;
      model: string;
      messages: { role: string; content: string }[];
    };
    expect(payload.providerId).toBe('grok');
    expect(payload.model).toBe('grok-4');
    expect(payload.messages[0].content.startsWith(`[${PREVIZ_PROMPT_TAG}]`)).toBe(true);
    expect(payload.messages[1].content).toContain('林舟走到苏晴面前和她说话');
    expect(payload.messages[1].content).toContain('- 林舟：黑发少年');

    await waitFor(() => expect(lastSample(stage).mood).toBe('dusk'));
    expect(screen.getByTestId('previz-time').textContent).toContain('3.0s');
    expect(screen.getByRole('button', { name: '暂停预演' })).toBeTruthy();
    expect(figure(stage, 'f2')).toMatchObject({ name: '苏晴', x: 0.6, facing: -90 });
  });

  it('没有配置 AI：模型下拉禁用，生成默认走位并给出说明；AI 返回无法识别时同样回退', async () => {
    mockIpc({ providers: false });
    const { stage, createStage } = fakeStage();
    renderDialog(createStage);
    await ready(stage);
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: '预演模型' }).textContent).toContain(
        '没有可用的 AI'
      )
    );
    fireEvent.click(screen.getByRole('button', { name: '生成预演' }));
    expect(await screen.findByText(/没有配置 AI，使用默认走位/)).toBeTruthy();
    expect(invoke.mock.calls.some(([channel]) => channel === 'ai-complete')).toBe(false);
  });

  it('AI 返回不是预演脚本：回退默认走位并说明原因', async () => {
    mockIpc({ reply: '抱歉' });
    const { stage, createStage } = fakeStage();
    renderDialog(createStage);
    await ready(stage);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('ai-providers-list'));
    fireEvent.click(screen.getByRole('button', { name: '生成预演' }));
    expect(await screen.findByText(/AI 返回的预演无法识别/)).toBeTruthy();
    expect(lastSample(stage).figures).toHaveLength(2);
  });

  it('播放 / 暂停 / 拖动进度条：舞台显示对应时刻；空格切换播放', async () => {
    const { stage, createStage } = fakeStage();
    renderDialog(createStage);
    await ready(stage);
    fireEvent.change(screen.getByRole('slider', { name: '预演进度' }), {
      target: { value: '2.5' },
    });
    expect(lastSample(stage).t).toBe(2.5);
    expect(screen.getByTestId('previz-time').textContent).toBe('2.5s / 4.0s');
    fireEvent.click(screen.getByRole('button', { name: '播放预演' }));
    expect(screen.getByRole('button', { name: '暂停预演' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: ' ' });
    expect(screen.getByRole('button', { name: '播放预演' })).toBeTruthy();
    const loop = screen.getByRole('button', { name: '循环播放' });
    expect(loop.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(loop);
    expect(loop.getAttribute('aria-pressed')).toBe('false');
  });

  it('保存预演视频：先截第一帧，再逐帧（长边 1280、24fps）交给编码器，结果连同脚本交给 onSave', async () => {
    const { stage, createStage } = fakeStage();
    const encodeVideo = vi.fn<PrevizVideoEncoder>(async (input: PrevizEncodeInput) => {
      for (let index = 0; index < input.totalFrames; index += 1) {
        expect(input.drawFrame(index)).toBe(FRAME);
        input.onProgress?.(index + 1, input.totalFrames);
      }
      return { data: MP4, ext: 'mp4' };
    });
    const { onSave, onClose } = renderDialog(createStage, { encodeVideo });
    await ready(stage);
    fireEvent.click(screen.getByRole('button', { name: '保存预演视频' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(stage.capture).toHaveBeenCalledWith({ width: 1280, height: 720 });
    expect(stage.beginExport).toHaveBeenCalledWith({ width: 1280, height: 720 });
    const input = encodeVideo.mock.calls[0][0];
    expect(input).toMatchObject({ width: 1280, height: 720, fps: 24, totalFrames: 96 });
    const times = stage.renderExportFrame.mock.calls.map(([sample]) => sample.t);
    expect(times).toHaveLength(96);
    expect(times[0]).toBe(0);
    expect(times[24]).toBeCloseTo(1, 6);
    expect(stage.endExport).toHaveBeenCalledTimes(1);
    const output = onSave.mock.calls[0][0];
    expect(output).toMatchObject({ video: MP4, ext: 'mp4', firstFrame: PNG });
    expect(output.script.figures.map((item) => item.name)).toEqual(['林舟', '苏晴']);
  });

  it('保存失败（编码器不支持 / 写入失败）：显示错误、不关闭、恢复舞台', async () => {
    const { stage, createStage } = fakeStage();
    const encodeVideo = vi.fn<PrevizVideoEncoder>(async () => {
      throw new Error('当前环境不支持 WebCodecs（VideoEncoder），无法导出视频');
    });
    const { onClose } = renderDialog(createStage, { encodeVideo, aspectRatio: '9:16' });
    await ready(stage);
    fireEvent.click(screen.getByRole('button', { name: '保存预演视频' }));
    expect((await screen.findByRole('alert')).textContent).toContain('WebCodecs');
    expect(stage.capture).toHaveBeenCalledWith({ width: 720, height: 1280 });
    expect(stage.endExport).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(
      (screen.getByRole('button', { name: '保存预演视频' }) as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it('回归：点人物 / 小幅拖动不会让人物飞走；拖动按深度换算、整段走位一起平移', async () => {
    const { stage, createStage } = fakeStage('f2');
    renderDialog(createStage);
    await ready(stage);
    const frame = viewport();
    const before = figure(stage, 'f2');
    // 单击（带 2 像素抖动）：站位不变
    fireEvent.pointerDown(frame, { clientX: 500, clientY: 300, pointerId: 1 });
    expect(stage.setHighlight).toHaveBeenLastCalledWith('f2');
    fireEvent.pointerMove(frame, { clientX: 502, clientY: 301, pointerId: 1 });
    fireEvent.pointerUp(frame, { pointerId: 1 });
    expect(stage.setHighlight).toHaveBeenLastCalledWith(null);
    expect(figure(stage, 'f2')).toMatchObject({ x: before?.x, z: before?.z });

    // 向右拖 60 像素：向右移动不到 1 米，不会被甩到舞台边缘
    fireEvent.pointerDown(frame, { clientX: 500, clientY: 300, pointerId: 1 });
    for (let dx = 1; dx <= 60; dx += 1) {
      fireEvent.pointerMove(frame, { clientX: 500 + dx, clientY: 300 + (dx % 2), pointerId: 1 });
    }
    fireEvent.pointerUp(frame, { pointerId: 1 });
    const after = figure(stage, 'f2');
    expect(after!.x - before!.x).toBeGreaterThan(0.05);
    expect(after!.x - before!.x).toBeLessThan(1);
    expect(Math.abs(after!.z - before!.z)).toBeLessThan(0.05);
    // 另一个人物不受影响
    expect(figure(stage, 'f1')?.x).toBe(-0.45);
  });

  it('拖动空白处环绕机位；「微调」里可重置机位、换时段', async () => {
    const { stage, createStage } = fakeStage(null);
    renderDialog(createStage);
    await ready(stage);
    const frame = viewport();
    fireEvent.pointerDown(frame, { clientX: 400, clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(frame, { clientX: 300, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(frame, { pointerId: 1 });
    expect(lastSample(stage).camera.yaw).toBe(30);
    fireEvent.click(screen.getByRole('button', { name: '微调' }));
    fireEvent.click(screen.getByRole('button', { name: '重置机位' }));
    expect(lastSample(stage).camera.yaw).toBe(0);
    fireEvent.click(screen.getByRole('radio', { name: '夜晚' }));
    expect(lastSample(stage).mood).toBe('night');
  });

  it('关闭按钮 / Esc 调用 onClose；卸载时释放舞台', async () => {
    const { stage, createStage } = fakeStage();
    const { onClose, unmount } = renderDialog(createStage);
    await ready(stage);
    fireEvent.click(screen.getByRole('button', { name: '关闭预演' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    unmount();
    expect(stage.dispose).toHaveBeenCalledTimes(1);
  });

  it('舞台创建失败（无 WebGL）时显示提示、data-stage=error，保存按钮保持禁用', async () => {
    const createStage = vi.fn<CreatePrevizStage>(async () => {
      throw new Error('no webgl');
    });
    renderDialog(createStage);
    expect(await screen.findByText('当前环境不支持 3D 预演（需要 WebGL）')).toBeTruthy();
    expect(screen.getByTestId('previz-dialog').getAttribute('data-stage')).toBe('error');
    expect(
      (screen.getByRole('button', { name: '保存预演视频' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('舞台就绪前已卸载：创建好的舞台立即释放', async () => {
    const { stage } = fakeStage();
    let resolve: (value: PrevizStageApi) => void = () => undefined;
    const createStage = vi.fn<CreatePrevizStage>(
      () => new Promise<PrevizStageApi>((done) => (resolve = done))
    );
    const { unmount } = renderDialog(createStage);
    unmount();
    resolve(stage);
    await waitFor(() => expect(stage.dispose).toHaveBeenCalledTimes(1));
    expect(stage.setSample).not.toHaveBeenCalled();
  });

  it('StrictMode 下卸载后重建：每次都用新的 canvas，旧舞台被释放、旧 canvas 被移除', async () => {
    const canvases: HTMLCanvasElement[] = [];
    const stages: Stage[] = [];
    const createStage = vi.fn<CreatePrevizStage>(async (canvas) => {
      canvases.push(canvas);
      const { stage } = fakeStage();
      stages.push(stage);
      return stage;
    });
    render(
      <React.StrictMode>
        <PrevizDialog
          shotLabel="镜头 2"
          shot={SHOT}
          characters={[{ name: '林舟' }]}
          aspectRatio="16:9"
          onSave={async () => undefined}
          onClose={() => undefined}
          createStage={createStage}
        />
      </React.StrictMode>
    );
    await waitFor(() => expect(createStage).toHaveBeenCalledTimes(2));
    expect(canvases[0]).not.toBe(canvases[1]);
    await waitFor(() => expect(stages[0].dispose).toHaveBeenCalled());
    expect(canvases[0].isConnected).toBe(false);
    expect(canvases[1].isConnected).toBe(true);
    expect(screen.getAllByTestId('previz-canvas')).toHaveLength(1);
  });
});
