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
import { SAMPLE_AUDIO, SAMPLE_SCENE_WORK } from '../../scripts/sample-media/scene.mjs';

const WORK = path.join(SAMPLE_DATA_DIR, ...SAMPLE_SCENE_WORK.split('/'));
const inWork = (relative: string) => path.join(WORK, ...relative.split('/'));

async function bytesOf(relative: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(inWork(relative)));
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
