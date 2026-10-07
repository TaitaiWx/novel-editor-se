// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Shot, VideoTask } from '@novel-editor/video';
import {
  SHOT_REFERENCE_LIMIT,
  referencePathsFor,
  useSceneVideoTasks,
} from '@/render/components/SceneVideoView/useSceneVideoTasks';
import {
  createSceneVideoState,
  replaceStoryboardShots,
  type SceneTaskRef,
  type SceneVideoState,
} from '@/render/components/SceneVideoView/sceneVideoState';
import { installElectronMock, uninstallElectronMock } from '../../hooks/electronMock';

const REF: SceneTaskRef = {
  workPath: '/p/novels/星河旅人',
  chapter: '001-启程',
  scene: '第一场 清晨的青石镇',
};

function shot(partial: Partial<Shot> = {}): Shot {
  return { id: 'x', shotSize: '中景', durationSec: 6, description: '林舟站在镇口', ...partial };
}

function sceneState(shots: Shot[]): SceneVideoState {
  const base = createSceneVideoState(
    {
      chapterPath: '/p/novels/星河旅人/第一卷-离乡/001-启程.md',
      chapter: REF.chapter,
      scene: REF.scene,
      sourceText: '石板路还湿着。',
      characters: ['林舟', '苏晴'],
      location: '青石镇',
    },
    new Date('2026-10-07T08:00:00.000Z')
  );
  return replaceStoryboardShots(base, shots);
}

function task(partial: Partial<VideoTask>): VideoTask {
  return {
    id: 't1',
    providerId: 'minimax-video',
    ...REF,
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
  } as VideoTask;
}

afterEach(() => uninstallElectronMock());

describe('referencePathsFor', () => {
  const references = {
    林舟: ['资料/图集/人物/林舟/三视图.png', '资料/图集/人物/林舟/形象.png'],
    苏晴: ['资料/图集/人物/苏晴/三视图.png', '资料/图集/人物/林舟/形象.png'],
    秦伯: ['a.png', 'b.png', 'c.png'],
  };

  it('没有参考图时返回空', () => {
    expect(referencePathsFor(shot(), { characters: ['林舟'] }, undefined)).toEqual([]);
  });

  it('镜头没有标注人物时用整场出场人物；去重保持顺序', () => {
    expect(referencePathsFor(shot(), { characters: ['林舟', '苏晴', '无图'] }, references)).toEqual(
      [
        '资料/图集/人物/林舟/三视图.png',
        '资料/图集/人物/林舟/形象.png',
        '资料/图集/人物/苏晴/三视图.png',
      ]
    );
    expect(
      referencePathsFor(shot({ characters: [] }), { characters: ['苏晴'] }, references)
    ).toEqual(references.苏晴);
  });

  it('镜头标注了人物时只用镜头人物，最多 4 张', () => {
    expect(
      referencePathsFor(shot({ characters: ['苏晴'] }), { characters: ['林舟'] }, references)
    ).toEqual(references.苏晴);
    const paths = referencePathsFor(
      shot({ characters: ['林舟', '秦伯'] }),
      { characters: [] },
      references
    );
    expect(paths).toHaveLength(SHOT_REFERENCE_LIMIT);
    expect(paths).toEqual([...references.林舟, 'a.png', 'b.png']);
  });
});

describe('useSceneVideoTasks.submitShots', () => {
  it('提交时带上人物参考图与已采用的首帧；没有时不带这两个字段', async () => {
    const submitted: Record<string, unknown>[] = [];
    const mock = installElectronMock((channel, payload) => {
      if (channel === 'video-task-list') return { ok: true, data: [] };
      if (channel === 'video-task-submit') {
        const body = payload as Record<string, unknown>;
        submitted.push(body);
        return {
          ok: true,
          data: task({ id: `t${submitted.length}`, shotIndex: Number(body.shotIndex) }),
        };
      }
      return null;
    });
    const { result } = renderHook(() => useSceneVideoTasks(REF));
    await waitFor(() =>
      expect(mock.invoke).toHaveBeenCalledWith('video-task-list', { workPath: REF.workPath })
    );

    let state = sceneState([
      shot({ characters: ['林舟'] }),
      shot({ description: '苏晴回头', characters: ['无图'] }),
    ]);
    state = { ...state, keyframes: { 'shot-1': '资料/视频/001-启程/场景/首帧-1.png' } };
    let outcome: Awaited<ReturnType<typeof result.current.submitShots>> | null = null;
    await act(async () => {
      outcome = await result.current.submitShots({
        state,
        shots: state.storyboard.shots,
        providerId: 'minimax-video',
        model: 'video-01',
        references: { 林舟: ['资料/图集/人物/林舟/三视图.png'] },
      });
    });
    expect(outcome).toEqual({ submitted: 2, errors: [] });
    expect(submitted).toHaveLength(2);
    expect(submitted[0]).toMatchObject({
      providerId: 'minimax-video',
      model: 'video-01',
      ...REF,
      shotIndex: 1,
      durationSec: 6,
      aspectRatio: state.aspectRatio,
      referencePaths: ['资料/图集/人物/林舟/三视图.png'],
      firstFramePath: '资料/视频/001-启程/场景/首帧-1.png',
    });
    expect(submitted[1].shotIndex).toBe(2);
    // 没有传 withAudio（服务不支持生成声音）时不发送该字段
    expect('withAudio' in submitted[0]).toBe(false);
    expect('referencePaths' in submitted[1]).toBe(false);
    expect('firstFramePath' in submitted[1]).toBe(false);
    expect(result.current.tasks.map((item) => item.id)).toEqual(['t2', 't1']);
  });

  it('跳过没有画面描述的镜头；提交失败后不再继续', async () => {
    let calls = 0;
    installElectronMock((channel) => {
      if (channel === 'video-task-list') return { ok: true, data: [] };
      if (channel === 'video-task-submit') {
        calls += 1;
        return { ok: false, error: { message: '超出预算' } };
      }
      return null;
    });
    const { result } = renderHook(() => useSceneVideoTasks(REF));
    const state = sceneState([shot({ description: '  ' }), shot(), shot()]);
    let outcome: Awaited<ReturnType<typeof result.current.submitShots>> | null = null;
    await act(async () => {
      outcome = await result.current.submitShots({
        state,
        shots: state.storyboard.shots,
        providerId: 'minimax-video',
      });
    });
    expect(calls).toBe(1);
    expect(outcome).toEqual({
      submitted: 0,
      errors: ['有镜头还没有画面描述，已跳过', '超出预算'],
    });
  });
});

describe('useSceneVideoTasks.submitShots · 生成声音', () => {
  it('视频服务支持生成声音时把开关带进每个任务', async () => {
    const submitted: Record<string, unknown>[] = [];
    installElectronMock((channel, payload) => {
      if (channel === 'video-task-list') return { ok: true, data: [] };
      if (channel === 'video-task-submit') {
        submitted.push(payload as Record<string, unknown>);
        return { ok: true, data: task({ id: `a${submitted.length}`, shotIndex: 1 }) };
      }
      return null;
    });
    const { result } = renderHook(() => useSceneVideoTasks(REF));
    const state = sceneState([shot()]);
    await act(async () => {
      await result.current.submitShots({
        state,
        shots: state.storyboard.shots,
        providerId: 'seedance-video',
        withAudio: true,
      });
    });
    expect(submitted[0]).toMatchObject({ providerId: 'seedance-video', withAudio: true });
  });
});
