/**
 * 「拼接预览」：把选中镜头选用的成片版本拼成一条样片（WebCodecs，渲染进程本地完成，不上传任何内容）。
 * 还没有成片的镜头用占位卡（镜头号 + 景别 + 画面描述）代替，方便先看节奏。
 */
import type { Shot, Storyboard } from '@novel-editor/video';
import {
  animaticSize,
  buildAnimaticTimeline,
  createVideoElementSource,
  detectSupportedCodecs,
  encodeTimeline,
  isWebCodecsSupported,
  pickDefaultCodec,
  type ClipSource,
  type EncodeProgress,
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
}

const FPS = 24;
const BITRATE = 4_000_000;

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
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

export async function stitchAnimatic(input: StitchInput): Promise<StitchOutput> {
  if (!isWebCodecsSupported()) throw new Error('当前环境不支持 WebCodecs，无法拼接样片');
  const { width, height } = animaticSize(input.storyboard.aspectRatio, { longEdge: 1280 });
  const urls: string[] = [];
  const sources = new Map<string, ClipSource>();
  try {
    for (const shot of input.storyboard.shots) {
      const fileName = input.files.get(shot.id);
      if (!fileName) continue;
      const bytes = await input.readFile(fileName);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'video/mp4' }));
      urls.push(url);
      const video = await loadVideo(url);
      sources.set(shot.id, createVideoElementSource(video, { width, height }));
    }
    const timeline = buildAnimaticTimeline(input.storyboard, sources, { width, height });
    const codec = pickDefaultCodec(
      await detectSupportedCodecs({ width, height, fps: FPS, bitrate: BITRATE })
    );
    if (!codec) throw new Error('没有可用的视频编码格式');
    const result = await encodeTimeline(
      timeline,
      { fps: FPS, bitrate: BITRATE, codec, signal: input.signal },
      (progress: EncodeProgress) => input.onProgress?.(progress.percent)
    );
    const data = new Uint8Array(await result.blob.arrayBuffer());
    return { data, ext: result.fileExtension === 'webm' ? 'webm' : 'mp4' };
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
