// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { builtinMotionBvh, type PrevizSample } from '@novel-editor/video';
import type { MotionProvider } from '@novel-editor/ai/motion';
import PrevizDialog, {
  type CreatePrevizStage,
  type PrevizStageApi,
} from '@/render/components/SceneVideoView/Previz';

const WORK = '/tmp/work';
const WAVE_BVH = builtinMotionBvh('builtin:wave') ?? '';
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

const lastSample = (stage: ReturnType<typeof fakeStage>['stage']): PrevizSample => {
  const calls = stage.setSample.mock.calls;
  return calls[calls.length - 1][0];
};

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
let invoke: ReturnType<typeof vi.fn<Invoke>>;
let files: { fileName: string; data: string }[];

function mockIpc(reply: unknown) {
  files = [
    { fileName: 'wave-test.bvh', data: WAVE_BVH },
    { fileName: 'broken.bvh', data: 'not a bvh' },
  ];
  invoke = vi.fn<Invoke>(async (channel, payload) => {
    const request = payload as { workPath?: string; fileName?: string; data?: string };
    switch (channel) {
      case 'ai-providers-list':
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
      case 'motion-library-list':
        expect(request.workPath).toBe(WORK);
        return {
          ok: true,
          data: {
            files: files.map((file) => ({
              fileName: file.fileName,
              clipId: `lib:${file.fileName.replace(/\.bvh$/, '')}`,
              size: file.data.length,
              mtimeMs: 0,
            })),
          },
        };
      case 'motion-library-read':
        return {
          ok: true,
          data: files.find((file) => file.fileName === request.fileName)?.data ?? '',
        };
      case 'motion-library-import': {
        files.push({ fileName: request.fileName ?? '', data: request.data ?? '' });
        const clipId = `lib:${(request.fileName ?? '').replace(/\.bvh$/, '')}`;
        return { ok: true, data: { fileName: request.fileName, clipId } };
      }
      case 'ai-complete':
        return { ok: true, data: { text: JSON.stringify(reply) } };
      default:
        throw new Error(`unexpected ${channel}`);
    }
  });
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { ipcRenderer: { invoke } },
  });
}

const SCRIPT = {
  durationSec: 3,
  summary: '林舟挥手',
  figures: [
    {
      name: '林舟',
      keys: [{ t: 0, x: 0, z: 0, pose: 'stand', motion: { clip: 'lib:wave-test', loop: true } }],
    },
    {
      name: '苏晴',
      keys: [{ t: 0, x: 1, z: 0, pose: 'stand', motion: { generate: '紧张地搓手' } }],
    },
  ],
  camera: [{ t: 0, shotSize: 'full' }],
};

function renderDialog(createStage: CreatePrevizStage, motionProvider?: MotionProvider) {
  return render(
    <PrevizDialog
      shotLabel="镜头 1"
      shot={{ shotSize: '全景', durationSec: 3, description: '林舟挥手' }}
      characters={[{ name: '林舟' }, { name: '苏晴' }]}
      aspectRatio="16:9"
      workPath={WORK}
      motionProvider={motionProvider}
      onSave={async () => undefined}
      onClose={() => undefined}
      createStage={createStage}
    />
  );
}

describe('3D 预演 · 动作库', () => {
  beforeEach(() => {
    mockIpc(SCRIPT);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(560);
  });
  afterEach(() => vi.restoreAllMocks());

  it('「微调」列出内置动作与作品动作库；无法解析的文件标出来', async () => {
    const { stage, createStage } = fakeStage();
    renderDialog(createStage);
    await waitFor(() => expect(stage.setSample).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '微调' }));
    const list = await screen.findByRole('list', { name: '可用动作' });
    await waitFor(() =>
      expect(list.querySelector('[data-clip-id="lib:wave-test"]')?.textContent).toBe('wave-test')
    );
    expect(list.querySelector('[data-clip-id="builtin:wave"]')?.textContent).toBe('挥手');
    expect(list.querySelector('[data-clip-id="lib:broken"]')?.getAttribute('title')).toContain(
      'BVH'
    );
  });

  it('AI 引用动作库片段：提示词列出片段 id，舞台采样带上片段的关节旋转', async () => {
    const { stage, createStage } = fakeStage();
    renderDialog(createStage);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('ai-providers-list'));
    fireEvent.click(screen.getByRole('button', { name: '生成预演' }));
    await waitFor(() => expect(screen.getByText('林舟挥手', { selector: 'p' })).toBeTruthy());
    const call = invoke.mock.calls.find(([channel]) => channel === 'ai-complete');
    const prompt = (call?.[1] as { messages: { content: string }[] }).messages[1].content;
    expect(prompt).toContain('- lib:wave-test');
    expect(prompt).toContain('- builtin:idle');
    expect(prompt).not.toContain('lib:broken');
    await waitFor(() => {
      const lin = lastSample(stage).figures[0];
      expect(lin.motion?.joints.rightUpperArm?.weight).toBe(1);
    });
    // 没有动作生成服务：苏晴的 generate 暂用姿势，并给出提示
    expect(screen.getByText(/没有配置动作生成服务/)).toBeTruthy();
  });

  it('配置了动作生成服务（假服务）：生成的 BVH 存进动作库，脚本改为引用它', async () => {
    const generateMotion = vi.fn<MotionProvider['generateMotion']>(async () => ({
      format: 'bvh',
      data: builtinMotionBvh('builtin:nod') ?? '',
    }));
    const { stage, createStage } = fakeStage();
    renderDialog(createStage, { id: 'fake', kind: 'motion', generateMotion });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('ai-providers-list'));
    fireEvent.click(screen.getByRole('button', { name: '生成预演' }));
    await waitFor(() => expect(generateMotion).toHaveBeenCalled());
    const imported = await waitFor(() => {
      const call = invoke.mock.calls.find(([channel]) => channel === 'motion-library-import');
      if (!call) throw new Error('还没有保存');
      return call[1] as { fileName: string };
    });
    expect(imported.fileName).toMatch(/^generated-[0-9a-f]{8}\.bvh$/);
    await waitFor(() => expect(lastSample(stage).figures[1].motion).toBeTruthy());
  });

  it('导入 .bvh：读成文本交给 motion-library-import，列表刷新', async () => {
    const { stage, createStage } = fakeStage();
    renderDialog(createStage);
    await waitFor(() => expect(stage.setSample).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '微调' }));
    const input = screen.getByLabelText('导入 BVH 动作文件') as HTMLInputElement;
    const file = new File([WAVE_BVH], 'hello.bvh', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('motion-library-import', {
        workPath: WORK,
        fileName: 'hello.bvh',
        data: WAVE_BVH,
      })
    );
    const list = screen.getByRole('list', { name: '可用动作' });
    await waitFor(() => expect(list.querySelector('[data-clip-id="lib:hello"]')).toBeTruthy());
  });
});
