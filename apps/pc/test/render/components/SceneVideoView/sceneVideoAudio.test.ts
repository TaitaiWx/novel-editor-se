import { describe, expect, it } from 'vitest';
import {
  animaticSignatureFor,
  audioSignatureFor,
  buildShotVideoPrompt,
  createSceneVideoState,
  parseSceneVideoState,
  type SceneVideoState,
} from '@/render/components/SceneVideoView/sceneVideoState';
import {
  pickSpeechProviders,
  withLineAudio,
} from '@/render/components/SceneVideoView/useSceneAudio';
import { shotAudioBadges } from '@/render/components/SceneVideoView/nodes';
import type { AIProviderInfo } from '@/shared/ai';

function baseState(): SceneVideoState {
  const state = createSceneVideoState(
    {
      chapterPath: '/p/novels/星河旅人/001-启程.md',
      chapter: '001-启程',
      scene: '第一场',
      sourceText: '正文',
      language: 'en-US',
    },
    new Date('2026-10-08T00:00:00.000Z')
  );
  return {
    ...state,
    style: '写实',
    storyboard: {
      ...state.storyboard,
      shots: [
        {
          id: 'shot-1',
          shotSize: '近景',
          durationSec: 6,
          description: '林舟回头',
          dialogue: [
            { id: 'l1', speaker: '林舟', text: 'Let us go', emotion: 'calm' },
            { id: 'l2', speaker: 'narrator', text: 'That spring' },
          ],
          sfx: [{ id: 's1', prompt: '风声', atSec: 1, volume: 0.8 }],
        },
      ],
    },
    audio: { ...state.audio, ambience: { prompt: '雨声', volume: 0.4 } },
  };
}

describe('视频提示词：只有支持声音时才带语言与对白', () => {
  it('支持声音：附上语言、说话人：台词、音效与环境声', () => {
    const state = baseState();
    const prompt = buildShotVideoPrompt(state.storyboard.shots[0], state, { withAudio: true });
    expect(prompt).toContain('林舟回头');
    expect(prompt).toContain('对白语言：英语（美国）（en-US）');
    expect(prompt).toContain('林舟（平静）：「Let us go」');
    expect(prompt).toContain('旁白：「That spring」');
    expect(prompt).toContain('音效：风声');
    expect(prompt).toContain('环境声：雨声');
  });

  it('不支持声音：提示词只描述画面', () => {
    const state = baseState();
    for (const prompt of [
      buildShotVideoPrompt(state.storyboard.shots[0], state),
      buildShotVideoPrompt(state.storyboard.shots[0], state, { withAudio: false }),
    ]) {
      expect(prompt).toBe('写实风格。近景。林舟回头');
    }
  });
});

describe('分镜.json 的声音：新建、旧版迁移', () => {
  it('新建场景用设置中心的默认语言', () => {
    expect(baseState().audio).toMatchObject({ language: 'en-US', ducking: true });
  });

  it('旧版 分镜.json：没有 audio 用默认语言；自由文本台词迁移为一句对白', () => {
    const parsed = parseSceneVideoState(
      {
        schemaVersion: 1,
        chapter: '001-启程',
        scene: '第一场',
        storyboard: {
          shots: [
            {
              id: 'shot-1',
              shotSize: '近景',
              durationSec: 6,
              description: 'x',
              dialogue: '小石头：舟哥！',
            },
            {
              id: 'shot-2',
              shotSize: '近景',
              durationSec: 6,
              description: 'y',
              dialogue: '风很大',
            },
          ],
        },
      },
      'ja-JP'
    );
    expect(parsed?.audio).toEqual({ language: 'ja-JP', ducking: true });
    expect(parsed?.storyboard.shots[0].dialogue).toEqual([
      { id: 'l1', speaker: '小石头', text: '舟哥！' },
    ]);
    expect(parsed?.storyboard.shots[1].dialogue).toEqual([
      { id: 'l1', speaker: 'narrator', text: '风很大' },
    ]);
  });

  it('保存后再读：声音设置与配音文件原样保留', () => {
    const state = withLineAudio(baseState(), 'shot-1', 'l1', {
      audioFile: '镜头1-台词-l1.mp3',
      audioDurationSec: 1.4,
    });
    const withBgm: SceneVideoState = {
      ...state,
      audio: {
        ...state.audio,
        ducking: false,
        bgm: { source: 'file', path: '资料/音乐/雨.mp3', volume: 0.3, fadeInSec: 1, fadeOutSec: 2 },
      },
    };
    const parsed = parseSceneVideoState(JSON.parse(JSON.stringify(withBgm)));
    expect(parsed?.audio).toEqual(withBgm.audio);
    expect(parsed?.storyboard.shots[0].dialogue?.[0]).toEqual({
      id: 'l1',
      speaker: '林舟',
      text: 'Let us go',
      emotion: 'calm',
      audioFile: '镜头1-台词-l1.mp3',
      audioDurationSec: 1.4,
    });
    expect(parsed?.storyboard.shots[0].sfx).toEqual(withBgm.storyboard.shots[0].sfx);
  });
});

describe('样片签名与节点标记', () => {
  it('没有声音素材时签名与旧版一致；加了配乐 / 配音后签名变化（触发重新合成）', () => {
    const state = baseState();
    const files = ['镜头1-v1.mp4'];
    expect(audioSignatureFor(state)).toBe('');
    expect(animaticSignatureFor(state, files)).toBe('镜头1-v1.mp4');
    const voiced = withLineAudio(state, 'shot-1', 'l1', { audioFile: '镜头1-台词-l1.mp3' });
    expect(animaticSignatureFor(voiced, files)).toBe('镜头1-v1.mp4#d:镜头1-台词-l1.mp3:');
  });

  it('镜头节点：台词数（已配音）、音效数、配乐', () => {
    const shot = withLineAudio(baseState(), 'shot-1', 'l1', { audioFile: '镜头1-台词-l1.mp3' })
      .storyboard.shots[0];
    expect(shotAudioBadges(shot, true)).toEqual([
      { key: 'dialogue', text: '台词 2', tip: '2 句对白，已配音 1 句' },
      { key: 'sfx', text: '音效 1', tip: '1 个音效' },
      { key: 'bgm', text: '配乐', tip: '样片会混入这一场的背景音乐' },
    ]);
    expect(shotAudioBadges({ ...shot, dialogue: undefined, sfx: undefined }, false)).toEqual([]);
  });

  it('只列出已配置且启用的配音服务', () => {
    const info = (
      id: string,
      kind: AIProviderInfo['kind'],
      configured: boolean
    ): AIProviderInfo => ({
      id,
      kind,
      label: id,
      description: '',
      defaultBaseUrl: '',
      defaultModel: '',
      models: [],
      configured,
      secureStorage: true,
      enabled: true,
      baseUrl: '',
      model: '',
    });
    expect(
      pickSpeechProviders([
        info('openai-speech', 'speech', true),
        info('minimax-speech', 'speech', false),
        info('grok', 'text', true),
      ]).map((item) => item.id)
    ).toEqual(['openai-speech']);
  });
});
