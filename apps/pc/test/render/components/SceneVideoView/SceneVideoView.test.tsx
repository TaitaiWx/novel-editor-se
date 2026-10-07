// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SceneVideoView from '@/render/components/SceneVideoView';
import { setSceneVideoSeed } from '@/render/components/SceneVideoView/events';
import type { VideoTask } from '@novel-editor/video';
import { installElectronMock, uninstallElectronMock } from '../../hooks/electronMock';

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
  return {
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
  };
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

const shotCards = () => screen.getAllByRole('listitem', { name: /^镜头 \d+$/ });

afterEach(() => {
  cleanup();
  uninstallElectronMock();
});

describe('场景视频工作区', () => {
  it('没有配置视频服务：友好提示，仍可按段落拆分镜并导出分镜表', async () => {
    const { electron } = setup();
    await screen.findByTestId('scene-video-view');
    // 左栏预填：场景正文来自章节里的「第一场」，人物从正文识别，地点来自设定
    const source = screen.getByLabelText(/场景正文/) as HTMLTextAreaElement;
    expect(source.value.startsWith('石板路还湿着')).toBe(true);
    expect(screen.getByLabelText('地点')).toHaveProperty('value', '青石镇');
    expect(screen.getByLabelText('移除人物 林舟')).toBeTruthy();
    expect(screen.getByLabelText('移除人物 小石头')).toBeTruthy();
    expect(screen.queryByLabelText('移除人物 苏晴')).toBeNull();
    expect(await screen.findByText('先在设置中心配置视频服务')).toBeTruthy();
    // 缺头像只做浅色提示，不阻止
    expect(screen.getByText(/补一张林舟的形象图效果更好/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'AI 生成分镜' }));
    await waitFor(() => expect(shotCards()).toHaveLength(3));
    expect(calls(electron, 'ai-complete')).toHaveLength(0);
    expect(screen.getByText(/已按段落拆出 3 个镜头/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: '生成选中镜头' }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(screen.getByTestId('scene-video-estimate').textContent).toBe(
      '3 个镜头 · 共 18 秒 · 未填写单价，无法预估费用'
    );

    fireEvent.click(screen.getByRole('button', { name: '导出分镜表' }));
    await waitFor(() =>
      expect(
        calls(electron, 'video-scene-save').some(
          ([, payload]) => typeof (payload as { markdown?: string }).markdown === 'string'
        )
      ).toBe(true)
    );
    const exported = calls(electron, 'video-scene-save').find(
      ([, payload]) => (payload as { markdown?: string }).markdown
    )?.[1] as { markdown: string; chapter: string; scene: string; workPath: string };
    expect(exported).toMatchObject({ workPath: WORK, chapter: '001-启程', scene: SCENE });
    expect(exported.markdown).toContain('| 1 | 全景 | 6s |');
    expect(
      await screen.findByText(/已导出分镜表：资料\/视频\/001-启程\/第一场 清晨的青石镇\/分镜.md/)
    ).toBeTruthy();
  });

  it('AI 生成分镜：用分镜提示词请求文本服务，结果校验后成为可编辑镜头；显示费用预估', async () => {
    const { electron } = setup({ textReady: true, videoReady: true });
    await screen.findByTestId('scene-video-view');
    await screen.findByLabelText('视频服务');
    fireEvent.click(screen.getByRole('button', { name: 'AI 生成分镜' }));
    await waitFor(() => expect(shotCards()).toHaveLength(4));
    const [, request] = calls(electron, 'ai-complete')[0] as [
      string,
      { providerId: string; messages: Array<{ role: string; content: string }> },
    ];
    expect(request.providerId).toBe('openai-compatible');
    expect(request.messages[1].content).toContain('石板路还湿着');
    expect(request.messages[1].content).toContain('【地点】青石镇');
    expect(screen.getByText(/AI 拆出 4 个镜头/)).toBeTruthy();
    expect(screen.getByLabelText('镜头 2 画面描述')).toHaveProperty('value', '林舟回头');
    // 默认全部选中：6 + 4 + 5 + 3 = 18 秒 × ¥0.5
    expect(screen.getByTestId('scene-video-estimate').textContent).toBe(
      '预计 ¥9.00 · 4 个镜头 · 共 18 秒'
    );
    fireEvent.click(screen.getByLabelText('选择镜头 4'));
    expect(screen.getByTestId('scene-video-estimate').textContent).toBe(
      '预计 ¥7.50 · 3 个镜头 · 共 15 秒'
    );
    expect(screen.getByText('每日上限 ¥20.00')).toBeTruthy();
  });

  it('编辑、排序、删除、添加镜头，修改自动写回 分镜.json', async () => {
    const { electron } = setup({ textReady: true });
    await screen.findByTestId('scene-video-view');
    fireEvent.click(await screen.findByRole('button', { name: 'AI 生成分镜' }));
    await waitFor(() => expect(shotCards()).toHaveLength(4));

    fireEvent.change(screen.getByLabelText('镜头 1 画面描述'), {
      target: { value: '晨雾里的镇口老槐树' },
    });
    fireEvent.change(screen.getByLabelText('镜头 1 景别'), { target: { value: '大远景' } });
    fireEvent.click(screen.getByLabelText('下移镜头 1'));
    expect(screen.getByLabelText('镜头 2 画面描述')).toHaveProperty('value', '晨雾里的镇口老槐树');
    expect(screen.getByLabelText('镜头 1 画面描述')).toHaveProperty('value', '林舟回头');
    fireEvent.click(screen.getByLabelText('删除镜头 4'));
    expect(shotCards()).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: '添加镜头' }));
    expect(shotCards()).toHaveLength(4);
    expect(screen.getByText('写一句画面描述后才能生成')).toBeTruthy();

    await waitFor(
      () => {
        const saves = calls(electron, 'video-scene-save');
        const last = saves.at(-1)?.[1] as {
          state: {
            storyboard: { shots: Array<{ id: string; description: string; shotSize: string }> };
          };
        };
        expect(last.state.storyboard.shots.map((shot) => shot.id)).toEqual([
          'shot-2',
          'shot-1',
          'shot-3',
          'shot-5',
        ]);
        expect(last.state.storyboard.shots[1]).toMatchObject({
          description: '晨雾里的镇口老槐树',
          shotSize: '大远景',
        });
      },
      { timeout: 3000 }
    );
  });

  it('生成选中镜头 → 任务列表随 video-task-updated 实时更新；失败显示原因并可重试，进行中可取消', async () => {
    const { electron } = setup({ textReady: true, videoReady: true });
    await screen.findByTestId('scene-video-view');
    await screen.findByLabelText('视频服务');
    fireEvent.click(screen.getByRole('button', { name: 'AI 生成分镜' }));
    await waitFor(() => expect(shotCards()).toHaveLength(4));
    fireEvent.click(screen.getByLabelText('选择镜头 3'));
    fireEvent.click(screen.getByLabelText('选择镜头 4'));
    fireEvent.click(screen.getByRole('button', { name: '生成选中镜头' }));

    await waitFor(() => expect(calls(electron, 'video-task-submit')).toHaveLength(2));
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
    expect(submitted[1]).toMatchObject({ shotIndex: 2 });
    const taskList = await screen.findByRole('list', { name: '生成任务' });
    await waitFor(() => expect(within(taskList).getAllByRole('listitem')).toHaveLength(2));

    const [first, second] = calls(electron, 'video-task-submit').map(
      ([, payload]) => payload as Record<string, unknown>
    );
    const firstTask = makeTask(first, { id: 'task-1', status: 'running', progress: 42 });
    electron.emit('video-task-updated', firstTask);
    expect(await within(taskList).findByText('生成中 42%')).toBeTruthy();
    // 镜头卡片同步显示状态
    expect(
      within(screen.getByRole('listitem', { name: '镜头 1' })).getByText('生成中 42%')
    ).toBeTruthy();

    electron.emit(
      'video-task-updated',
      makeTask(second, {
        id: 'task-2',
        status: 'failed',
        error: { code: 'content-safety', message: '内容未通过安全审核', retryable: false },
      })
    );
    expect(await within(taskList).findByText(/内容未通过安全审核/)).toBeTruthy();
    expect(within(taskList).getByText(/可以把画面描述写得更含蓄/)).toBeTruthy();

    fireEvent.click(within(taskList).getByRole('button', { name: '重试 镜头 2 v1' }));
    await waitFor(() => expect(electron.invoke).toHaveBeenCalledWith('video-task-retry', 'task-2'));
    fireEvent.click(within(taskList).getByRole('button', { name: '取消 镜头 1 v1' }));
    await waitFor(() =>
      expect(electron.invoke).toHaveBeenCalledWith('video-task-cancel', 'task-1')
    );
    expect(await within(taskList).findByText('已取消')).toBeTruthy();

    // 其他场景的任务不显示
    electron.emit('video-task-updated', makeTask({ ...first, scene: '别的场' }, { id: 'x' }));
    expect(within(taskList).getAllByRole('listitem')).toHaveLength(2);
  });

  it('重新打开：从 分镜.json 恢复；带入的选段与保存的不同时只提示，不覆盖', async () => {
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
      updatedAt: '2026-10-07T00:00:00.000Z',
    };
    const { electron } = setup({ savedState, files: ['镜头3-v1.mp4', '镜头3-v2.mp4'] });
    await screen.findByTestId('scene-video-view');
    expect(screen.getByLabelText(/场景正文/)).toHaveProperty('value', '保存过的场景正文');
    expect(screen.getByLabelText('镜头 1 画面描述')).toHaveProperty('value', '保存的镜头');
    expect(screen.getByRole('radio', { name: '水墨' }).getAttribute('aria-checked')).toBe('true');
    expect(calls(electron, 'read-file')).toHaveLength(0);
    // 已有成片版本：可预览 / 选用 / 对比
    expect(screen.getByRole('button', { name: '预览 镜头 1 v2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '选用 镜头 1 v1' })).toBeTruthy();

    expect(screen.getByText(/这次选中的文字与保存的场景正文不同/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '用选中的文字替换' }));
    expect(screen.getByLabelText(/场景正文/)).toHaveProperty('value', '这次选中的另一段文字');
  });
});
