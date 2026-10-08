import { describe, expect, it } from 'vitest';
import { animaticFileName, isAnimaticFileName, videoSceneLayout } from '@novel-editor/video';
import type { VideoTask } from '@novel-editor/video';
import {
  animaticFiles,
  appendShot,
  buildShotVideoPrompt,
  chapterNameFromPath,
  chosenVersionFor,
  confirmStoryboard,
  createSceneVideoState,
  describeTaskStatus,
  estimateSceneCost,
  isSceneTask,
  latestTaskForShot,
  moveShot,
  outlineLinkEntry,
  parseSceneVideoState,
  removeShot,
  renumberShots,
  replaceStoryboardShots,
  sceneRelativeDir,
  shotNumber,
  shotVersionsFromFiles,
  storyboardConfirmBlocker,
  updateShot,
  type SceneVideoState,
} from '@/render/components/SceneVideoView/sceneVideoState';
import {
  createSceneVideoWorkspaceTab,
  isWorkspaceTab,
  parseSceneVideoWorkspaceTab,
} from '@/render/utils/workspace';

const NOW = new Date('2026-10-07T08:00:00.000Z');

function baseState(): SceneVideoState {
  return createSceneVideoState(
    {
      chapterPath: '/p/novels/星河旅人/第一卷-离乡/001-启程.md',
      chapter: '001-启程',
      scene: '第一场 清晨的青石镇',
      sourceText: '石板路还湿着。',
      characters: ['林舟'],
      location: '青石镇',
    },
    NOW
  );
}

const shot = (description: string, id = 'x') => ({
  id,
  shotSize: '中景' as const,
  durationSec: 6,
  description,
});

function task(partial: Partial<VideoTask>): VideoTask {
  return {
    id: 't',
    providerId: 'minimax-video',
    workPath: '/p/novels/星河旅人',
    chapter: '001-启程',
    scene: '第一场 清晨的青石镇',
    shotIndex: 1,
    version: 1,
    prompt: 'p',
    params: {},
    status: 'queued',
    attempts: 0,
    maxAttempts: 3,
    pollCount: 0,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

describe('路径与标签', () => {
  it('场景目录与 分镜.json / 分镜.md 落在 资料/视频/<章>/<场景>/，名称经过清洗', () => {
    expect(chapterNameFromPath('/a/b/001-启程.md')).toBe('001-启程');
    expect(chapterNameFromPath('C:\\a\\002-迷雾.txt')).toBe('002-迷雾');
    expect(sceneRelativeDir('001-启程', '第一场 清晨的青石镇')).toBe(
      '资料/视频/001-启程/第一场 清晨的青石镇'
    );
    expect(videoSceneLayout({ chapter: '../外面', scene: 'a/b:c' })).toMatchObject({
      dir: '资料/视频/外面/abc',
      storyboardJson: '资料/视频/外面/abc/分镜.json',
      storyboardMarkdown: '资料/视频/外面/abc/分镜.md',
    });
  });

  it('样片文件名带本地时间戳', () => {
    const name = animaticFileName(new Date(2026, 9, 7, 9, 5, 3), 'mp4');
    expect(name).toBe('样片-20261007-090503.mp4');
    expect(isAnimaticFileName(name)).toBe(true);
    expect(isAnimaticFileName('样片-1.mp4')).toBe(false);
  });

  it('工作区标签 __workspace__:scene-video:<章路径>#<场景>，场景名里的 # 被替换', () => {
    const tab = createSceneVideoWorkspaceTab({ chapterPath: '/p/a#b/001.md', scene: '第一场 #1' });
    expect(tab).toBe('__workspace__:scene-video:/p/a#b/001.md#第一场 ＃1');
    expect(isWorkspaceTab(tab)).toBe(true);
    expect(parseSceneVideoWorkspaceTab(tab)).toEqual({
      chapterPath: '/p/a#b/001.md',
      scene: '第一场 ＃1',
    });
    expect(parseSceneVideoWorkspaceTab('__workspace__:scene-video:#x')).toBeNull();
    expect(parseSceneVideoWorkspaceTab('/p/001.md')).toBeNull();
  });
});

describe('状态持久化', () => {
  it('生成声音默认开启；关闭后保存并恢复；旧文件没有该字段时视为开启', () => {
    const state = baseState();
    expect(state.withAudio).toBe(true);
    const off = parseSceneVideoState(JSON.parse(JSON.stringify({ ...state, withAudio: false })));
    expect(off?.withAudio).toBe(false);
    const legacy = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    delete legacy.withAudio;
    expect(parseSceneVideoState(legacy)?.withAudio).toBe(true);
  });

  it('JSON 往返后完全一致（含空画面描述的新镜头）', () => {
    let state = replaceStoryboardShots(baseState(), [shot('月夜'), shot('雪原')]);
    state = appendShot(state);
    const restored = parseSceneVideoState(JSON.parse(JSON.stringify(state)));
    expect(restored).toEqual(state);
    expect(restored?.storyboard.shots[2].description).toBe('');
  });

  it('结构不对时返回 null；缺字段补默认值；无效的选中 / 选用版本被丢弃', () => {
    expect(parseSceneVideoState(null)).toBeNull();
    expect(parseSceneVideoState({ schemaVersion: 2, chapter: 'a', scene: 'b' })).toBeNull();
    expect(parseSceneVideoState({ schemaVersion: 1, chapter: '', scene: 'b' })).toBeNull();
    const parsed = parseSceneVideoState({
      schemaVersion: 1,
      chapter: '001',
      scene: '雪夜',
      storyboard: { shots: [{ id: 'abc', description: '远山', durationSec: '99' }] },
      selectedShotIds: ['missing', 'shot-1'],
      chosenVersions: { 'shot-1': '镜头1-v2.mp4', ghost: '镜头9-v1.mp4' },
      shotDurationSec: 100,
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.storyboard.shots[0]).toMatchObject({ id: 'shot-1', durationSec: 15 });
    expect(parsed?.nextShotNumber).toBe(2);
    expect(parsed?.selectedShotIds).toEqual(['shot-1']);
    expect(parsed?.chosenVersions).toEqual({ 'shot-1': '镜头1-v2.mp4' });
    expect(parsed?.shotDurationSec).toBe(6);
    expect(parsed?.style).toBe('写实');
  });

  it('镜头编号只增不减：重新生成分镜、删除后新增都不复用旧编号', () => {
    let state = replaceStoryboardShots(baseState(), [shot('a'), shot('b')]);
    expect(state.storyboard.shots.map((item) => item.id)).toEqual(['shot-1', 'shot-2']);
    expect(state.selectedShotIds).toEqual(['shot-1', 'shot-2']);
    state = removeShot(state, 'shot-2');
    state = appendShot(state);
    expect(state.storyboard.shots.map((item) => item.id)).toEqual(['shot-1', 'shot-3']);
    state = replaceStoryboardShots(state, [shot('c')]);
    expect(state.storyboard.shots.map((item) => item.id)).toEqual(['shot-4']);
    expect(shotNumber({ id: 'shot-4' })).toBe(4);
    expect(shotNumber({ id: 'abc' })).toBeNull();
    expect(renumberShots([shot('a'), shot('b')], 7).next).toBe(9);
  });

  it('首帧 / 预演截图：只保留存在的镜头与安全的相对路径，并随 JSON 往返', () => {
    const parsed = parseSceneVideoState({
      schemaVersion: 1,
      chapter: '001',
      scene: '雪夜',
      storyboard: {
        shots: [
          { id: 'shot-1', description: 'a' },
          { id: 'shot-2', description: 'b' },
        ],
      },
      keyframes: {
        'shot-1': ' 资料/视频/001/雪夜/首帧-1.png ',
        'shot-2': '../外面.png',
        ghost: '资料/a.png',
      },
      previz: {
        'shot-1': '/etc/passwd',
        'shot-2': '资料/视频/001/雪夜/预演-2.png',
        'shot-3': '资料/b.png',
      },
    });
    expect(parsed?.keyframes).toEqual({ 'shot-1': '资料/视频/001/雪夜/首帧-1.png' });
    expect(parsed?.previz).toEqual({ 'shot-2': '资料/视频/001/雪夜/预演-2.png' });
    expect(parseSceneVideoState(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);

    const rejected = parseSceneVideoState({
      schemaVersion: 1,
      chapter: '001',
      scene: '雪夜',
      storyboard: { shots: [{ id: 'shot-1', description: 'a' }] },
      keyframes: { 'shot-1': 'C:/x.png' },
      previz: { 'shot-1': '资料//a.png' },
    });
    expect(rejected?.keyframes).toEqual({});
    expect(rejected?.previz).toEqual({});
    for (const value of ['', '   ', 7, null]) {
      const state = parseSceneVideoState({
        schemaVersion: 1,
        chapter: '001',
        scene: '雪夜',
        storyboard: { shots: [{ id: 'shot-1', description: 'a' }] },
        keyframes: { 'shot-1': value },
        previz: 'not-a-map',
      });
      expect(state?.keyframes).toEqual({});
      expect(state?.previz).toEqual({});
    }
    expect(baseState().keyframes).toEqual({});
    expect(baseState().previz).toEqual({});
  });

  it('预演视频与预演脚本：只保留存在的镜头与安全路径，脚本重新校验（数值夹到范围内）', () => {
    const parsed = parseSceneVideoState({
      schemaVersion: 1,
      chapter: '001',
      scene: '雪夜',
      storyboard: {
        shots: [
          { id: 'shot-1', description: 'a' },
          { id: 'shot-2', description: 'b' },
        ],
      },
      previzVideo: { 'shot-1': '资料/视频/001/雪夜/镜头1-预演.mp4', 'shot-2': '../x.mp4' },
      previzScripts: {
        'shot-1': {
          durationSec: 99,
          figures: [{ name: 'A', keys: [{ t: 0, x: 50, z: 0, pose: 'stand' }] }],
          camera: [{ shotSize: 'medium' }],
        },
        'shot-2': 'broken',
        ghost: { figures: [], camera: [] },
      },
    });
    expect(parsed?.previzVideo).toEqual({ 'shot-1': '资料/视频/001/雪夜/镜头1-预演.mp4' });
    expect(Object.keys(parsed?.previzScripts ?? {})).toEqual(['shot-1']);
    expect(parsed?.previzScripts['shot-1']).toMatchObject({ durationSec: 10 });
    expect(parsed?.previzScripts['shot-1'].figures[0].keys[0].x).toBe(8);
    expect(parseSceneVideoState(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    expect(baseState().previzVideo).toEqual({});
    expect(baseState().previzScripts).toEqual({});
  });

  it('删除镜头时移除它的首帧 / 预演；重新生成分镜时全部清空', () => {
    let state = replaceStoryboardShots(baseState(), [shot('a'), shot('b')]);
    state = {
      ...state,
      keyframes: { 'shot-1': '资料/k1.png', 'shot-2': '资料/k2.png' },
      previz: { 'shot-1': '资料/p1.png', 'shot-2': '资料/p2.png' },
      previzVideo: { 'shot-1': '资料/p1.mp4', 'shot-2': '资料/p2.mp4' },
    };
    const removed = removeShot(state, 'shot-1');
    expect(removed.previzVideo).toEqual({ 'shot-2': '资料/p2.mp4' });
    expect(removed.keyframes).toEqual({ 'shot-2': '资料/k2.png' });
    expect(removed.previz).toEqual({ 'shot-2': '资料/p2.png' });
    // 不修改原状态
    expect(state.keyframes['shot-1']).toBe('资料/k1.png');
    const replaced = replaceStoryboardShots(removed, [shot('c')]);
    expect(replaced.keyframes).toEqual({});
    expect(replaced.previz).toEqual({});
    expect(replaced.previzVideo).toEqual({});
  });

  it('排序与编辑', () => {
    const state = replaceStoryboardShots(baseState(), [shot('a'), shot('b'), shot('c')]);
    const moved = moveShot(state.storyboard.shots, 'shot-3', 'shot-1');
    expect(moved.map((item) => item.description)).toEqual(['c', 'a', 'b']);
    expect(moveShot(moved, 'shot-1', 'nope')).toEqual(moved);
    const edited = updateShot(state, 'shot-2', { camera: '横移' });
    expect(edited.storyboard.shots[1].camera).toBe('横移');
  });
});

describe('版本、任务与费用', () => {
  const files = ['镜头1-v1.mp4', '镜头1-v2.mp4', '镜头1-v1.prompt.json', '镜头2-v1.mp4', '分镜.md'];

  it('镜头版本（新版本在前）与选用版本', () => {
    expect(shotVersionsFromFiles(files, 1)).toEqual([
      { fileName: '镜头1-v2.mp4', version: 2 },
      { fileName: '镜头1-v1.mp4', version: 1 },
    ]);
    let state = replaceStoryboardShots(baseState(), [shot('a'), shot('b')]);
    expect(chosenVersionFor(state, state.storyboard.shots[0], files)).toBe('镜头1-v2.mp4');
    state = { ...state, chosenVersions: { 'shot-1': '镜头1-v1.mp4' } };
    expect(chosenVersionFor(state, state.storyboard.shots[0], files)).toBe('镜头1-v1.mp4');
    state = { ...state, chosenVersions: { 'shot-1': '镜头1-v9.mp4' } };
    expect(chosenVersionFor(state, state.storyboard.shots[0], files)).toBe('镜头1-v2.mp4');
    expect(
      animaticFiles(['样片-20261007-090000.mp4', '样片-20261008-090000.webm', 'x.mp4'])
    ).toEqual(['样片-20261008-090000.webm', '样片-20261007-090000.mp4']);
  });

  it('任务归属与状态文案', () => {
    const ref = {
      workPath: '/p/novels/星河旅人',
      chapter: '001-启程',
      scene: '第一场 清晨的青石镇',
    };
    expect(isSceneTask(task({}), ref)).toBe(true);
    expect(isSceneTask(task({ scene: '别的场' }), ref)).toBe(false);
    const tasks = [
      task({ id: 'a', createdAt: 1 }),
      task({ id: 'b', createdAt: 5 }),
      task({ id: 'c', shotIndex: 2 }),
    ];
    expect(latestTaskForShot(tasks, 1)?.id).toBe('b');
    expect(latestTaskForShot(tasks, 3)).toBeNull();
    expect(describeTaskStatus(task({ status: 'running', progress: 41.6 }))).toBe('生成中 42%');
    expect(describeTaskStatus(task({ status: 'succeeded' }))).toBe('下载中');
    expect(describeTaskStatus(task({ status: 'succeeded', outputPath: 'x' }))).toBe('已完成');
    expect(describeTaskStatus(task({ status: 'failed' }))).toBe('失败');
  });

  it('费用预估：未填写单价时只给时长，填写后按每秒单价估算', () => {
    const shots = [shot('a'), { ...shot('b'), durationSec: 4 }];
    expect(estimateSceneCost([], null).text).toBe('还没有选中镜头');
    expect(estimateSceneCost(shots, null)).toEqual({
      shotCount: 2,
      durationSec: 10,
      amount: null,
      text: '2 个镜头 · 共 10 秒 · 未填写单价，无法预估费用',
    });
    expect(estimateSceneCost(shots, { pricePerSecond: 0.35, currency: 'CNY' })).toEqual({
      shotCount: 2,
      durationSec: 10,
      amount: 3.5,
      text: '预计 ¥3.50 · 2 个镜头 · 共 10 秒',
    });
    expect(estimateSceneCost(shots, { pricePerSecond: 0.1, currency: 'USD' }).text).toBe(
      '预计 $1.00 · 2 个镜头 · 共 10 秒'
    );
  });

  it('视频提示词与章纲回链', () => {
    let state = replaceStoryboardShots(baseState(), [
      { ...shot('林舟站在镇口'), camera: '缓慢推近' },
      shot('小石头跑来'),
    ]);
    expect(buildShotVideoPrompt(state.storyboard.shots[0], state)).toBe(
      '写实风格。地点：青石镇。中景，缓慢推近。林舟站在镇口'
    );
    state = { ...state, chosenVersions: { 'shot-2': '镜头2-v1.mp4' } };
    const entry = outlineLinkEntry(state, [...files, '样片-20261007-090000.mp4']);
    expect(entry.title).toBe('场景视频 · 第一场 清晨的青石镇');
    expect(entry.content.split('\n')).toEqual([
      '分镜：资料/视频/001-启程/第一场 清晨的青石镇/分镜.md',
      '样片：资料/视频/001-启程/第一场 清晨的青石镇/样片-20261007-090000.mp4',
      '镜头 1：资料/视频/001-启程/第一场 清晨的青石镇/镜头1-v2.mp4',
      '镜头 2：资料/视频/001-启程/第一场 清晨的青石镇/镜头2-v1.mp4',
    ]);
  });
});

describe('分镜确认（AI 拆出的只是草稿）', () => {
  const shots = [
    { id: 'a', shotSize: '远景' as const, durationSec: 6, description: '雨后镇口' },
    { id: 'b', shotSize: '中景' as const, durationSec: 6, description: '林舟回头' },
  ];

  it('新场景与重新拆分的分镜都是草稿；画面描述齐全才能确认', () => {
    const draft = replaceStoryboardShots(baseState(), shots);
    expect(baseState().storyboardConfirmed).toBe(false);
    expect(draft.storyboardConfirmed).toBe(false);
    expect(storyboardConfirmBlocker(baseState())).toBe('还没有镜头');
    const missing = updateShot(draft, draft.storyboard.shots[1].id, { description: ' ' });
    expect(storyboardConfirmBlocker(missing)).toBe('镜头 2 还没有画面描述');
    expect(confirmStoryboard(missing).storyboardConfirmed).toBe(false);
    const confirmed = confirmStoryboard(draft);
    expect(confirmed.storyboardConfirmed).toBe(true);
    // 重新拆分镜：回到草稿
    expect(replaceStoryboardShots(confirmed, shots).storyboardConfirmed).toBe(false);
  });

  it('读取：保存的值优先；旧版 分镜.json 没有这个字段时，已有镜头视为已确认', () => {
    const confirmed = confirmStoryboard(replaceStoryboardShots(baseState(), shots));
    const roundTrip = parseSceneVideoState(JSON.parse(JSON.stringify(confirmed)));
    expect(roundTrip?.storyboardConfirmed).toBe(true);
    const legacy = JSON.parse(JSON.stringify(confirmed)) as Record<string, unknown>;
    delete legacy.storyboardConfirmed;
    expect(parseSceneVideoState(legacy)?.storyboardConfirmed).toBe(true);
    const emptyLegacy = JSON.parse(JSON.stringify(baseState())) as Record<string, unknown>;
    delete emptyLegacy.storyboardConfirmed;
    expect(parseSceneVideoState(emptyLegacy)?.storyboardConfirmed).toBe(false);
  });
});
