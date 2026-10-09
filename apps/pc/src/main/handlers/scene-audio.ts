import { registerWorkspaceHandler } from '../workspace-ipc';
/**
 * 场景视频 · 声音 IPC：ai-speech-synthesize / scene-audio-import / scene-audio-read
 *
 * - ai-speech-synthesize：用已配置的配音服务（OpenAI 兼容 / MiniMax，密钥只在主进程）为一句对白生成配音，
 *   写入场景目录 <作品>/资料/视频/<章>/<场景>/镜头N-台词-<id>.mp3|wav（覆盖同一句的旧配音），只返回文件名与时长
 * - scene-audio-import：弹出系统「打开」对话框选择本地音频，按文件头确认是音频（MP3 / WAV / OGG / FLAC / M4A / AAC / WebM）、
 *   不超过 50MB，复制到 <作品>/资料/音乐/（配乐 / 环境音）或 <作品>/资料/音效/（音效），同名时自动加序号、独占创建不覆盖
 * - scene-audio-read：读取作品内 资料/音乐/ 或 资料/音效/ 下的音频（试听 / 拼接样片混音），经符号链接逃出作品目录的拒绝
 *
 * 不信任渲染进程：作品目录经 assertWorkPath（存在、位于窗口工作区内）；章 / 场景名清洗为单个路径段；
 * 对白 id 只允许 [A-Za-z0-9_-]；文字、语言、情绪、音色按白名单与长度校验；渲染进程不能指定任何源文件路径。
 * E2E 测试（NOVEL_EDITOR_E2E=1）可用 NOVEL_EDITOR_E2E_OPEN_PATH 跳过「打开」对话框。
 */
import { BrowserWindow, dialog } from 'electron';
import { readFile, realpath, rm, stat, writeFile } from 'fs/promises';
import path from 'path';
import { AIError, toAIError, type SpeechProvider, type SpeechRequest } from '@novel-editor/ai';
import {
  AUDIO_IMPORT_MAX_BYTES,
  MUSIC_DIR,
  SFX_DIR,
  detectAudioFormat,
  dialogueAudioFileName,
  isSafeAudioPath,
  normalizeLanguage,
  parseCharacterVoice,
  sanitizeLineId,
  sanitizePathSegment,
} from '@novel-editor/video';
import type { AIIpcResult, SceneAudioImportResult, SpeechSynthesizeResult } from '../../shared/ai';
import { getAIService } from '../ai/runtime';
import { isE2ETestMode } from '../launch-mode';
import { resolveInsideWork } from '../video/download';
import { overwriteFile, resolveScene, type VideoSceneHandlerDeps } from './video-scene';

const MAX_TEXT_CHARS = 1000;
/** 配音结果上限（单句台词正常只有几百 KB） */
export const MAX_SPEECH_BYTES = 20 * 1024 * 1024;
export const AUDIO_FILE_EXTENSIONS = [
  'mp3',
  'wav',
  'ogg',
  'oga',
  'opus',
  'flac',
  'm4a',
  'aac',
  'webm',
];

export interface SceneAudioHandlerDeps extends VideoSceneHandlerDeps {
  /** 取得配音服务（测试注入）；默认用 AIService */
  getSpeechProvider?: (providerId?: string) => SpeechProvider;
  /** 选择本地音频文件（测试注入）；返回绝对路径，取消时 null */
  pickAudioFile?: (senderId: number | undefined, title: string) => Promise<string | null>;
}

async function guard<T>(task: () => Promise<T> | T): Promise<AIIpcResult<T>> {
  try {
    return { ok: true, data: await task() };
  } catch (error) {
    return { ok: false, error: toAIError(error).toJSON() };
  }
}

function badRequest(message: string): AIError {
  return new AIError({ kind: 'bad-request', message });
}

function optionalText(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > max || /[\r\n]/.test(value)) {
    throw badRequest(`无效的${field}`);
  }
  return value.trim() || undefined;
}

/** 白名单校验配音参数（不含作品目录 / 场景） */
export function sanitizeSpeechPayload(raw: unknown): {
  shotIndex: number;
  lineId: string;
  providerId?: string;
  request: SpeechRequest;
} {
  if (typeof raw !== 'object' || raw === null) throw badRequest('无效的配音请求');
  const payload = raw as Record<string, unknown>;
  const shotIndex = payload.shotIndex;
  if (
    typeof shotIndex !== 'number' ||
    !Number.isInteger(shotIndex) ||
    shotIndex < 1 ||
    shotIndex > 999
  ) {
    throw badRequest('无效的镜头序号');
  }
  const lineId = sanitizeLineId(payload.lineId);
  if (!lineId || lineId !== payload.lineId) throw badRequest('无效的对白 id');
  if (typeof payload.text !== 'string' || !payload.text.trim()) throw badRequest('台词不能为空');
  if (payload.text.length > MAX_TEXT_CHARS) throw badRequest('台词过长（最多 1000 字）');
  const language = normalizeLanguage(payload.language);
  if (!language) throw badRequest('无效的配音语言');
  const format = payload.format === undefined ? 'mp3' : payload.format;
  if (format !== 'mp3' && format !== 'wav') throw badRequest('配音格式只支持 mp3 / wav');
  const providerId = optionalText(payload.providerId, '配音服务', 64);
  const model = optionalText(payload.model, '模型', 200);
  const emotion = optionalText(payload.emotion, '情绪', 20);
  const voice = parseCharacterVoice(payload.voice);
  const request: SpeechRequest = { text: payload.text.trim(), language, format };
  if (model) request.model = model;
  if (emotion) request.emotion = emotion;
  if (voice) request.voice = voice;
  return { shotIndex, lineId, ...(providerId ? { providerId } : {}), request };
}

/** 导入音频的目标目录（相对作品目录） */
export function importDirFor(kind: unknown): string {
  if (kind === 'bgm' || kind === 'ambience') return MUSIC_DIR;
  if (kind === 'sfx') return SFX_DIR;
  throw badRequest('无效的声音类型');
}

function numbered(base: string, ext: string, index: number): string {
  return index <= 1 ? `${base}.${ext}` : `${base}-${index}.${ext}`;
}

/**
 * 把本地音频复制进作品：校验大小与文件头，按识别出的格式决定扩展名，同名时加序号（独占创建，不覆盖）
 */
export async function importAudioFile(
  workPath: string,
  kind: unknown,
  sourcePath: string
): Promise<SceneAudioImportResult> {
  const dir = importDirFor(kind);
  if (!path.isAbsolute(sourcePath)) throw badRequest('无效的音频文件');
  const info = await stat(sourcePath).catch(() => null);
  if (!info?.isFile()) throw badRequest('音频文件不存在');
  if (info.size === 0) throw badRequest('音频文件为空');
  if (info.size > AUDIO_IMPORT_MAX_BYTES) throw badRequest('音频文件超过 50MB');
  const data = new Uint8Array(await readFile(sourcePath));
  const format = detectAudioFormat(data);
  if (!format) throw badRequest('不是可识别的音频文件（支持 MP3 / WAV / OGG / FLAC / M4A / AAC）');
  const parsed = path.parse(sourcePath);
  const base = sanitizePathSegment(parsed.name, '音频').slice(0, 60);
  for (let index = 1; index <= 99; index += 1) {
    const fileName = numbered(base, format, index);
    const relativePath = `${dir}/${fileName}`;
    const target = await resolveInsideWork(workPath, relativePath);
    try {
      await writeFile(target, data, { flag: 'wx' });
      return { canceled: false, fileName, relativePath, size: data.byteLength };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw badRequest('同名音频文件过多，请先改名');
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** 读取作品内的配乐 / 音效（只允许 资料/音乐/ 与 资料/音效/ 下的音频文件） */
export async function readWorkAudio(workPath: string, relativePath: unknown): Promise<Uint8Array> {
  if (!isSafeAudioPath(relativePath)) throw badRequest('无效的音频路径');
  const normalized = relativePath.replace(/\\/g, '/');
  if (![MUSIC_DIR, SFX_DIR].some((dir) => normalized.startsWith(`${dir}/`))) {
    throw badRequest('只能读取 资料/音乐/ 或 资料/音效/ 下的音频');
  }
  const file = path.resolve(workPath, ...normalized.split('/'));
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw badRequest('音频文件不存在');
  const [realRoot, realFile] = await Promise.all([realpath(workPath), realpath(file)]);
  if (!isInside(realRoot, realFile)) throw badRequest('音频文件经符号链接指向了作品目录之外');
  if (info.size > AUDIO_IMPORT_MAX_BYTES) throw badRequest('音频文件超过 50MB');
  const data = new Uint8Array(await readFile(realFile));
  if (!detectAudioFormat(data)) throw badRequest('不是可识别的音频文件');
  return data;
}

/** E2E 测试替身：只在 NOVEL_EDITOR_E2E=1 时生效 */
export function e2eOpenPath(): string | null {
  if (!isE2ETestMode()) return null;
  const value = process.env.NOVEL_EDITOR_E2E_OPEN_PATH;
  return value && path.isAbsolute(value) ? value : null;
}

async function defaultPickAudioFile(
  senderId: number | undefined,
  title: string
): Promise<string | null> {
  const override = e2eOpenPath();
  if (override) return override;
  const window = BrowserWindow.getAllWindows().find((item) => item.webContents.id === senderId);
  const options: Electron.OpenDialogOptions = {
    title,
    properties: ['openFile'],
    filters: [{ name: '音频', extensions: AUDIO_FILE_EXTENSIONS }],
  };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

const PICK_TITLES: Record<string, string> = {
  bgm: '选择背景音乐',
  ambience: '选择环境音',
  sfx: '选择音效',
};

export function registerSceneAudioHandlers(deps: SceneAudioHandlerDeps): void {
  const getSpeech =
    deps.getSpeechProvider ??
    ((providerId?: string) => getAIService().getSpeechProvider(providerId));
  const pick = deps.pickAudioFile ?? defaultPickAudioFile;

  registerWorkspaceHandler('ai-speech-synthesize', (event, raw: unknown) =>
    guard(async (): Promise<SpeechSynthesizeResult> => {
      const scene = await resolveScene(raw, deps, event?.sender?.id);
      const { shotIndex, lineId, providerId, request } = sanitizeSpeechPayload(raw);
      const provider = getSpeech(providerId);
      const result = await provider.synthesize(request);
      if (result.data.byteLength === 0 || result.data.byteLength > MAX_SPEECH_BYTES) {
        throw new AIError({
          kind: 'invalid-response',
          message: '配音结果大小异常',
          providerId: provider.id,
        });
      }
      const format = detectAudioFormat(result.data);
      if (format !== 'mp3' && format !== 'wav') {
        throw new AIError({
          kind: 'invalid-response',
          message: '配音结果不是音频',
          providerId: provider.id,
        });
      }
      const fileName = dialogueAudioFileName(shotIndex, lineId, format);
      const relativePath = `${scene.layout.dir}/${fileName}`;
      const target = await resolveInsideWork(scene.workPath, relativePath);
      await overwriteFile(target, result.data);
      // 换了格式时删掉另一种格式的旧配音，避免同一句留两份
      const other = dialogueAudioFileName(shotIndex, lineId, format === 'mp3' ? 'wav' : 'mp3');
      await rm(await resolveInsideWork(scene.workPath, `${scene.layout.dir}/${other}`), {
        force: true,
      });
      return {
        fileName,
        relativePath,
        mimeType: result.mimeType,
        providerId: provider.id,
        ...(result.durationSec ? { durationSec: result.durationSec } : {}),
      };
    })
  );

  registerWorkspaceHandler('scene-audio-import', (event, raw: unknown) =>
    guard(async (): Promise<SceneAudioImportResult> => {
      if (typeof raw !== 'object' || raw === null) throw badRequest('无效的请求');
      const payload = raw as { workPath?: unknown; kind?: unknown };
      const workPath = await deps.assertWorkPath(
        payload.workPath,
        deps.workspaceRootFor(event?.sender?.id)
      );
      importDirFor(payload.kind);
      const source = await pick(event?.sender?.id, PICK_TITLES[String(payload.kind)] ?? '选择音频');
      if (!source) return { canceled: true };
      return importAudioFile(workPath, payload.kind, source);
    })
  );

  registerWorkspaceHandler('scene-audio-read', (event, raw: unknown) =>
    guard(async (): Promise<Uint8Array> => {
      if (typeof raw !== 'object' || raw === null) throw badRequest('无效的请求');
      const payload = raw as { workPath?: unknown; relativePath?: unknown };
      const workPath = await deps.assertWorkPath(
        payload.workPath,
        deps.workspaceRootFor(event?.sender?.id)
      );
      return readWorkAudio(workPath, payload.relativePath);
    })
  );
}
