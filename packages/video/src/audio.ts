/**
 * 场景视频的声音层（纯函数，无 DOM / Node 依赖）：
 *
 * - 场景级 SceneAudio：语言（BCP-47）、背景音乐（本地文件 / 无 / 预留 AI 生成）、环境音、对白时自动压低配乐
 * - 镜头级：对白 DialogueLine[]（说话人 = 人物名或旁白、台词、情绪、相对镜头起点的时间、已生成的配音文件）
 *   与音效 SfxCue[]（文字描述或本地文件、时间点、音量）
 * - 人物声音 CharacterVoice（厂商音色 id、性别、年龄、音色描述），存在人物 attributes 里，可选
 *
 * 所有解析函数都是宽松的（容忍 AI 返回的字段别名与旧版自由文本「台词」），保证旧的 分镜.json 可以直接读入。
 */

/** 旁白（没有说话人） */
export const NARRATOR = 'narrator';
export const DEFAULT_VOICE_LANGUAGE = 'zh-CN';

/** 常用配音语言（BCP-47）与中文名称 */
export const VOICE_LANGUAGES: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'zh-CN', label: '普通话' },
  { code: 'zh-HK', label: '粤语' },
  { code: 'zh-TW', label: '中文（台湾）' },
  { code: 'en-US', label: '英语（美国）' },
  { code: 'en-GB', label: '英语（英国）' },
  { code: 'ja-JP', label: '日语' },
  { code: 'ko-KR', label: '韩语' },
  { code: 'fr-FR', label: '法语' },
  { code: 'de-DE', label: '德语' },
  { code: 'es-ES', label: '西班牙语' },
  { code: 'ru-RU', label: '俄语' },
  { code: 'pt-BR', label: '葡萄牙语（巴西）' },
  { code: 'it-IT', label: '意大利语' },
  { code: 'th-TH', label: '泰语' },
  { code: 'vi-VN', label: '越南语' },
  { code: 'id-ID', label: '印尼语' },
];

/** 情绪（界面下拉的固定选项；AI 返回的其他情绪文字原样保留，只作为提示） */
export const VOICE_EMOTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'calm', label: '平静' },
  { value: 'happy', label: '开心' },
  { value: 'sad', label: '悲伤' },
  { value: 'angry', label: '愤怒' },
  { value: 'fearful', label: '害怕' },
  { value: 'surprised', label: '惊讶' },
  { value: 'disgusted', label: '厌恶' },
];

/** 情绪 → 固定选项的英文值（精确匹配英文值或中文名称；匹配不到时 undefined） */
export function emotionValue(emotion: string | undefined): string | undefined {
  if (!emotion) return undefined;
  const key = emotion.trim();
  return VOICE_EMOTIONS.find((item) => item.value === key.toLowerCase() || item.label === key)
    ?.value;
}

export function emotionLabel(emotion: string): string {
  return VOICE_EMOTIONS.find((item) => item.value === emotion)?.label ?? emotion;
}

export const DIALOGUE_MAX_LINES = 20;
export const DIALOGUE_TEXT_MAX = 500;
export const SFX_MAX_CUES = 10;
export const AUDIO_PROMPT_MAX = 200;
/** 对白时配乐压低的分贝数 */
export const DUCKING_DB = -12;
/** 本地背景音乐 / 音效文件上限（导入时校验） */
export const AUDIO_IMPORT_MAX_BYTES = 50 * 1024 * 1024;
/** 作品内的音乐 / 音效目录（相对作品目录） */
export const MUSIC_DIR = '资料/音乐';
export const SFX_DIR = '资料/音效';

export interface DialogueLine {
  /** 镜头内唯一，只含 [A-Za-z0-9_-]（配音文件名使用） */
  id: string;
  /** 人物名，或 NARRATOR 表示旁白 */
  speaker: string;
  text: string;
  /** 情绪，例如「平静」「激动」「哽咽」 */
  emotion?: string;
  /** 相对镜头起点的秒数；不填时紧接上一句 */
  startSec?: number;
  /** 已生成的配音（场景目录内的文件名：镜头N-台词-<id>.<ext>） */
  audioFile?: string;
  /** 配音时长（秒，生成时记录；拼接样片时以实际解码长度为准） */
  audioDurationSec?: number;
}

export interface SfxCue {
  id: string;
  /** 文字描述（交给能生成声音的视频模型 / 将来的音效模型） */
  prompt?: string;
  /** 本地音效文件（相对作品目录，例如 资料/音效/开门.wav） */
  path?: string;
  /** 相对镜头起点的秒数 */
  atSec: number;
  /** 0..1 */
  volume: number;
}

export type BgmSource = 'file' | 'none' | 'generate';

export interface BgmSpec {
  source: BgmSource;
  /** source = file：相对作品目录的路径（资料/音乐/…） */
  path?: string;
  /** source = generate：给将来的配乐模型的描述（MusicProvider，尚未接入） */
  prompt?: string;
  /** 0..1 */
  volume: number;
  fadeInSec: number;
  fadeOutSec: number;
}

export interface AmbienceSpec {
  /** 文字描述（交给能生成声音的视频模型，例如「雨声、远处狗叫」） */
  prompt?: string;
  /** 本地环境音文件（相对作品目录） */
  path?: string;
  /** 0..1 */
  volume: number;
}

export interface SceneAudio {
  /** BCP-47 语言代码 */
  language: string;
  bgm?: BgmSpec;
  ambience?: AmbienceSpec;
  /** 对白时自动压低配乐（约 -12dB） */
  ducking: boolean;
  /** 配音服务（设置中心配置的 openai-speech / minimax-speech）；不填时用第一个可用的 */
  speechProviderId?: string;
}

export interface CharacterVoice {
  /** 厂商音色 id（例如 OpenAI 的 alloy / MiniMax 的 male-qn-qingse） */
  providerVoiceId?: string;
  gender?: 'male' | 'female' | 'neutral';
  /** 年龄段描述，例如「少年」「中年」 */
  age?: string;
  /** 音色描述，例如「低沉沙哑」「清亮」 */
  timbre?: string;
}

export const DEFAULT_BGM: BgmSpec = {
  source: 'none',
  volume: 0.5,
  fadeInSec: 1,
  fadeOutSec: 2,
};

export function createSceneAudio(language: string = DEFAULT_VOICE_LANGUAGE): SceneAudio {
  return { language: normalizeLanguage(language) ?? DEFAULT_VOICE_LANGUAGE, ducking: true };
}

// ─── 基础工具 ───────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pick(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const trimmed = String(value).trim();
  return trimmed ? Array.from(trimmed).slice(0, max).join('') : undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const match = /-?\d+(?:\.\d+)?/.exec(value);
    if (match) return Number(match[0]);
  }
  return undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 音量：0..1；给的是百分比（>1 且 ≤100）时按百分比换算 */
export function normalizeVolume(value: unknown, fallback: number): number {
  const parsed = num(value);
  if (parsed === undefined) return fallback;
  const ratio = parsed > 1 && parsed <= 100 ? parsed / 100 : parsed;
  return round(clamp(ratio, 0, 1));
}

/** 作品内的相对路径：不能是绝对路径、不能含 . / .. / 空段 */
export function isSafeAudioPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 500) return false;
  if (value.startsWith('/') || value.startsWith('\\') || /^[a-zA-Z]:/.test(value)) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(value)) return false;
  return value.split(/[\\/]/).every((part) => part !== '..' && part !== '.' && part !== '');
}

/** 规范 BCP-47 代码：zh_cn → zh-CN；无效时 undefined */
export function normalizeLanguage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parts = value.trim().replace(/_/g, '-').split('-').filter(Boolean);
  if (parts.length === 0 || !/^[a-zA-Z]{2,3}$/.test(parts[0])) return undefined;
  if (parts.length > 3 || parts.some((part) => !/^[a-zA-Z0-9]{1,8}$/.test(part))) return undefined;
  return parts
    .map((part, index) => {
      if (index === 0) return part.toLowerCase();
      if (part.length === 2) return part.toUpperCase();
      if (part.length === 4) return part[0].toUpperCase() + part.slice(1).toLowerCase();
      return part;
    })
    .join('-');
}

export function languageLabel(code: string): string {
  return VOICE_LANGUAGES.find((item) => item.code === code)?.label ?? code;
}

/** 行 id：只保留 [A-Za-z0-9_-]，最长 40 */
export function sanitizeLineId(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const cleaned = String(value)
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 40);
  return cleaned || undefined;
}

/** 生成不冲突的 id：l1、l2…（对白）/ s1、s2…（音效） */
export function createLineId(existing: Iterable<string>, prefix = 'l'): string {
  const used = new Set(existing);
  for (let index = 1; ; index += 1) {
    const id = `${prefix}${index}`;
    if (!used.has(id)) return id;
  }
}

// ─── 对白 ───────────────────────────────────────────────────────────────

const NARRATOR_ALIASES = new Set(['narrator', 'voiceover', 'voice-over', 'vo', 'os', '旁白']);

/** 说话人：旁白别名统一为 NARRATOR */
export function normalizeSpeaker(value: unknown): string {
  const name = text(value, 40);
  if (!name) return NARRATOR;
  return NARRATOR_ALIASES.has(name.toLowerCase()) ? NARRATOR : name;
}

export function speakerLabel(speaker: string): string {
  return speaker === NARRATOR ? '旁白' : speaker;
}

/** 「林舟：走吧」形式的旧文本拆出说话人（名字最长 12 个字符，冒号为半角或全角） */
function splitSpeakerPrefix(line: string): { speaker: string; text: string } {
  const match = /^([^:\uff1a\s]{1,12})[:\uff1a]\s*([\s\S]+)$/.exec(line.trim());
  if (match && match[2].trim()) {
    return { speaker: normalizeSpeaker(match[1]), text: match[2].trim() };
  }
  return { speaker: NARRATOR, text: line.trim() };
}

/** 对白音频文件名：镜头3-台词-l2.mp3 */
export function dialogueAudioFileName(shotIndex: number, lineId: string, ext: string): string {
  return `镜头${shotIndex}-台词-${lineId}.${ext}`;
}

// 镜头N-台词-<id>.<ext>（\u955c\u5934 = 镜头，\u53f0\u8bcd = 台词）
const DIALOGUE_AUDIO_RE =
  /^\u955c\u5934(\d{1,3})-\u53f0\u8bcd-([A-Za-z0-9_-]{1,40})\.(mp3|wav|ogg|opus|flac|m4a|aac)$/i;

export function parseDialogueAudioFileName(
  name: unknown
): { shotIndex: number; lineId: string; ext: string } | null {
  if (typeof name !== 'string') return null;
  const match = DIALOGUE_AUDIO_RE.exec(name);
  if (!match) return null;
  const shotIndex = Number(match[1]);
  if (!Number.isSafeInteger(shotIndex) || shotIndex < 1) return null;
  return { shotIndex, lineId: match[2], ext: match[3].toLowerCase() };
}

/**
 * 解析镜头对白：
 * - 旧版自由文本（字符串）→ 每行一句；「名字：台词」拆出说话人，否则为旁白
 * - 数组：元素可以是字符串或对象（speaker / character / role / name / 角色 / 说话人；text / line / content / 台词；
 *   emotion / mood / 情绪；startSec / start / at / 开始）
 */
export function parseDialogue(raw: unknown): DialogueLine[] {
  const items: unknown[] =
    // 逗号 / 分号 / 顿号（含全角）分隔
    typeof raw === 'string' ? raw.split(/\r?\n/) : Array.isArray(raw) ? raw : [];
  const lines: DialogueLine[] = [];
  const used = new Set<string>();
  for (const item of items) {
    if (lines.length >= DIALOGUE_MAX_LINES) break;
    let speaker = NARRATOR;
    let body: string | undefined;
    let record: Record<string, unknown> = {};
    if (typeof item === 'string') {
      if (!item.trim()) continue;
      const split = splitSpeakerPrefix(item);
      speaker = split.speaker;
      body = text(split.text, DIALOGUE_TEXT_MAX);
    } else if (isRecord(item)) {
      record = item;
      speaker = normalizeSpeaker(
        pick(item, 'speaker', 'character', 'role', 'name', '角色', '说话人', '人物')
      );
      body = text(
        pick(item, 'text', 'line', 'content', 'dialogue', '台词', '内容'),
        DIALOGUE_TEXT_MAX
      );
    }
    if (!body) continue;
    const requested = sanitizeLineId(record.id);
    const id = requested && !used.has(requested) ? requested : createLineId(used);
    used.add(id);
    const line: DialogueLine = { id, speaker, text: body };
    const emotion = text(pick(record, 'emotion', 'mood', 'tone', '情绪'), 20);
    if (emotion) line.emotion = emotion;
    const start = num(pick(record, 'startSec', 'start', 'at', 'atSec', '开始'));
    if (start !== undefined && start >= 0) line.startSec = round(clamp(start, 0, 60), 1);
    if (typeof record.audioFile === 'string' && parseDialogueAudioFileName(record.audioFile)) {
      line.audioFile = record.audioFile;
    }
    const duration = num(record.audioDurationSec);
    if (line.audioFile && duration !== undefined && duration > 0) {
      line.audioDurationSec = round(clamp(duration, 0, 600), 2);
    }
    lines.push(line);
  }
  return lines;
}

/** 对白的可读文本（字幕 / 分镜表）：「林舟：走吧」「旁白：……」 */
export function dialogueToText(
  lines: readonly DialogueLine[] | undefined,
  separator = ' / '
): string {
  return (lines ?? []).map((line) => `${speakerLabel(line.speaker)}：${line.text}`).join(separator);
}

// ─── 音效 ───────────────────────────────────────────────────────────────

/** 解析音效：字符串（逗号 / 换行分隔的描述）或对象数组（prompt / description / sound / 音效；path / file；atSec / at / time） */
export function parseSfx(raw: unknown): SfxCue[] {
  const items: unknown[] =
    typeof raw === 'string' ? raw.split(/[\n,;\uff0c\uff1b\u3001]/) : Array.isArray(raw) ? raw : [];
  const cues: SfxCue[] = [];
  const used = new Set<string>();
  for (const item of items) {
    if (cues.length >= SFX_MAX_CUES) break;
    const record: Record<string, unknown> =
      typeof item === 'string' ? { prompt: item } : isRecord(item) ? item : {};
    const prompt = text(
      pick(record, 'prompt', 'description', 'sound', 'name', '音效', '描述'),
      AUDIO_PROMPT_MAX
    );
    const rawPath = pick(record, 'path', 'file');
    const path = isSafeAudioPath(rawPath) ? rawPath : undefined;
    if (!prompt && !path) continue;
    const requested = sanitizeLineId(record.id);
    const id = requested && !used.has(requested) ? requested : createLineId(used, 's');
    used.add(id);
    const at = num(pick(record, 'atSec', 'at', 'time', 'start', 'startSec', '时间'));
    const cue: SfxCue = {
      id,
      atSec: round(clamp(at ?? 0, 0, 60), 1),
      volume: normalizeVolume(pick(record, 'volume', 'gain', '音量'), 0.8),
    };
    if (prompt) cue.prompt = prompt;
    if (path) cue.path = path;
    cues.push(cue);
  }
  return cues;
}

// ─── 场景声音 ───────────────────────────────────────────────────────────

function parseBgm(raw: unknown): BgmSpec | undefined {
  if (!isRecord(raw)) return undefined;
  const source: BgmSource =
    raw.source === 'file' || raw.source === 'generate' || raw.source === 'none'
      ? raw.source
      : isSafeAudioPath(raw.path)
        ? 'file'
        : 'none';
  const bgm: BgmSpec = {
    source,
    volume: normalizeVolume(raw.volume, DEFAULT_BGM.volume),
    fadeInSec: round(clamp(num(raw.fadeInSec) ?? DEFAULT_BGM.fadeInSec, 0, 30), 1),
    fadeOutSec: round(clamp(num(raw.fadeOutSec) ?? DEFAULT_BGM.fadeOutSec, 0, 30), 1),
  };
  if (isSafeAudioPath(raw.path)) bgm.path = raw.path;
  const prompt = text(raw.prompt, AUDIO_PROMPT_MAX);
  if (prompt) bgm.prompt = prompt;
  // 选了「文件」却没有文件：视为无配乐
  if (bgm.source === 'file' && !bgm.path) bgm.source = 'none';
  return bgm;
}

function parseAmbience(raw: unknown): AmbienceSpec | undefined {
  if (!isRecord(raw)) return undefined;
  const prompt = text(raw.prompt, AUDIO_PROMPT_MAX);
  const path = isSafeAudioPath(raw.path) ? raw.path : undefined;
  if (!prompt && !path) return undefined;
  const ambience: AmbienceSpec = { volume: normalizeVolume(raw.volume, 0.4) };
  if (prompt) ambience.prompt = prompt;
  if (path) ambience.path = path;
  return ambience;
}

/** 读取场景声音（旧的 分镜.json 没有这一项：用默认语言、无配乐、开启压低） */
export function parseSceneAudio(
  raw: unknown,
  defaultLanguage: string = DEFAULT_VOICE_LANGUAGE
): SceneAudio {
  const audio = createSceneAudio(defaultLanguage);
  if (!isRecord(raw)) return audio;
  audio.language = normalizeLanguage(raw.language) ?? audio.language;
  audio.ducking = raw.ducking !== false;
  const bgm = parseBgm(raw.bgm);
  if (bgm) audio.bgm = bgm;
  const ambience = parseAmbience(raw.ambience);
  if (ambience) audio.ambience = ambience;
  if (typeof raw.speechProviderId === 'string' && /^[a-z0-9-]{1,64}$/.test(raw.speechProviderId)) {
    audio.speechProviderId = raw.speechProviderId;
  }
  return audio;
}

/** 当前是否有可混音的背景音乐文件 */
export function activeBgmPath(audio: SceneAudio | undefined): string | null {
  return audio?.bgm?.source === 'file' && audio.bgm.path ? audio.bgm.path : null;
}

// ─── 人物声音 ───────────────────────────────────────────────────────────

export function parseCharacterVoice(raw: unknown): CharacterVoice | undefined {
  if (!isRecord(raw)) return undefined;
  const voice: CharacterVoice = {};
  const id = text(raw.providerVoiceId, 80);
  if (id && /^[A-Za-z0-9_.:-]+$/.test(id)) voice.providerVoiceId = id;
  if (raw.gender === 'male' || raw.gender === 'female' || raw.gender === 'neutral') {
    voice.gender = raw.gender;
  }
  const age = text(raw.age, 20);
  if (age) voice.age = age;
  const timbre = text(raw.timbre, 60);
  if (timbre) voice.timbre = timbre;
  return Object.keys(voice).length ? voice : undefined;
}

// ─── 视频提示词里的声音提示 ─────────────────────────────────────────────

/**
 * 给能生成声音的视频模型的声音提示：语言 + 对白（说话人：台词）+ 音效 + 环境音。
 * 不支持声音的模型不要调用（保持提示词只描述画面）。
 */
export function shotAudioPromptHints(
  shot: { dialogue?: readonly DialogueLine[]; sfx?: readonly SfxCue[] },
  audio: SceneAudio
): string[] {
  const hints: string[] = [];
  const lines = shot.dialogue ?? [];
  if (lines.length) {
    hints.push(`对白语言：${languageLabel(audio.language)}（${audio.language}）`);
    hints.push(
      `对白：${lines
        .map((line) => {
          const emotion = line.emotion ? `（${emotionLabel(line.emotion)}）` : '';
          return `${speakerLabel(line.speaker)}${emotion}：「${line.text}」`;
        })
        .join(' ')}`
    );
  }
  const sounds = (shot.sfx ?? []).map((cue) => cue.prompt).filter(Boolean);
  if (sounds.length) hints.push(`音效：${sounds.join('、')}`);
  if (audio.ambience?.prompt) hints.push(`环境声：${audio.ambience.prompt}`);
  return hints;
}

// ─── 音频文件识别 ───────────────────────────────────────────────────────

export type AudioFileFormat = 'mp3' | 'wav' | 'ogg' | 'flac' | 'm4a' | 'aac' | 'webm';

export const AUDIO_MIME_TYPES: Record<AudioFileFormat, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  webm: 'audio/webm',
};

function ascii(bytes: Uint8Array, start: number, length: number): string {
  if (bytes.byteLength < start + length) return '';
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

/** 按文件头识别音频格式（不信任扩展名）；不是音频时返回 null */
export function detectAudioFormat(bytes: Uint8Array): AudioFileFormat | null {
  if (bytes.byteLength < 4) return null;
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return 'wav';
  if (ascii(bytes, 0, 3) === 'ID3') return 'mp3';
  if (ascii(bytes, 0, 4) === 'OggS') return 'ogg';
  if (ascii(bytes, 0, 4) === 'fLaC') return 'flac';
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4);
    return /^(M4A |M4B |mp42|isom|dash|iso\d)/.test(brand) ? 'm4a' : null;
  }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return 'webm';
  }
  if (bytes[0] === 0xff) {
    // ADTS AAC：FFF1 / FFF9（layer 位为 00）；MPEG 音频帧同步：FFEx / FFFx 且 layer 不为 00
    if ((bytes[1] & 0xf6) === 0xf0) return 'aac';
    if ((bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0) return 'mp3';
  }
  return null;
}

/** 只读 WAV 头估算时长（秒）；不是 PCM WAV 或头不完整时返回 undefined */
export function wavDurationSec(bytes: Uint8Array): number | undefined {
  if (detectAudioFormat(bytes) !== 'wav') return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ' && offset + 16 <= bytes.byteLength)
      byteRate = view.getUint32(offset + 16, true);
    if (id === 'data') {
      const dataSize = Math.min(size, bytes.byteLength - offset - 8);
      return byteRate > 0 ? round(dataSize / byteRate, 3) : undefined;
    }
    offset += 8 + size + (size % 2);
  }
  return undefined;
}
