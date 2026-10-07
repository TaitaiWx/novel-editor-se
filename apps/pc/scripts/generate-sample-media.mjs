/**
 * 生成示例作品集的图片与视频（程序化插画，不依赖外部服务）：
 * - 人物：novels/星河旅人/资料/图集/人物/<名>/形象图.webp、三视图.webp
 * - 设定：novels/星河旅人/资料/图集/设定/<标题>/图片.webp
 * - 视频：novels/星河旅人/资料/视频/示例/离港.mp4（WebCodecs H.264 + mp4-muxer）
 *
 * 用法（在 apps/pc 下）：pnpm exec electron scripts/generate-sample-media.mjs
 * 之后运行 generate-sample-data.mts 刷新 seed.json，再用 sample-content-hash.mts --bump 递增示例版本。
 */
import { app, BrowserWindow } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLE_CHARACTER_ART, SAMPLE_LORE_ART } from './sample-media/characters.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const workDir = path.join(here, '..', 'sample-data', 'novels', '星河旅人');
const require = createRequire(path.join(here, '..', '..', '..', 'packages', 'video', 'package.json'));

export const SAMPLE_MEDIA_PATHS = {
  portrait: (name) => `资料/图集/人物/${name}/形象图.webp`,
  turnaround: (name) => `资料/图集/人物/${name}/三视图.webp`,
  lore: (title) => `资料/图集/设定/${title}/图片.webp`,
  video: '资料/视频/示例/离港.mp4',
};

async function save(relative, base64) {
  const target = path.join(workDir, relative);
  await mkdir(path.dirname(target), { recursive: true });
  const bytes = Buffer.from(base64, 'base64');
  await writeFile(target, bytes);
  console.log(`${relative}  ${(bytes.length / 1024).toFixed(1)} KB`);
}

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    webPreferences: { backgroundThrottling: false, offscreen: false },
  });
  // WebCodecs 只在安全上下文可用：data: 地址不行，用临时目录里的本地页面
  const page = path.join(os.tmpdir(), 'novel-editor-sample-media.html');
  await writeFile(page, '<!doctype html><html><body></body></html>');
  await win.loadFile(page);
  const art = await readFile(path.join(here, 'sample-media', 'art.js'), 'utf-8');
  const muxer = await readFile(require.resolve('mp4-muxer'), 'utf-8');
  await win.webContents.executeJavaScript(`${art}\n;${muxer}\n;window.Mp4Muxer = Mp4Muxer; true`);

  const render = (fn, width, height, spec, quality) =>
    win.webContents.executeJavaScript(`(() => {
      const canvas = document.createElement('canvas');
      canvas.width = ${width};
      canvas.height = ${height};
      window.SampleArt.${fn}(canvas, ${JSON.stringify(spec ?? null)});
      return canvas.toDataURL('image/webp', ${quality}).split(',')[1];
    })()`);

  for (const spec of SAMPLE_CHARACTER_ART) {
    await save(SAMPLE_MEDIA_PATHS.portrait(spec.name), await render('renderPortrait', 600, 800, spec, 0.86));
    await save(SAMPLE_MEDIA_PATHS.turnaround(spec.name), await render('renderTurnaround', 1280, 720, spec, 0.86));
  }
  for (const lore of SAMPLE_LORE_ART) {
    await save(SAMPLE_MEDIA_PATHS.lore(lore.title), await render(lore.render, 1280, 720, null, 0.84));
  }

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
  win.destroy();
  app.quit();
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
