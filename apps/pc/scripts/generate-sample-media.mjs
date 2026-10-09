/**
 * 生成示例作品集的图片与视频（程序化插画，不依赖外部服务）：
 * - 人物：novels/星河旅人/资料/图集/人物/<名>/形象图.webp、三视图.webp
 * - 设定：novels/星河旅人/资料/图集/设定/<标题>/图片.webp
 * - 视频：novels/星河旅人/资料/视频/示例/离港.mp4（WebCodecs H.264 + mp4-muxer）
 * - 声音：novels/星河旅人/资料/音乐/（配乐、环境音）、资料/音效/（钟声、脚步、风帆），AAC（M4A）
 * - 场景视频「第一场 清晨的青石镇」：首帧、预演、成片、配音占位音、带声音的样片（见 sample-media/scene-media.mjs）
 *
 * 用法（在 apps/pc 下）：pnpm exec electron scripts/generate-sample-media.mjs [--only=images,video,audio,scene]
 * 只重新生成某几类时用 --only（其余文件保持不变，避免无关的二进制改动）。
 * 默认预览；[示例目录] --write 才将媒体、seed、内容哈希和版本一并发布。
 */
import { app, BrowserWindow } from 'electron';
import { tsImport } from 'tsx/esm/api';
/** @type {typeof import('./sample-media-generation.mts')} */
const { publishSampleMedia } = await tsImport('./sample-media-generation.mts', import.meta.url);
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLE_CHARACTER_ART, SAMPLE_LORE_ART } from './sample-media/characters.mjs';
import { generateSampleAudio, generateSceneMedia } from './sample-media/scene-media.mjs';

const ALL_PARTS = ['images', 'video', 'audio', 'scene'];
const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
const parts = new Set(onlyArg ? onlyArg.slice('--only='.length).split(',') : ALL_PARTS);

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const targets = args.filter((arg) => !arg.startsWith('--'));
const targetRoot = path.resolve(targets[0] || path.join(here, '..', 'sample-data'));
let workDir = '';
const require = createRequire(
  path.join(here, '..', '..', '..', 'packages', 'video', 'package.json')
);

export const SAMPLE_MEDIA_PATHS = {
  portrait: (/** @type {string} */ name) => `资料/图集/人物/${name}/形象图.webp`,
  turnaround: (/** @type {string} */ name) => `资料/图集/人物/${name}/三视图.webp`,
  lore: (/** @type {string} */ title) => `资料/图集/设定/${title}/图片.webp`,
  video: '资料/视频/示例/离港.mp4',
};

/** @param {string} relative @param {string} base64 */
async function save(relative, base64) {
  const target = path.join(workDir, relative);
  await mkdir(path.dirname(target), { recursive: true });
  const bytes = Buffer.from(base64, 'base64');
  await writeFile(target, bytes);
  console.log(`${relative}  ${(bytes.length / 1024).toFixed(1)} KB`);
}

async function main() {
  if (
    targets.length > 1 ||
    args.some((arg) => arg.startsWith('--') && arg !== '--write' && !arg.startsWith('--only=')) ||
    [...parts].some((part) => !ALL_PARTS.includes(part))
  ) {
    throw new Error(
      '用法：generate-sample-media.mjs [示例目录] [--only=images,video,audio,scene] [--write]；默认预览'
    );
  }

  // Window teardown must not terminate before async cleanup or the error exit code.
  app.on('window-all-closed', () => {});
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    webPreferences: { backgroundThrottling: false, offscreen: false },
  });
  // WebCodecs 只在安全上下文可用：data: 地址不行，用临时目录里的本地页面
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'novel-editor-sample-media-'));
  const page = path.join(temporary, 'index.html');
  try {
    await writeFile(page, '<!doctype html><html><body></body></html>');
    await win.loadFile(page);
    const scripts = await Promise.all(
      ['art.js', 'scene-art.js', 'audio.js', 'encode.js'].map((name) =>
        readFile(path.join(here, 'sample-media', name), 'utf-8')
      )
    );
    const muxer = await readFile(require.resolve('mp4-muxer'), 'utf-8');
    await win.webContents.executeJavaScript(`${muxer}\n;window.Mp4Muxer = Mp4Muxer; true`);
    for (const script of scripts) await win.webContents.executeJavaScript(`${script}\n;true`);

    /** @type {RenderImage} */
    const render = (fn, width, height, spec, quality) =>
      win.webContents.executeJavaScript(`(() => {
      const canvas = document.createElement('canvas');
      canvas.width = ${width};
      canvas.height = ${height};
      window.SampleArt.${fn}(canvas, ${JSON.stringify(spec ?? null)});
      return canvas.toDataURL('image/webp', ${quality}).split(',')[1];
    })()`);

    await publishSampleMedia(
      targetRoot,
      async (stage) => {
        workDir = path.join(stage, 'novels', '星河旅人');
        if (parts.has('audio')) await generateSampleAudio(win, save);
        if (parts.has('scene')) await generateSceneMedia(win, save);
        if (parts.has('images')) await generateImages(render);
        if (parts.has('video')) await generateVideo(win);
      },
      args.includes('--write')
    );
    console.log(
      args.includes('--write') ? '素材、种子和版本指纹已一起发布' : '预览通过；添加 --write 才发布'
    );
  } finally {
    win.destroy();
    await rm(temporary, { recursive: true, force: true });
  }
  app.quit();
}

/** @typedef {(fn: string, width: number, height: number, spec: (typeof SAMPLE_CHARACTER_ART)[number] | null, quality: number) => Promise<string>} RenderImage */
/** @param {RenderImage} render */
async function generateImages(render) {
  for (const spec of SAMPLE_CHARACTER_ART) {
    await save(
      SAMPLE_MEDIA_PATHS.portrait(spec.name),
      await render('renderPortrait', 600, 800, spec, 0.86)
    );
    await save(
      SAMPLE_MEDIA_PATHS.turnaround(spec.name),
      await render('renderTurnaround', 1280, 720, spec, 0.86)
    );
  }
  for (const lore of SAMPLE_LORE_ART) {
    await save(
      SAMPLE_MEDIA_PATHS.lore(lore.title),
      await render(lore.render, 1280, 720, null, 0.84)
    );
  }
}

/** @param {import("electron").BrowserWindow} win */
async function generateVideo(win) {
  const hero = SAMPLE_CHARACTER_ART.find((item) => item.name === '林舟');
  const video = await win.webContents.executeJavaScript(`(async () => {
    const width = 640;
    const height = 360;
    const fps = 30;
    const frames = fps * 5;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const target = new Mp4Muxer.ArrayBufferTarget();
    const muxer = new Mp4Muxer.Muxer({
      target,
      video: { codec: 'avc', width, height, frameRate: fps },
      fastStart: 'in-memory',
    });
    let failure = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (error) => { failure = error; },
    });
    const candidates = ['avc1.42E01F', 'avc1.4D401F', 'avc1.640028'];
    let codec = null;
    for (const value of candidates) {
      const support = await VideoEncoder.isConfigSupported({ codec: value, width, height, bitrate: 550000, framerate: fps });
      if (support.supported) { codec = value; break; }
    }
    if (!codec) throw new Error('当前 Electron 不支持 H.264 编码');
    encoder.configure({ codec, width, height, bitrate: 550000, framerate: fps, avc: { format: 'avc' } });
    const hero = ${JSON.stringify(hero)};
    for (let i = 0; i < frames; i += 1) {
      window.SampleArt.drawDepartureFrame(canvas, i / (frames - 1), hero);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      encoder.encode(frame, { keyFrame: i % 60 === 0 });
      frame.close();
      if (encoder.encodeQueueSize > 8) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await encoder.flush();
    if (failure) throw failure;
    muxer.finalize();
    const bytes = new Uint8Array(target.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  })()`);
  await save(SAMPLE_MEDIA_PATHS.video, video);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
