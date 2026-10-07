import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CODEC_PRESETS,
  createMuxer,
  detectSupportedCodecs,
  encodeTimeline,
  isWebCodecsSupported,
  pickDefaultCodec,
  type CodecPreset,
  type EncodeProgress,
  type Timeline,
  type VideoClipSource,
} from '../src/stitch';
import { FakeOffscreenCanvas, fakeImage } from './fake-canvas';

const muxerState = vi.hoisted(() => ({
  created: [] as { kind: string; options: unknown; chunks: unknown[]; finalized: boolean }[],
}));

vi.mock('mp4-muxer', () => {
  class ArrayBufferTarget {
    buffer = new Uint8Array([1, 2, 3]).buffer;
  }
  class Muxer {
    target: ArrayBufferTarget;
    record: { kind: string; options: unknown; chunks: unknown[]; finalized: boolean };
    constructor(options: { target: ArrayBufferTarget }) {
      this.target = options.target;
      this.record = { kind: 'mp4', options, chunks: [], finalized: false };
      muxerState.created.push(this.record);
    }
    addVideoChunk(chunk: unknown) {
      this.record.chunks.push(chunk);
    }
    finalize() {
      this.record.finalized = true;
    }
  }
  return { Muxer, ArrayBufferTarget };
});

vi.mock('webm-muxer', () => {
  class ArrayBufferTarget {
    buffer = new Uint8Array([9]).buffer;
  }
  class Muxer {
    target: ArrayBufferTarget;
    record: { kind: string; options: unknown; chunks: unknown[]; finalized: boolean };
    constructor(options: { target: ArrayBufferTarget }) {
      this.target = options.target;
      this.record = { kind: 'webm', options, chunks: [], finalized: false };
      muxerState.created.push(this.record);
    }
    addVideoChunk(chunk: unknown) {
      this.record.chunks.push(chunk);
    }
    finalize() {
      this.record.finalized = true;
    }
  }
  return { Muxer, ArrayBufferTarget };
});

interface EncoderInit {
  output: (chunk: unknown, meta?: unknown) => void;
  error: (error: unknown) => void;
}

/** 假 WebCodecs：记录 encode / flush / close */
function installWebCodecs(
  options: { supported?: (codec: string) => boolean; failAt?: number } = {}
) {
  const encoders: FakeEncoder[] = [];
  const frames: FakeFrame[] = [];
  class FakeFrame {
    closed = false;
    constructor(
      public source: unknown,
      public init: { timestamp: number; duration: number }
    ) {
      frames.push(this);
    }
    close() {
      this.closed = true;
    }
  }
  class FakeEncoder {
    static isConfigSupported = vi.fn(async (config: { codec: string }) => {
      if (config.codec === 'throw') throw new Error('bad');
      return { supported: options.supported ? options.supported(config.codec) : true };
    });
    state: 'unconfigured' | 'configured' | 'closed' = 'unconfigured';
    config: unknown;
    encoded: { timestamp: number; keyFrame: boolean }[] = [];
    flushes = 0;
    constructor(public init: EncoderInit) {
      encoders.push(this);
    }
    configure(config: unknown) {
      this.config = config;
      this.state = 'configured';
    }
    encode(frame: FakeFrame, opts: { keyFrame: boolean }) {
      this.encoded.push({ timestamp: frame.init.timestamp, keyFrame: opts.keyFrame });
      if (options.failAt !== undefined && this.encoded.length === options.failAt) {
        this.init.error(new Error('encoder exploded'));
      }
      this.init.output({ type: opts.keyFrame ? 'key' : 'delta', timestamp: frame.init.timestamp });
    }
    async flush() {
      this.flushes += 1;
    }
    close() {
      this.state = 'closed';
    }
  }
  vi.stubGlobal('VideoEncoder', FakeEncoder);
  vi.stubGlobal('VideoFrame', FakeFrame);
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  return { encoders, frames, FakeEncoder };
}

const avc = CODEC_PRESETS.find((p) => p.id === 'avc') as CodecPreset;
const vp9 = CODEC_PRESETS.find((p) => p.id === 'vp9') as CodecPreset;

function timeline(durationMs = 1000, extra: Partial<Timeline> = {}): Timeline {
  return {
    width: 64,
    height: 36,
    transitionMs: 0,
    clips: [{ id: 'a', name: 'a', source: fakeImage(64, 36), durationMs, caption: '字幕' }],
    ...extra,
  };
}

beforeEach(() => {
  muxerState.created = [];
  FakeOffscreenCanvas.instances = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('codecs', () => {
  it('没有 WebCodecs 时不支持任何编码', async () => {
    vi.stubGlobal('VideoEncoder', undefined);
    expect(isWebCodecsSupported()).toBe(false);
    expect(await detectSupportedCodecs({ width: 2, height: 2, fps: 30, bitrate: 1 })).toEqual([]);
  });

  it('按预设顺序返回支持的编码，探测异常视为不支持', async () => {
    const { FakeEncoder } = installWebCodecs({ supported: (codec) => codec !== 'vp8' });
    expect(isWebCodecsSupported()).toBe(true);
    const supported = await detectSupportedCodecs({ width: 64, height: 36, fps: 30, bitrate: 1e6 });
    expect(supported.map((p) => p.id)).toEqual(['avc', 'vp9', 'av1']);
    expect(FakeEncoder.isConfigSupported).toHaveBeenCalledWith(
      expect.objectContaining({ width: 64, height: 36, framerate: 30, bitrate: 1e6 })
    );
    FakeEncoder.isConfigSupported.mockRejectedValueOnce(new Error('x'));
    const again = await detectSupportedCodecs({ width: 64, height: 36, fps: 30, bitrate: 1e6 });
    expect(again).toHaveLength(2);
  });

  it('pickDefaultCodec 优先 avc，其次 vp9', () => {
    const [h264, v9, v8, a1] = CODEC_PRESETS as [
      CodecPreset,
      CodecPreset,
      CodecPreset,
      CodecPreset,
    ];
    expect(pickDefaultCodec([v8, v9, h264])?.id).toBe('avc');
    expect(pickDefaultCodec([v8, a1, v9])?.id).toBe('vp9');
    expect(pickDefaultCodec([a1, v8])?.id).toBe('av1');
    expect(pickDefaultCodec([])).toBeNull();
    expect(CODEC_PRESETS.map((p) => p.id)).toEqual(['avc', 'vp9', 'vp8', 'av1']);
  });

  it('createMuxer 按容器选择封装器', () => {
    createMuxer(avc, 64, 36);
    createMuxer(vp9, 64, 36);
    expect(muxerState.created.map((m) => m.kind)).toEqual(['mp4', 'webm']);
    expect(muxerState.created[0]?.options).toMatchObject({
      video: { codec: 'avc', width: 64, height: 36 },
      fastStart: 'in-memory',
    });
    expect(muxerState.created[1]?.options).toMatchObject({ video: { codec: 'V_VP9' } });
  });
});

describe('encodeTimeline', () => {
  it('正常导出 MP4：关键帧每 2 秒、定期 flush、关闭帧与编码器', async () => {
    const { encoders, frames } = installWebCodecs();
    const progress: EncodeProgress[] = [];
    const result = await encodeTimeline(
      timeline(3000),
      { fps: 10, bitrate: 1e6, codec: avc },
      (p) => progress.push(p)
    );
    expect(result.mimeType).toBe('video/mp4');
    expect(result.fileExtension).toBe('mp4');
    expect(result.blob.type).toBe('video/mp4');
    expect(result.blob.size).toBe(3);

    const encoder = encoders[0];
    expect(encoder?.encoded).toHaveLength(30);
    expect(encoder?.encoded.filter((e) => e.keyFrame).map((e) => e.timestamp)).toEqual([
      0, 2_000_000,
    ]);
    expect(encoder?.encoded[1]?.timestamp).toBe(100_000);
    // 每秒一次 + 结束一次
    expect(encoder?.flushes).toBe(4);
    expect(encoder?.state).toBe('closed');
    expect(encoder?.config).toMatchObject({
      codec: 'avc1.42001f',
      width: 64,
      height: 36,
      framerate: 10,
    });
    expect(frames.every((f) => f.closed)).toBe(true);
    expect(frames[0]?.init.duration).toBe(100_000);
    expect(muxerState.created[0]?.chunks).toHaveLength(30);
    expect(muxerState.created[0]?.finalized).toBe(true);
    expect(progress).toHaveLength(30);
    expect(progress[29]).toEqual({ frame: 30, totalFrames: 30, percent: 100 });
    // 渲染画布用完即释放
    expect(FakeOffscreenCanvas.instances[0]?.width).toBe(0);
  });

  it('WebM 与视频片段源（逐帧 ensureFrameAt）', async () => {
    installWebCodecs();
    const ensure = vi.fn(async () => undefined);
    const source: VideoClipSource = {
      durationMs: 500,
      getFrameAt: () => fakeImage(8, 8),
      ensureFrameAt: ensure,
    };
    const result = await encodeTimeline(
      {
        width: 63,
        height: 35,
        transitionMs: 0,
        clips: [{ id: 'v', name: 'v', source, durationMs: 500 }],
      },
      { fps: 4, bitrate: 1e5, codec: vp9 }
    );
    expect(result.fileExtension).toBe('webm');
    expect(ensure.mock.calls.map((c) => (c as unknown[])[0])).toEqual([0, 250]);
  });

  it('参数校验', async () => {
    installWebCodecs();
    const ok = { fps: 10, bitrate: 1e6, codec: avc };
    await expect(encodeTimeline(timeline(1000, { clips: [] }), ok)).rejects.toThrow('时间轴为空');
    await expect(encodeTimeline(timeline(), { ...ok, fps: 0 })).rejects.toThrow('帧率');
    await expect(encodeTimeline(timeline(), { ...ok, bitrate: -1 })).rejects.toThrow('码率');
    await expect(encodeTimeline(timeline(1000, { width: 63 }), ok)).rejects.toThrow('偶数');
    await expect(encodeTimeline(timeline(1000, { width: 0 }), ok)).rejects.toThrow('分辨率');
    await expect(encodeTimeline(timeline(0), ok)).rejects.toThrow('总时长为 0');
  });

  it('不支持 WebCodecs 或编码配置时报错', async () => {
    vi.stubGlobal('VideoEncoder', undefined);
    await expect(encodeTimeline(timeline(), { fps: 10, bitrate: 1e6, codec: avc })).rejects.toThrow(
      'WebCodecs'
    );
    installWebCodecs({ supported: () => false });
    await expect(encodeTimeline(timeline(), { fps: 10, bitrate: 1e6, codec: avc })).rejects.toThrow(
      '不支持 64×36@10fps'
    );
  });

  it('编码器出错时中止并关闭', async () => {
    const { encoders, frames } = installWebCodecs({ failAt: 3 });
    await expect(
      encodeTimeline(timeline(2000), { fps: 10, bitrate: 1e6, codec: avc })
    ).rejects.toThrow('encoder exploded');
    expect(encoders[0]?.encoded).toHaveLength(3);
    expect(encoders[0]?.state).toBe('closed');
    expect(frames.every((f) => f.closed)).toBe(true);
    expect(muxerState.created[0]?.finalized).toBe(false);
  });

  it('AbortSignal 取消：开始前与进行中', async () => {
    const { encoders } = installWebCodecs();
    const before = new AbortController();
    before.abort();
    await expect(
      encodeTimeline(timeline(), { fps: 10, bitrate: 1e6, codec: avc, signal: before.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(encoders).toHaveLength(0);

    const controller = new AbortController();
    const reason = new Error('作者取消');
    await expect(
      encodeTimeline(
        timeline(2000),
        { fps: 10, bitrate: 1e6, codec: avc, signal: controller.signal },
        (p) => {
          if (p.frame === 5) controller.abort(reason);
        }
      )
    ).rejects.toBe(reason);
    expect(encoders[0]?.encoded).toHaveLength(5);
    expect(encoders[0]?.state).toBe('closed');
  });
});
