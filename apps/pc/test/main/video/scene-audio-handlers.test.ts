import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpeechProvider, SpeechRequest } from '@novel-editor/ai';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
  },
}));
vi.mock('../../../src/main/ai/runtime', () => ({
  getAIService: () => {
    throw new Error('测试中不应使用默认 AIService');
  },
}));

const { registerSceneAudioHandlers, sanitizeSpeechPayload, importAudioFile, readWorkAudio } =
  await import('../../../src/main/handlers/scene-audio');
const { isAllowedSceneMediaName } = await import('../../../src/main/handlers/video-scene');

/** 最小的 16-bit 单声道 WAV（静音） */
function wav(durationSec: number, sampleRate = 8000): Uint8Array {
  const data = Math.round(durationSec * sampleRate) * 2;
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

const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ne-scene-audio-')));
const work = path.join(root, 'novels', '星河旅人');
const outside = path.join(root, 'outside');
const sceneDir = path.join(work, '资料', '视频', '001-启程', '第一场 清晨');
const ref = { workPath: work, chapter: '001-启程', scene: '第一场 清晨' };

const speechRequests: SpeechRequest[] = [];
let speechOutput: Uint8Array = wav(0.5);
let picked: string | null = null;

const fakeSpeech: SpeechProvider = {
  id: 'openai-speech',
  kind: 'speech',
  async synthesize(request) {
    speechRequests.push(request);
    return { data: speechOutput, mimeType: 'audio/wav', format: 'wav', durationSec: 0.5 };
  },
  async testConnection() {},
};

registerSceneAudioHandlers({
  assertWorkPath: async (raw: unknown) => {
    if (typeof raw !== 'string' || !path.isAbsolute(raw) || !existsSync(raw)) {
      throw new Error('无效的作品目录');
    }
    return raw;
  },
  workspaceRootFor: () => null,
  getSpeechProvider: () => fakeSpeech,
  pickAudioFile: async () => picked,
});

async function call<T>(channel: string, payload: unknown): Promise<T> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`未注册: ${channel}`);
  return (await handler({ sender: { id: 1 } }, payload)) as T;
}

type Result<T> = { ok: true; data: T } | { ok: false; error: { message: string; kind: string } };

beforeEach(async () => {
  rmSync(root, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  await mkdir(outside, { recursive: true });
  speechRequests.length = 0;
  speechOutput = wav(0.5);
  picked = null;
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('ai-speech-synthesize', () => {
  const payload = {
    ...ref,
    shotIndex: 2,
    lineId: 'l1',
    text: '走吧',
    language: 'zh_cn',
    emotion: 'sad',
    voice: { gender: 'female', providerVoiceId: 'nova', extra: 'ignored' },
  };

  it('生成配音并写入场景目录，只返回文件名与时长（不含密钥）', async () => {
    const result = await call<Result<{ fileName: string; relativePath: string }>>(
      'ai-speech-synthesize',
      payload
    );
    expect(result).toEqual({
      ok: true,
      data: {
        fileName: '镜头2-台词-l1.wav',
        relativePath: '资料/视频/001-启程/第一场 清晨/镜头2-台词-l1.wav',
        mimeType: 'audio/wav',
        providerId: 'openai-speech',
        durationSec: 0.5,
      },
    });
    expect(await readFile(path.join(sceneDir, '镜头2-台词-l1.wav'))).toEqual(
      Buffer.from(speechOutput)
    );
    expect(speechRequests[0]).toEqual({
      text: '走吧',
      language: 'zh-CN',
      format: 'mp3',
      emotion: 'sad',
      voice: { providerVoiceId: 'nova', gender: 'female' },
    });
  });

  it('重新生成覆盖同一句；换格式时删掉另一种格式的旧配音', async () => {
    await mkdir(sceneDir, { recursive: true });
    await writeFile(path.join(sceneDir, '镜头2-台词-l1.mp3'), 'old');
    await call('ai-speech-synthesize', payload);
    await call('ai-speech-synthesize', payload);
    expect(existsSync(path.join(sceneDir, '镜头2-台词-l1.mp3'))).toBe(false);
    expect(existsSync(path.join(sceneDir, '镜头2-台词-l1.wav'))).toBe(true);
  });

  it('场景目录里的配音文件可以经 video-scene-read-file 读取（试听 / 样片混音）', () => {
    expect(isAllowedSceneMediaName('镜头2-台词-l1.wav')).toBe(true);
    expect(isAllowedSceneMediaName('镜头2-台词-l1.mp3')).toBe(true);
    expect(isAllowedSceneMediaName('镜头2-台词-l1.exe')).toBe(false);
    expect(isAllowedSceneMediaName('../镜头2-台词-l1.wav')).toBe(false);
  });

  it('参数校验：对白 id、台词、语言、镜头序号、格式', () => {
    expect(() => sanitizeSpeechPayload({ ...payload, lineId: '../x' })).toThrow('对白 id');
    expect(() => sanitizeSpeechPayload({ ...payload, text: '  ' })).toThrow('台词不能为空');
    expect(() => sanitizeSpeechPayload({ ...payload, text: 'x'.repeat(1001) })).toThrow('过长');
    expect(() => sanitizeSpeechPayload({ ...payload, language: '中文' })).toThrow('语言');
    expect(() => sanitizeSpeechPayload({ ...payload, shotIndex: 0 })).toThrow('镜头序号');
    expect(() => sanitizeSpeechPayload({ ...payload, format: 'flac' })).toThrow('格式');
    expect(() => sanitizeSpeechPayload({ ...payload, emotion: 'a\nb' })).toThrow('情绪');
    expect(() => sanitizeSpeechPayload(null)).toThrow('无效的配音请求');
  });

  it('作品目录无效 / 厂商返回的不是音频时报错，不写文件', async () => {
    const bad = await call<Result<unknown>>('ai-speech-synthesize', {
      ...payload,
      workPath: 'relative/path',
    });
    expect(bad.ok).toBe(false);
    speechOutput = new TextEncoder().encode('<html>not audio</html>');
    const invalid = await call<Result<unknown>>('ai-speech-synthesize', payload);
    expect(invalid).toMatchObject({ ok: false, error: { kind: 'invalid-response' } });
    expect(existsSync(path.join(sceneDir, '镜头2-台词-l1.wav'))).toBe(false);
  });
});

describe('scene-audio-import', () => {
  it('复制到 资料/音乐/，按文件头决定扩展名，同名自动加序号', async () => {
    const source = path.join(outside, '雨夜 配乐.bin');
    await writeFile(source, wav(1));
    picked = source;
    const first = await call<Result<{ relativePath: string; fileName: string }>>(
      'scene-audio-import',
      { workPath: work, kind: 'bgm' }
    );
    expect(first).toMatchObject({
      ok: true,
      data: { canceled: false, fileName: '雨夜 配乐.wav', relativePath: '资料/音乐/雨夜 配乐.wav' },
    });
    const second = await call<Result<{ relativePath: string }>>('scene-audio-import', {
      workPath: work,
      kind: 'ambience',
    });
    expect(second).toMatchObject({ ok: true, data: { relativePath: '资料/音乐/雨夜 配乐-2.wav' } });
    const sfx = await call<Result<{ relativePath: string }>>('scene-audio-import', {
      workPath: work,
      kind: 'sfx',
    });
    expect(sfx).toMatchObject({ ok: true, data: { relativePath: '资料/音效/雨夜 配乐.wav' } });
  });

  it('取消选择时不写文件；类型无效、不是音频、超过 50MB 都拒绝', async () => {
    expect(await call('scene-audio-import', { workPath: work, kind: 'bgm' })).toEqual({
      ok: true,
      data: { canceled: true },
    });
    expect(existsSync(path.join(work, '资料'))).toBe(false);
    const invalidKind = await call<Result<unknown>>('scene-audio-import', {
      workPath: work,
      kind: 'video',
    });
    expect(invalidKind.ok).toBe(false);
    const text = path.join(outside, 'fake.mp3');
    await writeFile(text, '<html>');
    await expect(importAudioFile(work, 'bgm', text)).rejects.toThrow('不是可识别的音频');
    const big = path.join(outside, 'big.wav');
    const header = wav(0.01);
    await writeFile(big, Buffer.concat([Buffer.from(header), Buffer.alloc(50 * 1024 * 1024)]));
    await expect(importAudioFile(work, 'bgm', big)).rejects.toThrow('50MB');
    await expect(importAudioFile(work, 'bgm', 'relative.wav')).rejects.toThrow('无效');
  });
});

describe('scene-audio-read', () => {
  it('只读 资料/音乐/ 与 资料/音效/ 下的音频，拒绝越界与符号链接逃逸', async () => {
    await mkdir(path.join(work, '资料', '音乐'), { recursive: true });
    const audio = wav(0.2);
    await writeFile(path.join(work, '资料', '音乐', 'a.wav'), audio);
    const ok = await call<Result<Uint8Array>>('scene-audio-read', {
      workPath: work,
      relativePath: '资料/音乐/a.wav',
    });
    expect(ok.ok && Buffer.from(ok.data).equals(Buffer.from(audio))).toBe(true);
    await expect(readWorkAudio(work, '资料/视频/a.wav')).rejects.toThrow('只能读取');
    await expect(readWorkAudio(work, '资料/音乐/../../x.wav')).rejects.toThrow('无效');
    await expect(readWorkAudio(work, '/etc/passwd')).rejects.toThrow('无效');
    await writeFile(path.join(outside, 'secret.wav'), audio);
    await symlink(path.join(outside, 'secret.wav'), path.join(work, '资料', '音乐', 'link.wav'));
    await expect(readWorkAudio(work, '资料/音乐/link.wav')).rejects.toThrow('符号链接');
    await writeFile(path.join(work, '资料', '音乐', 'note.wav'), 'text');
    await expect(readWorkAudio(work, '资料/音乐/note.wav')).rejects.toThrow('不是可识别');
  });
});
