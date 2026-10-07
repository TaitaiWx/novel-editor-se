// @vitest-environment happy-dom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Toolbar from '@/render/components/SceneVideoView/Toolbar';
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
  return {
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
  };
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
