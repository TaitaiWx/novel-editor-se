// @vitest-environment happy-dom
import React, { useState } from 'react';
import { modelInfo } from '../../helpers/aiModel';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createSceneAudio, type SceneAudio, type Shot } from '@novel-editor/video';
import {
  SceneAudioSection,
  ShotAudioSection,
} from '@/render/components/SceneVideoView/AudioSection';
import type { AIProviderInfo } from '@/shared/ai';

const WAV = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20,
]);

function pick(name: string, option: string | RegExp) {
  fireEvent.click(screen.getByRole('combobox', { name }));
  const list = screen.getByRole('listbox');
  fireEvent.click(within(list).getByRole('option', { name: option }));
}

function ShotHarness(props: {
  initial: Shot;
  onSynthesize?: (ids?: string[]) => void;
  onShot?: (shot: Shot) => void;
  readSceneFile?: (name: string) => Promise<Uint8Array>;
}) {
  const [shot, setShot] = useState(props.initial);
  return (
    <ShotAudioSection
      shot={shot}
      label="镜头 1"
      speakers={['林舟', '小石头']}
      onUpdateShot={(patch) =>
        setShot((prev) => {
          const next = { ...prev, ...patch };
          props.onShot?.(next);
          return next;
        })
      }
      onSynthesize={props.onSynthesize ?? (() => undefined)}
      busyLineIds={new Set()}
      canSynthesize
      readSceneFile={props.readSceneFile ?? (async () => WAV)}
      loadWorkAudio={async () => WAV}
      onImportSfx={async () => '资料/音效/门.wav'}
    />
  );
}

const baseShot: Shot = { id: 'shot-1', shotSize: '近景', durationSec: 6, description: '林舟回头' };

describe('镜头检查器 · 对白', () => {
  it('添加、编辑（说话人 / 台词 / 情绪）、删除对白', () => {
    const onShot = vi.fn<(shot: Shot) => void>();
    render(<ShotHarness initial={baseShot} onShot={onShot} />);
    expect(screen.getByText('这个镜头没有对白。', { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /添加对白/ }));
    expect(screen.getAllByTestId('dialogue-line')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('镜头 1 第 1 句 台词'), {
      target: { value: '舟哥！' },
    });
    pick('镜头 1 第 1 句 说话人', '小石头');
    pick('镜头 1 第 1 句 情绪', '开心');
    expect(onShot.mock.calls.at(-1)?.[0].dialogue).toEqual([
      { id: 'l1', speaker: '小石头', text: '舟哥！', emotion: 'happy' },
    ]);
    // 旁白也是说话人选项
    pick('镜头 1 第 1 句 说话人', '旁白');
    expect(onShot.mock.calls.at(-1)?.[0].dialogue?.[0].speaker).toBe('narrator');
    fireEvent.click(screen.getByRole('button', { name: '删除镜头 1 第 1 句' }));
    expect(screen.queryAllByTestId('dialogue-line')).toHaveLength(0);
    expect(onShot.mock.calls.at(-1)?.[0].dialogue).toBeUndefined();
  });

  it('生成配音：单句与「全部生成配音」只传还没有配音的句子；已配音的可以试听', async () => {
    const onSynthesize = vi.fn<(ids?: string[]) => void>();
    const readSceneFile = vi.fn(async () => WAV);
    render(
      <ShotHarness
        initial={{
          ...baseShot,
          dialogue: [
            { id: 'l1', speaker: '林舟', text: '走吧', audioFile: '镜头1-台词-l1.wav' },
            { id: 'l2', speaker: '小石头', text: '等等我' },
          ],
        }}
        onSynthesize={onSynthesize}
        readSceneFile={readSceneFile}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '为镜头 1 第 2 句生成配音' }));
    expect(onSynthesize).toHaveBeenLastCalledWith(['l2']);
    fireEvent.click(screen.getByRole('button', { name: '全部生成配音（1）' }));
    expect(onSynthesize).toHaveBeenLastCalledWith(['l2']);
    expect(screen.getByRole('button', { name: '为镜头 1 第 1 句生成配音' }).textContent).toBe(
      '重新配音'
    );
    await waitFor(() => expect(screen.getByLabelText('试听镜头 1 第 1 句')).toBeTruthy());
    expect(readSceneFile).toHaveBeenCalledWith('镜头1-台词-l1.wav');
  });

  it('改了台词后旧配音作废', () => {
    const onShot = vi.fn<(shot: Shot) => void>();
    render(
      <ShotHarness
        initial={{
          ...baseShot,
          dialogue: [
            {
              id: 'l1',
              speaker: '林舟',
              text: '走吧',
              audioFile: '镜头1-台词-l1.wav',
              audioDurationSec: 1,
            },
          ],
        }}
        onShot={onShot}
      />
    );
    fireEvent.change(screen.getByLabelText('镜头 1 第 1 句 台词'), { target: { value: '走' } });
    expect(onShot.mock.calls.at(-1)?.[0].dialogue).toEqual([
      { id: 'l1', speaker: '林舟', text: '走' },
    ]);
  });

  it('音效：添加、填写描述、选择文件、删除', async () => {
    const onShot = vi.fn<(shot: Shot) => void>();
    render(<ShotHarness initial={baseShot} onShot={onShot} />);
    fireEvent.click(screen.getByRole('button', { name: /添加音效/ }));
    fireEvent.change(screen.getByLabelText('镜头 1 音效 1 描述'), { target: { value: '风声' } });
    fireEvent.click(
      within(screen.getByTestId('sfx-cue')).getByRole('button', { name: '选择文件' })
    );
    await waitFor(() =>
      expect(onShot.mock.calls.at(-1)?.[0].sfx).toEqual([
        { id: 's1', atSec: 0, volume: 0.8, prompt: '风声', path: '资料/音效/门.wav' },
      ])
    );
    fireEvent.click(screen.getByRole('button', { name: '删除镜头 1 音效 1' }));
    expect(onShot.mock.calls.at(-1)?.[0].sfx).toBeUndefined();
  });
});

function speechProvider(id: string, label: string): AIProviderInfo {
  return modelInfo({
    id,
    kind: 'speech',
    label,
    description: '',
    defaultBaseUrl: '',
    defaultModel: 'm',
    models: ['m'],
    configured: true,
    secureStorage: true,
    enabled: true,
    baseUrl: '',
    model: 'm',
  });
}

function SceneHarness(props: {
  onAudio: (audio: SceneAudio) => void;
  onImport: (kind: 'bgm' | 'ambience') => Promise<string | null>;
  providers?: AIProviderInfo[];
}) {
  const [audio, setAudio] = useState<SceneAudio>(createSceneAudio('zh-CN'));
  return (
    <SceneAudioSection
      audio={audio}
      onChange={(updater) =>
        setAudio((prev) => {
          const next = updater(prev);
          props.onAudio(next);
          return next;
        })
      }
      speechProviders={props.providers ?? []}
      videoSupportsAudio={false}
      onImport={props.onImport}
      loadWorkAudio={async () => WAV}
    />
  );
}

describe('场景检查器 · 声音', () => {
  it('语言、背景音乐（选择本地文件 → 试听 → 音量）、压低开关', async () => {
    const onAudio = vi.fn<(audio: SceneAudio) => void>();
    const onImport = vi.fn(async () => '资料/音乐/雨夜.wav');
    render(<SceneHarness onAudio={onAudio} onImport={onImport} />);
    expect(screen.getByText(/还没有配音模型/)).toBeTruthy();
    pick('配音语言', /英语（美国）/);
    expect(onAudio.mock.calls.at(-1)?.[0].language).toBe('en-US');

    pick('背景音乐', '本地音乐文件');
    expect(onImport).toHaveBeenCalledWith('bgm');
    await waitFor(() =>
      expect(screen.getByTestId('scene-audio-bgm-file').textContent).toBe('雨夜.wav')
    );
    expect(onAudio.mock.calls.at(-1)?.[0].bgm).toEqual({
      source: 'file',
      path: '资料/音乐/雨夜.wav',
      volume: 0.5,
      fadeInSec: 1,
      fadeOutSec: 2,
    });
    await waitFor(() => expect(screen.getByLabelText('试听背景音乐')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('背景音乐音量'), { target: { value: '30' } });
    fireEvent.blur(screen.getByLabelText('背景音乐音量'));
    await waitFor(() => expect(onAudio.mock.calls.at(-1)?.[0].bgm?.volume).toBe(0.3));

    const ducking = screen.getByRole('switch', { name: /对白时自动压低配乐/ });
    expect((ducking as HTMLInputElement).checked).toBe(true);
    fireEvent.click(ducking);
    expect(onAudio.mock.calls.at(-1)?.[0].ducking).toBe(false);

    pick('背景音乐', '无配乐');
    expect(onAudio.mock.calls.at(-1)?.[0].bgm?.source).toBe('none');
  });

  it('取消选择文件时不改配乐；多个配音模型时可以选择', async () => {
    const onAudio = vi.fn<(audio: SceneAudio) => void>();
    render(
      <SceneHarness
        onAudio={onAudio}
        onImport={async () => null}
        providers={[
          speechProvider('openai-speech', 'OpenAI 兼容配音'),
          speechProvider('minimax-speech', 'MiniMax 语音合成'),
        ]}
      />
    );
    pick('背景音乐', '本地音乐文件');
    await waitFor(() => expect(onAudio).not.toHaveBeenCalled());
    pick('配音模型', 'MiniMax 语音合成');
    expect(onAudio.mock.calls.at(-1)?.[0].speechProviderId).toBe('minimax-speech');
  });
});
