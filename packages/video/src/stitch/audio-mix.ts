/**
 * 样片声音：解码素材声音（WebAudio decodeAudioData）、按规划混音（OfflineAudioContext）。
 * 只能在渲染进程（有 WebAudio 的环境）中运行；没有音轨或解码失败的素材视为静音，不会让导出失败。
 */
import { AUDIO_SAMPLE_RATE, DEFAULT_AUDIO_FORMAT, type AudioFormat } from './audio-codecs';
import type { AudioTimelinePlan } from './audio-plan';
import type { SceneMixPlan } from './audio-scene-plan';
import type { PcmAudio } from './types';

export function isWebAudioSupported(): boolean {
  return typeof OfflineAudioContext !== 'undefined';
}

/**
 * 解码一个素材文件的声音（重采样到 sampleRate）。没有音轨、无法解码或环境不支持时返回 null。
 * decodeAudioData 会转移传入的缓冲区，这里先复制一份，不影响调用方的字节。
 */
export async function decodeAudioTrack(
  bytes: Uint8Array,
  sampleRate: number = AUDIO_SAMPLE_RATE
): Promise<AudioBuffer | null> {
  if (!isWebAudioSupported() || bytes.byteLength === 0) return null;
  try {
    const context = new OfflineAudioContext(1, 1, sampleRate);
    const copy = bytes.slice().buffer;
    const buffer = await context.decodeAudioData(copy);
    return buffer.length > 0 && buffer.duration > 0 ? buffer : null;
  } catch {
    return null;
  }
}

/** 按规划把各片段的声音放到时间轴上并混成一条（单声道素材自动上混） */
export async function mixAudioPlan(
  plan: AudioTimelinePlan,
  buffers: ReadonlyMap<string, AudioBuffer>,
  format: Pick<AudioFormat, 'sampleRate' | 'numberOfChannels'> = DEFAULT_AUDIO_FORMAT
): Promise<PcmAudio> {
  const { sampleRate, numberOfChannels } = format;
  const frames = Math.max(1, Math.ceil((plan.durationMs / 1000) * sampleRate));
  const context = new OfflineAudioContext(numberOfChannels, frames, sampleRate);
  for (const segment of plan.segments) {
    const buffer = buffers.get(segment.clipId);
    if (!buffer) continue;
    const start = segment.startMs / 1000;
    const duration = segment.durationMs / 1000;
    const end = start + duration;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    const fadeIn = segment.fadeInMs / 1000;
    const fadeOut = segment.fadeOutMs / 1000;
    gain.gain.setValueAtTime(fadeIn > 0 ? 0 : 1, start);
    if (fadeIn > 0) gain.gain.linearRampToValueAtTime(1, start + fadeIn);
    if (fadeOut > 0) {
      gain.gain.setValueAtTime(1, end - fadeOut);
      gain.gain.linearRampToValueAtTime(0, end);
    }
    source.connect(gain);
    gain.connect(context.destination);
    source.start(start, segment.offsetMs / 1000, duration);
  }
  const rendered = await context.startRendering();
  const channels: Float32Array[] = [];
  for (let index = 0; index < numberOfChannels; index += 1) {
    channels.push(rendered.getChannelData(Math.min(index, rendered.numberOfChannels - 1)).slice());
  }
  return { sampleRate, channels };
}

/**
 * 按完整混音规划（planSceneAudioMix）混音：成片原声 / 对白 / 音效 / 配乐（循环 + 淡入淡出 + 压低）/ 环境音。
 * 增益折线逐点写成 setValueAtTime + linearRampToValueAtTime；缺少素材的声音直接跳过（不会让导出失败）。
 */
export async function mixScenePlan(
  plan: SceneMixPlan,
  buffers: ReadonlyMap<string, AudioBuffer>,
  format: Pick<AudioFormat, 'sampleRate' | 'numberOfChannels'> = DEFAULT_AUDIO_FORMAT
): Promise<PcmAudio> {
  const { sampleRate, numberOfChannels } = format;
  const frames = Math.max(1, Math.ceil((plan.durationMs / 1000) * sampleRate));
  const context = new OfflineAudioContext(numberOfChannels, frames, sampleRate);
  for (const voice of plan.voices) {
    const buffer = buffers.get(voice.sourceId);
    if (!buffer || voice.durationMs <= 0) continue;
    const start = voice.startMs / 1000;
    const end = start + voice.durationMs / 1000;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    const [first, ...rest] = voice.gain;
    gain.gain.setValueAtTime(first?.value ?? 1, (first?.timeMs ?? voice.startMs) / 1000);
    for (const point of rest) gain.gain.linearRampToValueAtTime(point.value, point.timeMs / 1000);
    source.connect(gain);
    gain.connect(context.destination);
    if (voice.loop) {
      source.loop = true;
      source.start(start, voice.offsetMs / 1000);
      source.stop(end);
    } else {
      source.start(start, voice.offsetMs / 1000, voice.durationMs / 1000);
    }
  }
  const rendered = await context.startRendering();
  const channels: Float32Array[] = [];
  for (let index = 0; index < numberOfChannels; index += 1) {
    channels.push(rendered.getChannelData(Math.min(index, rendered.numberOfChannels - 1)).slice());
  }
  return { sampleRate, channels };
}
