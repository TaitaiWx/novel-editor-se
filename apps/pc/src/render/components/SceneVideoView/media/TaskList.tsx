import React from 'react';
import type { VideoTask } from '@/render/types/ai-api';
import { describeTaskStatus } from '../sceneVideoState';
import styles from './styles.module.scss';

export interface TaskListProps {
  tasks: readonly VideoTask[];
  /** 镜头编号 → 当前在分镜中的位置（1-based）；已删除的镜头没有 */
  positionByNumber: ReadonlyMap<number, number>;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
}

const SAFETY_TIP = '可以把画面描述写得更含蓄（避免血腥、暴力、真人姓名等），再重试';

function isActive(task: VideoTask): boolean {
  return (
    task.status === 'queued' ||
    task.status === 'submitted' ||
    task.status === 'running' ||
    (task.status === 'succeeded' && !task.outputPath)
  );
}

function tone(task: VideoTask): 'active' | 'done' | 'failed' | 'muted' {
  if (task.status === 'failed') return 'failed';
  if (task.status === 'cancelled') return 'muted';
  if (task.status === 'succeeded' && task.outputPath) return 'done';
  return 'active';
}

/** 任务队列：实时状态（排队 / 生成中 % / 完成 / 失败原因），失败可重试，进行中可取消 */
const TaskList: React.FC<TaskListProps> = ({ tasks, positionByNumber, onCancel, onRetry }) => {
  if (tasks.length === 0) {
    return <p className={styles.muted}>还没有生成任务。选中镜头后点「生成选中镜头」。</p>;
  }
  return (
    <ul className={styles.tasks} aria-label="生成任务">
      {tasks.map((task) => {
        const position = positionByNumber.get(task.shotIndex);
        const label = position ? `镜头 ${position}` : `镜头（已删除 #${task.shotIndex}）`;
        const progress =
          task.status === 'running' && typeof task.progress === 'number' ? task.progress : null;
        return (
          <li key={task.id} className={styles.task} data-status={task.status}>
            <div className={styles.taskHead}>
              <span className={styles.taskName}>
                {label} · v{task.version}
              </span>
              <span className={styles.taskStatus} data-tone={tone(task)}>
                {describeTaskStatus(task)}
              </span>
            </div>
            {progress !== null && (
              <div
                className={styles.progress}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress)}
              >
                <span style={{ width: `${Math.min(100, Math.max(2, progress))}%` }} />
              </div>
            )}
            {task.status === 'failed' && task.error && (
              <p className={styles.taskError}>
                {task.error.message}
                {task.error.code === 'content-safety' && (
                  <span className={styles.taskTip}>{SAFETY_TIP}</span>
                )}
              </p>
            )}
            {task.costEstimate && (
              <span className={styles.taskMeta}>
                预计 {task.costEstimate.currency === 'USD' ? '$' : '¥'}
                {task.costEstimate.amount.toFixed(2)}
              </span>
            )}
            <div className={styles.taskActions}>
              {isActive(task) && (
                <button
                  type="button"
                  className={styles.smallButton}
                  aria-label={`取消 ${label} v${task.version}`}
                  onClick={() => onCancel(task.id)}
                >
                  取消
                </button>
              )}
              {(task.status === 'failed' || task.status === 'cancelled') && (
                <button
                  type="button"
                  className={styles.smallButton}
                  aria-label={`重试 ${label} v${task.version}`}
                  onClick={() => onRetry(task.id)}
                >
                  重试
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
};

export default TaskList;
