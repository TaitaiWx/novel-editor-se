/**
 * 示例作品集里预先做好的一场场景视频（《星河旅人》001-启程 ·「第一场 清晨的青石镇」）的工作区状态：
 * <作品>/资料/视频/001-启程/第一场 清晨的青石镇/分镜.json（内部数据，GUI 不显示原文）与派生的 分镜.md。
 *
 * 镜头、文件名与声音来自 sample-media/scene.mjs（媒体文件由 generate-sample-media.mjs 生成）；这里只用
 * @novel-editor/video 的类型、校验与命名函数组装状态，保证打开画布时不需要任何 AI Key 就能看到完整流程：
 * 分镜 → 对白（说话人 / 情绪 / 开始时间 / 配音占位音）→ 音效 → 配乐 / 环境音 / 压低 → 预演脚本（AI 风格的关节轨迹）→
 * 首帧 → 成片 → 样片。chapterPath 写相对作品目录的路径（拷贝到用户目录后由 GUI 按作品目录解析）。
 */
import {
  DIALOGUE_MAX_LINES,
  PREVIZ_FIGURE_COLORS,
  PREVIZ_SCRIPT_VERSION,
  createSceneAudio,
  dialogueAudioFileName,
  isAnimaticFileName,
  parseSceneAudio,
  previzFileName,
  staticCameraKey,
  storyboardToMarkdown,
  validatePrevizScript,
  validateStoryboard,
  videoSceneLayout,
  videoShotFileName,
  type DialogueLine,
  type PrevizScript,
  type SceneAudio,
  type SfxCue,
  type Shot,
  type ShotSize,
  type Storyboard,
} from '@novel-editor/video';
import {
  SAMPLE_AUDIO,
  SAMPLE_SCENE,
  SAMPLE_SCENE_TIME,
  SAMPLE_SCENE_WORK,
  samplePrevizFile,
  sampleVoiceFile,
} from './sample-media/scene.mjs';

type AudioKey = keyof typeof SAMPLE_AUDIO;

interface SceneShotSpec {
  number: number;
  shotSize: string;
  durationSec: number;
  description: string;
  camera: string;
  characters: string[];
  location?: string;
  dialogue: Array<{
    id: string;
    speaker: string;
    text: string;
    emotion?: string;
    startSec?: number;
    voice?: { pitch: number; seconds: number };
  }>;
  sfx: Array<{ id: string; prompt: string; file: AudioKey; atSec: number; volume: number }>;
  keyframe: string;
  previz?: boolean;
  output?: string;
}

const SHOTS = SAMPLE_SCENE.shots as unknown as SceneShotSpec[];

/** 场景目录（相对作品目录），用 videoSceneLayout 推导并与描述核对 */
export function sampleSceneLayout() {
  const layout = videoSceneLayout({ chapter: SAMPLE_SCENE.chapter, scene: SAMPLE_SCENE.scene });
  if (layout.dir !== SAMPLE_SCENE.dir) {
    throw new Error(`场景目录与命名规则不一致：${layout.dir} ≠ ${SAMPLE_SCENE.dir}`);
  }
  return layout;
}

/** 断言 scene.mjs 里写死的文件名与 @novel-editor/video 的命名函数一致 */
function assertSame(actual: string, expected: string): string {
  if (actual !== expected) throw new Error(`示例文件名与命名规则不一致：${actual} ≠ ${expected}`);
  return actual;
}

function shotDialogue(shot: SceneShotSpec): DialogueLine[] {
  return shot.dialogue.slice(0, DIALOGUE_MAX_LINES).map((line) => ({
    id: line.id,
    speaker: line.speaker,
    text: line.text,
    ...(line.emotion ? { emotion: line.emotion } : {}),
    ...(line.startSec !== undefined ? { startSec: line.startSec } : {}),
    ...(line.voice
      ? {
          audioFile: assertSame(
            sampleVoiceFile(shot.number, line.id),
            dialogueAudioFileName(shot.number, line.id, 'm4a')
          ),
          // 占位音比台词长 0.2 秒的余量（淡出），见 sample-media/audio.js renderVoice
          audioDurationSec: Math.round((line.voice.seconds + 0.2) * 100) / 100,
        }
      : {}),
  }));
}

function shotSfx(shot: SceneShotSpec): SfxCue[] {
  return shot.sfx.map((cue) => ({
    id: cue.id,
    prompt: cue.prompt,
    path: SAMPLE_AUDIO[cue.file],
    atSec: cue.atSec,
    volume: cue.volume,
  }));
}

export function buildSampleStoryboard(): Storyboard {
  const shots: Shot[] = SHOTS.map((shot) => ({
    id: `shot-${shot.number}`,
    shotSize: shot.shotSize as ShotSize,
    durationSec: shot.durationSec,
    description: shot.description,
    camera: shot.camera,
    characters: shot.characters,
    ...(shot.location ? { location: shot.location } : {}),
    dialogue: shotDialogue(shot),
    sfx: shotSfx(shot),
  }));
  const validation = validateStoryboard({
    version: 1,
    aspectRatio: SAMPLE_SCENE.aspectRatio,
    style: SAMPLE_SCENE.style,
    shots,
  });
  if (!validation.ok) throw new Error(`示例分镜无效：${validation.errors.join('；')}`);
  return validation.storyboard;
}

export function buildSampleSceneAudio(): SceneAudio {
  const audio: SceneAudio = {
    ...createSceneAudio('zh-CN'),
    bgm: {
      source: 'file',
      path: SAMPLE_AUDIO.bgm,
      prompt: '五声音阶的轻柔旋律，清晨、离别、带一点希望',
      volume: 0.45,
      fadeInSec: 1,
      fadeOutSec: 2,
    },
    ambience: { prompt: '雨后清晨：微风、鸟鸣、屋檐滴水', path: SAMPLE_AUDIO.town, volume: 0.3 },
    ducking: true,
  };
  // 与 GUI 读取时同一套解析：写入解析后的结果（字段顺序与 GUI 保存时一致），文件与描述都要保留
  const parsed = parseSceneAudio(audio);
  if (parsed.bgm?.path !== SAMPLE_AUDIO.bgm || parsed.ambience?.path !== SAMPLE_AUDIO.town) {
    throw new Error('示例场景声音无法原样读取');
  }
  return parsed;
}

/**
 * 镜头 1 的预演脚本：林舟沿石板路走向镜头，走到一半回头望（AI 风格的关节轨迹：头 / 胸转向、手扶行囊），
 * 机位从远景缓慢推近。数值都在 validatePrevizScript 的范围内。
 */
export function buildSamplePrevizScript(): PrevizScript {
  const script: PrevizScript = {
    version: PREVIZ_SCRIPT_VERSION,
    durationSec: 5,
    mood: 'day',
    summary: '林舟背着行囊走出镇口，走到一半回头望了一眼小镇',
    figures: [
      {
        id: 'f1',
        name: '林舟',
        color: PREVIZ_FIGURE_COLORS[0],
        keys: [
          { t: 0, x: 0, z: -4, facing: 0, pose: 'walk', ease: 'linear' },
          {
            t: 2,
            x: 0.2,
            z: -1.6,
            facing: 0,
            pose: 'stand',
            ease: 'ease-in-out',
            motion: {
              generate: '停下脚步，回头望一眼小镇，右手扶住肩上的行囊',
              weight: 1,
              tracks: {
                head: [
                  [0, 0, 0, 0],
                  [0.6, -5, 40, 0],
                  [1.4, -5, 45, 0],
                  [1.9, 0, 0, 0],
                ],
                chest: [
                  [0, 0, 0, 0],
                  [0.6, 0, 18, 0],
                  [1.4, 0, 20, 0],
                  [1.9, 0, 0, 0],
                ],
                rightUpperArm: [
                  [0, 0, 0, 0],
                  [0.5, -60, 0, -20],
                  [1.9, -60, 0, -20],
                ],
                rightForearm: [
                  [0, 0, 0, 0],
                  [0.5, -70, 0, 0],
                  [1.9, -70, 0, 0],
                ],
              },
              rootBob: [
                [0, 0],
                [0.4, -0.03],
                [1, 0],
              ],
            },
          },
          { t: 4, x: 0.2, z: -1.6, facing: 0, pose: 'walk', ease: 'linear' },
          { t: 5, x: 0.3, z: -0.2, facing: 0, pose: 'walk' },
        ],
      },
    ],
    camera: [
      { ...staticCameraKey('wide', 0), ease: 'ease-in-out' },
      { ...staticCameraKey('full', 5), lens: 24 },
    ],
    props: [
      { id: 'p1', kind: 'tree', name: '老槐树', x: -2.4, z: -3, facing: 0 },
      { id: 'p2', kind: 'wall', name: '镇口的院墙', x: 2.6, z: -4.5, facing: -20 },
    ],
  };
  const validation = validatePrevizScript(script);
  if (!validation.ok) throw new Error(`示例预演脚本无效：${validation.errors.join('；')}`);
  return validation.script;
}

/** 场景目录内的文件（相对作品目录）：首帧、预演、成片、配音占位音、样片 */
export function sampleSceneMediaFiles(): string[] {
  const { dir } = sampleSceneLayout();
  const files: string[] = [];
  for (const shot of SHOTS) {
    files.push(`${dir}/${shot.keyframe}`);
    if (shot.previz) {
      files.push(
        `${dir}/${assertSame(samplePrevizFile(shot.number, 'png'), previzFileName(shot.number, 'png'))}`,
        `${dir}/${assertSame(samplePrevizFile(shot.number, 'mp4'), previzFileName(shot.number, 'mp4'))}`
      );
    }
    if (shot.output) {
      files.push(`${dir}/${assertSame(shot.output, videoShotFileName(shot.number, 1, 'mp4'))}`);
    }
    for (const line of shotDialogue(shot)) {
      if (line.audioFile) files.push(`${dir}/${line.audioFile}`);
    }
  }
  if (!isAnimaticFileName(SAMPLE_SCENE.animatic)) throw new Error('样片文件名不符合命名规则');
  files.push(`${dir}/${SAMPLE_SCENE.animatic}`);
  return files;
}

/** 分镜.json 的内容（SceneVideoState，见 SceneVideoView/sceneVideoState.ts） */
export function buildSampleSceneState(): Record<string, unknown> {
  const { dir } = sampleSceneLayout();
  const storyboard = buildSampleStoryboard();
  const ids = storyboard.shots.map((shot) => shot.id);
  const keyframes: Record<string, string> = {};
  const previz: Record<string, string> = {};
  const previzVideo: Record<string, string> = {};
  const previzScripts: Record<string, PrevizScript> = {};
  const chosenVersions: Record<string, string> = {};
  for (const shot of SHOTS) {
    const id = `shot-${shot.number}`;
    keyframes[id] = `${dir}/${shot.keyframe}`;
    if (shot.previz) {
      previz[id] = `${dir}/${previzFileName(shot.number, 'png')}`;
      previzVideo[id] = `${dir}/${previzFileName(shot.number, 'mp4')}`;
      previzScripts[id] = buildSamplePrevizScript();
    }
    if (shot.output) chosenVersions[id] = shot.output;
  }
  return {
    schemaVersion: 1,
    chapterPath: SAMPLE_SCENE.chapterFile,
    chapter: SAMPLE_SCENE.chapter,
    scene: SAMPLE_SCENE.scene,
    sourceText: SAMPLE_SCENE_SOURCE,
    location: SAMPLE_SCENE.location,
    characters: SAMPLE_SCENE.characters,
    style: SAMPLE_SCENE.style,
    aspectRatio: SAMPLE_SCENE.aspectRatio,
    shotDurationSec: SAMPLE_SCENE.shotDurationSec,
    providerId: null,
    useAvatarReference: true,
    withAudio: true,
    audio: buildSampleSceneAudio(),
    storyboard,
    nextShotNumber: SHOTS.length + 1,
    selectedShotIds: ids,
    chosenVersions,
    canvas: { positions: {} },
    keyframes,
    previz,
    previzVideo,
    previzScripts,
    // 已经在示例里展示过（不在打开时自动往章纲里追加条目）
    outlineLinked: true,
    updatedAt: SAMPLE_SCENE_TIME,
  };
}

/** 这一场的正文（与 001-启程.md 中「第一场」一致，单测核对） */
export const SAMPLE_SCENE_SOURCE = [
  '石板路还湿着，昨夜的雨把镇口那棵老槐树洗得发亮。林舟回头看了一眼，铁匠铺的烟囱还没冒烟，秦伯大概又喝多了。',
  '“舟哥！”小石头光着脚从巷子里跑出来，手里攥着一块烤得焦黄的饼，“秦伯让我给你的，他说你肯定忘了吃早饭。”',
  '林舟接过饼，揉了揉小石头乱糟糟的头发：“替我看好铁匠铺，等我回来。”',
  '“你一定要回来。”小石头仰着头，认真得像在立誓。',
].join('\n\n');

/** 分镜.md（派生的可读分镜表，与 GUI 保存时同一个函数生成） */
export function buildSampleSceneMarkdown(): string {
  const state = buildSampleSceneState();
  const storyboard = state.storyboard as Storyboard;
  return storyboardToMarkdown({
    ...storyboard,
    title: `${SAMPLE_SCENE.chapter} · ${SAMPLE_SCENE.scene}`,
    aspectRatio: storyboard.aspectRatio,
    style: SAMPLE_SCENE.style,
  });
}

/** 写入的文件（相对项目根 → 内容） */
export function buildSampleSceneFiles(): Record<string, string> {
  const layout = sampleSceneLayout();
  const base = `${SAMPLE_SCENE_WORK}/`;
  return {
    [`${base}${layout.storyboardJson}`]: `${JSON.stringify(buildSampleSceneState(), null, 2)}\n`,
    [`${base}${layout.storyboardMarkdown}`]: buildSampleSceneMarkdown(),
  };
}
