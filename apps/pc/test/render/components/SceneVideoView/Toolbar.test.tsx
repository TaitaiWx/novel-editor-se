// @vitest-environment happy-dom
import React from 'react';
import { modelInfo } from '../../helpers/aiModel';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { chooseOption, getCombobox, selectOptionTexts } from '../../helpers/select';
import Toolbar, {
  normalizeCustomDuration,
  normalizeCustomStyle,
} from '@/render/components/SceneVideoView/Toolbar';
import {
  createSceneVideoState,
  type SceneVideoState,
} from '@/render/components/SceneVideoView/sceneVideoState';
import type { AIProviderInfo } from '@/shared/ai';

const state = createSceneVideoState(
  {
    chapterPath: '/p/novels/星河旅人/001-启程.md',
    chapter: '001-启程',
    scene: '第一场',
    sourceText: '正文',
    characters: [],
    location: '',
  },
  new Date('2026-10-08T00:00:00.000Z')
);

function videoProvider(id: string, supportsAudio: boolean): AIProviderInfo {
  return modelInfo({
    id,
    kind: 'video',
    label: id,
    description: '',
    defaultBaseUrl: '',
    defaultModel: 'm',
    models: ['m'],
    configured: true,
    secureStorage: true,
    enabled: true,
    baseUrl: '',
    model: 'm',
    ...(supportsAudio ? { supportsAudio: true } : {}),
  });
}

function renderToolbar(providers: AIProviderInfo[], current: SceneVideoState = state) {
  const onChange = vi.fn<(updater: (prev: SceneVideoState) => SceneVideoState) => void>();
  render(
    <Toolbar
      state={{ ...current, providerId: providers[0]?.id ?? null }}
      onChange={onChange}
      videoProviders={providers}
      servicesLoaded
      saveText=""
      saveTone="idle"
      estimateText=""
      pendingCount={1}
      submitting={false}
      canAddShot
      onGenerate={() => undefined}
      onAddShot={() => undefined}
      onReveal={() => undefined}
      onOpenSettings={() => undefined}
    />
  );
  return { onChange };
}

describe('场景视频工具栏 · 生成声音', () => {
  it('支持生成声音的服务（Seedance）：默认开启，点击切换', () => {
    const { onChange } = renderToolbar([videoProvider('seedance-video', true)]);
    const toggle = screen.getByRole('switch', { name: '生成声音' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect((toggle as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(toggle);
    const updater = onChange.mock.calls[0][0];
    expect(updater(state).withAudio).toBe(false);
  });

  it('不支持的服务（MiniMax）：开关不可用并显示为关闭', () => {
    const { onChange } = renderToolbar([videoProvider('minimax-video', false)]);
    const toggle = screen.getByRole('switch', { name: '生成声音' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(toggle);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('关闭后显示为未开启', () => {
    renderToolbar([videoProvider('seedance-video', true)], { ...state, withAudio: false });
    expect(screen.getByRole('switch', { name: '生成声音' }).getAttribute('aria-checked')).toBe(
      'false'
    );
  });
});

describe('场景视频工具栏 · 视频模型', () => {
  it('一个下拉列出视频模型（显示名称）；没有单独的「视频服务」+「模型」两级选择；选择后记录模型 id', () => {
    const fast = {
      ...videoProvider('video-2', true),
      label: 'Seedance · 2.0 fast',
      vendor: 'seedance-video',
    };
    const { onChange } = renderToolbar([
      { ...videoProvider('video-1', false), label: 'MiniMax 海螺 · Hailuo-02' },
      fast,
    ]);
    expect(screen.queryByRole('combobox', { name: '视频服务' })).toBeNull();
    expect(selectOptionTexts('视频模型')).toEqual([
      'MiniMax 海螺 · Hailuo-02',
      'Seedance · 2.0 fast',
    ]);
    expect(getCombobox('视频模型').textContent).toBe('MiniMax 海螺 · Hailuo-02');
    // MiniMax 不支持生成声音
    expect((screen.getByRole('switch', { name: '生成声音' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    chooseOption('视频模型', 'Seedance · 2.0 fast');
    const next = onChange.mock.calls[0][0]({ ...state, model: 'old-model' });
    expect(next.providerId).toBe('video-2');
    expect(next.model).toBeUndefined();
  });
});

describe('场景视频工具栏 · 自定义风格与时长', () => {
  it('normalizeCustomStyle：去空白、限 80 字、空内容不采用', () => {
    expect(normalizeCustomStyle('  胶片颗粒，  逆光  ')).toBe('胶片颗粒， 逆光');
    expect(normalizeCustomStyle('   ')).toBeNull();
    expect(Array.from(normalizeCustomStyle('字'.repeat(100)) ?? '')).toHaveLength(80);
  });

  it('normalizeCustomDuration：1–60 的整数秒', () => {
    expect(normalizeCustomDuration('12')).toBe('12');
    expect(normalizeCustomDuration('7.6')).toBe('8');
    expect(normalizeCustomDuration('0')).toBeNull();
    expect(normalizeCustomDuration('61')).toBeNull();
    expect(normalizeCustomDuration('abc')).toBeNull();
  });

  it('风格与时长都可以在列表底部手动填写', () => {
    const { onChange } = renderToolbar([videoProvider('seedance-video', true)]);
    fireEvent.click(screen.getByRole('combobox', { name: '风格' }));
    const style = screen.getByLabelText('风格（自定义）');
    fireEvent.change(style, { target: { value: '胶片颗粒、逆光、浅景深' } });
    fireEvent.keyDown(style, { key: 'Enter' });
    expect(onChange.mock.calls.at(-1)?.[0](state).style).toBe('胶片颗粒、逆光、浅景深');
    fireEvent.click(screen.getByRole('combobox', { name: '每镜时长' }));
    const duration = screen.getByLabelText('每镜时长（自定义）');
    fireEvent.change(duration, { target: { value: '12' } });
    fireEvent.keyDown(duration, { key: 'Enter' });
    expect(onChange.mock.calls.at(-1)?.[0](state).shotDurationSec).toBe(12);
  });
});
