/* eslint-disable */
/**
 * 示例作品集的程序化声音（在 Electron 隐藏窗口里运行，见 ../generate-sample-media.mjs）：
 * - 配乐：五声音阶的轻柔旋律 + 和声铺底 + 轻打击，首尾淡入淡出，可循环
 * - 环境音：海港（浪声 + 海鸥）、清晨小镇（微风 + 鸟鸣 + 屋檐滴水）
 * - 音效：钟声、木板脚步、风帆
 * - 配音占位音：哼唱式的元音共振峰（「示例占位音」，不是真人语音），演示对白配音的位置与时长
 * 只用纯数学合成（伪随机由固定种子生成），结果完全确定；编码为 AAC（M4A，mp4-muxer 封装）。
 */
(function () {
  'use strict';

  const SR = 44100;

  /** 固定种子的伪随机（mulberry32） */
  function seeded(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buffer(seconds) {
    return new Float32Array(Math.round(seconds * SR));
  }

  /** 一阶低通（就地） */
  function lowpass(data, cutoff) {
    const k = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
    let y = 0;
    for (let i = 0; i < data.length; i += 1) {
      y += k * (data[i] - y);
      data[i] = y;
    }
    return data;
  }

  /** 二阶带通（共振峰），返回新数组 */
  function bandpass(data, freq, q) {
    const w = (2 * Math.PI * freq) / SR;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    const b0 = alpha / a0;
    const b2 = -alpha / a0;
    const a1 = (-2 * Math.cos(w)) / a0;
    const a2 = (1 - alpha) / a0;
    const out = new Float32Array(data.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < data.length; i += 1) {
      const x = data[i];
      const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      out[i] = y;
    }
    return out;
  }

  /** 首尾淡入淡出（秒） */
  function fade(data, fadeIn, fadeOut) {
    const nIn = Math.round(fadeIn * SR);
    const nOut = Math.round(fadeOut * SR);
    for (let i = 0; i < nIn && i < data.length; i += 1) data[i] *= i / nIn;
    for (let i = 0; i < nOut && i < data.length; i += 1) data[data.length - 1 - i] *= i / nOut;
    return data;
  }

  /** 归一化到峰值 peak */
  function normalize(data, peak) {
    let max = 0;
    for (let i = 0; i < data.length; i += 1) max = Math.max(max, Math.abs(data[i]));
    if (max > 0) for (let i = 0; i < data.length; i += 1) data[i] *= peak / max;
    return data;
  }

  /** 加一个音符：正弦 + 少量泛音，ADSR 包络 */
  function addTone(data, start, length, freq, gain, options) {
    const opts = options || {};
    const attack = opts.attack ?? 0.02;
    const release = opts.release ?? 0.4;
    const harmonics = opts.harmonics || [1, 0.3, 0.12];
    const vibrato = opts.vibrato ?? 0;
    const from = Math.round(start * SR);
    const total = Math.round((length + release) * SR);
    let phase = 0;
    for (let n = 0; n < total && from + n < data.length; n += 1) {
      const t = n / SR;
      const env =
        t < attack
          ? t / attack
          : t < length
            ? 1 - 0.25 * ((t - attack) / Math.max(0.001, length - attack))
            : 0.75 * Math.exp((-(t - length) * 5) / release);
      const f = freq * (1 + vibrato * Math.sin(2 * Math.PI * 5 * t));
      phase += (2 * Math.PI * f) / SR;
      let v = 0;
      for (let h = 0; h < harmonics.length; h += 1) v += harmonics[h] * Math.sin(phase * (h + 1));
      data[from + n] += v * env * gain;
    }
  }

  const NOTE = (semitones) => 261.63 * Math.pow(2, semitones / 12);
  // C 大调五声音阶：C D E G A
  const PENTA = [0, 2, 4, 7, 9, 12, 14, 16];

  /** 配乐：约 10 秒，90 BPM，旋律 + 和声铺底 + 轻打击 */
  function renderBgm() {
    const seconds = 10.67; // 4 小节 × 4 拍 × (60/90)
    const data = buffer(seconds);
    const beat = 60 / 90;
    // 和声铺底：C - Am - F - G（每小节一个和弦，慢起慢收）
    const chords = [
      [0, 4, 7],
      [-3, 0, 4],
      [-7, -3, 0],
      [-5, -1, 2],
    ];
    chords.forEach((chord, bar) => {
      for (const note of chord) {
        addTone(data, bar * 4 * beat, 4 * beat - 0.2, NOTE(note - 12), 0.06, {
          attack: 0.6,
          release: 0.8,
          harmonics: [1, 0.15],
        });
      }
    });
    // 旋律：每拍一个音（偶尔两拍），由固定种子在五声音阶里走动
    const random = seeded(17);
    let index = 3;
    for (let step = 0; step < 16; step += 1) {
      if (step % 4 === 3 && random() < 0.5) continue;
      index = Math.max(0, Math.min(PENTA.length - 1, index + Math.round((random() - 0.5) * 3)));
      const long = step % 8 === 7;
      addTone(data, step * beat, long ? beat * 1.6 : beat * 0.8, NOTE(PENTA[index]), 0.16, {
        attack: 0.015,
        release: 0.5,
        harmonics: [1, 0.25, 0.08],
        vibrato: 0.003,
      });
    }
    // 轻打击：每拍一个低沉的「咚」，反拍上一点沙沙声
    const noise = seeded(29);
    for (let step = 0; step < 16; step += 1) {
      const from = Math.round(step * beat * SR);
      const kickGain = step % 4 === 0 ? 0.22 : 0.1;
      for (let n = 0; n < SR * 0.25 && from + n < data.length; n += 1) {
        const t = n / SR;
        data[from + n] += Math.sin(2 * Math.PI * (55 + 50 * Math.exp(-t * 30)) * t) * Math.exp(-t * 14) * kickGain;
      }
      const off = Math.round((step + 0.5) * beat * SR);
      for (let n = 0; n < SR * 0.06 && off + n < data.length; n += 1) {
        data[off + n] += (noise() * 2 - 1) * Math.exp((-n / SR) * 60) * 0.03;
      }
    }
    return fade(normalize(data, 0.7), 1, 1.5);
  }

  /** 鸟鸣 / 海鸥：一段带颤音的下滑音 */
  function addChirp(data, start, from, to, length, gain) {
    const begin = Math.round(start * SR);
    let phase = 0;
    for (let n = 0; n < length * SR && begin + n < data.length; n += 1) {
      const s = n / (length * SR);
      const f = from + (to - from) * s + 40 * Math.sin(2 * Math.PI * 28 * (n / SR));
      phase += (2 * Math.PI * f) / SR;
      const env = Math.sin(Math.PI * s) ** 1.5;
      data[begin + n] += (Math.sin(phase) + 0.3 * Math.sin(phase * 2)) * env * gain;
    }
  }

  function noiseBuffer(seconds, seed) {
    const data = buffer(seconds);
    const random = seeded(seed);
    for (let i = 0; i < data.length; i += 1) data[i] = random() * 2 - 1;
    return data;
  }

  /** 海港：浪声（缓慢起伏的低频噪声）+ 几声海鸥 */
  function renderHarbor() {
    const seconds = 7;
    const waves = lowpass(lowpass(noiseBuffer(seconds, 41), 500), 900);
    for (let i = 0; i < waves.length; i += 1) {
      const t = i / SR;
      waves[i] *= 0.55 + 0.45 * Math.sin(2 * Math.PI * 0.16 * t - 1.2) ** 2;
    }
    normalize(waves, 0.45);
    for (const [start, from, to] of [
      [1.1, 1900, 1300],
      [1.45, 1800, 1250],
      [4.2, 2100, 1400],
      [5.6, 1850, 1300],
      [5.9, 1750, 1200],
    ]) {
      addChirp(waves, start, from, to, 0.28, 0.1);
    }
    return fade(normalize(waves, 0.6), 0.8, 0.8);
  }

  /** 清晨小镇：微风 + 鸟鸣 + 屋檐滴水 */
  function renderTown() {
    const seconds = 7;
    const wind = lowpass(lowpass(noiseBuffer(seconds, 53), 300), 600);
    for (let i = 0; i < wind.length; i += 1) {
      wind[i] *= 0.6 + 0.4 * Math.sin(2 * Math.PI * 0.1 * (i / SR));
    }
    normalize(wind, 0.18);
    const random = seeded(61);
    for (let k = 0; k < 9; k += 1) {
      const start = 0.4 + k * 0.72 + random() * 0.2;
      const base = 3200 + random() * 900;
      addChirp(wind, start, base, base - 900, 0.09 + random() * 0.05, 0.07);
    }
    // 滴水：短促的「叮」
    for (const start of [0.9, 2.6, 3.3, 5.1, 6.2]) {
      addTone(wind, start, 0.01, 1180 + start * 37, 0.08, { attack: 0.002, release: 0.12, harmonics: [1, 0.2] });
    }
    return fade(normalize(wind, 0.55), 0.6, 0.8);
  }

  /** 钟声：不协和泛音，缓慢衰减 */
  function renderBell() {
    const data = buffer(1.8);
    const partials = [
      [1, 1, 1.4],
      [2, 0.5, 2.2],
      [2.4, 0.35, 2.8],
      [3, 0.25, 3.6],
      [4.2, 0.18, 5],
    ];
    for (let i = 0; i < data.length; i += 1) {
      const t = i / SR;
      let v = 0;
      for (const [ratio, gain, decay] of partials) v += gain * Math.sin(2 * Math.PI * 392 * ratio * t) * Math.exp(-t * decay);
      data[i] = v * Math.min(1, t / 0.004);
    }
    return fade(normalize(data, 0.7), 0, 0.2);
  }

  /** 木板脚步：三步，每步一声闷响 + 木头敲击 */
  function renderFootsteps() {
    const data = buffer(1.3);
    const random = seeded(73);
    [0.05, 0.47, 0.88].forEach((start, index) => {
      const from = Math.round(start * SR);
      for (let n = 0; n < SR * 0.18 && from + n < data.length; n += 1) {
        const t = n / SR;
        const thump = Math.sin(2 * Math.PI * (95 - index * 5) * t) * Math.exp(-t * 28);
        const knock = Math.sin(2 * Math.PI * 410 * t) * Math.exp(-t * 60) * 0.5;
        const grit = (random() * 2 - 1) * Math.exp(-t * 45) * 0.35;
        data[from + n] += (thump + knock + grit) * (index === 1 ? 0.85 : 1);
      }
    });
    return normalize(lowpass(data, 2400), 0.75);
  }

  /** 风帆：被风吹得一鼓一鼓的噪声 */
  function renderSail() {
    const seconds = 1.1;
    const data = lowpass(noiseBuffer(seconds, 89), 1600);
    for (let i = 0; i < data.length; i += 1) {
      const t = i / SR;
      const flap = Math.max(0, Math.sin(2 * Math.PI * 7 * t)) ** 3;
      data[i] *= 0.15 + flap * Math.exp(-t * 1.6);
    }
    return fade(normalize(data, 0.7), 0.02, 0.25);
  }

  /** 配音占位音：声门脉冲（锯齿）+ 两个元音共振峰，音节起伏；明显不是真人语音 */
  function renderVoice(pitch, seconds) {
    const data = buffer(seconds + 0.2);
    const syllables = Math.max(1, Math.round(seconds * 3.2));
    let phase = 0;
    for (let i = 0; i < data.length; i += 1) {
      const t = i / SR;
      const s = Math.min(1, t / seconds);
      const f = pitch * (1 + 0.08 * Math.sin(Math.PI * s) - 0.06 * s);
      phase = (phase + f / SR) % 1;
      const syllable = (t * syllables) / seconds;
      const env = t < seconds ? Math.sin(Math.PI * (syllable % 1)) ** 0.6 : 0;
      data[i] = (2 * phase - 1) * env;
    }
    const a = bandpass(data, 750, 4);
    const o = bandpass(data, 1150, 5);
    const mixed = new Float32Array(data.length);
    for (let i = 0; i < data.length; i += 1) mixed[i] = a[i] + 0.6 * o[i] + 0.05 * data[i];
    return fade(normalize(lowpass(mixed, 3000), 0.6), 0.03, 0.12);
  }

  /** 混音：把 source 叠加到 target 的 at 秒处（gain 倍） */
  function mixInto(target, source, at, gain) {
    const from = Math.round(at * SR);
    for (let i = 0; i < source.length && from + i < target.length; i += 1) {
      if (from + i >= 0) target[from + i] += source[i] * gain;
    }
    return target;
  }

  function toBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }

  /** 把单声道样本编码进 AudioEncoder（AAC），每块 1024 帧 */
  async function feedAudio(samples, onChunk, requested) {
    const bitrate = Math.max(48000, requested || 0);
    let failure = null;
    const encoder = new AudioEncoder({ output: onChunk, error: (error) => { failure = error; } });
    encoder.configure({ codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: 1, bitrate });
    for (let offset = 0; offset < samples.length; offset += 1024) {
      const frame = samples.subarray(offset, Math.min(samples.length, offset + 1024));
      const data = new AudioData({
        format: 'f32-planar',
        sampleRate: SR,
        numberOfFrames: frame.length,
        numberOfChannels: 1,
        timestamp: Math.round((offset / SR) * 1e6),
        data: new Float32Array(frame),
      });
      encoder.encode(data);
      data.close();
    }
    await encoder.flush();
    encoder.close();
    if (failure) throw failure;
  }

  /** 单声道样本 → M4A（AAC，mp4-muxer 封装），返回 base64 */
  // macOS 的 AAC 编码器（AudioToolbox）在 44.1kHz 单声道低于 48kbps 时不报错也不输出（flush 永远不返回），这里统一夹到 48kbps
  const MIN_AAC_BITRATE = 48000;

  async function encodeM4a(samples, requested) {
    const bitrate = Math.max(MIN_AAC_BITRATE, requested || 0);
    const support = await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: 1, bitrate });
    if (!support.supported) throw new Error('当前 Electron 不支持 AAC 编码');
    const target = new Mp4Muxer.ArrayBufferTarget();
    const muxer = new Mp4Muxer.Muxer({
      target,
      audio: { codec: 'aac', numberOfChannels: 1, sampleRate: SR },
      fastStart: 'in-memory',
    });
    await feedAudio(samples, (chunk, meta) => muxer.addAudioChunk(chunk, meta), bitrate);
    muxer.finalize();
    return toBase64(new Uint8Array(target.buffer));
  }

  window.SampleAudio = {
    SR,
    renderBgm,
    renderHarbor,
    renderTown,
    renderBell,
    renderFootsteps,
    renderSail,
    renderVoice,
    mixInto,
    feedAudio,
    encodeM4a,
    toBase64,
  };
})();
