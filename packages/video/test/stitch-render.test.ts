import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateStoryboard, type Storyboard } from '../src';
import {
  animaticSize,
  buildAnimaticTimeline,
  createCanvasSurface,
  createDefaultPlaceholder,
  createRenderer,
  createVideoElementSource,
  drawTimelineFrame,
  fitRect,
  getClipFrameSource,
  getSourceSize,
  isOffscreenRenderingSupported,
  isVideoClipSource,
  parseAspectRatio,
  prepareTimelineFrames,
  resolveClipsAt,
  resolveTimelineAt,
  timelineDurationMs,
  toEvenDimension,
  wrapText,
  type FrameSource,
  type RenderContext,
  type Timeline,
  type TimelineClip,
  type VideoClipSource,
} from '../src/stitch';
import { FakeOffscreenCanvas, createFakeContext, fakeImage, type FakeContext } from './fake-canvas';

afterEach(() => {
  vi.unstubAllGlobals();
  FakeOffscreenCanvas.instances = [];
});

const img = fakeImage(100, 50);
const clip = (id: string, durationMs: number, extra: Partial<TimelineClip> = {}): TimelineClip => ({
  id,
  name: id,
  source: img,
  durationMs,
  ...extra,
});

describe('timeline', () => {
  it('timelineDurationMs：顺序累加与 startMs', () => {
    expect(timelineDurationMs({ clips: [] })).toBe(0);
    expect(timelineDurationMs({ clips: [clip('a', 1000), clip('b', 500)] })).toBe(1500);
    expect(
      timelineDurationMs({ clips: [clip('a', 1000, { startMs: 2000 }), clip('b', 500)] })
    ).toBe(3500);
    expect(timelineDurationMs({ clips: [clip('a', 3000), clip('b', 500, { startMs: 100 })] })).toBe(
      3000
    );
  });

  it('resolveClipsAt：片段内、转场、间隙与越界', () => {
    const clips = [clip('a', 1000), clip('b', 1000)];
    expect(resolveClipsAt([], 100, 0).clip).toBeNull();
    expect(resolveClipsAt(clips, 200, 100)).toMatchObject({
      clip: { id: 'a' },
      nextClip: null,
      clipLocalMs: 100,
      transitionProgress: 0,
    });
    const mid = resolveClipsAt(clips, 200, 900);
    expect(mid.clip?.id).toBe('a');
    expect(mid.nextClip?.id).toBe('b');
    expect(mid.transitionProgress).toBeCloseTo(0.5);
    expect(resolveClipsAt(clips, 200, 1000)).toMatchObject({ clip: { id: 'b' }, clipLocalMs: 0 });
    expect(resolveClipsAt(clips, 200, 1950).nextClip).toBeNull();
    expect(resolveClipsAt(clips, 200, 2000).clip).toBeNull();
    expect(resolveClipsAt(clips, 200, -1).clip).toBeNull();
    // 没有转场时不出现 nextClip
    expect(resolveClipsAt(clips, 0, 999).nextClip).toBeNull();
    // 转场不超过片段时长
    expect(resolveClipsAt(clips, 5000, 0).transitionProgress).toBeCloseTo(0);
    expect(resolveClipsAt(clips, 5000, 500).transitionProgress).toBeCloseTo(0.5);
    // 间隙
    const gap = [clip('a', 100), clip('b', 100, { startMs: 500 })];
    expect(resolveClipsAt(gap, 0, 300).clip).toBeNull();
    expect(resolveClipsAt(gap, 0, 550).clip?.id).toBe('b');
    const timeline: Timeline = { width: 2, height: 2, transitionMs: 0, clips };
    expect(resolveTimelineAt(timeline, 1500).clip?.id).toBe('b');
  });
});

describe('render', () => {
  const ctx = (): FakeContext => createFakeContext();
  const draw = (c: FakeContext, timeline: Timeline, ms: number) =>
    drawTimelineFrame(c as unknown as RenderContext, timeline, ms);

  it('getSourceSize 识别 VideoFrame / img / canvas', () => {
    expect(getSourceSize({ displayWidth: 4, displayHeight: 3 } as unknown as VideoFrame)).toEqual({
      width: 4,
      height: 3,
    });
    expect(
      getSourceSize({
        naturalWidth: 0,
        naturalHeight: 0,
        width: 7,
        height: 8,
      } as unknown as HTMLImageElement)
    ).toEqual({ width: 7, height: 8 });
    expect(
      getSourceSize({
        naturalWidth: 5,
        naturalHeight: 6,
        width: 1,
        height: 1,
      } as unknown as HTMLImageElement)
    ).toEqual({ width: 5, height: 6 });
    expect(getSourceSize(img)).toEqual({ width: 100, height: 50 });
  });

  it('fitRect cover / contain', () => {
    const target = { width: 100, height: 100 };
    expect(fitRect({ width: 200, height: 100 }, target, 'cover')).toEqual({
      x: -50,
      y: 0,
      width: 200,
      height: 100,
    });
    expect(fitRect({ width: 200, height: 100 }, target, 'contain')).toEqual({
      x: 0,
      y: 25,
      width: 100,
      height: 50,
    });
    expect(fitRect({ width: 0, height: 1 }, target, 'cover')).toBeNull();
  });

  it('wrapText 按宽度逐字折行并保留空行', () => {
    const measure = (text: string) => text.length;
    expect(wrapText(measure, '一二三四五', 2)).toEqual(['一二', '三四', '五']);
    expect(wrapText(measure, 'a\n\nb', 5)).toEqual(['a', '', 'b']);
  });

  it('普通帧：背景 + 图像 + 字幕', () => {
    const c = ctx();
    const timeline: Timeline = {
      width: 100,
      height: 100,
      transitionMs: 0,
      fitMode: 'contain',
      background: '#111',
      clips: [clip('a', 1000, { caption: '你好' })],
    };
    draw(c, timeline, 10);
    const ops = c.calls.map((call) => call.op);
    expect(ops).toEqual(['clearRect', 'fillRect', 'drawImage', 'fillRect', 'fillText']);
    expect(c.calls[2]?.args.slice(1)).toEqual([0, 25, 100, 50]);
    expect(c.calls[4]?.args[0]).toBe('你好');
  });

  it('空白时刻只画背景', () => {
    const c = ctx();
    draw(c, { width: 10, height: 10, transitionMs: 0, clips: [clip('a', 10)] }, 50);
    expect(c.calls.map((call) => call.op)).toEqual(['clearRect', 'fillRect']);
  });

  it('crossfade：两层叠加，字幕随占优片段', () => {
    const c = ctx();
    const timeline: Timeline = {
      width: 100,
      height: 100,
      transitionMs: 200,
      clips: [clip('a', 1000, { caption: 'A' }), clip('b', 1000, { caption: 'B' })],
    };
    draw(c, timeline, 950);
    const images = c.calls.filter((call) => call.op === 'drawImage');
    expect(images).toHaveLength(2);
    expect(images[1]?.alpha).toBeCloseTo(0.75);
    expect(c.calls.find((call) => call.op === 'fillText')?.args[0]).toBe('B');
  });

  it('fade：前半段淡出当前片段，后半段淡入下一片段', () => {
    const timeline: Timeline = {
      width: 100,
      height: 100,
      transitionMs: 200,
      transitionType: 'fade',
      clips: [clip('a', 1000, { caption: 'A' }), clip('b', 1000, { caption: 'B' })],
    };
    const first = ctx();
    draw(first, timeline, 850);
    const firstImages = first.calls.filter((call) => call.op === 'drawImage');
    expect(firstImages).toHaveLength(1);
    expect(firstImages[0]?.alpha).toBeCloseTo(0.5);
    expect(first.calls.find((call) => call.op === 'fillText')?.args[0]).toBe('A');
    const second = ctx();
    draw(second, timeline, 950);
    expect(second.calls.filter((call) => call.op === 'drawImage')[0]?.alpha).toBeCloseTo(0.5);
    expect(second.calls.find((call) => call.op === 'fillText')?.args[0]).toBe('B');
  });

  it('字幕最多 3 行并加省略号', () => {
    const c = ctx();
    const timeline: Timeline = {
      width: 100,
      height: 100,
      transitionMs: 0,
      clips: [clip('a', 1000, { caption: '字'.repeat(100) })],
    };
    draw(c, timeline, 0);
    const texts = c.calls.filter((call) => call.op === 'fillText');
    expect(texts).toHaveLength(3);
    expect(String(texts[2]?.args[0]).endsWith('…')).toBe(true);
  });

  it('视频片段：先 ensureFrameAt 再取帧；未就绪时不绘制', async () => {
    const frame = fakeImage(10, 10);
    let ready = false;
    const source: VideoClipSource = {
      durationMs: 1000,
      getFrameAt: vi.fn(() => (ready ? frame : null)),
      ensureFrameAt: vi.fn(async () => {
        ready = true;
      }),
    };
    expect(isVideoClipSource(source)).toBe(true);
    expect(isVideoClipSource(img)).toBe(false);
    const timeline: Timeline = {
      width: 10,
      height: 10,
      transitionMs: 100,
      clips: [clip('v', 1000, { source }), clip('w', 1000, { source })],
    };
    expect(getClipFrameSource(timeline.clips[0] as TimelineClip, 0)).toBeNull();
    const c = ctx();
    draw(c, timeline, 0);
    expect(c.calls.some((call) => call.op === 'drawImage')).toBe(false);
    await prepareTimelineFrames(timeline, 950);
    expect(source.ensureFrameAt).toHaveBeenCalledWith(950);
    expect(source.ensureFrameAt).toHaveBeenCalledWith(0);
    draw(c, timeline, 10);
    expect(c.calls.some((call) => call.op === 'drawImage')).toBe(true);
  });
});

describe('renderer', () => {
  it('优先 OffscreenCanvas，destroy 释放画布', () => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    expect(isOffscreenRenderingSupported()).toBe(true);
    const renderer = createRenderer(20, 10);
    const canvas = renderer.getCanvas() as unknown as FakeOffscreenCanvas;
    expect(canvas.width).toBe(20);
    renderer.render({ width: 20, height: 10, transitionMs: 0, clips: [clip('a', 100)] }, 0);
    expect(canvas.context.drawImage).toHaveBeenCalled();
    renderer.destroy();
    expect(canvas.width).toBe(0);
    expect(renderer.width).toBe(20);
  });

  it('没有 OffscreenCanvas 时回退到 document.createElement', () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    const fake = new FakeOffscreenCanvas(0, 0);
    vi.stubGlobal('document', { createElement: vi.fn(() => fake) });
    const { canvas } = createCanvasSurface(30, 40);
    expect(canvas).toBe(fake);
    expect(fake.width).toBe(30);
    expect(fake.height).toBe(40);
  });

  it('两者都没有时抛错', () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    vi.stubGlobal('document', undefined);
    expect(() => createCanvasSurface(1, 1)).toThrow('无法创建画布');
  });
});

describe('animatic', () => {
  const parsed = validateStoryboard({
    aspectRatio: '9:16',
    shots: [
      { id: 's1', shotSize: '远景', durationSec: 3, description: '星港全貌' },
      { id: 's2', shotSize: '特写', durationSec: 2.5, description: '林舟的眼睛', dialogue: '走吧' },
      { id: 's3', shotSize: '中景', durationSec: 1, description: '舱门关闭' },
    ],
  });
  if (!parsed.ok) throw new Error('fixture invalid');
  const storyboard: Storyboard = parsed.storyboard;

  it('尺寸计算：比例、偶数、只给一边', () => {
    expect(toEvenDimension(719.4)).toBe(720);
    expect(toEvenDimension(1)).toBe(2);
    expect(toEvenDimension(-5)).toBe(2);
    expect(parseAspectRatio('21:9')).toBeCloseTo(21 / 9);
    expect(parseAspectRatio('bad')).toBeCloseTo(16 / 9);
    expect(animaticSize('16:9')).toEqual({ width: 1280, height: 720 });
    expect(animaticSize('9:16')).toEqual({ width: 720, height: 1280 });
    expect(animaticSize('21:9')).toEqual({ width: 1280, height: 548 });
    expect(animaticSize('4:3')).toEqual({ width: 1280, height: 960 });
    expect(animaticSize('1:1', { longEdge: 641 })).toEqual({ width: 642, height: 642 });
    expect(animaticSize('16:9', { width: 640 })).toEqual({ width: 640, height: 360 });
    expect(animaticSize('16:9', { height: 360 })).toEqual({ width: 640, height: 360 });
    expect(animaticSize('16:9', { width: 101, height: 51 })).toEqual({ width: 102, height: 52 });
  });

  it('有素材的镜头用素材，没有的用占位卡；字幕台词优先', () => {
    const source = fakeImage(720, 1280);
    const placeholders: FrameSource[] = [];
    const createPlaceholder = vi.fn((_shot, index: number, w: number, h: number) => {
      const p = fakeImage(w, h + index);
      placeholders.push(p);
      return p;
    });
    const timeline = buildAnimaticTimeline(storyboard, new Map([['s2', source]]), {
      createPlaceholder,
    });
    expect(timeline).toMatchObject({
      width: 720,
      height: 1280,
      transitionMs: 300,
      transitionType: 'crossfade',
      fitMode: 'cover',
    });
    expect(timeline.clips.map((c) => [c.id, c.name, c.durationMs, c.caption])).toEqual([
      ['s1', '镜头1', 3000, '星港全貌'],
      ['s2', '镜头2', 2500, '走吧'],
      ['s3', '镜头3', 1000, '舱门关闭'],
    ]);
    expect(timeline.clips[1]?.source).toBe(source);
    expect(createPlaceholder).toHaveBeenCalledTimes(2);
    expect(createPlaceholder.mock.calls[1]?.slice(1)).toEqual([2, 720, 1280]);
    expect(timeline.clips[2]?.source).toBe(placeholders[1]);
    expect(timelineDurationMs(timeline)).toBe(6500);
  });

  it('关闭字幕、自定义尺寸与转场（不超过最短镜头一半）', () => {
    const timeline = buildAnimaticTimeline(storyboard, new Map(), {
      captions: false,
      width: 320,
      transitionMs: 2000,
      fitMode: 'contain',
      createPlaceholder: () => fakeImage(1, 1),
    });
    expect(timeline.width).toBe(320);
    expect(timeline.height).toBe(568);
    expect(timeline.transitionMs).toBe(500);
    expect(timeline.fitMode).toBe('contain');
    expect(timeline.clips.every((c) => c.caption === undefined)).toBe(true);
    const noTransition = buildAnimaticTimeline(storyboard, new Map(), {
      transitionMs: -1,
      createPlaceholder: () => fakeImage(1, 1),
    });
    expect(noTransition.transitionMs).toBe(0);
  });

  it('支持视频片段源', () => {
    const video: VideoClipSource = {
      durationMs: 3000,
      getFrameAt: () => null,
      ensureFrameAt: async () => undefined,
    };
    const timeline = buildAnimaticTimeline(storyboard, new Map([['s1', video]]), {
      createPlaceholder: () => fakeImage(1, 1),
    });
    expect(timeline.clips[0]?.source).toBe(video);
  });

  it('默认占位卡在画布上绘制镜头号、景别与描述', () => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    const shot = {
      id: 'x',
      shotSize: '特写' as const,
      durationSec: 2,
      camera: '推近',
      description: '很长的描述'.repeat(100),
    };
    const canvas = createDefaultPlaceholder(shot, 4, 320, 180) as unknown as FakeOffscreenCanvas;
    expect(canvas).toBeInstanceOf(FakeOffscreenCanvas);
    const texts = canvas.context.calls.filter((c) => c.op === 'fillText').map((c) => c.args[0]);
    expect(texts[0]).toBe('镜头 5');
    expect(texts[1]).toBe('特写 · 2 秒 · 推近');
    expect(String(texts[texts.length - 1]).endsWith('…')).toBe(true);
    // 用作时间轴默认占位
    const timeline = buildAnimaticTimeline(storyboard, new Map());
    expect(FakeOffscreenCanvas.instances.length).toBe(1 + storyboard.shots.length);
    expect(timeline.clips[0]?.source).toBe(FakeOffscreenCanvas.instances[1]);
  });
});

describe('createVideoElementSource', () => {
  class FakeVideo extends EventTarget {
    videoWidth = 64;
    videoHeight = 36;
    duration = 2;
    seeks: number[] = [];
    private time = 0;
    autoSeek = true;
    get currentTime() {
      return this.time;
    }
    set currentTime(value: number) {
      this.time = value;
      this.seeks.push(value);
      if (this.autoSeek) setTimeout(() => this.dispatchEvent(new Event('seeked')), 0);
    }
  }

  it('按需 seek 并绘制到画布；同一时间不重复 seek；超出时长停在末帧', async () => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    const video = new FakeVideo();
    const source = createVideoElementSource(video as unknown as HTMLVideoElement);
    expect(source.durationMs).toBe(2000);
    expect(source.getFrameAt(0)).toBeNull();
    await source.ensureFrameAt(0);
    const frame = source.getFrameAt(0) as unknown as FakeOffscreenCanvas;
    expect(frame).toBeInstanceOf(FakeOffscreenCanvas);
    expect(frame.width).toBe(64);
    expect(frame.context.drawImage).toHaveBeenCalledTimes(1);
    expect(video.seeks).toEqual([]);
    await Promise.all([source.ensureFrameAt(500), source.ensureFrameAt(500)]);
    expect(video.seeks).toEqual([0.5]);
    expect(frame.context.drawImage).toHaveBeenCalledTimes(2);
    await source.ensureFrameAt(10_000);
    expect(video.seeks[1]).toBeCloseTo(2 - 1 / 30);
  });

  it('入点、自定义尺寸与 seek 超时', async () => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    const video = new FakeVideo();
    video.autoSeek = false;
    video.duration = Number.NaN;
    const source = createVideoElementSource(video as unknown as HTMLVideoElement, {
      width: 10,
      height: 8,
      inPointMs: 300,
      seekTimeoutMs: 5,
    });
    expect(source.durationMs).toBe(0);
    await source.ensureFrameAt(100);
    // 时长未知时只能停在 0
    expect(video.seeks).toEqual([]);
    const frame = source.getFrameAt(0) as unknown as FakeOffscreenCanvas;
    expect(frame.width).toBe(10);
    expect(frame.height).toBe(8);

    const timed = new FakeVideo();
    timed.autoSeek = false;
    const slow = createVideoElementSource(timed as unknown as HTMLVideoElement, {
      inPointMs: 300,
      seekTimeoutMs: 5,
    });
    await slow.ensureFrameAt(100);
    expect(timed.seeks).toEqual([0.4]);
    expect(slow.durationMs).toBe(1700);
  });
});
