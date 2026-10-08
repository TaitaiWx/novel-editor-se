/**
 * 示例作品集里预先做好的场景视频（《星河旅人》001-启程 ·「第一场 清晨的青石镇」）与示例声音：
 * 分镜.json 能被 GUI 原样读取，引用的媒体 / 声音文件都真实存在且格式正确，文件名符合 @novel-editor/video 的命名规则。
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { audioDirectiveSource, classifyWorkspaceEntry, lintNovelMarkup } from '@novel-editor/core';
import {
  detectAudioFormat,
  isAnimaticFileName,
  parseDialogueAudioFileName,
  parsePrevizFileName,
  parseShotFileName,
  validatePrevizScript,
} from '@novel-editor/video';
import { parseSceneVideoState } from '@/render/components/SceneVideoView/sceneVideoState';
import { sceneVideoTargetFromStoryboard } from '@/render/components/SceneVideoView/events';
import { SAMPLE_DATA_DIR } from '../../scripts/generate-sample-data.mts';
import {
  SAMPLE_SCENE_SOURCE,
  buildSampleSceneState,
  sampleSceneLayout,
  sampleSceneMediaFiles,
} from '../../scripts/sample-data-scene.mts';
import {
  SAMPLE_AUDIO,
  SAMPLE_SCENE,
  SAMPLE_SCENE_WORK,
  samplePrevizFile,
} from '../../scripts/sample-media/scene.mjs';

const WORK = path.join(SAMPLE_DATA_DIR, ...SAMPLE_SCENE_WORK.split('/'));
const inWork = (relative: string) => path.join(WORK, ...relative.split('/'));

async function bytesOf(relative: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(inWork(relative)));
}

/** MP4 box：type 为四字符类型，body 为内容起点（跳过头部），end 为结束位置 */
interface Mp4Box {
  type: string;
  body: number;
  end: number;
}

/** 读取 [from, to) 范围内同一层的 box（只支持 32 位与 64 位长度，测试用的极简读取器） */
function readBoxes(bytes: Uint8Array, from: number, to: number): Mp4Box[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes: Mp4Box[] = [];
  let offset = from;
  while (offset + 8 <= to) {
    let size = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    let header = 8;
    if (size === 1) {
      size = Number(view.getBigUint64(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = to - offset;
    }
    if (size < header) break;
    boxes.push({ type, body: offset + header, end: Math.min(to, offset + size) });
    offset += size;
  }
  return boxes;
}

function child(bytes: Uint8Array, parent: Mp4Box, type: string): Mp4Box | undefined {
  return readBoxes(bytes, parent.body, parent.end).find((box) => box.type === type);
}

interface Mp4Track {
  /** stsd 里的样本类型：avc1 / mp4a … */
  sampleType: string;
  /** tkhd 的显示宽高（16.16 定点数取整数部分） */
  width: number;
  height: number;
  /** avc1 样本描述里的编码宽高（音轨为 0） */
  codedWidth: number;
  codedHeight: number;
  /** mdhd 时长（秒） */
  seconds: number;
}

/** 列出 MP4 的全部轨道（moov → trak → tkhd / mdia → mdhd / minf → stbl → stsd） */
function mp4Tracks(bytes: Uint8Array): Mp4Track[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const moov = readBoxes(bytes, 0, bytes.length).find((box) => box.type === 'moov');
  if (!moov) return [];
  return readBoxes(bytes, moov.body, moov.end)
    .filter((box) => box.type === 'trak')
    .map((trak) => {
      const tkhd = child(bytes, trak, 'tkhd');
      const mdia = child(bytes, trak, 'mdia');
      const mdhd = mdia && child(bytes, mdia, 'mdhd');
      const minf = mdia && child(bytes, mdia, 'minf');
      const stbl = minf && child(bytes, minf, 'stbl');
      const stsd = stbl && child(bytes, stbl, 'stsd');
      // stsd：版本 / 标志 4 字节 + 条目数 4 字节，之后是样本描述 box
      const entry = stsd ? readBoxes(bytes, stsd.body + 8, stsd.end)[0] : undefined;
      let seconds = 0;
      if (mdhd) {
        const v1 = bytes[mdhd.body] === 1;
        const timescale = view.getUint32(mdhd.body + (v1 ? 20 : 12));
        const duration = v1
          ? Number(view.getBigUint64(mdhd.body + 24))
          : view.getUint32(mdhd.body + 16);
        seconds = timescale ? duration / timescale : 0;
      }
      // VisualSampleEntry：保留 6 + 数据引用 2 + 预定义 / 保留 16 字节之后是宽、高（各 2 字节）
      const visual = entry?.type === 'avc1';
      return {
        sampleType: entry?.type ?? '',
        width: tkhd ? view.getUint32(tkhd.end - 8) >>> 16 : 0,
        height: tkhd ? view.getUint32(tkhd.end - 4) >>> 16 : 0,
        codedWidth: visual && entry ? view.getUint16(entry.body + 24) : 0,
        codedHeight: visual && entry ? view.getUint16(entry.body + 26) : 0,
        seconds,
      };
    });
}

describe('示例场景视频（第一场 清晨的青石镇）', () => {
  it('分镜.json 能被 GUI 读取：5 个镜头、对白 / 音效 / 声音 / 预演 / 首帧 / 成片都保留', async () => {
    const layout = sampleSceneLayout();
    const raw = JSON.parse(await readFile(inWork(layout.storyboardJson), 'utf-8')) as unknown;
    expect(raw).toEqual(buildSampleSceneState());
    const state = parseSceneVideoState(raw);
    expect(state).not.toBeNull();
    if (!state) return;
    expect(state.storyboard.shots.map((shot) => shot.id)).toEqual([
      'shot-1',
      'shot-2',
      'shot-3',
      'shot-4',
      'shot-5',
    ]);
    expect(
      state.storyboard.shots.flatMap((shot) => shot.dialogue ?? []).map((l) => l.speaker)
    ).toEqual(['narrator', '小石头', '林舟', '小石头']);
    expect(state.storyboard.shots.filter((shot) => shot.sfx?.length).length).toBe(3);
    expect(state.audio).toMatchObject({ language: 'zh-CN', ducking: true });
    expect(state.audio.bgm).toMatchObject({ source: 'file', path: SAMPLE_AUDIO.bgm });
    expect(state.audio.ambience?.path).toBe(SAMPLE_AUDIO.town);
    expect(Object.keys(state.keyframes)).toHaveLength(5);
    expect(Object.keys(state.chosenVersions)).toEqual(['shot-1', 'shot-2']);
    expect(Object.keys(state.previzScripts)).toEqual(['shot-1']);
    // AI 风格的关节轨迹：重新校验后仍然完整
    const script = state.previzScripts['shot-1'];
    const validation = validatePrevizScript(script);
    expect(validation.ok).toBe(true);
    expect(script.figures[0].keys.some((key) => key.motion?.tracks?.head?.length)).toBe(true);
    // 读取时不会改写（打开画布不会因为解析差异而写回文件）
    expect(state.storyboard.shots).toEqual(
      (raw as { storyboard: { shots: unknown } }).storyboard.shots
    );
  });

  it('章节路径相对作品目录，从资料打开时解析到真实章节；场景正文与章节一致', async () => {
    const layout = sampleSceneLayout();
    const stateFile = inWork(layout.storyboardJson);
    const target = sceneVideoTargetFromStoryboard(await readFile(stateFile, 'utf-8'), stateFile);
    expect(target?.scene).toBe('第一场 清晨的青石镇');
    const chapter = await readFile(String(target?.chapterPath), 'utf-8');
    const start = chapter.indexOf('第一场 清晨的青石镇') + '第一场 清晨的青石镇'.length;
    const end = chapter.indexOf('第二场');
    expect(chapter.slice(start, end).trim()).toBe(SAMPLE_SCENE_SOURCE);
  });

  it('引用的媒体都存在，文件名符合命名规则，格式与扩展名一致', async () => {
    const files = sampleSceneMediaFiles();
    expect(files.length).toBeGreaterThanOrEqual(12);
    for (const relative of files) {
      const name = path.posix.basename(relative);
      const bytes = await bytesOf(relative);
      expect(bytes.byteLength, relative).toBeGreaterThan(1000);
      if (name.endsWith('.m4a')) {
        expect(parseDialogueAudioFileName(name), name).not.toBeNull();
        expect(detectAudioFormat(bytes), name).toBe('m4a');
      } else if (name.endsWith('.mp4')) {
        expect(
          Boolean(parseShotFileName(name) || isAnimaticFileName(name) || parsePrevizFileName(name)),
          name
        ).toBe(true);
        expect(String.fromCharCode(...bytes.subarray(4, 8)), name).toBe('ftyp');
      }
      // 成片 / 样片 / 首帧 / 预演 / 配音是作者可见的媒体，不是内部数据
      expect(classifyWorkspaceEntry(`${SAMPLE_SCENE_WORK}/${relative}`).kind, relative).toBe(
        'user'
      );
    }
    const layout = sampleSceneLayout();
    expect(classifyWorkspaceEntry(`${SAMPLE_SCENE_WORK}/${layout.storyboardJson}`).kind).toBe(
      'internal'
    );
    expect(classifyWorkspaceEntry(`${SAMPLE_SCENE_WORK}/${layout.storyboardMarkdown}`).kind).toBe(
      'derived'
    );
  });

  it('成片与样片是 1280 × 720 的 H.264，并带 AAC 音轨（与画面等长）；预演是无声的动作参考', async () => {
    const dir = SAMPLE_SCENE.dir;
    const outputs = SAMPLE_SCENE.shots.flatMap((shot) =>
      'output' in shot && shot.output ? [shot.output] : []
    );
    expect(outputs).toEqual(['镜头1-v1.mp4', '镜头2-v1.mp4']);
    for (const name of [...outputs, SAMPLE_SCENE.animatic]) {
      const tracks = mp4Tracks(await bytesOf(`${dir}/${name}`));
      const video = tracks.find((track) => track.sampleType === 'avc1');
      const audio = tracks.find((track) => track.sampleType === 'mp4a');
      expect(video, `${name} 应有 H.264 画面`).toMatchObject({
        width: 1280,
        height: 720,
        codedWidth: 1280,
        codedHeight: 720,
      });
      expect(audio, `${name} 应有 AAC 音轨`).toBeDefined();
      if (!video || !audio) continue;
      // AAC 按 1024 个样本一帧，结尾最多多出一帧左右
      expect(Math.abs(audio.seconds - video.seconds), name).toBeLessThan(0.2);
    }
    const previz = mp4Tracks(await bytesOf(`${dir}/${samplePrevizFile(1, 'mp4')}`));
    expect(previz.map((track) => track.sampleType)).toEqual(['avc1']);
    expect(previz[0]).toMatchObject({ width: 1280, height: 720 });
  });

  it('配乐 / 环境音 / 音效都是 AAC（M4A），总共不超过 400KB', async () => {
    let total = 0;
    for (const relative of Object.values(SAMPLE_AUDIO)) {
      const bytes = await bytesOf(relative);
      expect(detectAudioFormat(bytes), relative).toBe('m4a');
      total += bytes.byteLength;
    }
    const scene = sampleSceneMediaFiles().filter((file) => file.endsWith('.m4a'));
    for (const relative of scene) total += (await stat(inWork(relative))).size;
    expect(total).toBeLessThan(400 * 1024);
  });
});

describe('声音示例.md', () => {
  it('每个 ::audio 都指向存在的文件；格式检查没有问题', async () => {
    const text = await readFile(path.join(SAMPLE_DATA_DIR, '声音示例.md'), 'utf-8');
    expect(lintNovelMarkup(text)).toEqual([]);
    const sources = text
      .split('\n')
      .map((line) => audioDirectiveSource(line))
      .filter((item): item is NonNullable<typeof item> => item !== null);
    expect(sources.length).toBeGreaterThanOrEqual(9);
    for (const source of sources) {
      const info = await stat(path.join(SAMPLE_DATA_DIR, ...source.src.split('/')));
      expect(info.isFile(), source.src).toBe(true);
    }
    expect(sources.filter((item) => item.loop).length).toBeGreaterThanOrEqual(3);
    expect(sources.some((item) => item.caption.includes('示例占位音'))).toBe(true);
  });
});
