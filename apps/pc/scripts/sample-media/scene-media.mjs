/**
 * 生成示例声音与「第一场 清晨的青石镇」场景视频的媒体（在 generate-sample-media.mjs 打开的隐藏窗口里执行）：
 * - 声音：资料/音乐/（配乐、两段环境音）、资料/音效/（钟声、木板脚步、风帆）
 * - 场景目录：每个镜头的首帧图、镜头 1 的预演（第一帧 PNG + 预演视频）、镜头 1 / 2 的成片、
 *   配音占位音（镜头N-台词-<id>.m4a）、带声音的样片
 * 文件名与镜头来自 ./scene.mjs（分镜.json 由 generate-sample-data.mts 按同一份描述写入）。
 */
import { SAMPLE_CHARACTER_ART } from './characters.mjs';
import { SAMPLE_AUDIO, SAMPLE_SCENE, samplePrevizFile, sampleVoiceFile } from './scene.mjs';

const W = 384;
const H = 216;
const FPS = 10;
/** 样片更小（26 秒左右，带声音） */
const AW = 320;
const AH = 180;

/** 在页面里执行一段返回 base64 的脚本 */
const run = (win, code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);

const specs = JSON.stringify(
  SAMPLE_CHARACTER_ART.filter((item) => SAMPLE_SCENE.characters.includes(item.name))
);

export async function generateSampleAudio(win, save) {
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
function voiceExpression(voice) {
  return `SampleAudio.renderVoice(${voice.pitch}, ${voice.seconds})`;
}

export async function generateSceneMedia(win, save) {
  const dir = SAMPLE_SCENE.dir;
  const shots = SAMPLE_SCENE.shots;

  // 首帧：每个镜头 t = 0 的画面（WebP）
  for (const shot of shots) {
    const image = await run(
      win,
      `const canvas = document.createElement('canvas');
       canvas.width = 640; canvas.height = 360;
       SampleScene.drawShotFrame(canvas, ${shot.number}, 0, ${specs});
       return canvas.toDataURL('image/webp', 0.8).split(',')[1];`
    );
    await save(`${dir}/${shot.keyframe}`, image);
  }

  // 预演（镜头 1）：第一帧 PNG + 预演视频
  const previzShot = shots.find((shot) => shot.previz);
  if (previzShot) {
    await save(
      `${dir}/${samplePrevizFile(previzShot.number, 'png')}`,
      await run(
        win,
        `const canvas = document.createElement('canvas');
         canvas.width = ${W}; canvas.height = ${H};
         SampleScene.drawPrevizFrame(canvas, 0);
         return canvas.toDataURL('image/png').split(',')[1];`
      )
    );
    const frames = previzShot.durationSec * FPS;
    await save(
      `${dir}/${samplePrevizFile(previzShot.number, 'mp4')}`,
      await run(
        win,
        `return SampleEncode.encodeMp4({ width: ${W}, height: ${H}, fps: ${FPS}, frames: ${frames}, bitrate: 80000,
           draw: (canvas, i) => SampleScene.drawPrevizFrame(canvas, i / ${frames - 1}) });`
      )
    );
  }

  // 成片（镜头 1 / 2）：逐帧动画，没有声音
  for (const shot of shots.filter((item) => item.output)) {
    const frames = shot.durationSec * FPS;
    await save(
      `${dir}/${shot.output}`,
      await run(
        win,
        `return SampleEncode.encodeMp4({ width: ${W}, height: ${H}, fps: ${FPS}, frames: ${frames}, bitrate: 110000,
           draw: (canvas, i) => SampleScene.drawShotFrame(canvas, ${shot.number}, i / ${frames - 1}, ${specs}) });`
      )
    );
  }

  // 配音占位音（示例占位音，不是真人语音）
  for (const shot of shots) {
    for (const line of shot.dialogue) {
      if (!line.voice) continue;
      await save(
        `${dir}/${sampleVoiceFile(shot.number, line.id)}`,
        await run(win, `return SampleAudio.encodeM4a(${voiceExpression(line.voice)}, 48000);`)
      );
    }
  }

  // 样片：所有镜头依次播放（有成片的镜头动起来，其余停在首帧），带配乐（对白时压低）、环境音、对白与音效
  const starts = [];
  let total = 0;
  for (const shot of shots) {
    starts.push(total);
    total += shot.durationSec;
  }
  const cues = [];
  shots.forEach((shot, index) => {
    for (const line of shot.dialogue) {
      if (line.voice) {
        cues.push(
          `mixInto(mix, ${voiceExpression(line.voice)}, ${starts[index] + line.startSec}, 0.9);` +
            `duck.push([${starts[index] + line.startSec}, ${starts[index] + line.startSec + line.voice.seconds}]);`
        );
      }
    }
    for (const cue of shot.sfx) {
      const render = { bell: 'renderBell', footsteps: 'renderFootsteps', sail: 'renderSail' }[
        cue.file
      ];
      cues.push(
        `mixInto(mix, SampleAudio.${render}(), ${starts[index] + cue.atSec}, ${cue.volume});`
      );
    }
  });
  const timeline = JSON.stringify(
    shots.map((shot, index) => [shot.number, starts[index], shot.durationSec, Boolean(shot.output)])
  );
  await save(
    `${dir}/${SAMPLE_SCENE.animatic}`,
    await run(
      win,
      `const { SR, mixInto } = SampleAudio;
       const total = ${total};
       const mix = new Float32Array(Math.round(total * SR));
       const duck = [];
       ${cues.join('\n')}
       const bgm = SampleAudio.renderBgm();
       const town = SampleAudio.renderTown();
       for (let i = 0; i < mix.length; i += 1) {
         const t = i / SR;
         const ducked = duck.some(([a, b]) => t > a - 0.15 && t < b + 0.35);
         const fadeGain = Math.min(1, t / 1) * Math.min(1, (total - t) / 2);
         mix[i] += bgm[i % bgm.length] * 0.32 * (ducked ? 0.25 : 1) * fadeGain;
         mix[i] += town[i % town.length] * 0.22 * fadeGain;
       }
       let peak = 0;
       for (const v of mix) peak = Math.max(peak, Math.abs(v));
       if (peak > 0.9) for (let i = 0; i < mix.length; i += 1) mix[i] *= 0.9 / peak;
       const timeline = ${timeline};
       const frames = total * ${FPS};
       return SampleEncode.encodeMp4({ width: ${AW}, height: ${AH}, fps: ${FPS}, frames, bitrate: 60000, audio: mix,
         keyFrame: (i) => i === 0 || timeline.some(([, s]) => Math.round(s * ${FPS}) === i),
         audioBitrate: 48000,
         draw: (canvas, i) => {
           const t = i / ${FPS};
           const [n, start, length, animated] = timeline.find(([, s, d]) => t >= s && t < s + d) || timeline[timeline.length - 1];
           SampleScene.drawShotFrame(canvas, n, animated ? (t - start) / length : 0, ${specs});
         } });`
    )
  );
}
