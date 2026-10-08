/**
 * 人物 / 设定图集 IPC
 *
 * - entity-image-save：保存一张图片到 <作品>/资料/图集/人物|设定/<名称>/<时间>-<哈希>.<扩展名>，
 *   AI 生成的图片同时写同名 .prompt.json（提示词、服务、模型），返回相对作品目录的路径
 * - entity-image-delete：删除图集里的一张图片（只允许 资料/图集/ 下的文件）
 * - ai-image-generate：用已配置的图片服务生成 1–4 张候选图（不落盘，作者挑选后再 entity-image-save）；
 *   参考图只能是作品目录内的图片文件（主进程读取后转成 data URL 交给厂商）
 *
 * 不信任渲染进程：作品目录必须存在且位于窗口已上报的工作区内；图片按文件头识别格式、限制大小；
 * 文件名由主进程生成；所有路径经 resolveInsideWork 校验（拒绝 `..` 与符号链接逃逸）。
 */
import { ipcMain } from 'electron';
import { createHash } from 'crypto';
import { mkdir, rename, unlink, writeFile } from 'fs/promises';
import path from 'path';
import {
  ENTITY_MEDIA_ROOT,
  ENTITY_MEDIA_SUBDIR,
  isSafeMediaPath,
  type EntityKind,
} from '@novel-editor/core/entity-media';
import { toAIError, type SerializedAIError } from '@novel-editor/ai';
import { getAIService } from '../ai/runtime';
import { resolveInsideWork } from '../video/download';
import { assertWorkDir, detectImageExtension, sanitizeAvatarBaseName } from './character-avatar';
import {
  MAX_ENTITY_IMAGE_BYTES,
  MAX_REFERENCE_IMAGES,
  MIME_BY_EXT,
  loadReferenceImages,
  resolveExistingInsideWork,
} from '../media-files';

export { loadReferenceImages, resolveExistingInsideWork };
import { getWorkspaceRootForSender } from './session';

export { MAX_ENTITY_IMAGE_BYTES, MAX_REFERENCE_IMAGES };
const MAX_PROMPT_CHARS = 2000;

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

function stamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours()
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export interface EntityImageSaveInput {
  entity: EntityKind;
  name: string;
  data: Uint8Array;
  prompt?: string;
  providerId?: string;
  model?: string;
}

function parseSaveInput(raw: unknown): EntityImageSaveInput {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  if (input.entity !== 'character' && input.entity !== 'lore') throw new Error('无效的图集类型');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) {
    throw new Error('无效的名称');
  }
  const data = toBytes(input.data);
  if (!data || data.length === 0) throw new Error('没有读取到图片内容');
  const text = (value: unknown, max: number) =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
  return {
    entity: input.entity,
    name: input.name,
    data,
    prompt: text(input.prompt, MAX_PROMPT_CHARS),
    providerId: text(input.providerId, 60),
    model: text(input.model, 120),
  };
}

export async function saveEntityImage(
  workPathRaw: unknown,
  raw: unknown,
  workspaceRoot: string | null,
  now: Date = new Date()
): Promise<{ relativePath: string }> {
  const workPath = await assertWorkDir(workPathRaw, workspaceRoot);
  const input = parseSaveInput(raw);
  if (input.data.length > MAX_ENTITY_IMAGE_BYTES) throw new Error('图片不能超过 10MB');
  const ext = detectImageExtension(input.data);
  if (!ext) throw new Error('只支持 PNG / JPEG / GIF / WebP 图片');
  const hash = createHash('sha1').update(input.data).digest('hex').slice(0, 8);
  const relativePath = [
    ...ENTITY_MEDIA_ROOT,
    ENTITY_MEDIA_SUBDIR[input.entity],
    sanitizeAvatarBaseName(input.name),
    `${stamp(now)}-${hash}.${ext}`,
  ].join('/');
  const target = await resolveInsideWork(workPath, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp-${process.pid}`;
  await writeFile(temp, input.data);
  await rename(temp, target);
  if (input.prompt) {
    await writeFile(
      target.replace(/\.[^.]+$/, '.prompt.json'),
      `${JSON.stringify(
        {
          prompt: input.prompt,
          providerId: input.providerId,
          model: input.model,
          createdAt: now.toISOString(),
        },
        null,
        2
      )}\n`,
      'utf-8'
    );
  }
  return { relativePath };
}

/** 只允许删除 资料/图集/ 下的图片（连同 .prompt.json） */
export async function deleteEntityImage(
  workPathRaw: unknown,
  relativeRaw: unknown,
  workspaceRoot: string | null
): Promise<void> {
  const workPath = await assertWorkDir(workPathRaw, workspaceRoot);
  if (typeof relativeRaw !== 'string' || !isSafeMediaPath(relativeRaw)) {
    throw new Error('无效的图片路径');
  }
  const parts = relativeRaw.split('/');
  if (parts[0] !== ENTITY_MEDIA_ROOT[0] || parts[1] !== ENTITY_MEDIA_ROOT[1]) {
    throw new Error('只能删除图集里的图片');
  }
  if (!/\.(png|jpe?g|gif|webp)$/i.test(relativeRaw)) throw new Error('只能删除图片文件');
  const target = await resolveExistingInsideWork(workPath, relativeRaw);
  if (!target) return;
  await unlink(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
  await unlink(target.replace(/\.[^.]+$/, '.prompt.json')).catch(() => undefined);
}

export interface ImageGeneratePayload {
  workPath?: string;
  providerId?: string;
  prompt: string;
  aspectRatio?: string;
  count?: number;
  references?: string[];
}

export interface ImageCandidate {
  dataUrl: string;
  mimeType: string;
}

const ASPECT_RE = /^\d{1,2}:\d{1,2}$/;

async function fetchAsDataUrl(
  url: string,
  fallbackMime: string,
  doFetch: (input: string, init?: RequestInit) => Promise<Response> = fetch
): Promise<ImageCandidate | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  const response = await doFetch(url);
  if (!response.ok) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_ENTITY_IMAGE_BYTES) return null;
  const ext = detectImageExtension(bytes);
  const mimeType = ext ? MIME_BY_EXT[ext] : fallbackMime;
  return { mimeType, dataUrl: `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}` };
}

export async function generateImages(
  raw: unknown,
  workspaceRoot: string | null
): Promise<{ images: ImageCandidate[]; providerId: string; model: string }> {
  const payload = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
  if (!prompt) throw new Error('图片描述不能为空');
  if (prompt.length > MAX_PROMPT_CHARS) throw new Error('图片描述过长');
  const aspectRatio =
    typeof payload.aspectRatio === 'string' && ASPECT_RE.test(payload.aspectRatio)
      ? payload.aspectRatio
      : undefined;
  const providerId = typeof payload.providerId === 'string' ? payload.providerId : undefined;
  const service = getAIService();
  const provider = service.getImageProvider(providerId);
  // 厂商只返回图片地址时（例如 Grok），下载也按该模型的网络设置（勾选了代理就走代理）
  const modelId = providerId ?? service.resolveDefaultId('image');
  const downloadFetch = (modelId ? service.fetchFor(modelId) : undefined) ?? fetch;
  let references: string[] = [];
  if (provider.supportsReferences && payload.references !== undefined) {
    const workPath = await assertWorkDir(payload.workPath, workspaceRoot);
    references = await loadReferenceImages(workPath, payload.references);
  }
  const result = await provider.generate({
    prompt,
    aspectRatio,
    count: typeof payload.count === 'number' ? payload.count : 1,
    referenceImages: references,
  });
  const images: ImageCandidate[] = [];
  for (const image of result.images) {
    if (image.base64) {
      images.push({
        mimeType: image.mimeType,
        dataUrl: `data:${image.mimeType};base64,${image.base64}`,
      });
    } else if (image.url) {
      const fetched = await fetchAsDataUrl(image.url, image.mimeType, downloadFetch).catch(
        () => null
      );
      if (fetched) images.push(fetched);
    }
  }
  if (images.length === 0) throw new Error('图片服务没有返回可用的图片');
  return { images, providerId: provider.id, model: result.model };
}

export function registerEntityMediaHandlers(): void {
  ipcMain.handle(
    'entity-image-save',
    async (
      event,
      workPath: unknown,
      payload: unknown
    ): Promise<Result<{ relativePath: string }>> => {
      try {
        const root = getWorkspaceRootForSender(event.sender.id);
        return { ok: true, data: await saveEntityImage(workPath, payload, root) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );
  ipcMain.handle(
    'entity-image-delete',
    async (event, workPath: unknown, relativePath: unknown): Promise<Result<null>> => {
      try {
        const root = getWorkspaceRootForSender(event.sender.id);
        await deleteEntityImage(workPath, relativePath, root);
        return { ok: true, data: null };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );
  ipcMain.handle(
    'ai-image-generate',
    async (
      event,
      payload: unknown
    ): Promise<
      | { ok: true; data: Awaited<ReturnType<typeof generateImages>> }
      | { ok: false; error: SerializedAIError }
    > => {
      try {
        const root = getWorkspaceRootForSender(event.sender.id);
        return { ok: true, data: await generateImages(payload, root) };
      } catch (error) {
        return { ok: false, error: toAIError(error).toJSON() };
      }
    }
  );
}
