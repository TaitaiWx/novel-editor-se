/**
 * 图集的读写动作（经 IPC）：上传本地图片、保存 AI 候选图、删除图片
 */
import type { EntityKind, MediaItem, MediaKind } from '@novel-editor/core/entity-media';

let idSeq = 0;
function newId(): string {
  idSeq += 1;
  return `m-${Date.now().toString(36)}-${idSeq.toString(36)}`;
}

/** data:image/png;base64,xxxx → 字节 */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export interface SaveImageInput {
  workPath: string;
  entity: EntityKind;
  name: string;
  kind: MediaKind;
  data: Uint8Array;
  source: 'upload' | 'ai';
  prompt?: string;
  providerId?: string;
  model?: string;
  label?: string;
}

export async function saveImage(input: SaveImageInput): Promise<MediaItem> {
  const ipc = window.electron?.ipcRenderer;
  if (!ipc) throw new Error('没有打开项目');
  const result = await ipc.invoke('entity-image-save', input.workPath, {
    entity: input.entity,
    name: input.name,
    data: input.data,
    prompt: input.prompt,
    providerId: input.providerId,
    model: input.model,
  });
  if (!result.ok) throw new Error(result.error);
  return {
    id: newId(),
    path: result.data.relativePath,
    kind: input.kind,
    source: input.source,
    createdAt: new Date().toISOString(),
    ...(input.label ? { label: input.label } : {}),
    ...(input.prompt ? { prompt: input.prompt } : {}),
  };
}

export async function deleteImage(workPath: string, path: string): Promise<void> {
  const ipc = window.electron?.ipcRenderer;
  if (!ipc) return;
  const result = await ipc.invoke('entity-image-delete', workPath, path);
  if (!result.ok) throw new Error(result.error);
}
