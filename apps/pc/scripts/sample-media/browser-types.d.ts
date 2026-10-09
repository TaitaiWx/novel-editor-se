/** Browser globals installed in order by generate-sample-media.mjs. The muxer is resolved
 * from the video package's declared dependency, matching the generator's createRequire. */
type SampleCharacter = (typeof import('./characters.mjs').SAMPLE_CHARACTER_ART)[number];
type CharacterView = 'front' | 'side' | 'back';
type CanvasPaint = string | CanvasGradient | CanvasPattern;
type SampleSoundEffect = 'bell' | 'footsteps' | 'sail';
type SampleAudioCue = { at: number; gain: number } & (
  | { voice: { pitch: number; seconds: number }; sfx?: never }
  | { voice?: never; sfx: SampleSoundEffect }
);
interface SampleSceneMix {
  from: number;
  length: number;
  cues: SampleAudioCue[];
  fadeIn: number;
  fadeOut: number;
}
interface SampleEncodeOptions {
  width: number;
  height: number;
  fps: number;
  frames: number;
  bitrate?: number;
  bitrateMode?: VideoEncoderBitrateMode;
  quantizer?: number;
  keyFrame?: (index: number) => boolean;
  draw(canvas: HTMLCanvasElement, index: number): void;
  audio?: Float32Array;
  audioBitrate?: number;
}
interface SampleArtApi {
  renderPortrait(canvas: HTMLCanvasElement, spec: SampleCharacter): void;
  renderTurnaround(canvas: HTMLCanvasElement, spec: SampleCharacter): void;
  renderLighthouse(canvas: HTMLCanvasElement): void;
  renderHarbor(canvas: HTMLCanvasElement): void;
  drawDepartureFrame(canvas: HTMLCanvasElement, t: number, hero: SampleCharacter): void;
  drawCharacter(
    ctx: CanvasRenderingContext2D,
    spec: SampleCharacter,
    view: CharacterView,
    cx: number,
    footY: number,
    height: number
  ): void;
  drawMountains(
    ctx: CanvasRenderingContext2D,
    width: number,
    baseY: number,
    color: CanvasPaint,
    seed: number,
    amplitude: number
  ): void;
  groundShadow(ctx: CanvasRenderingContext2D, cx: number, y: number, width: number): void;
  vignette(ctx: CanvasRenderingContext2D, width: number, height: number, strength: number): void;
  ellipse(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    rx: number,
    ry: number,
    fill: CanvasPaint | null,
    stroke?: CanvasPaint | null,
    lineWidth?: number,
    rotation?: number
  ): void;
  seeded(seed: number): () => number;
  mix(a: string, b: string, t: number): string;
  rgba(hex: string, alpha: number): string;
}
interface SampleAudioApi {
  SR: number;
  renderBgm(): Float32Array;
  renderHarbor(): Float32Array;
  renderTown(): Float32Array;
  renderBell(): Float32Array;
  renderFootsteps(): Float32Array;
  renderSail(): Float32Array;
  renderVoice(pitch: number, seconds: number): Float32Array;
  mixInto(target: Float32Array, source: Float32Array, at: number, gain: number): Float32Array;
  renderSceneMix(spec: SampleSceneMix): Float32Array;
  feedAudio(
    samples: Float32Array,
    onChunk: EncodedAudioChunkOutputCallback,
    requested?: number
  ): Promise<void>;
  encodeM4a(samples: Float32Array, requested?: number): Promise<string>;
  toBase64(bytes: Uint8Array): string;
}
interface Window {
  SampleArt: SampleArtApi;
  SampleAudio: SampleAudioApi;
  SampleEncode: { encodeMp4(options: SampleEncodeOptions): Promise<string> };
  SampleScene: {
    drawShotFrame(
      canvas: HTMLCanvasElement,
      shot: number,
      t: number,
      specs: SampleCharacter[]
    ): void;
    drawPrevizFrame(canvas: HTMLCanvasElement, t: number): void;
  };
}
declare const SampleAudio: SampleAudioApi;
declare const Mp4Muxer: typeof import('../../../../../packages/video/node_modules/mp4-muxer');
