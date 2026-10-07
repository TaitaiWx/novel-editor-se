import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOICE_LANGUAGE,
  NARRATOR,
  activeBgmPath,
  createSceneAudio,
  detectAudioFormat,
  dialogueAudioFileName,
  dialogueToText,
  emotionValue,
  normalizeLanguage,
  normalizeVolume,
  parseCharacterVoice,
  parseDialogue,
  parseDialogueAudioFileName,
  parseSceneAudio,
  parseSfx,
  shotAudioPromptHints,
  validateStoryboard,
  wavDurationSec,
} from '../src';

/** 16-bit 单声道 PCM WAV（静音） */
function wav(durationSec: number, sampleRate = 8000): Uint8Array {
  const samples = Math.round(durationSec * sampleRate);
  const data = samples * 2;
  const bytes = new Uint8Array(44 + data);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) =>
    [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + data, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, data, true);
  return bytes;
}

describe('对白解析与旧版台词迁移', () => {
  it('旧版自由文本：每行一句，「名字：台词」拆出说话人，否则为旁白', () => {
    expect(parseDialogue('林舟：走吧\n风很大\n\n  苏晴:  等等 ')).toEqual([
      { id: 'l1', speaker: '林舟', text: '走吧' },
      { id: 'l2', speaker: NARRATOR, text: '风很大' },
      { id: 'l3', speaker: '苏晴', text: '等等' },
    ]);
  });

  it('结构化数组：容忍字段别名，旁白别名统一，保留合法的配音文件', () => {
    const lines = parseDialogue([
      { character: '林舟', line: '出发', mood: '激动', start: '1.5秒', id: 'a b!' },
      { 角色: '旁白', 台词: '天亮了' },
      { speaker: 'VO', text: '多年以后' },
      { speaker: '林舟', text: '   ' },
      { speaker: '苏晴', text: '嗯', audioFile: '镜头2-台词-l4.wav', audioDurationSec: 1.234 },
      { speaker: '苏晴', text: '坏文件', audioFile: '../x.wav' },
      'not-an-object-but-string',
    ]);
    expect(lines).toEqual([
      { id: 'ab', speaker: '林舟', text: '出发', emotion: '激动', startSec: 1.5 },
      { id: 'l1', speaker: NARRATOR, text: '天亮了' },
      { id: 'l2', speaker: NARRATOR, text: '多年以后' },
      {
        id: 'l3',
        speaker: '苏晴',
        text: '嗯',
        audioFile: '镜头2-台词-l4.wav',
        audioDurationSec: 1.23,
      },
      { id: 'l4', speaker: '苏晴', text: '坏文件' },
      { id: 'l5', speaker: NARRATOR, text: 'not-an-object-but-string' },
    ]);
  });

  it('validateStoryboard 把旧的 dialogue 字符串迁移为对白数组，并解析音效', () => {
    const result = validateStoryboard({
      shots: [
        { description: '雨夜', durationSec: 4, dialogue: '小石头：舟哥！' },
        {
          description: '门开了',
          durationSec: 3,
          dialogue: [{ speaker: '林舟', text: '谁？', emotion: 'fearful' }],
          sfx: [{ prompt: '木门吱呀', at: 0.5 }, '雷声'],
        },
        { description: '空镜', durationSec: 2, dialogue: '' },
      ],
    });
    if (!result.ok) throw new Error(result.errors.join(';'));
    const [first, second, third] = result.storyboard.shots;
    expect(first.dialogue).toEqual([{ id: 'l1', speaker: '小石头', text: '舟哥！' }]);
    expect(second.dialogue).toEqual([
      { id: 'l1', speaker: '林舟', text: '谁？', emotion: 'fearful' },
    ]);
    expect(second.sfx).toEqual([
      { id: 's1', prompt: '木门吱呀', atSec: 0.5, volume: 0.8 },
      { id: 's2', prompt: '雷声', atSec: 0, volume: 0.8 },
    ]);
    expect(third.dialogue).toBeUndefined();
    expect(dialogueToText(second.dialogue)).toBe('林舟：谁？');
  });

  it('配音文件名：镜头N-台词-<id>.<ext>，拒绝路径与非法扩展名', () => {
    expect(dialogueAudioFileName(3, 'l2', 'mp3')).toBe('镜头3-台词-l2.mp3');
    expect(parseDialogueAudioFileName('镜头3-台词-l2.mp3')).toEqual({
      shotIndex: 3,
      lineId: 'l2',
      ext: 'mp3',
    });
    expect(parseDialogueAudioFileName('镜头3-台词-l2.exe')).toBeNull();
    expect(parseDialogueAudioFileName('../镜头3-台词-l2.mp3')).toBeNull();
    expect(parseDialogueAudioFileName('镜头0-台词-l2.mp3')).toBeNull();
  });
});

describe('音效与场景声音', () => {
  it('音效：描述或安全的相对路径，时间与音量夹到范围内', () => {
    expect(
      parseSfx([
        { path: '资料/音效/门.wav', atSec: 99, volume: 150 },
        { path: '/etc/passwd' },
        { prompt: '风', volume: 50 },
      ])
    ).toEqual([
      { id: 's1', path: '资料/音效/门.wav', atSec: 60, volume: 1 },
      { id: 's2', prompt: '风', atSec: 0, volume: 0.5 },
    ]);
    expect(normalizeVolume('80', 0.5)).toBe(0.8);
    expect(normalizeVolume(-1, 0.5)).toBe(0);
    expect(normalizeVolume(undefined, 0.5)).toBe(0.5);
  });

  it('旧的 分镜.json 没有 audio：默认语言、无配乐、开启压低', () => {
    expect(parseSceneAudio(undefined)).toEqual({ language: 'zh-CN', ducking: true });
    expect(parseSceneAudio(null, 'en-US')).toEqual({ language: 'en-US', ducking: true });
    expect(createSceneAudio('bad language!')).toEqual({
      language: DEFAULT_VOICE_LANGUAGE,
      ducking: true,
    });
  });

  it('解析配乐 / 环境音：路径必须是作品内的相对路径；选了文件却没有文件视为无配乐', () => {
    const audio = parseSceneAudio({
      language: 'ja_jp',
      ducking: false,
      bgm: { source: 'file', path: '资料/音乐/雨.mp3', volume: 0.3, fadeInSec: 2, fadeOutSec: 99 },
      ambience: { prompt: '雨声', path: 'C:/x.wav', volume: 2 },
      speechProviderId: 'minimax-speech',
    });
    expect(audio).toEqual({
      language: 'ja-JP',
      ducking: false,
      bgm: { source: 'file', path: '资料/音乐/雨.mp3', volume: 0.3, fadeInSec: 2, fadeOutSec: 30 },
      ambience: { prompt: '雨声', volume: 0.02 },
      speechProviderId: 'minimax-speech',
    });
    expect(activeBgmPath(audio)).toBe('资料/音乐/雨.mp3');
    const missing = parseSceneAudio({ bgm: { source: 'file', path: '../外面.mp3' } });
    expect(missing.bgm?.source).toBe('none');
    expect(activeBgmPath(missing)).toBeNull();
    expect(parseSceneAudio({ speechProviderId: 'Bad Id' }).speechProviderId).toBeUndefined();
  });

  it('语言代码规范化与情绪映射', () => {
    expect(normalizeLanguage('zh_cn')).toBe('zh-CN');
    expect(normalizeLanguage('zh-hant-tw')).toBe('zh-Hant-TW');
    expect(normalizeLanguage('english')).toBeUndefined();
    expect(normalizeLanguage(3)).toBeUndefined();
    expect(emotionValue('悲伤')).toBe('sad');
    expect(emotionValue('Happy')).toBe('happy');
    expect(emotionValue('哽咽')).toBeUndefined();
  });

  it('人物声音：只保留合法字段，全部为空时为 undefined', () => {
    expect(
      parseCharacterVoice({
        providerVoiceId: 'alloy',
        gender: 'female',
        age: '少女',
        timbre: '清亮',
      })
    ).toEqual({ providerVoiceId: 'alloy', gender: 'female', age: '少女', timbre: '清亮' });
    expect(parseCharacterVoice({ providerVoiceId: 'a b', gender: 'robot' })).toBeUndefined();
    expect(parseCharacterVoice('x')).toBeUndefined();
  });
});

describe('视频提示词里的声音提示', () => {
  it('包含语言、说话人与台词、情绪、音效与环境声', () => {
    const hints = shotAudioPromptHints(
      {
        dialogue: [
          { id: 'l1', speaker: '林舟', text: '走吧', emotion: 'sad' },
          { id: 'l2', speaker: NARRATOR, text: '那年春天' },
        ],
        sfx: [{ id: 's1', prompt: '风声', atSec: 0, volume: 1 }],
      },
      { language: 'en-US', ducking: true, ambience: { prompt: '雨夜街道', volume: 0.4 } }
    );
    expect(hints).toEqual([
      '对白语言：英语（美国）（en-US）',
      '对白：林舟（悲伤）：「走吧」 旁白：「那年春天」',
      '音效：风声',
      '环境声：雨夜街道',
    ]);
    expect(shotAudioPromptHints({}, createSceneAudio())).toEqual([]);
  });
});

describe('音频文件识别', () => {
  it('按文件头识别格式，拒绝非音频', () => {
    expect(detectAudioFormat(wav(0.1))).toBe('wav');
    expect(detectAudioFormat(new Uint8Array([0x49, 0x44, 0x33, 3, 0]))).toBe('mp3');
    expect(detectAudioFormat(new Uint8Array([0xff, 0xfb, 0x90, 0x64]))).toBe('mp3');
    expect(detectAudioFormat(new Uint8Array([0xff, 0xf1, 0x50, 0x80]))).toBe('aac');
    expect(detectAudioFormat(new TextEncoder().encode('OggS\0\0'))).toBe('ogg');
    expect(detectAudioFormat(new TextEncoder().encode('fLaC\0\0'))).toBe('flac');
    expect(detectAudioFormat(new TextEncoder().encode('\0\0\0\x20ftypM4A \0\0'))).toBe('m4a');
    expect(detectAudioFormat(new TextEncoder().encode('\0\0\0\x20ftypavc1\0\0'))).toBeNull();
    expect(detectAudioFormat(new TextEncoder().encode('<html>'))).toBeNull();
    expect(detectAudioFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });

  it('WAV 时长从文件头计算', () => {
    expect(wavDurationSec(wav(1.5))).toBe(1.5);
    expect(wavDurationSec(new Uint8Array([0x49, 0x44, 0x33, 3]))).toBeUndefined();
  });
});
