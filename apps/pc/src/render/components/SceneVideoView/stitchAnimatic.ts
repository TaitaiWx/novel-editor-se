/**
 * 「拼接预览」：把选中镜头选用的成片版本拼成一条样片（WebCodecs，渲染进程本地完成，不上传任何内容）。
 * 还没有成片的镜头用占位卡（镜头号 + 景别 + 画面描述）代替，方便先看节奏。
 * 成片自带的声音会保留：按镜头的起点 / 时长混音后编码进样片（MP4 用 AAC；AAC 不可用时改用
 * WebM + Opus）；都不可用时只导出画面并返回 audioDropped，由调用方提示作者。
 */
import type { Shot, Storyboard } from '@novel-editor/video';
import {
  animaticSize,
  buildAnimaticTimeline,
  chooseAudioEncoding,
  createVideoElementSource,
  decodeAudioTrack,
  detectSupportedCodecs,
  encodeTimeline,
  isWebCodecsSupported,
  mixAudioPlan,
  pickDefaultCodec,
  planAudioTimeline,
  type ClipSource,
  type EncodeAudioOptions,
  type EncodeProgress,
  type Timeline,
} from '@novel-editor/video/stitch';

export interface StitchInput {
  storyboard: Storyboard;
  /** 镜头 id → 成片文件名（没有的镜头用占位卡） */
  files: ReadonlyMap<string, string>;
  readFile: (fileName: string) => Promise<Uint8Array>;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}

export interface StitchOutput {
  data: Uint8Array;
  ext: 'mp4' | 'webm';
  /** 样片是否带声音 */
  hasAudio: boolean;
  /** 成片有声音，但当前环境无法编码音频，样片只有画面 */
  audioDropped: boolean;
}

const FPS = 24;
const BITRATE = 4_000_000;

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    // 这个 video 只用来逐帧取画面（不播放），静音不影响样片的声音：声音另行从原始字节解码混音
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    const cleanup = () => {
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('error', onError);
    };
    const onLoaded = () => {
      cleanup();
      resolve(video);
    };
    const onError = () => {
      cleanup();
      reject(new Error('无法解码视频文件'));
    };
    video.addEventListener('loadeddata', onLoaded);
    video.addEventListener('error', onError);
    video.src = url;
  });
}

export function canStitchAnimatic(): boolean {
  return isWebCodecsSupported();
}

/** 解码各镜头成片的声音并按时间轴混音；没有任何声音时返回 null */
async function mixTimelineAudio(
  timeline: Timeline,
  clipBytes: ReadonlyMap<string, Uint8Array>
): Promise<EncodeAudioOptions['pcm'] | null> {
  const buffers = new Map<string, AudioBuffer>();
  for (const [id, bytes] of clipBytes) {
    const buffer = await decodeAudioTrack(bytes);
    if (buffer) buffers.set(id, buffer);
  }
  const plan = planAudioTimeline(
    timeline.clips.map((clip) => ({
      id: clip.id,
      durationMs: clip.durationMs,
      startMs: clip.startMs,
      audioDurationMs: (buffers.get(clip.id)?.duration ?? 0) * 1000,
    })),
    { transitionMs: timeline.transitionMs }
  );
  return plan.hasAudio ? mixAudioPlan(plan, buffers) : null;
}

export async function stitchAnimatic(input: StitchInput): Promise<StitchOutput> {
  if (!isWebCodecsSupported()) throw new Error('当前环境不支持 WebCodecs，无法拼接样片');
  const { width, height } = animaticSize(input.storyboard.aspectRatio, { longEdge: 1280 });
  const urls: string[] = [];
  const sources = new Map<string, ClipSource>();
  const clipBytes = new Map<string, Uint8Array>();
  try {
    for (const shot of input.storyboard.shots) {
      const fileName = input.files.get(shot.id);
      if (!fileName) continue;
      const bytes = await input.readFile(fileName);
      clipBytes.set(shot.id, bytes);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'video/mp4' }));
      urls.push(url);
      const video = await loadVideo(url);
      sources.set(shot.id, createVideoElementSource(video, { width, height }));
    }
    const timeline = buildAnimaticTimeline(input.storyboard, sources, { width, height });
    const supported = await detectSupportedCodecs({ width, height, fps: FPS, bitrate: BITRATE });
    const preferred = pickDefaultCodec(supported);
    if (!preferred) throw new Error('没有可用的视频编码格式');
    const pcm = await mixTimelineAudio(timeline, clipBytes);
    const choice = await chooseAudioEncoding({
      video: preferred,
      supportedVideo: supported,
      hasAudio: pcm !== null,
    });
    const audio = pcm && choice.audio ? { pcm, codec: choice.audio } : undefined;
    const result = await encodeTimeline(
      timeline,
      { fps: FPS, bitrate: BITRATE, codec: choice.video, audio, signal: input.signal },
      (progress: EncodeProgress) => input.onProgress?.(progress.percent)
    );
    const data = new Uint8Array(await result.blob.arrayBuffer());
    return {
      data,
      ext: result.fileExtension === 'webm' ? 'webm' : 'mp4',
      hasAudio: result.hasAudio,
      audioDropped: choice.audioDropped,
    };
  } finally {
    urls.forEach((url) => URL.revokeObjectURL(url));
  }
}

/** 选中镜头（保持分镜顺序）组成的样片分镜 */
export function animaticStoryboard(
  storyboard: Storyboard,
  selectedIds: readonly string[]
): Storyboard {
  const selected = new Set(selectedIds);
  const shots: Shot[] = storyboard.shots.filter(
    (shot) => selected.has(shot.id) && shot.description.trim()
  );
  return { ...storyboard, shots };
}
