import { isSafeMediaPath } from '@novel-editor/core/entity-media';
/**
 * 场景视频任务 IPC：video-task-submit / list / cancel / retry，video-settings-get / set
 *
 * - 任务保存在当前项目数据库（video_tasks），数据库打开后自动恢复轮询（runtime.onDatabaseOpened）
 * - 渲染进程传入的作品目录必须是存在的绝对路径；若该窗口已上报工作区，还必须位于工作区内
 * - 成片落盘到 <作品>/资料/视频/<章>/<场景>/镜头N-vX.mp4（+ .prompt.json），写入前再次校验路径
 * - 任务每次变化通过 video-task-updated 广播给所有窗口
 * - 场景视频工作区（分镜.json / 分镜.md / 成片预览 / 拼接样片）的读写见 video-scene.ts
 */
import { BrowserWindow, ipcMain } from 'electron';
import { readdir, realpath, stat } from 'fs/promises';
import path from 'path';
import { AIError, toAIError } from '@novel-editor/ai';
import { isDatabaseReady, videoTaskOps } from '@novel-editor/store';
import { perSecondEstimator, type VideoTask } from '@novel-editor/video';
import {
  VIDEO_TASK_EVENT,
  type AIIpcResult,
  type VideoSettingsInfo,
  type VideoTaskSubmitPayload,
} from '../../shared/ai';
import { getAIService, getProviderConfigStore, onDatabaseOpened } from '../ai/runtime';
import { downloadToFile, resolveInsideWork, writeJsonFile } from '../video/download';
import { VideoTaskRunner, type VideoTaskRepo } from '../video/runner';
import { isPathInWorkspace } from './database/workspace-path';
import { getWorkspaceRootForSender } from './session';
import { registerVideoSceneHandlers } from './video-scene';
import { registerSceneAudioHandlers } from './scene-audio';

const MAX_TEXT = 4000;

async function guard<T>(task: () => Promise<T> | T): Promise<AIIpcResult<T>> {
  try {
    return { ok: true, data: await task() };
  } catch (error) {
    return { ok: false, error: toAIError(error).toJSON() };
  }
}

function badRequest(message: string): AIError {
  return new AIError({ kind: 'bad-request', message });
}

function text(value: unknown, field: string, max = 200, required = true): string {
  if (typeof value !== 'string' || (required && !value.trim())) throw badRequest(`缺少${field}`);
  if (value.length > max) throw badRequest(`${field}过长`);
  return value.trim();
}

function optionalText(value: unknown, field: string, max = 200): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return text(value, field, max);
}

/** 校验作品目录：存在的绝对路径（解析符号链接后）；窗口已上报工作区时必须位于其中 */
export async function assertWorkPath(raw: unknown, workspaceRoot: string | null): Promise<string> {
  if (typeof raw !== 'string' || !raw.trim() || !path.isAbsolute(raw)) {
    throw badRequest('无效的作品目录');
  }
  const resolved = path.resolve(raw);
  const info = await stat(resolved).catch(() => null);
  if (!info?.isDirectory()) throw badRequest(`作品目录不存在: ${resolved}`);
  if (workspaceRoot) {
    const [realWork, realRoot] = await Promise.all([
      realpath(resolved),
      realpath(workspaceRoot).catch(() => workspaceRoot),
    ]);
    if (!isPathInWorkspace(realWork, realRoot)) throw badRequest('作品目录不在当前打开的项目内');
  }
  return resolved;
}

/** 白名单校验提交参数 */
export function sanitizeSubmitPayload(raw: unknown): Omit<VideoTaskSubmitPayload, 'workPath'> {
  if (typeof raw !== 'object' || raw === null) throw badRequest('无效的视频任务');
  const payload = raw as Record<string, unknown>;
  const shotIndex = payload.shotIndex;
  if (
    typeof shotIndex !== 'number' ||
    !Number.isInteger(shotIndex) ||
    shotIndex < 1 ||
    shotIndex > 999
  ) {
    throw badRequest('无效的镜头序号');
  }
  const durationSec = payload.durationSec;
  if (
    durationSec !== undefined &&
    (typeof durationSec !== 'number' || !(durationSec > 0 && durationSec <= 60))
  ) {
    throw badRequest('无效的镜头时长');
  }
  const firstFrameImage = optionalText(payload.firstFrameImage, '首帧图', 20 * 1024 * 1024);
  if (firstFrameImage && !/^(https?:\/\/|data:image\/)/i.test(firstFrameImage)) {
    throw badRequest('首帧图只支持 http(s) 地址或 data URL');
  }
  const relativeImage = (value: unknown, label: string): string | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string' || !isSafeMediaPath(value) || value.length > 500) {
      throw badRequest(`无效的${label}路径`);
    }
    return value;
  };
  const firstFramePath = relativeImage(payload.firstFramePath, '首帧图');
  let referencePaths: string[] | undefined;
  if (payload.referencePaths !== undefined) {
    if (!Array.isArray(payload.referencePaths) || payload.referencePaths.length > 4) {
      throw badRequest('参考图最多 4 张');
    }
    referencePaths = payload.referencePaths.map((item) => relativeImage(item, '参考图') as string);
  }
  return {
    providerId: text(payload.providerId, '视频服务', 64),
    model: optionalText(payload.model, '模型', 200),
    chapter: text(payload.chapter, '章节', 200),
    scene: text(payload.scene, '场景', 200),
    shotIndex,
    prompt: text(payload.prompt, '画面描述', MAX_TEXT),
    durationSec: durationSec as number | undefined,
    aspectRatio: optionalText(payload.aspectRatio, '画面比例', 16),
    resolution: optionalText(payload.resolution, '分辨率', 16),
    firstFrameImage,
    ...(firstFramePath ? { firstFramePath } : {}),
    ...(referencePaths?.length ? { referencePaths } : {}),
    ...(payload.withAudio === undefined ? {} : { withAudio: optionalBoolean(payload.withAudio) }),
  };
}

function optionalBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw badRequest('生成声音必须是布尔值');
  return value;
}

const storeRepo: VideoTaskRepo = {
  list: (filter) => (isDatabaseReady() ? videoTaskOps.list<VideoTask>(filter ?? {}) : []),
  get: (id) => (isDatabaseReady() ? videoTaskOps.get<VideoTask>(id) : undefined),
  save: (task) => {
    if (!isDatabaseReady()) throw new Error('数据库未初始化');
    videoTaskOps.save(task);
  },
};

function broadcast(task: VideoTask): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(VIDEO_TASK_EVENT, task);
  }
}

export function createDefaultVideoRunner(): VideoTaskRunner {
  return new VideoTaskRunner({
    repo: storeRepo,
    getProvider: (providerId) => getAIService().getVideoProvider(providerId),
    resolveOutput: resolveInsideWork,
    downloadFile: (url, destination, signal) => downloadToFile(url, destination, { signal }),
    writeJson: writeJsonFile,
    listFiles: (dir) => readdir(dir),
    limits: () => ({ maxConcurrent: getProviderConfigStore().getVideoSettings().maxConcurrent }),
    estimateCost: (query) => {
      const config = getProviderConfigStore().get(query.providerId);
      if (typeof config.pricePerSecond !== 'number') return null;
      return perSecondEstimator(config.pricePerSecond, config.currency ?? 'CNY')(query);
    },
    budget: () => {
      const settings = getProviderConfigStore().getVideoSettings();
      return { dailyLimit: settings.dailyLimit, perTaskLimit: settings.perTaskLimit };
    },
    onChange: broadcast,
    log: (message, error) => console.warn(message, error),
  });
}

export function registerVideoHandlers(
  runner: VideoTaskRunner = createDefaultVideoRunner(),
  workspaceRootFor: (senderId: number | undefined) => string | null = getWorkspaceRootForSender
): VideoTaskRunner {
  // 数据库（项目）打开后恢复未完成的任务
  onDatabaseOpened(() => {
    runner.stop();
    runner.start();
  });

  ipcMain.handle('video-task-submit', (event, raw: unknown) =>
    guard(async () => {
      const payload = sanitizeSubmitPayload(raw);
      const workPath = await assertWorkPath(
        (raw as { workPath?: unknown } | null)?.workPath,
        workspaceRootFor(event?.sender?.id)
      );
      return runner.submit({ ...payload, workPath });
    })
  );
  ipcMain.handle('video-task-list', (_event, filter: unknown) =>
    guard(() => {
      const workPath =
        typeof filter === 'object' &&
        filter !== null &&
        typeof (filter as { workPath?: unknown }).workPath === 'string'
          ? path.resolve((filter as { workPath: string }).workPath)
          : undefined;
      return runner.list(workPath ? { workPath } : undefined);
    })
  );
  ipcMain.handle('video-task-cancel', (_event, id: unknown) =>
    guard(() => runner.cancel(String(id)))
  );
  ipcMain.handle('video-task-retry', (_event, id: unknown) =>
    guard(() => runner.retry(String(id)))
  );
  registerVideoSceneHandlers({ assertWorkPath, workspaceRootFor });
  registerSceneAudioHandlers({ assertWorkPath, workspaceRootFor });
  ipcMain.handle('video-settings-get', () =>
    guard((): VideoSettingsInfo => getProviderConfigStore().getVideoSettings())
  );
  ipcMain.handle('video-settings-set', (_event, update: unknown) =>
    guard(
      (): VideoSettingsInfo =>
        getProviderConfigStore().updateVideoSettings(
          typeof update === 'object' && update !== null
            ? (update as Partial<VideoSettingsInfo>)
            : {}
        )
    )
  );
  return runner;
}
