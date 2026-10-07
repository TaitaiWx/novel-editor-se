import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AAC_PRESET,
  AUDIO_CHUNK_FRAMES,
  CODEC_PRESETS,
  OPUS_PRESET,
  audioPresetFor,
  chooseAudioEncoding,
  createMuxer,
  decodeAudioTrack,
  encodeTimeline,
  isAudioEncoderConfigSupported,
  mixAudioPlan,
  planAudioTimeline,
  type CodecPreset,
  type Timeline,
} from '../src/stitch';
import { FakeOffscreenCanvas, fakeImage } from './fake-canvas';

interface MuxRecord {
  kind: string;
  options: unknown;
  video: unknown[];
  audio: { chunk: { timestamp: number }; meta: unknown }[];
  finalized: boolean;
}

const muxerState = vi.hoisted(() => ({ created: [] as MuxRecord[], sequence: [] as string[] }));

function fakeMuxerModule(kind: string) {
  class ArrayBufferTarget {
    buffer = new Uint8Array([1]).buffer;
  }
  class Muxer {
    target: ArrayBufferTarget;
    record: MuxRecord;
    constructor(options: { target: ArrayBufferTarget }) {
      this.target = options.target;
      this.record = { kind, options, video: [], audio: [], finalized: false };
      muxerState.created.push(this.record);
    }
    addVideoChunk(chunk: unknown) {
      this.record.video.push(chunk);
      muxerState.sequence.push('v');
    }
    addAudioChunk(chunk: { timestamp: number }, meta: unknown) {
      this.record.audio.push({ chunk, meta });
      muxerState.sequence.push('a');
    }
    finalize() {
      this.record.finalized = true;
    }
  }
  return { Muxer, ArrayBufferTarget };
}

vi.mock('mp4-muxer', () => fakeMuxerModule('mp4'));
vi.mock('webm-muxer', () => fakeMuxerModule('webm'));

const avc = CODEC_PRESETS.find((p) => p.id === 'avc') as CodecPreset;
const vp9 = CODEC_PRESETS.find((p) => p.id === 'vp9') as CodecPreset;
const vp8 = CODEC_PRESETS.find((p) => p.id === 'vp8') as CodecPreset;

beforeEach(() => {
  muxerState.created = [];
  muxerState.sequence = [];
  FakeOffscreenCanvas.instances = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('planAudioTimeline', () => {
  it('与画面相同的起点：顺序累加，带 startMs 的片段按 startMs', () => {
    const plan = planAudioTimeline([
      { id: 'a', durationMs: 3000, audioDurationMs: 5000 },
      { id: 'b', durationMs: 2000, audioDurationMs: 2000 },
      { id: 'c', durationMs: 1000, startMs: 6000, audioDurationMs: 1000 },
    ]);
    expect(plan.durationMs).toBe(7000);
    expect(plan.hasAudio).toBe(true);
    expect(plan.segments.map((s) => [s.clipId, s.startMs, s.durationMs])).toEqual([
      ['a', 0, 3000],
      ['b', 3000, 2000],
      ['c', 6000, 1000],
    ]);
  });

  it('声音比片段短时只播声音本身的长度；入点之后的长度；没有声音的片段为静音', () => {
    const plan = planAudioTimeline([
      { id: 'short', durationMs: 4000, audioDurationMs: 1500 },
      { id: 'silent', durationMs: 2000 },
      { id: 'zero', durationMs: 2000, audioDurationMs: 0 },
      { id: 'in', durationMs: 3000, audioDurationMs: 2000, inPointMs: 500 },
      { id: 'past', durationMs: 1000, audioDurationMs: 400, inPointMs: 500 },
    ]);
    expect(plan.segments.map((s) => [s.clipId, s.startMs, s.offsetMs, s.durationMs])).toEqual([
      ['short', 0, 0, 1500],
      ['in', 8000, 500, 1500],
    ]);
    expect(plan.durationMs).toBe(12000);
  });

  it('全部没有声音时 hasAudio 为 false；空时间轴', () => {
    expect(planAudioTimeline([{ id: 'a', durationMs: 1000 }]).hasAudio).toBe(false);
    expect(planAudioTimeline([])).toEqual({ durationMs: 0, segments: [], hasAudio: false });
  });

  it('淡入淡出：默认 10ms 防爆音，紧接下一片段时淡出与转场一致，不超过一半长度', () => {
    const plan = planAudioTimeline(
      [
        { id: 'a', durationMs: 2000, audioDurationMs: 2000 },
        { id: 'b', durationMs: 400, audioDurationMs: 400 },
        { id: 'c', durationMs: 1000, audioDurationMs: 500 },
        { id: 'd', durationMs: 1000, audioDurationMs: 1000 },
      ],
      { transitionMs: 300 }
    );
    const fades = plan.segments.map((s) => [s.clipId, s.fadeInMs, s.fadeOutMs]);
    expect(fades).toEqual([
      ['a', 10, 300],
      ['b', 10, 200],
      // 声音没播到片段末尾：只做防爆音淡出
      ['c', 10, 10],
      // 最后一个片段后面没有片段
      ['d', 10, 10],
    ]);
    const noFade = planAudioTimeline([{ id: 'a', durationMs: 1000, audioDurationMs: 1000 }], {
      edgeFadeMs: 0,
    });
    expect(noFade.segments[0]).toMatchObject({ fadeInMs: 0, fadeOutMs: 0 });
  });

  it('非法数值视为 0', () => {
    const plan = planAudioTimeline([
      { id: 'a', durationMs: Number.NaN, audioDurationMs: 1000 },
      { id: 'b', durationMs: 1000, audioDurationMs: Number.POSITIVE_INFINITY },
    ]);
    expect(plan.segments).toEqual([]);
  });
});

describe('chooseAudioEncoding', () => {
  const supportedOnly =
    (...codecs: string[]) =>
    async (config: AudioEncoderConfig) =>
      codecs.includes(config.codec);

  it('没有声音：保持视频编码，不需要音频', async () => {
    const check = vi.fn(async () => true);
    expect(
      await chooseAudioEncoding({
        video: avc,
        supportedVideo: [avc],
        hasAudio: false,
        isAudioSupported: check,
      })
    ).toEqual({ video: avc, audio: null, audioDropped: false });
    expect(check).not.toHaveBeenCalled();
  });

  it('MP4 + AAC 可用', async () => {
    const choice = await chooseAudioEncoding({
      video: avc,
      supportedVideo: [avc, vp9],
      hasAudio: true,
      isAudioSupported: supportedOnly('mp4a.40.2', 'opus'),
    });
    expect(choice).toEqual({ video: avc, audio: AAC_PRESET, audioDropped: false });
  });

  it('AAC 不可用时改用 WebM（VP9 优先）+ Opus', async () => {
    const choice = await chooseAudioEncoding({
      video: avc,
      supportedVideo: [avc, vp8, vp9],
      hasAudio: true,
      isAudioSupported: supportedOnly('opus'),
    });
    expect(choice).toEqual({ video: vp9, audio: OPUS_PRESET, audioDropped: false });
    const onlyVp8 = await chooseAudioEncoding({
      video: avc,
      supportedVideo: [avc, vp8],
      hasAudio: true,
      isAudioSupported: supportedOnly('opus'),
    });
    expect(onlyVp8.video.id).toBe('vp8');
  });

  it('都不可用：只导出画面并标记 audioDropped', async () => {
    expect(
      await chooseAudioEncoding({
        video: avc,
        supportedVideo: [avc],
        hasAudio: true,
        isAudioSupported: supportedOnly('opus'),
      })
    ).toEqual({ video: avc, audio: null, audioDropped: true });
    expect(
      await chooseAudioEncoding({
        video: avc,
        supportedVideo: [avc, vp9],
        hasAudio: true,
        isAudioSupported: supportedOnly(),
      })
    ).toEqual({ video: avc, audio: null, audioDropped: true });
    expect(
      await chooseAudioEncoding({
        video: vp9,
        supportedVideo: [vp9],
        hasAudio: true,
        isAudioSupported: supportedOnly('mp4a.40.2'),
      })
    ).toEqual({ video: vp9, audio: null, audioDropped: true });
  });

  it('默认探测：没有 AudioEncoder 时不支持；探测异常视为不支持', async () => {
    vi.stubGlobal('AudioEncoder', undefined);
    expect(
      await isAudioEncoderConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2 })
    ).toBe(false);
    const isConfigSupported = vi
      .fn()
      .mockResolvedValueOnce({ supported: true })
      .mockRejectedValueOnce(new Error('x'));
    vi.stubGlobal('AudioEncoder', { isConfigSupported });
    vi.stubGlobal('AudioData', class {});
    const config = { codec: 'opus', sampleRate: 48000, numberOfChannels: 2 };
    expect(await isAudioEncoderConfigSupported(config)).toBe(true);
    expect(await isAudioEncoderConfigSupported(config)).toBe(false);
    expect(audioPresetFor('mp4')).toBe(AAC_PRESET);
    expect(audioPresetFor('webm')).toBe(OPUS_PRESET);
  });
});

describe('createMuxer 音频轨', () => {
  it('MP4 + AAC / WebM + Opus；WebM 不能装 AAC', () => {
    const track = { sampleRate: 48000, numberOfChannels: 2 };
    createMuxer(avc, 64, 36, { preset: AAC_PRESET, ...track });
    createMuxer(vp9, 64, 36, { preset: OPUS_PRESET, ...track });
    expect(muxerState.created[0]?.options).toMatchObject({
      audio: { codec: 'aac', sampleRate: 48000, numberOfChannels: 2 },
    });
    expect(muxerState.created[1]?.options).toMatchObject({
      audio: { codec: 'A_OPUS', sampleRate: 48000, numberOfChannels: 2 },
    });
    expect(() => createMuxer(vp9, 64, 36, { preset: AAC_PRESET, ...track })).toThrow('WebM');
    createMuxer(avc, 64, 36);
    expect(muxerState.created[2]?.options).not.toHaveProperty('audio');
  });
});

/** 假 WebCodecs（视频 + 音频） */
function installCodecs(options: { audioFailAt?: number } = {}) {
  const audioData: FakeAudioData[] = [];
  const audioEncoders: FakeAudioEncoder[] = [];
  class FakeFrame {
    constructor(
      public source: unknown,
      public init: { timestamp: number }
    ) {}
    close() {}
  }
  class FakeVideoEncoder {
    static isConfigSupported = async () => ({ supported: true });
    state = 'unconfigured';
    constructor(public init: { output: (chunk: unknown) => void }) {}
    configure() {
      this.state = 'configured';
    }
    encode(frame: FakeFrame) {
      this.init.output({ timestamp: frame.init.timestamp });
    }
    async flush() {}
    close() {
      this.state = 'closed';
    }
  }
  class FakeAudioData {
    closed = false;
    constructor(
      public init: {
        format: string;
        sampleRate: number;
        numberOfFrames: number;
        numberOfChannels: number;
        timestamp: number;
        data: Float32Array;
      }
    ) {
      audioData.push(this);
    }
    close() {
      this.closed = true;
    }
  }
  class FakeAudioEncoder {
    state = 'unconfigured';
    config: unknown;
    flushes = 0;
    constructor(
      public init: { output: (chunk: unknown, meta?: unknown) => void; error: (e: unknown) => void }
    ) {
      audioEncoders.push(this);
    }
    configure(config: unknown) {
      this.config = config;
      this.state = 'configured';
    }
    encode(data: FakeAudioData) {
      if (options.audioFailAt !== undefined && audioData.length === options.audioFailAt) {
        this.init.error(new Error('audio exploded'));
      }
      this.init.output({ timestamp: data.init.timestamp }, { decoderConfig: { codec: 'x' } });
    }
    async flush() {
      this.flushes += 1;
    }
    close() {
      this.state = 'closed';
    }
  }
  vi.stubGlobal('VideoEncoder', FakeVideoEncoder);
  vi.stubGlobal('VideoFrame', FakeFrame);
  vi.stubGlobal('AudioEncoder', FakeAudioEncoder);
  vi.stubGlobal('AudioData', FakeAudioData);
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  return { audioData, audioEncoders };
}

function timeline(durationMs: number): Timeline {
  return {
    width: 64,
    height: 36,
    transitionMs: 0,
    clips: [{ id: 'a', name: 'a', source: fakeImage(64, 36), durationMs }],
  };
}

/** 两个声道：左声道 = 帧序号，右声道 = 负帧序号，便于检查 planar 排布 */
function rampPcm(frames: number, sampleRate = 8000) {
  const left = new Float32Array(frames).map((_, i) => i);
  const right = new Float32Array(frames).map((_, i) => -i);
  return { sampleRate, channels: [left, right] };
}

describe('encodeTimeline 带声音', () => {
  it('声音按画面进度交错编码进同一个文件，planar 排布、时间戳连续，结束 flush', async () => {
    const { audioData, audioEncoders } = installCodecs();
    const pcm = rampPcm(2 * 8000);
    const result = await encodeTimeline(timeline(2000), {
      fps: 10,
      bitrate: 1e6,
      codec: avc,
      audio: { pcm, codec: AAC_PRESET, bitrate: 96_000 },
    });
    expect(result.hasAudio).toBe(true);
    const mux = muxerState.created[0];
    expect(mux?.options).toMatchObject({
      audio: { codec: 'aac', sampleRate: 8000, numberOfChannels: 2 },
    });
    expect(audioEncoders[0]?.config).toEqual({
      codec: 'mp4a.40.2',
      sampleRate: 8000,
      numberOfChannels: 2,
      bitrate: 96_000,
    });
    // 全部帧都编码了，块不超过 AUDIO_CHUNK_FRAMES，时间戳连续
    const total = audioData.reduce((sum, d) => sum + d.init.numberOfFrames, 0);
    expect(total).toBe(16000);
    expect(audioData.every((d) => d.init.numberOfFrames <= AUDIO_CHUNK_FRAMES)).toBe(true);
    let expectedStart = 0;
    for (const d of audioData) {
      expect(d.init.timestamp).toBe(Math.round((expectedStart / 8000) * 1e6));
      expect(d.init.format).toBe('f32-planar');
      // planar：先左声道再右声道
      expect(d.init.data[0]).toBe(expectedStart);
      expect(d.init.data[d.init.numberOfFrames]).toBe(-expectedStart);
      expectedStart += d.init.numberOfFrames;
    }
    expect(audioData.every((d) => d.closed)).toBe(true);
    // 每秒画面 flush 时声音跟上进度：音视频块交错写入，而不是全部画面之后才写声音
    expect(muxerState.sequence.indexOf('a')).toBeLessThan(muxerState.sequence.lastIndexOf('v'));
    expect(mux?.video).toHaveLength(20);
    expect(mux?.audio[0]?.meta).toEqual({ decoderConfig: { codec: 'x' } });
    expect(audioEncoders[0]?.flushes).toBe(1);
    expect(audioEncoders[0]?.state).toBe('closed');
  });

  it('不给声音时只有画面：hasAudio 为 false，不创建音频编码器', async () => {
    const { audioEncoders } = installCodecs();
    const result = await encodeTimeline(timeline(1000), { fps: 10, bitrate: 1e6, codec: avc });
    expect(result.hasAudio).toBe(false);
    expect(audioEncoders).toHaveLength(0);
    expect(muxerState.created[0]?.options).not.toHaveProperty('audio');
  });

  it('音频编码器出错时导出失败（不会悄悄丢掉声音）', async () => {
    const { audioEncoders } = installCodecs({ audioFailAt: 1 });
    await expect(
      encodeTimeline(timeline(2000), {
        fps: 10,
        bitrate: 1e6,
        codec: vp9,
        audio: { pcm: rampPcm(16000), codec: OPUS_PRESET },
      })
    ).rejects.toThrow('audio exploded');
    expect(audioEncoders[0]?.state).toBe('closed');
    expect(muxerState.created[0]?.finalized).toBe(false);
  });
});

describe('decodeAudioTrack / mixAudioPlan（假 WebAudio）', () => {
  interface Scheduled {
    when: number;
    offset: number;
    duration: number;
    buffer: unknown;
    ramps: [string, number, number][];
  }

  function installWebAudio(decode: (data: ArrayBuffer) => Promise<unknown>) {
    const scheduled: Scheduled[] = [];
    const contexts: { channels: number; length: number; sampleRate: number }[] = [];
    class FakeOfflineAudioContext {
      destination = {};
      constructor(
        public channels: number,
        public length: number,
        public sampleRate: number
      ) {
        contexts.push({ channels, length, sampleRate });
      }
      decodeAudioData(data: ArrayBuffer) {
        return decode(data);
      }
      createGain() {
        const ramps: [string, number, number][] = [];
        return {
          ramps,
          gain: {
            setValueAtTime: (value: number, time: number) => ramps.push(['set', value, time]),
            linearRampToValueAtTime: (value: number, time: number) =>
              ramps.push(['ramp', value, time]),
          },
          connect: () => undefined,
        };
      }
      createBufferSource() {
        const entry: Scheduled = { when: 0, offset: 0, duration: 0, buffer: null, ramps: [] };
        return {
          set buffer(value: unknown) {
            entry.buffer = value;
          },
          connect: (gain: { ramps: [string, number, number][] }) => {
            entry.ramps = gain.ramps;
          },
          start: (when: number, offset: number, duration: number) => {
            Object.assign(entry, { when, offset, duration });
            scheduled.push(entry);
          },
        };
      }
      async startRendering() {
        const data = [new Float32Array(this.length).fill(0.5)];
        return { numberOfChannels: 1, getChannelData: (i: number) => data[i] as Float32Array };
      }
    }
    vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
    return { scheduled, contexts };
  }

  it('decodeAudioTrack：复制字节后解码；没有音轨 / 解码失败 / 空 / 环境不支持时为 null', async () => {
    const decoded = { length: 10, duration: 1 };
    const seen: ArrayBuffer[] = [];
    installWebAudio(async (data) => {
      seen.push(data);
      return decoded;
    });
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await decodeAudioTrack(bytes)).toBe(decoded);
    expect(seen[0]).not.toBe(bytes.buffer);
    expect(await decodeAudioTrack(new Uint8Array())).toBeNull();

    installWebAudio(async () => {
      throw new Error('no audio track');
    });
    expect(await decodeAudioTrack(bytes)).toBeNull();
    installWebAudio(async () => ({ length: 0, duration: 0 }));
    expect(await decodeAudioTrack(bytes)).toBeNull();
    vi.stubGlobal('OfflineAudioContext', undefined);
    expect(await decodeAudioTrack(bytes)).toBeNull();
  });

  it('mixAudioPlan：按规划排程（起点 / 入点 / 时长 / 淡入淡出），单声道结果上混为双声道', async () => {
    const { scheduled, contexts } = installWebAudio(async () => null);
    const plan = planAudioTimeline(
      [
        { id: 'a', durationMs: 1000, audioDurationMs: 1000 },
        { id: 'b', durationMs: 1000 },
        { id: 'c', durationMs: 500, audioDurationMs: 2000, inPointMs: 250 },
      ],
      { transitionMs: 100 }
    );
    const bufferA = { name: 'A' };
    const bufferC = { name: 'C' };
    const buffers = new Map([
      ['a', bufferA as unknown as AudioBuffer],
      ['c', bufferC as unknown as AudioBuffer],
    ]);
    const pcm = await mixAudioPlan(plan, buffers, { sampleRate: 1000, numberOfChannels: 2 });
    expect(contexts[0]).toEqual({ channels: 2, length: 2500, sampleRate: 1000 });
    expect(scheduled.map((s) => [s.buffer, s.when, s.offset, s.duration])).toEqual([
      [bufferA, 0, 0, 1],
      [bufferC, 2, 0.25, 0.5],
    ]);
    expect(scheduled[0]?.ramps).toEqual([
      ['set', 0, 0],
      ['ramp', 1, 0.01],
      ['set', 1, 0.9],
      ['ramp', 0, 1],
    ]);
    expect(pcm.sampleRate).toBe(1000);
    expect(pcm.channels).toHaveLength(2);
    expect(pcm.channels[1]?.[0]).toBe(0.5);
    expect(pcm.channels[0]).not.toBe(pcm.channels[1]);
  });
});
