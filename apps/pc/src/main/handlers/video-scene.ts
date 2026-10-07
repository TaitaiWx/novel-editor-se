/**
 * 场景视频工作区 IPC：video-scene-load / save / read-file / write-animatic
 *
 * 场景目录固定为 <作品>/资料/视频/<章>/<场景>/（@novel-editor/video 的 videoSceneLayout），
 * 渲染进程只能传入 作品目录 + 章 / 场景名称 + 文件名，主进程负责：
 * - 作品目录必须是存在的绝对路径，且位于该窗口打开的项目内（assertWorkPath）
 * - 章 / 场景名称清洗为单个路径段，路径解析后（含符号链接）不得逃出作品目录
 * - 读写的文件名只允许 分镜.json / 分镜.md / 镜头N-vX.<ext> / 样片-*.mp4|webm
 */
import { ipcMain } from 'electron';
import { readdir, readFile, realpath, stat, writeFile } from 'fs/promises';
import path from 'path';
import { AIError, toAIError } from '@novel-editor/ai';
import {
  animaticFileName,
  isAnimaticFileName,
  parseShotFileName,
  videoSceneLayout,
} from '@novel-editor/video';
import type {
  AIIpcResult,
  VideoSceneLoadResult,
  VideoSceneRef,
  VideoSceneSaveResult,
} from '../../shared/ai';
import { resolveInsideWork, writeJsonFile } from '../video/download';

/** 分镜.json 上限（作者编辑的文本，正常远小于此） */
const MAX_STATE_BYTES = 2 * 1024 * 1024;
const MAX_MARKDOWN_CHARS = 1024 * 1024;
/** 预览 / 拼接读取的单个视频上限 */
export const MAX_SCENE_VIDEO_BYTES = 512 * 1024 * 1024;
/** 拼接样片写入上限 */
const MAX_ANIMATIC_BYTES = 1024 * 1024 * 1024;

export interface VideoSceneHandlerDeps {
  assertWorkPath(raw: unknown, workspaceRoot: string | null): Promise<string>;
  workspaceRootFor(senderId: number | undefined): string | null;
}

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

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function sceneName(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`缺少${field}`);
  if (value.length > 200) throw badRequest(`${field}过长`);
  return value.trim();
}

/** 只允许场景目录里的成片 / 样片文件名（不能带路径分隔符） */
export function isAllowedSceneMediaName(name: unknown): name is string {
  if (typeof name !== 'string' || !name || name.length > 120) return false;
  if (/[/\\\0]/.test(name)) return false;
  return Boolean(parseShotFileName(name)) || isAnimaticFileName(name);
}

interface ResolvedScene {
  workPath: string;
  layout: ReturnType<typeof videoSceneLayout>;
  /** 场景目录绝对路径（未解析符号链接，可能不存在） */
  dir: string;
}

async function resolveScene(
  raw: unknown,
  deps: VideoSceneHandlerDeps,
  senderId: number | undefined
): Promise<ResolvedScene> {
  if (typeof raw !== 'object' || raw === null) throw badRequest('无效的场景');
  const ref = raw as Partial<VideoSceneRef>;
  const workPath = await deps.assertWorkPath(ref.workPath, deps.workspaceRootFor(senderId));
  const layout = videoSceneLayout({
    chapter: sceneName(ref.chapter, '章节'),
    scene: sceneName(ref.scene, '场景'),
  });
  return { workPath, layout, dir: path.resolve(workPath, ...layout.segments) };
}

/** 场景目录内已存在文件的真实路径（经符号链接也必须在作品目录内）；不存在时返回 null */
async function existingFileInside(workPath: string, file: string): Promise<string | null> {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return null;
  const [realRoot, realFile] = await Promise.all([realpath(workPath), realpath(file)]);
  if (!isInside(realRoot, realFile)) throw badRequest('文件经符号链接指向了作品目录之外');
  return realFile;
}

export async function loadScene(scene: ResolvedScene): Promise<VideoSceneLoadResult> {
  const jsonFile = await existingFileInside(
    scene.workPath,
    path.join(scene.dir, path.basename(scene.layout.storyboardJson))
  );
  let state: unknown = null;
  if (jsonFile) {
    const info = await stat(jsonFile);
    if (info.size > MAX_STATE_BYTES) throw badRequest('分镜.json 过大');
    try {
      state = JSON.parse(await readFile(jsonFile, 'utf-8')) as unknown;
    } catch {
      // 文件损坏时当作没有保存过（渲染进程会重新生成；原文件在下次保存前保留）
      state = null;
    }
  }
  const entries = await readdir(scene.dir, { withFileTypes: true }).catch(() => []);
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  return { dir: scene.dir, state, files };
}

export function registerVideoSceneHandlers(deps: VideoSceneHandlerDeps): void {
  ipcMain.handle('video-scene-load', (event, raw: unknown) =>
    guard(async () => loadScene(await resolveScene(raw, deps, event?.sender?.id)))
  );

  ipcMain.handle('video-scene-save', (event, raw: unknown) =>
    guard(async (): Promise<VideoSceneSaveResult> => {
      const scene = await resolveScene(raw, deps, event?.sender?.id);
      const payload = raw as { state?: unknown; markdown?: unknown };
      if (typeof payload.state !== 'object' || payload.state === null) {
        throw badRequest('缺少分镜内容');
      }
      const serialized = JSON.stringify(payload.state);
      if (serialized.length > MAX_STATE_BYTES) throw badRequest('分镜内容过大');
      const jsonPath = await resolveInsideWork(scene.workPath, scene.layout.storyboardJson);
      await writeJsonFile(jsonPath, payload.state);
      const result: VideoSceneSaveResult = { dir: path.dirname(jsonPath), jsonPath };
      if (payload.markdown !== undefined) {
        if (typeof payload.markdown !== 'string' || payload.markdown.length > MAX_MARKDOWN_CHARS) {
          throw badRequest('分镜表内容无效');
        }
        const markdownPath = await resolveInsideWork(
          scene.workPath,
          scene.layout.storyboardMarkdown
        );
        await writeFile(markdownPath, payload.markdown, 'utf-8');
        result.markdownPath = markdownPath;
      }
      return result;
    })
  );

  ipcMain.handle('video-scene-read-file', (event, raw: unknown) =>
    guard(async (): Promise<Uint8Array> => {
      const scene = await resolveScene(raw, deps, event?.sender?.id);
      const fileName = (raw as { fileName?: unknown }).fileName;
      if (!isAllowedSceneMediaName(fileName)) throw badRequest('不支持读取该文件');
      const file = await existingFileInside(scene.workPath, path.join(scene.dir, fileName));
      if (!file) throw new AIError({ kind: 'bad-request', message: '视频文件不存在' });
      const info = await stat(file);
      if (info.size > MAX_SCENE_VIDEO_BYTES) throw badRequest('视频文件过大，无法在应用内预览');
      return new Uint8Array(await readFile(file));
    })
  );

  ipcMain.handle('video-scene-write-animatic', (event, raw: unknown) =>
    guard(async (): Promise<{ fileName: string; path: string }> => {
      const scene = await resolveScene(raw, deps, event?.sender?.id);
      const payload = raw as { ext?: unknown; data?: unknown };
      if (payload.ext !== 'mp4' && payload.ext !== 'webm') throw badRequest('不支持的样片格式');
      if (!(payload.data instanceof Uint8Array) || payload.data.byteLength === 0) {
        throw badRequest('样片内容为空');
      }
      if (payload.data.byteLength > MAX_ANIMATIC_BYTES) throw badRequest('样片过大');
      const fileName = animaticFileName(new Date(), payload.ext);
      const target = await resolveInsideWork(scene.workPath, `${scene.layout.dir}/${fileName}`);
      try {
        await writeFile(target, payload.data, { flag: 'wx' });
      } catch {
        throw badRequest('样片保存失败（可能同名文件已存在），请稍后再试');
      }
      return { fileName, path: target };
    })
  );
}
