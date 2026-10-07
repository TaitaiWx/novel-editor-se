// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import VideoPlayer, { formatTime } from '@/render/components/VideoPlayer';
import { clampTime, frameWidth, ratioFromPointer } from '@/render/components/VideoPlayer/format';

/** 模拟浏览器读到元数据：设置尺寸与时长并派发 loadedmetadata */
function loadMetadata(video: HTMLVideoElement, width: number, height: number, duration: number) {
  Object.defineProperty(video, 'videoWidth', { configurable: true, value: width });
  Object.defineProperty(video, 'videoHeight', { configurable: true, value: height });
  Object.defineProperty(video, 'duration', { configurable: true, value: duration });
  act(() => {
    video.dispatchEvent(new Event('durationchange'));
    video.dispatchEvent(new Event('loadedmetadata'));
  });
}

function setup(props: Partial<React.ComponentProps<typeof VideoPlayer>> = {}) {
  const utils = render(
    <VideoPlayer src="blob:v" title="离港" videoClassName="my-video" {...props} />
  );
  const group = screen.getByRole('group', { name: '视频 离港' });
  const video = group.querySelector('video') as HTMLVideoElement;
  return { ...utils, group, video };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('VideoPlayer 纯函数', () => {
  it('formatTime：m:ss / h:mm:ss，非法值为 0:00', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(5.9)).toBe('0:05');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(3725)).toBe('1:02:05');
    expect(formatTime(Number.NaN)).toBe('0:00');
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe('0:00');
    expect(formatTime(-3)).toBe('0:00');
  });

  it('clampTime / ratioFromPointer：限制范围', () => {
    expect(clampTime(-2, 10)).toBe(0);
    expect(clampTime(12, 10)).toBe(10);
    expect(clampTime(12, Number.NaN)).toBe(12);
    expect(clampTime(Number.NaN, 10)).toBe(0);
    expect(ratioFromPointer(150, 100, 200)).toBe(0.25);
    expect(ratioFromPointer(0, 100, 200)).toBe(0);
    expect(ratioFromPointer(900, 100, 200)).toBe(1);
    expect(ratioFromPointer(10, 0, 0)).toBe(0);
  });

  it('frameWidth：按比例收窄，不超过父容器 / 最大宽度 / 最大高度', () => {
    expect(frameWidth(2)).toBe('100%');
    expect(frameWidth(2, 640)).toBe('min(100%, 640px)');
    expect(frameWidth(2, 640, 420)).toBe('min(100%, 640px, calc(420px * 2))');
    expect(frameWidth(0.5, undefined, '60vh')).toBe('min(100%, calc(60vh * 0.5))');
  });
});

describe('VideoPlayer 组件', () => {
  it('无障碍：分组标签、内部 video 带类名、不使用原生控制条', () => {
    const { group, video } = setup();
    expect(group.getAttribute('tabindex')).toBe('0');
    expect(video.classList.contains('my-video')).toBe(true);
    expect(video.controls).toBe(false);
    expect(video.getAttribute('preload')).toBe('metadata');
    expect(screen.getByRole('button', { name: '播放' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '静音' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '全屏' })).toBeTruthy();
    expect(screen.getByText('离港')).toBeTruthy();
  });

  it('读到元数据后容器贴合视频宽高比，并回调尺寸 / 时长与布局变化；不自动播放时停在第一帧附近', () => {
    const onMetadata = vi.fn();
    const onLayoutChange = vi.fn();
    const { group, video } = setup({ maxWidth: 640, maxHeight: 420, onMetadata, onLayoutChange });
    expect(group.getAttribute('data-aspect')).toBeNull();
    loadMetadata(video, 1280, 720, 12);
    expect(group.getAttribute('data-aspect')).toBe(String(Number((1280 / 720).toFixed(4))));
    expect(onMetadata).toHaveBeenCalledWith({ width: 1280, height: 720, duration: 12 });
    expect(onLayoutChange).toHaveBeenCalled();
    expect(video.currentTime).toBeCloseTo(0.1);
    expect(screen.getByTestId('video-time').textContent).toBe('0:00 / 0:12');
  });

  it('播放 / 暂停：按钮、点击画面、空格与 K 键', async () => {
    const { group, video } = setup();
    expect(video.paused).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '播放' }));
    });
    expect(video.paused).toBe(false);
    expect(group.getAttribute('data-paused')).toBe('false');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '暂停' }));
    });
    expect(video.paused).toBe(true);
    await act(async () => {
      fireEvent.keyDown(group, { key: ' ' });
    });
    expect(video.paused).toBe(false);
    await act(async () => {
      fireEvent.keyDown(group, { key: 'k' });
    });
    expect(video.paused).toBe(true);
    // 点击画面
    const surface = group.querySelector('[aria-hidden="true"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(surface);
    });
    expect(video.paused).toBe(false);
  });

  it('进度条：点击跳转、键盘 ← / → 5 秒、Home / End，aria 值同步', () => {
    const { video } = setup();
    loadMetadata(video, 640, 360, 20);
    const slider = screen.getByRole('slider', { name: '播放进度' });
    expect(slider.getAttribute('aria-valuemax')).toBe('20');
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      width: 200,
      top: 0,
      right: 300,
      bottom: 10,
      height: 10,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(slider, { clientX: 150, pointerId: 1 });
    fireEvent.pointerUp(slider, { pointerId: 1 });
    expect(video.currentTime).toBe(5);
    expect(slider.getAttribute('aria-valuenow')).toBe('5');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(video.currentTime).toBe(10);
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(video.currentTime).toBe(0);
    fireEvent.keyDown(slider, { key: 'End' });
    expect(video.currentTime).toBe(20);
    expect(slider.getAttribute('aria-valuetext')).toBe('0:20 / 0:20');
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(video.currentTime).toBe(0);
  });

  it('聚焦播放器时 ← / → 也能快退快进', () => {
    const { group, video } = setup();
    loadMetadata(video, 640, 360, 30);
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(video.currentTime).toBe(10);
    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(video.currentTime).toBe(5);
  });

  it('静音切换（按钮与 M 键），默认静音时显示「取消静音」', () => {
    const { group, video } = setup({ defaultMuted: true });
    expect(video.muted).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '取消静音' }));
    expect(video.muted).toBe(false);
    expect(screen.getByRole('button', { name: '静音' })).toBeTruthy();
    fireEvent.keyDown(group, { key: 'm' });
    expect(video.muted).toBe(true);
  });

  it('循环开关（可选）', () => {
    const { video } = setup({ showLoopToggle: true, defaultLoop: true });
    const toggle = screen.getByRole('button', { name: '循环播放' });
    expect(video.loop).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(video.loop).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('全屏按钮调用 requestFullscreen', () => {
    const { group } = setup();
    const request = vi.fn(() => Promise.resolve());
    Object.assign(group, { requestFullscreen: request });
    fireEvent.click(screen.getByRole('button', { name: '全屏' }));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('额外操作插槽显示在播放器里，点击不触发播放', async () => {
    const onBeside = vi.fn();
    const { video } = setup({
      actions: (
        <button type="button" aria-label="在旁边看 离港" onClick={onBeside}>
          看
        </button>
      ),
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '在旁边看 离港' }));
    });
    expect(onBeside).toHaveBeenCalledTimes(1);
    expect(video.paused).toBe(true);
  });

  it('compact：静音、循环、自动播放，没有控制条', () => {
    const { video, group } = setup({ variant: 'compact' });
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.autoplay).toBe(true);
    expect(group.getAttribute('tabindex')).toBe('-1');
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByRole('button', { name: '播放' })).toBeNull();
  });
});
