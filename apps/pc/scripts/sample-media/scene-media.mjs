/**
 * 生成示例声音与「第一场 清晨的青石镇」场景视频的媒体（在 generate-sample-media.mjs 打开的隐藏窗口里执行）：
 * - 声音：资料/音乐/（配乐、两段环境音）、资料/音效/（钟声、木板脚步、风帆）
 * - 场景目录：每个镜头的首帧图（960 × 540）、镜头 1 的预演（第一帧 PNG + 无声的预演视频）、
 *   镜头 1 / 2 的成片（带这一段的混音）、配音占位音（镜头N-台词-<id>.m4a）、带声音的样片；视频都是 1280 × 720、24 帧
 * 文件名与镜头来自 ./scene.mjs（分镜.json 由 generate-sample-data.mts 按同一份描述写入）。
 */
import { SAMPLE_CHARACTER_ART } from './characters.mjs';
import { SAMPLE_AUDIO, SAMPLE_SCENE, samplePrevizFile, sampleVoiceFile } from './scene.mjs';

/** 16:9 的成片、预演与样片统一 1280 × 720、24 帧 */
const W = 1280;
const H = 720;
const FPS = 24;
/** 首帧图（WebP）与画布缩略图同尺寸即可，比成片小一档以控制示例体积 */
const KW = 960;
const KH = 540;
/**
 * H.264 固定量化参数（QP，越小越清楚）：平涂插画在 720p 下这个 QP 边缘仍清楚，
 * 静止画面（样片里镜头 3–5 停在首帧）的 P 帧几乎不占字节。预演是灰模网格，可以更粗一点。
 */
const SHOT_QP = 28;
const PREVIZ_QP = 32;
/** 声音：单声道 AAC（macOS 编码器 44.1kHz 单声道低于 48kbps 会卡死，不能再低） */
const AUDIO_BITRATE = 48_000;

/** 在页面里执行一段返回 base64 的脚本 */
/** @param {import("electron").BrowserWindow} win @param {string} code @returns {Promise<string>} */
const run = (win, code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);

const specs = JSON.stringify(
  SAMPLE_CHARACTER_ART.filter((item) => SAMPLE_SCENE.characters.includes(item.name))
);

/** @param {import("electron").BrowserWindow} win @param {(relative: string, base64: string) => Promise<void>} save */
export async function generateSampleAudio(win, save) {
  /** @type {[string, string, number][]} */
  const items = [
    [SAMPLE_AUDIO.bgm, 'renderBgm()', 48000],
    [SAMPLE_AUDIO.harbor, 'renderHarbor()', 48000],
    [SAMPLE_AUDIO.town, 'renderTown()', 48000],
    [SAMPLE_AUDIO.bell, 'renderBell()', 48000],
    [SAMPLE_AUDIO.footsteps, 'renderFootsteps()', 48000],
    [SAMPLE_AUDIO.sail, 'renderSail()', 48000],
  ];
  for (const [relative, render, bitrate] of items) {
    await save(
      relative,
      await run(win, `return SampleAudio.encodeM4a(SampleAudio.${render}, ${bitrate});`)
    );
  }
}

/** 页面里重建每句配音占位音与样片混音用到的声音（与单独保存的文件同一套合成） */
/** @param {{pitch: number, seconds: number}} voice */
function voiceExpression(voice) {
  return `SampleAudio.renderVoice(${voice.pitch}, ${voice.seconds})`;
}

/** @param {import("electron").BrowserWindow} win @param {(relative: string, base64: string) => Promise<void>} save */
export async function generateSceneMedia(win, save) {
  const dir = SAMPLE_SCENE.dir;
  const shots = SAMPLE_SCENE.shots;

  // 场景时间轴：每个镜头的起点（秒），以及每个镜头的声音提示（绝对时间）
  /** @type {number[]} */
  const starts = [];
  let total = 0;
  for (const shot of shots) {
    starts.push(total);
    total += shot.durationSec;
  }
  const shotCues = shots.map((shot, index) => [
    ...shot.dialogue
      .filter((line) => 'voice' in line && line.voice)
      .map((line) => ({
        at: starts[index] + line.startSec,
        gain: 0.9,
        voice: 'voice' in line ? line.voice : undefined,
      })),
    ...shot.sfx.map((cue) => ({ at: starts[index] + cue.atSec, gain: cue.volume, sfx: cue.file })),
  ]);

  // 首帧：每个镜头 t = 0 的画面（WebP）
  for (const shot of shots) {
    const image = await run(
      win,
      `const canvas = document.createElement('canvas');
       canvas.width = ${KW}; canvas.height = ${KH};
       SampleScene.drawShotFrame(canvas, ${shot.number}, 0, ${specs});
       return canvas.toDataURL('image/webp', 0.8).split(',')[1];`
    );
    await save(`${dir}/${shot.keyframe}`, image);
  }

  // 预演（镜头 1）：第一帧 PNG + 预演视频。预演是动作参考，本来就没有声音
  const previzShot = shots.find((shot) => shot.previz);
  if (previzShot) {
    await save(
      `${dir}/${samplePrevizFile(previzShot.number, 'png')}`,
      await run(
        win,
        `const canvas = document.createElement('canvas');
         canvas.width = ${KW}; canvas.height = ${KH};
         SampleScene.drawPrevizFrame(canvas, 0);
         return canvas.toDataURL('image/png').split(',')[1];`
      )
    );
    const frames = previzShot.durationSec * FPS;
    await save(
      `${dir}/${samplePrevizFile(previzShot.number, 'mp4')}`,
      await run(
        win,
        `return SampleEncode.encodeMp4({ width: ${W}, height: ${H}, fps: ${FPS}, frames: ${frames}, quantizer: ${PREVIZ_QP},
           keyFrame: (i) => i === 0,
           draw: (canvas, i) => SampleScene.drawPrevizFrame(canvas, i / ${frames - 1}) });`
      )
    );
  }

  // 成片（镜头 1 / 2）：逐帧动画 + 这一段的混音（配乐 + 环境音 + 本镜头的音效与对白占位音）
  for (const shot of shots.filter((item) => item.output)) {
    const index = shots.indexOf(shot);
    const frames = shot.durationSec * FPS;
    const mix = JSON.stringify({
      from: starts[index],
      length: shot.durationSec,
      cues: shotCues[index],
      // 整场的第一个镜头像样片一样慢慢淡入，其余镜头短淡入淡出，单独播放也不突兀
      fadeIn: index === 0 ? 1 : 0.25,
      fadeOut: 0.4,
    });
    await save(
      `${dir}/${shot.output}`,
      await run(
        win,
        `return SampleEncode.encodeMp4({ width: ${W}, height: ${H}, fps: ${FPS}, frames: ${frames}, quantizer: ${SHOT_QP},
           keyFrame: (i) => i === 0,
           audio: SampleAudio.renderSceneMix(${mix}), audioBitrate: ${AUDIO_BITRATE},
           draw: (canvas, i) => SampleScene.drawShotFrame(canvas, ${shot.number}, i / ${frames - 1}, ${specs}) });`
      )
    );
  }

  // 配音占位音（示例占位音，不是真人语音）
  for (const shot of shots) {
    for (const line of shot.dialogue) {
      if (!('voice' in line) || !line.voice) continue;
      await save(
        `${dir}/${sampleVoiceFile(shot.number, line.id)}`,
        await run(
          win,
          `return SampleAudio.encodeM4a(${voiceExpression(line.voice)}, ${AUDIO_BITRATE});`
        )
      );
    }
  }

  // 样片：所有镜头依次播放（有成片的镜头动起来，其余停在首帧），整场同一份混音（对白时压低配乐）
  const mix = JSON.stringify({
    from: 0,
    length: total,
    cues: shotCues.flat(),
    fadeIn: 1,
    fadeOut: 2,
  });
  const timeline = JSON.stringify(
    shots.map((shot, index) => [shot.number, starts[index], shot.durationSec, Boolean(shot.output)])
  );
  await save(
    `${dir}/${SAMPLE_SCENE.animatic}`,
    await run(
      win,
      `const timeline = ${timeline};
       const frames = ${total * FPS};
       return SampleEncode.encodeMp4({ width: ${W}, height: ${H}, fps: ${FPS}, frames, quantizer: ${SHOT_QP},
         audio: SampleAudio.renderSceneMix(${mix}), audioBitrate: ${AUDIO_BITRATE},
         keyFrame: (i) => timeline.some(([, s]) => Math.round(s * ${FPS}) === i),
         draw: (canvas, i) => {
           const t = i / ${FPS};
           const [n, start, length, animated] = timeline.find(([, s, d]) => t >= s && t < s + d) || timeline[timeline.length - 1];
           SampleScene.drawShotFrame(canvas, n, animated ? (t - start) / length : 0, ${specs});
         } });`
    )
  );
}
