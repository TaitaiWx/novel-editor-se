/**
 * 示例作品集里「预先做好的一场场景视频」与示例声音的共享描述：
 * - generate-sample-media.mjs（Electron）按这里的文件名生成 首帧 / 预演 / 成片 / 样片 / 配音占位音 / 配乐 / 环境音 / 音效
 * - generate-sample-data.mts（tsx）按这里的镜头写 分镜.json 与 分镜.md（用 @novel-editor/video 的类型与校验）
 * 文件名必须与 @novel-editor/video 的命名规则一致（videoShotFileName / previzFileName / dialogueAudioFileName /
 * 样片-YYYYMMDD-HHMMSS），apps/pc/test/main/sample-scene.test.ts 逐一校验，并确认引用的文件都真实存在。
 */

/** 作品目录（相对项目根） */
export const SAMPLE_SCENE_WORK = 'novels/星河旅人';

/** 示例声音（相对作品目录）：资料/音乐（配乐 / 环境音）、资料/音效 */
export const SAMPLE_AUDIO = {
  bgm: '资料/音乐/青石镇的清晨.m4a',
  harbor: '资料/音乐/海港环境音.m4a',
  town: '资料/音乐/清晨小镇环境音.m4a',
  bell: '资料/音效/钟声.m4a',
  footsteps: '资料/音效/木板脚步.m4a',
  sail: '资料/音效/风帆.m4a',
};

/** 固定时间（写进 分镜.json 与文件名，保证每次生成一致） */
export const SAMPLE_SCENE_TIME = '2026-10-01T08:00:00.000Z';
const STAMP = '20261001-080000';

/**
 * 第一章「第一场 清晨的青石镇」：5 个镜头。
 * dialogue.voice：配音占位音（示例占位音，不是真人语音）的音高与长度，生成 镜头N-台词-<id>.m4a；
 * 没有 voice 的台词演示「还没配音」的状态。
 */
export const SAMPLE_SCENE = {
  chapterFile: '第一卷-离乡/001-启程.md',
  chapter: '001-启程',
  scene: '第一场 清晨的青石镇',
  dir: '资料/视频/001-启程/第一场 清晨的青石镇',
  location: '青石镇',
  characters: ['林舟', '小石头'],
  style: '国漫',
  aspectRatio: '16:9',
  shotDurationSec: 4,
  /** 拼接好的样片（5 个镜头：有成片的用成片，其余用首帧，带配乐与对白） */
  animatic: `样片-${STAMP}.mp4`,
  shots: [
    {
      number: 1,
      shotSize: '远景',
      durationSec: 5,
      description:
        '雨后清晨，青石镇镇口，老槐树湿漉漉地发亮，石板路反着光；林舟背着行囊从镇里走出来',
      camera: '缓慢推近',
      characters: ['林舟'],
      location: '青石镇镇口',
      dialogue: [
        {
          id: 'l1',
          speaker: 'narrator',
          text: '那天清晨，雨刚停。',
          emotion: 'calm',
          startSec: 0.5,
        },
      ],
      sfx: [{ id: 's1', prompt: '踩过湿石板的脚步声', file: 'footsteps', atSec: 2, volume: 0.6 }],
      keyframe: `镜头1-首帧-${STAMP}.webp`,
      previz: true,
      output: '镜头1-v1.mp4',
    },
    {
      number: 2,
      shotSize: '中景',
      durationSec: 3,
      description: '小石头光着脚从巷子里跑出来，手里攥着一块烤得焦黄的饼，朝林舟挥手',
      camera: '跟拍',
      characters: ['小石头', '林舟'],
      dialogue: [
        {
          id: 'l1',
          speaker: '小石头',
          text: '舟哥！',
          emotion: 'happy',
          startSec: 0.4,
          voice: { pitch: 330, seconds: 0.9 },
        },
      ],
      sfx: [{ id: 's1', prompt: '光脚跑过石板', file: 'footsteps', atSec: 0, volume: 0.5 }],
      keyframe: `镜头2-首帧-${STAMP}.webp`,
      output: '镜头2-v1.mp4',
    },
    {
      number: 3,
      shotSize: '近景',
      durationSec: 4,
      description: '林舟接过饼，揉了揉小石头乱糟糟的头发，眼神温柔',
      camera: '固定',
      characters: ['林舟', '小石头'],
      dialogue: [
        {
          id: 'l1',
          speaker: '林舟',
          text: '替我看好铁匠铺，等我回来。',
          emotion: 'calm',
          startSec: 0.8,
          voice: { pitch: 180, seconds: 2.2 },
        },
      ],
      sfx: [],
      keyframe: `镜头3-首帧-${STAMP}.webp`,
    },
    {
      number: 4,
      shotSize: '特写',
      durationSec: 3,
      description: '小石头仰着头，眼睛亮亮的，认真得像在立誓',
      camera: '缓慢推近',
      characters: ['小石头'],
      dialogue: [
        {
          id: 'l1',
          speaker: '小石头',
          text: '你一定要回来。',
          emotion: 'sad',
          startSec: 0.6,
          voice: { pitch: 300, seconds: 1.4 },
        },
      ],
      sfx: [{ id: 's1', prompt: '远处镇上的钟声', file: 'bell', atSec: 1.8, volume: 0.4 }],
      keyframe: `镜头4-首帧-${STAMP}.webp`,
    },
    {
      number: 5,
      shotSize: '大远景',
      durationSec: 4,
      description: '林舟走上出镇的山路，回头望了一眼笼罩在晨雾里的小镇，远山层层叠叠',
      camera: '缓慢拉远',
      characters: ['林舟'],
      location: '出镇的山路',
      dialogue: [],
      sfx: [],
      keyframe: `镜头5-首帧-${STAMP}.webp`,
    },
  ],
};

/** 配音占位音的文件名：镜头N-台词-<id>.m4a（与 dialogueAudioFileName 一致） */
/** @param {number} shotNumber @param {string} lineId */
export function sampleVoiceFile(shotNumber, lineId) {
  return `镜头${shotNumber}-台词-${lineId}.m4a`;
}

/** 预演文件名：镜头N-预演.png / .mp4（与 previzFileName 一致） */
/** @param {number} shotNumber @param {string} ext */
export function samplePrevizFile(shotNumber, ext) {
  return `镜头${shotNumber}-预演.${ext}`;
}
