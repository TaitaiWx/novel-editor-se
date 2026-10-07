import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Shot } from '@novel-editor/video';
import { VIDEO_TASK_EVENT, type VideoTask } from '@/render/types/ai-api';
import {
  buildShotVideoPrompt,
  isSceneTask,
  shotNumber,
  type SceneTaskRef,
  type SceneVideoState,
} from './sceneVideoState';

export interface SubmitShotsInput {
  state: SceneVideoState;
  shots: readonly Shot[];
  providerId: string;
  model?: string;
  /** 人物名 → 头像（data URL / http 地址），作者勾选「头像作首帧参考」时使用 */
  avatars?: Readonly<Record<string, string>>;
}

export interface SubmitShotsResult {
  submitted: number;
  errors: string[];
}

function upsert(tasks: VideoTask[], task: VideoTask): VideoTask[] {
  const index = tasks.findIndex((item) => item.id === task.id);
  if (index < 0) return [task, ...tasks];
  const next = [...tasks];
  next[index] = task;
  return next;
}

function firstFrameFor(shot: Shot, input: SubmitShotsInput): string | undefined {
  if (!input.state.useAvatarReference || !input.avatars) return undefined;
  for (const name of shot.characters ?? input.state.characters) {
    const avatar = input.avatars[name];
    if (avatar && /^(https?:\/\/|data:image\/)/i.test(avatar)) return avatar;
  }
  return undefined;
}

/**
 * 本场景的视频任务：打开时读取一次列表，之后通过 video-task-updated 实时更新；
 * 提交 / 取消 / 重试都经主进程（任务表在项目数据库中，重启后自动恢复）
 */
export function useSceneVideoTasks(ref: SceneTaskRef | null, onTaskFinished?: () => void) {
  const [tasks, setTasks] = useState<VideoTask[]>([]);
  const refKey = ref ? `${ref.workPath}\n${ref.chapter}\n${ref.scene}` : '';
  const refRef = useRef(ref);
  refRef.current = ref;
  const finishedRef = useRef(onTaskFinished);
  finishedRef.current = onTaskFinished;

  useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    const current = refRef.current;
    setTasks([]);
    if (!ipc || !current) return;
    let cancelled = false;
    void ipc
      .invoke('video-task-list', { workPath: current.workPath })
      .then((result) => {
        if (cancelled || !result.ok) return;
        setTasks(
          result.data
            .filter((task) => isSceneTask(task, current))
            .sort((a, b) => b.createdAt - a.createdAt)
        );
      })
      .catch(() => undefined);
    const dispose = ipc.on?.(VIDEO_TASK_EVENT, (_event: unknown, task: VideoTask) => {
      if (!task || !isSceneTask(task, current)) return;
      setTasks((prev) => upsert(prev, task));
      if (task.status === 'succeeded' && task.outputPath) finishedRef.current?.();
    });
    return () => {
      cancelled = true;
      if (typeof dispose === 'function') dispose();
    };
  }, [refKey]);

  const submitShots = useCallback(async (input: SubmitShotsInput): Promise<SubmitShotsResult> => {
    const ipc = window.electron?.ipcRenderer;
    const current = refRef.current;
    if (!ipc || !current) return { submitted: 0, errors: ['没有打开项目'] };
    const errors: string[] = [];
    let submitted = 0;
    for (const shot of input.shots) {
      const number = shotNumber(shot);
      const prompt = buildShotVideoPrompt(shot, input.state);
      if (number === null || !shot.description.trim()) {
        errors.push('有镜头还没有画面描述，已跳过');
        continue;
      }
      const result = await ipc
        .invoke('video-task-submit', {
          providerId: input.providerId,
          model: input.model,
          workPath: current.workPath,
          chapter: current.chapter,
          scene: current.scene,
          shotIndex: number,
          prompt,
          durationSec: shot.durationSec,
          aspectRatio: input.state.aspectRatio,
          firstFrameImage: firstFrameFor(shot, input),
        })
        .catch((error: unknown) => ({
          ok: false as const,
          error: { message: error instanceof Error ? error.message : String(error) },
        }));
      if (result.ok) {
        submitted += 1;
        setTasks((prev) => upsert(prev, result.data));
      } else {
        errors.push(result.error.message);
        // 预算 / 未配置等错误对后续镜头同样成立，不再继续提交
        break;
      }
    }
    return { submitted, errors: Array.from(new Set(errors)) };
  }, []);

  const runAction = useCallback(
    async (channel: 'video-task-cancel' | 'video-task-retry', id: string) => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) return null;
      const result =
        channel === 'video-task-cancel'
          ? await ipc.invoke('video-task-cancel', id).catch(() => null)
          : await ipc.invoke('video-task-retry', id).catch(() => null);
      if (result?.ok) {
        setTasks((prev) => upsert(prev, result.data));
        return null;
      }
      return result?.error.message ?? '操作失败';
    },
    []
  );

  const activeCount = useMemo(
    () =>
      tasks.filter(
        (task) =>
          task.status === 'queued' ||
          task.status === 'submitted' ||
          task.status === 'running' ||
          (task.status === 'succeeded' && !task.outputPath)
      ).length,
    [tasks]
  );

  return {
    tasks,
    activeCount,
    submitShots,
    cancelTask: (id: string) => runAction('video-task-cancel', id),
    retryTask: (id: string) => runAction('video-task-retry', id),
  };
}

export type SceneVideoTasksApi = ReturnType<typeof useSceneVideoTasks>;
