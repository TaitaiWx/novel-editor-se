// @vitest-environment happy-dom
import React from 'react';
import { modelInfo } from '../../helpers/aiModel';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { WORKSPACE_FILES_CHANGED_EVENT } from '@/render/utils/workspaceFiles';
import SceneVideoView from '@/render/components/SceneVideoView';
import { setSceneVideoSeed } from '@/render/components/SceneVideoView/events';
import type { VideoTask } from '@novel-editor/video';
import { installElectronMock, uninstallElectronMock } from '../../hooks/electronMock';
import { chooseOption } from '../../helpers/select';

const WORK = '/w/novels/星河旅人';
const CHAPTER_PATH = `${WORK}/第一卷-离乡/001-启程.md`;
const SCENE = '第一场 清晨的青石镇';
const TAB = `__workspace__:scene-video:${CHAPTER_PATH}#${SCENE}`;
const CHAPTER_TEXT = [
  '# 启程',
  '',
  SCENE,
  '',
  '石板路还湿着，林舟回头看了一眼青石镇。',
  '',
  '“舟哥！”小石头光着脚从巷子里跑出来。',
  '',
  '林舟接过饼，揉了揉小石头的头发。',
].join('\n');

const AI_STORYBOARD = JSON.stringify({
  shots: [
    { shotSize: '远景', durationSec: 6, description: '晨雾中的青石镇', camera: '缓慢推近' },
    { shotSize: '中景', durationSec: 4, description: '林舟回头', camera: '固定' },
    { shotSize: '近景', durationSec: 5, description: '小石头跑来', camera: '跟拍' },
    { shotSize: '特写', durationSec: 3, description: '递过来的饼', camera: '推近' },
  ],
});

interface MockOptions {
  textReady?: boolean;
  videoReady?: boolean;
  savedState?: unknown;
  files?: string[];
}

function provider(id: string, kind: 'text' | 'video', ready: boolean) {
  return modelInfo({
    id,
    kind,
    label: id === 'minimax-video' ? 'MiniMax 视频' : id,
    description: '',
    defaultBaseUrl: '',
    defaultModel: 'm1',
    models: ['m1', 'm2'],
    configured: ready,
    secureStorage: true,
    enabled: ready,
    baseUrl: '',
    model: 'm1',
    ...(kind === 'video' ? { pricePerSecond: 0.5, currency: 'CNY' } : {}),
  });
}

let taskSeq = 0;
function makeTask(payload: Record<string, unknown>, patch: Partial<VideoTask> = {}): VideoTask {
  taskSeq += 1;
  return {
    id: `task-${taskSeq}`,
    providerId: String(payload.providerId),
    workPath: String(payload.workPath),
    chapter: String(payload.chapter),
    scene: String(payload.scene),
    shotIndex: Number(payload.shotIndex),
    version: 1,
    prompt: String(payload.prompt),
    params: {},
    status: 'queued',
    attempts: 0,
    maxAttempts: 3,
    pollCount: 0,
    createdAt: taskSeq,
    updatedAt: taskSeq,
    ...patch,
  };
}

function setup(options: MockOptions = {}) {
  const tasks = new Map<string, VideoTask>();
  const electron = installElectronMock((channel, ...args) => {
    const payload = (args[0] ?? {}) as Record<string, unknown>;
    switch (channel) {
      case 'video-scene-load':
        return {
          ok: true,
          data: {
            dir: `${WORK}/资料/视频`,
            state: options.savedState ?? null,
            files: options.files ?? [],
          },
        };
      case 'read-file':
        return CHAPTER_TEXT;
      case 'ai-providers-list':
        return {
          ok: true,
          data: [
            provider('openai-compatible', 'text', options.textReady ?? false),
            provider('minimax-video', 'video', options.videoReady ?? false),
            provider('seedance-video', 'video', false),
          ],
        };
      case 'video-settings-get':
        return { ok: true, data: { maxConcurrent: 2, dailyLimit: 20 } };
      case 'video-task-list':
        return { ok: true, data: [] };
      case 'video-scene-read-file':
        return { ok: true, data: new Uint8Array([0, 0, 0, 24]) };
      case 'db-outline-list-by-folder':
        return [];
      case 'ai-complete':
        return { ok: true, data: { text: `好的：\n${AI_STORYBOARD}` } };
      case 'video-scene-save':
        return {
          ok: true,
          data: { dir: '/d', jsonPath: '/d/分镜.json', markdownPath: '/d/分镜.md' },
        };
      case 'video-task-submit': {
        const task = makeTask(payload);
        tasks.set(task.id, task);
        return { ok: true, data: task };
      }
      case 'video-task-cancel':
      case 'video-task-retry': {
        const task = tasks.get(String(args[0]));
        if (!task) return { ok: false, error: { kind: 'bad-request', message: '视频任务不存在' } };
        const next: VideoTask = {
          ...task,
          status: channel === 'video-task-cancel' ? 'cancelled' : 'queued',
          error: undefined,
        };
        tasks.set(next.id, next);
        return { ok: true, data: next };
      }
      default:
        return null;
    }
  });
  render(
    <SceneVideoView
      tabPath={TAB}
      chapterPath={CHAPTER_PATH}
      scene={SCENE}
      workPath={WORK}
      dbReady
      characters={[{ name: '林舟' }, { name: '小石头', aliases: ['石头'] }, { name: '苏晴' }]}
      loreTitles={['青石镇', '星港城']}
    />
  );
  return { electron, tasks };
}

const calls = (electron: ReturnType<typeof installElectronMock>, channel: string) =>
  electron.invoke.mock.calls.filter(([name]) => name === channel);

/** 画布上的镜头节点 */
const shotNodes = () => screen.queryAllByRole('group', { name: /^镜头 \d+$/ });
const node = (label: string) => screen.getByRole('group', { name: label });

/** 单击画布节点（按下 + 松开，不移动）→ 右侧检查器 */
function selectNode(label: string) {
  const target = node(label);
  fireEvent.pointerDown(target, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
  fireEvent.pointerUp(target, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
  return screen.getByTestId('scene-inspector');
}

function lastSavedState(electron: ReturnType<typeof installElectronMock>) {
  return (calls(electron, 'video-scene-save').at(-1)?.[1] as { state: Record<string, unknown> })
    ?.state;
}

afterEach(() => {
  cleanup();
  uninstallElectronMock();
});

describe('场景视频画布', () => {
  it('打开即自动拆分镜（没有 AI 时按段落）：人物 → 场景 → 镜头 → 样片；分镜.md 自动写入资料并通知刷新', async () => {
    const changed = vi.fn();
    window.addEventListener(WORKSPACE_FILES_CHANGED_EVENT, changed);
    const { electron } = setup();
    await screen.findByTestId('scene-video-view');
    // 自动拆分：不用点任何按钮
    await waitFor(() => expect(shotNodes()).toHaveLength(3));
    expect(calls(electron, 'ai-complete')).toHaveLength(0);
    expect(screen.getByText(/已按段落拆出 3 个镜头/)).toBeTruthy();
    // 节点：正文识别出的人物、场景、镜头、样片；连线 = 人物→场景 ×2 + 场景→镜头1 + 镜头链 ×2 + 镜头3→样片
    expect(node('人物 林舟')).toBeTruthy();
    expect(node('人物 小石头')).toBeTruthy();
    expect(screen.queryByRole('group', { name: '人物 苏晴' })).toBeNull();
    expect(node('场景').textContent).toContain('石板路还湿着');
    expect(node('场景').textContent).toContain('青石镇');
    expect(node('样片').textContent).toContain('0 / 3 个镜头');
    const canvas = screen.getByTestId('scene-canvas');
    expect(canvas.querySelectorAll('path[data-edge]')).toHaveLength(6);
    expect(canvas.querySelectorAll('path[data-edge][class*="edgeDashed"]')).toHaveLength(2);

    // 没有视频服务：工具栏给出配置入口，生成按钮不可用
    expect(await screen.findByTestId('scene-video-no-provider')).toBeTruthy();
    // 拆出的是草稿：先确认分镜
    fireEvent.click(screen.getByTestId('confirm-storyboard'));
    const generate = screen.getByRole('button', { name: '生成 3 个镜头' }) as HTMLButtonElement;
    expect(generate.disabled).toBe(true);
    expect(screen.getByTestId('scene-video-estimate').textContent).toBe(
      '3 个镜头 · 共 18 秒 · 未填写单价，无法预估费用'
    );

    // 修改自动保存：分镜.json 与 分镜.md 一起写入（不再需要「导出分镜表」）
    expect(screen.queryByRole('button', { name: '导出分镜表' })).toBeNull();
    await waitFor(() => expect(calls(electron, 'video-scene-save').length).toBeGreaterThan(0), {
      timeout: 3000,
    });
    const saved = calls(electron, 'video-scene-save')[0][1] as {
      markdown: string;
      chapter: string;
      scene: string;
      workPath: string;
    };
    expect(saved).toMatchObject({ workPath: WORK, chapter: '001-启程', scene: SCENE });
    expect(saved.markdown).toContain('| 1 | 全景 | 6s |');
    // 第一次保存新建了目录：通知文件面板刷新，资料里马上能看到
    await waitFor(() => expect(changed).toHaveBeenCalled());
    window.removeEventListener(WORKSPACE_FILES_CHANGED_EVENT, changed);
  });

  it('有 AI 时自动用 AI 拆分镜；单击镜头在检查器里编辑；费用只计还没有成片的镜头', async () => {
    const { electron } = setup({ textReady: true, videoReady: true });
    await screen.findByTestId('scene-video-view');
    await waitFor(() => expect(shotNodes()).toHaveLength(4));
    expect(calls(electron, 'ai-complete')).toHaveLength(1);
    const [, request] = calls(electron, 'ai-complete')[0] as [
      string,
      { providerId: string; messages: Array<{ role: string; content: string }> },
    ];
    expect(request.providerId).toBe('openai-compatible');
    expect(request.messages[1].content).toContain('石板路还湿着');
    expect(request.messages[1].content).toContain('【地点】青石镇');
    expect(screen.getByText(/AI 拟了 4 个镜头的分镜草稿/)).toBeTruthy();
    expect(node('镜头 2').textContent).toContain('中景 · 4s');
    expect(node('镜头 2').textContent).toContain('林舟回头');
    await screen.findByLabelText('视频模型');
    expect(screen.getByTestId('scene-video-estimate').textContent).toBe(
      '预计 ¥9.00 · 4 个镜头 · 共 18 秒'
    );

    const inspector = selectNode('镜头 2');
    expect(within(inspector).getByLabelText('镜头 2 画面描述')).toHaveProperty('value', '林舟回头');
    expect(node('镜头 2').getAttribute('aria-current')).toBe('true');
    // 单击画布空白处取消选中
    const canvas = screen.getByTestId('scene-canvas');
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 2, clientX: 1, clientY: 1 });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 2, clientX: 1, clientY: 1 });
    expect(screen.queryByTestId('scene-inspector')).toBeNull();
  });

  // 分镜由作者做主：AI 拆出的只是草稿，确认前不能生成（工具栏与节点上的「生成」都不可用）
  it('AI 拆出的分镜是草稿：可以修改、增删；确认前不能生成；确认后保存到 分镜.json，重新拆分又回到草稿', async () => {
    const { electron } = setup({ textReady: true, videoReady: true });
    await screen.findByTestId('scene-video-view');
    await waitFor(() => expect(shotNodes()).toHaveLength(4));
    await screen.findByLabelText('视频模型');
    expect(screen.getByTestId('storyboard-draft-notice').textContent).toContain('确认分镜');
    expect(screen.queryByRole('button', { name: '生成 4 个镜头' })).toBeNull();
    expect((screen.getByRole('button', { name: '生成镜头 1' }) as HTMLButtonElement).disabled).toBe(
      true
    );

    // 改一个镜头的画面描述：清空后不能确认
    const inspector = selectNode('镜头 2');
    const description = within(inspector).getByLabelText('镜头 2 画面描述');
    fireEvent.change(description, { target: { value: '' } });
    fireEvent.blur(description);
    await waitFor(() =>
      expect((screen.getByTestId('confirm-storyboard') as HTMLButtonElement).disabled).toBe(true)
    );
    fireEvent.change(description, { target: { value: '林舟回头望向铁匠铺，烟囱还没冒烟' } });
    fireEvent.blur(description);
    await waitFor(() =>
      expect((screen.getByTestId('confirm-storyboard') as HTMLButtonElement).disabled).toBe(false)
    );
    expect(calls(electron, 'video-task-submit')).toHaveLength(0);

    fireEvent.click(screen.getByTestId('confirm-storyboard'));
    expect(screen.queryByTestId('storyboard-draft-notice')).toBeNull();
    expect(screen.getByRole('button', { name: '生成 4 个镜头' })).toBeTruthy();
    expect((screen.getByRole('button', { name: '生成镜头 1' }) as HTMLButtonElement).disabled).toBe(
      false
    );
    await waitFor(() => {
      const saves = calls(electron, 'video-scene-save');
      const last = saves[saves.length - 1]?.[1] as { state: { storyboardConfirmed?: boolean } };
      expect(last?.state.storyboardConfirmed).toBe(true);
    });
  });

  it('检查器：编辑、前后移、删除、添加镜头；拖动节点保存位置；修改都写回 分镜.json', async () => {
    const { electron } = setup({ textReady: true });
    await screen.findByTestId('scene-video-view');
    await waitFor(() => expect(shotNodes()).toHaveLength(4));

    let inspector = selectNode('镜头 1');
    fireEvent.change(within(inspector).getByLabelText('镜头 1 画面描述'), {
      target: { value: '晨雾里的镇口老槐树' },
    });
    chooseOption('镜头 1 景别', '大远景', within(inspector));
    expect(node('镜头 1').textContent).toContain('晨雾里的镇口老槐树');
    fireEvent.click(within(inspector).getByLabelText('后移镜头 1'));
    expect(node('镜头 2').textContent).toContain('晨雾里的镇口老槐树');
    expect(node('镜头 1').textContent).toContain('林舟回头');

    inspector = selectNode('镜头 4');
    fireEvent.click(within(inspector).getByLabelText('删除镜头 4'));
    expect(shotNodes()).toHaveLength(3);
    expect(screen.queryByTestId('scene-inspector')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '添加镜头' }));
    expect(shotNodes()).toHaveLength(4);
    // 新镜头自动选中，等待补充画面描述
    expect(screen.getByTestId('scene-inspector').getAttribute('aria-label')).toBe('检查器：镜头 4');
    expect(node('镜头 4').textContent).toContain('写一句画面描述后才能生成');

    // 拖动「样片」节点：位置保存到 canvas.positions
    const output = node('样片');
    fireEvent.pointerDown(output, { button: 0, pointerId: 3, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(output, { pointerId: 3, clientX: 160, clientY: 140 });
    fireEvent.pointerUp(output, { pointerId: 3, clientX: 160, clientY: 140 });

    await waitFor(
      () => {
        const last = lastSavedState(electron) as {
          storyboard: { shots: Array<{ id: string; description: string; shotSize: string }> };
          canvas: { positions: Record<string, { x: number; y: number }> };
        };
        expect(last.storyboard.shots.map((shot) => shot.id)).toEqual([
          'shot-2',
          'shot-1',
          'shot-3',
          'shot-5',
        ]);
        expect(last.storyboard.shots[1]).toMatchObject({
          description: '晨雾里的镇口老槐树',
          shotSize: '大远景',
        });
        expect(last.canvas.positions.output).toBeDefined();
      },
      { timeout: 3000 }
    );
  });

  it('「生成 N 个镜头」只提交没有成片的镜头；节点实时显示进度 / 失败；检查器里重试与取消', async () => {
    const { electron } = setup({ textReady: true, videoReady: true });
    await screen.findByTestId('scene-video-view');
    await waitFor(() => expect(shotNodes()).toHaveLength(4));
    await screen.findByLabelText('视频模型');
    fireEvent.click(screen.getByTestId('confirm-storyboard'));
    fireEvent.click(screen.getByRole('button', { name: '生成 4 个镜头' }));
    await waitFor(() => expect(calls(electron, 'video-task-submit')).toHaveLength(4));
    const submitted = calls(electron, 'video-task-submit').map(
      ([, payload]) => payload as Record<string, unknown>
    );
    expect(submitted[0]).toMatchObject({
      providerId: 'minimax-video',
      model: 'm1',
      workPath: WORK,
      chapter: '001-启程',
      scene: SCENE,
      shotIndex: 1,
      durationSec: 6,
      aspectRatio: '16:9',
    });
    expect(String(submitted[0].prompt)).toContain('晨雾中的青石镇');
    // 已提交的镜头不再计入「生成」
    await waitFor(() => expect(screen.getByRole('button', { name: '镜头都已生成' })).toBeTruthy());

    const [first, second] = submitted;
    electron.emit(
      'video-task-updated',
      makeTask(first, { id: 'task-1', status: 'running', progress: 42 })
    );
    expect(await within(node('镜头 1')).findByText('生成中 42%')).toBeTruthy();
    electron.emit(
      'video-task-updated',
      makeTask(second, {
        id: 'task-2',
        status: 'failed',
        error: { code: 'content-safety', message: '内容未通过安全审核', retryable: false },
      })
    );
    expect(await within(node('镜头 2')).findByText(/生成失败：内容未通过安全审核/)).toBeTruthy();
    // 失败的镜头重新计入「生成」，节点上可以直接重新生成
    expect(await screen.findByRole('button', { name: '生成 1 个镜头' })).toBeTruthy();
    expect(within(node('镜头 2')).getByRole('button', { name: '重新生成镜头 2' })).toBeTruthy();

    let inspector = selectNode('镜头 2');
    const taskList = within(inspector).getByRole('list', { name: '生成任务' });
    expect(within(taskList).getByText(/可以把画面描述写得更含蓄/)).toBeTruthy();
    fireEvent.click(within(taskList).getByRole('button', { name: '重试 镜头 2 v1' }));
    await waitFor(() => expect(electron.invoke).toHaveBeenCalledWith('video-task-retry', 'task-2'));

    inspector = selectNode('镜头 1');
    fireEvent.click(within(inspector).getByRole('button', { name: '取消 镜头 1 v1' }));
    await waitFor(() =>
      expect(electron.invoke).toHaveBeenCalledWith('video-task-cancel', 'task-1')
    );
    // 其他场景的任务不显示
    electron.emit('video-task-updated', makeTask({ ...first, scene: '别的场' }, { id: 'x' }));
    expect(within(screen.getByTestId('scene-inspector')).getAllByRole('listitem')).toHaveLength(1);
  });

  it('重新打开：从 分镜.json 恢复（不再自动拆分）；成片显示在节点上；第一个成片后自动记录到章纲', async () => {
    setSceneVideoSeed(TAB, { sourceText: '这次选中的另一段文字', origin: 'selection' });
    const savedState = {
      schemaVersion: 1,
      chapterPath: CHAPTER_PATH,
      chapter: '001-启程',
      scene: SCENE,
      sourceText: '保存过的场景正文',
      location: '星港城',
      characters: ['苏晴'],
      style: '水墨',
      aspectRatio: '9:16',
      shotDurationSec: 8,
      providerId: null,
      useAvatarReference: false,
      storyboard: {
        version: 1,
        aspectRatio: '9:16',
        shots: [{ id: 'shot-3', shotSize: '特写', durationSec: 8, description: '保存的镜头' }],
      },
      nextShotNumber: 4,
      selectedShotIds: ['shot-3'],
      chosenVersions: {},
      canvas: { positions: { scene: { x: 400, y: 300 } } },
      updatedAt: '2026-10-07T00:00:00.000Z',
    };
    const { electron } = setup({ savedState, files: ['镜头3-v1.mp4', '镜头3-v2.mp4'] });
    await screen.findByTestId('scene-video-view');
    expect(node('场景').textContent).toContain('保存过的场景正文');
    expect(node('场景').style.left).toBe('400px');
    expect(shotNodes()).toHaveLength(1);
    expect(node('镜头 1').textContent).toContain('v2 / 2');
    expect(calls(electron, 'read-file')).toHaveLength(0);
    expect(calls(electron, 'ai-complete')).toHaveLength(0);
    expect(screen.getByRole('combobox', { name: '风格' }).textContent).toBe('水墨');

    // 已有成片：自动在本章章纲里记录一次（分镜表 + 成片路径），并记下已记录
    await waitFor(() =>
      expect(electron.invoke).toHaveBeenCalledWith(
        'db-outline-list-by-folder',
        WORK,
        expect.objectContaining({ kind: 'chapter', path: CHAPTER_PATH })
      )
    );
    await waitFor(() => expect(lastSavedState(electron)?.outlineLinked).toBe(true), {
      timeout: 3000,
    });

    // 版本：检查器里预览 / 选用
    let inspector = selectNode('镜头 1');
    expect(within(inspector).getByRole('button', { name: '预览 镜头 1 v2' })).toBeTruthy();
    fireEvent.click(within(inspector).getByRole('button', { name: '选用 镜头 1 v1' }));
    expect(node('镜头 1').textContent).toContain('v1 / 2');

    // 带入的选段与保存的不同：场景检查器里提示，不覆盖
    inspector = selectNode('场景');
    expect(within(inspector).getByText(/这次选中的文字与保存的场景正文不同/)).toBeTruthy();
    fireEvent.click(within(inspector).getByRole('button', { name: '用选中的文字替换' }));
    expect(within(inspector).getByLabelText(/场景正文/)).toHaveProperty(
      'value',
      '这次选中的另一段文字'
    );
  });

  it('画布缩放按钮与「适应画布」；所有图标按钮都有 tooltip', async () => {
    setup({ textReady: true });
    await screen.findByTestId('scene-video-view');
    await waitFor(() => expect(shotNodes()).toHaveLength(4));
    const zoom = screen.getByRole('toolbar', { name: '画布缩放' });
    const value = () => zoom.textContent?.match(/\d+%/)?.[0];
    const before = value();
    fireEvent.click(within(zoom).getByRole('button', { name: '放大' }));
    expect(value()).not.toBe(before);
    fireEvent.click(within(zoom).getByRole('button', { name: '适应画布' }));
    expect(value()).toBe(before);

    for (const label of ['放大', '缩小', '适应画布', '添加镜头', '在资料中查看', '重新拆分镜']) {
      const button = screen.getByRole('button', { name: label });
      fireEvent.mouseEnter(button.parentElement as HTMLElement);
      expect((await screen.findByRole('tooltip')).textContent).toBeTruthy();
      fireEvent.mouseLeave(button.parentElement as HTMLElement);
      await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
    }
  });
});
