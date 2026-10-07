import { describe, expect, it } from 'vitest';
import type { Shot, VideoTask } from '@novel-editor/video';
import {
  NODE_WIDTH,
  OUTPUT_NODE_ID,
  PORT_OFFSET_Y,
  SCENE_NODE_ID,
  SHOTS_PER_ROW,
  FIT_ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_MIN,
  characterNodeId,
  clampZoom,
  edgePath,
  fitViewport,
  layoutSceneCanvas,
  zoomAround,
} from '@/render/components/SceneVideoView/canvasLayout';
import {
  animaticSignatureFor,
  createSceneVideoState,
  parseCanvasState,
  parseSceneVideoState,
  removeShot,
  replaceStoryboardShots,
  shotProgress,
  shotsNeedingGeneration,
  shouldAutoStitch,
  type SceneVideoState,
} from '@/render/components/SceneVideoView/sceneVideoState';
import {
  isSceneStoryboardFile,
  sceneVideoTargetFromStoryboard,
} from '@/render/components/SceneVideoView/events';

const shot = (id: string, description = '画面'): Shot => ({
  id,
  shotSize: '中景',
  durationSec: 6,
  description,
});

function stateWith(shots: Shot[], patch: Partial<SceneVideoState> = {}): SceneVideoState {
  const base = createSceneVideoState(
    { chapterPath: '/w/001-启程.md', chapter: '001-启程', scene: '第一场', sourceText: '正文' },
    new Date(0)
  );
  return {
    ...base,
    storyboard: { ...base.storyboard, shots },
    nextShotNumber: shots.length + 1,
    ...patch,
  };
}

function task(shotIndex: number, patch: Partial<VideoTask> = {}): VideoTask {
  return {
    id: `t${shotIndex}-${patch.status ?? 'queued'}`,
    providerId: 'minimax-video',
    workPath: '/w',
    chapter: '001-启程',
    scene: '第一场',
    shotIndex,
    version: 1,
    prompt: 'p',
    params: {},
    status: 'queued',
    attempts: 0,
    maxAttempts: 3,
    pollCount: 0,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

describe('画布布局', () => {
  it('从左到右：人物 → 场景 → 镜头（每行 4 个，换行继续）→ 样片；连线按顺序', () => {
    const shots = Array.from({ length: 5 }, (_, index) => shot(`shot-${index + 1}`));
    const { nodes, edges } = layoutSceneCanvas({
      characters: ['林舟', '苏晴'],
      shots,
      canvas: { positions: {} },
    });
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const scene = byId.get(SCENE_NODE_ID)!;
    expect(byId.get(characterNodeId('林舟'))!.x).toBe(0);
    expect(byId.get(characterNodeId('苏晴'))!.y).toBeGreaterThan(0);
    expect(scene.x).toBeGreaterThan(NODE_WIDTH.character);
    const first = byId.get('shot-1')!;
    expect(first.x).toBeGreaterThan(scene.x + scene.width);
    // 第 5 个镜头换到第二行，与第 1 个对齐
    expect(byId.get(`shot-${SHOTS_PER_ROW + 1}`)!.x).toBe(first.x);
    expect(byId.get(`shot-${SHOTS_PER_ROW + 1}`)!.y).toBeGreaterThan(first.y);
    // 样片在最后一个镜头右侧的同一行（连线不斜穿画布）
    expect(byId.get(OUTPUT_NODE_ID)!.x).toBeGreaterThan(byId.get('shot-5')!.x);
    expect(byId.get(OUTPUT_NODE_ID)!.y).toBe(byId.get('shot-5')!.y);
    expect(edges.map((edge) => `${edge.from}>${edge.to}`)).toEqual([
      'character:林舟>scene',
      'character:苏晴>scene',
      'scene>shot-1',
      'shot-1>shot-2',
      'shot-2>shot-3',
      'shot-3>shot-4',
      'shot-4>shot-5',
      'shot-5>output',
    ]);
    expect(edges.filter((edge) => edge.dashed)).toHaveLength(2);
  });

  it('没有人物时场景在最左；没有镜头时不连样片；拖动过的节点用保存的位置', () => {
    const { nodes, edges } = layoutSceneCanvas({
      characters: [],
      shots: [],
      canvas: { positions: { output: { x: 900, y: 40 } } },
    });
    expect(nodes.find((node) => node.id === SCENE_NODE_ID)!.x).toBe(0);
    expect(nodes.find((node) => node.id === OUTPUT_NODE_ID)).toMatchObject({ x: 900, y: 40 });
    expect(edges).toEqual([]);
  });

  it('连线从上游右侧端口到下游左侧端口（标题行高度）', () => {
    const from = { id: 'a', kind: 'shot' as const, x: 0, y: 0, width: 100, height: 10 };
    const to = { id: 'b', kind: 'shot' as const, x: 300, y: 50, width: 100, height: 10 };
    const path = edgePath(from, to);
    expect(path.startsWith(`M 100 ${PORT_OFFSET_Y} C`)).toBe(true);
    expect(path.endsWith(`300 ${50 + PORT_OFFSET_Y}`)).toBe(true);
  });

  it('适应画布：放得下时居中且不放大超过 100%；放不下时不小于最小缩放并从左上角开始；缩放以指针为中心', () => {
    const nodes = [
      { id: 'a', kind: 'scene' as const, x: 0, y: 0, width: 1000, height: 400 },
      { id: 'b', kind: 'shot' as const, x: 1500, y: 0, width: 500, height: 400 },
    ];
    const viewport = fitViewport(nodes, { width: 1096, height: 800 });
    // 宽度需要 0.5 倍才能放下 → 保持最小缩放并贴左；高度放得下仍然垂直居中
    expect(viewport.zoom).toBe(FIT_ZOOM_MIN);
    expect(viewport).toMatchObject({ x: 48, y: 256 });
    // 0.8 倍就能放下 → 居中
    const fitted = fitViewport(nodes, { width: 1696, height: 1000 });
    expect(fitted.zoom).toBeCloseTo(0.8, 2);
    expect(fitted.x).toBe(48);
    expect(fitted.y).toBe(Math.round((1000 - 400 * fitted.zoom) / 2));
    expect(fitViewport(nodes.slice(0, 1), { width: 4000, height: 4000 }).zoom).toBe(1);
    expect(fitViewport([], { width: 100, height: 100 })).toEqual({ x: 0, y: 0, zoom: 1 });

    const zoomed = zoomAround({ x: 0, y: 0, zoom: 1 }, 1.5, { x: 100, y: 100 });
    expect(zoomed).toEqual({ x: -50, y: -50, zoom: 1.5 });
    expect(clampZoom(100)).toBe(ZOOM_MAX);
    expect(clampZoom(0)).toBe(ZOOM_MIN);
    expect(clampZoom(Number.NaN)).toBe(1);
  });
});

describe('画布状态与自动化', () => {
  it('canvas.positions：读取时丢弃无效坐标；重新拆分镜清掉旧镜头位置，删除镜头同时删位置', () => {
    expect(
      parseCanvasState({
        positions: { scene: { x: 1.4, y: 2 }, bad: { x: 'a', y: 1 }, far: { x: 1e9, y: 0 } },
      })
    ).toEqual({ positions: { scene: { x: 1, y: 2 } } });
    expect(parseCanvasState(null)).toEqual({ positions: {} });

    const state = stateWith([shot('shot-1'), shot('shot-2')], {
      canvas: {
        positions: { scene: { x: 1, y: 1 }, 'shot-1': { x: 5, y: 5 }, 'shot-2': { x: 9, y: 9 } },
      },
    });
    expect(replaceStoryboardShots(state, [shot('x')]).canvas.positions).toEqual({
      scene: { x: 1, y: 1 },
    });
    expect(Object.keys(removeShot(state, 'shot-1').canvas.positions)).toEqual(['scene', 'shot-2']);

    const parsed = parseSceneVideoState({
      ...state,
      canvas: { positions: { output: { x: 3, y: 4 } } },
      animaticSignature: 'a|b',
      outlineLinked: true,
    });
    expect(parsed?.canvas.positions.output).toEqual({ x: 3, y: 4 });
    expect(parsed?.animaticSignature).toBe('a|b');
    expect(parsed?.outlineLinked).toBe(true);
    // 旧文件没有 canvas 字段
    const legacy = { ...state } as Partial<SceneVideoState>;
    delete legacy.canvas;
    expect(parseSceneVideoState(legacy)?.canvas).toEqual({ positions: {} });
  });

  it('镜头状态：进行中 > 已有成片（选用的版本）> 最近失败 > 未生成', () => {
    const state = stateWith([shot('shot-1'), shot('shot-2'), shot('shot-3'), shot('shot-4')]);
    const files = ['镜头2-v1.mp4', '镜头2-v2.mp4', '分镜.json'];
    const tasks = [
      task(1, { status: 'running', progress: 30 }),
      task(3, { status: 'failed', error: { code: 'x', message: '超时', retryable: true } }),
    ];
    expect(shotProgress(state, state.storyboard.shots[0], files, tasks)).toEqual({
      kind: 'active',
      text: '生成中 30%',
      progress: 30,
    });
    expect(shotProgress(state, state.storyboard.shots[1], files, tasks)).toEqual({
      kind: 'done',
      fileName: '镜头2-v2.mp4',
      version: 2,
      versions: 2,
    });
    expect(shotProgress(state, state.storyboard.shots[2], files, tasks)).toEqual({
      kind: 'failed',
      text: '超时',
    });
    expect(shotProgress(state, state.storyboard.shots[3], files, tasks)).toEqual({ kind: 'empty' });
    // 「生成」只计没有成片、没有进行中任务、且有画面描述的镜头
    const withBlank = {
      ...state,
      storyboard: { ...state.storyboard, shots: [...state.storyboard.shots, shot('shot-5', ' ')] },
    };
    expect(shotsNeedingGeneration(withBlank, files, tasks).map((item) => item.id)).toEqual([
      'shot-3',
      'shot-4',
    ]);
  });

  it('自动合成样片：全部镜头都有成片、没有进行中任务、版本组合与上次不同时才合成', () => {
    const state = stateWith([shot('shot-1'), shot('shot-2')]);
    expect(animaticSignatureFor(state, ['镜头1-v1.mp4'])).toBeNull();
    const files = ['镜头1-v1.mp4', '镜头2-v3.mp4'];
    expect(animaticSignatureFor(state, files)).toBe('镜头1-v1.mp4|镜头2-v3.mp4');
    expect(shouldAutoStitch(state, files, [])).toBe('镜头1-v1.mp4|镜头2-v3.mp4');
    expect(shouldAutoStitch(state, files, [task(2, { status: 'running' })])).toBeNull();
    expect(
      shouldAutoStitch({ ...state, animaticSignature: '镜头1-v1.mp4|镜头2-v3.mp4' }, files, [])
    ).toBeNull();
    // 换了选用的版本 → 重新合成
    expect(
      shouldAutoStitch(
        {
          ...state,
          animaticSignature: '镜头1-v1.mp4|镜头2-v3.mp4',
          chosenVersions: { 'shot-1': '镜头1-v2.mp4' },
        },
        [...files, '镜头1-v2.mp4'],
        []
      )
    ).toBe('镜头1-v2.mp4|镜头2-v3.mp4');
    expect(shouldAutoStitch(stateWith([]), files, [])).toBeNull();
  });

  it('资料里的 分镜.json 识别为场景画布；内容不完整时按普通文件打开', () => {
    expect(isSceneStoryboardFile('/w/novels/星河旅人/资料/视频/001-启程/第一场/分镜.json')).toBe(
      true
    );
    expect(isSceneStoryboardFile('C:\\w\\资料\\视频\\001\\第一场\\分镜.json')).toBe(true);
    expect(isSceneStoryboardFile('/w/资料/视频/001-启程/分镜.json')).toBe(false);
    expect(isSceneStoryboardFile('/w/资料/视频/001/第一场/分镜.md')).toBe(false);
    expect(
      sceneVideoTargetFromStoryboard(JSON.stringify({ chapterPath: '/w/001.md', scene: '第一场' }))
    ).toEqual({ chapterPath: '/w/001.md', scene: '第一场' });
    expect(sceneVideoTargetFromStoryboard('{"scene":"第一场"}')).toBeNull();
    expect(sceneVideoTargetFromStoryboard('not json')).toBeNull();
  });
});
