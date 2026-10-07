// @vitest-environment happy-dom
/**
 * 正文媒体引用的路径解析缓存：预热、命中、失效、批量探测与回退
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROBE_BATCH_MAX,
  STALE_AFTER_MS,
  invalidateMediaResolveCache,
  peekResolvedMedia,
  probeExistingPaths,
  resolveMediaPath,
  resolveMediaRefs,
} from '@/render/components/TextEditor/live-preview/media-resolve';
import { findExistingMedia } from '@/render/components/TextEditor/live-preview/media-loader';
import { notifyWorkspaceFilesChanged } from '@/render/utils/workspaceFiles';
import {
  cancelReferenceWarmup,
  scheduleReferenceWarmup,
  warmDocumentMedia,
} from '@/render/utils/referenceWarmup';
import {
  installElectronMock,
  uninstallElectronMock,
  type ElectronMock,
} from '../../hooks/electronMock';

const DOC = '/p/小说格式示例.md';
const IMAGE = '/p/novels/a/资料/图.webp';
const VIDEO = '/p/novels/a/资料/v.mp4';
const imageRef = { src: 'novels/a/资料/图.webp', syntax: 'directive' as const };
const videoRef = { src: 'novels/a/资料/v.mp4', syntax: 'directive' as const };

let mock: ElectronMock;
let existing: Set<string>;
/** 主进程不回答的路径（模拟工作区外） */
let outside: Set<string>;

function calls(channel: string) {
  return mock.invoke.mock.calls.filter(([name]) => name === channel);
}

beforeEach(() => {
  invalidateMediaResolveCache();
  existing = new Set([IMAGE, VIDEO]);
  outside = new Set();
  mock = installElectronMock((channel, arg) => {
    if (channel === 'get-files-exist') {
      return (arg as string[]).map((path) => (outside.has(path) ? null : existing.has(path)));
    }
    if (channel === 'get-file-info') {
      if (!existing.has(String(arg))) throw new Error('不存在');
      return { isFile: true };
    }
    if (channel === 'get-file-info-batch') {
      // 与主进程一致：不存在的文件静默跳过
      return (arg as string[])
        .filter((path) => existing.has(path))
        .map((path) => ({ path, info: { isFile: true } }));
    }
    return null;
  });
});

afterEach(() => {
  cancelReferenceWarmup();
  uninstallElectronMock();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('media-resolve', () => {
  it('预热：多个引用合并为一次批量探测，按顺序返回第一个存在的候选', async () => {
    const missing = { src: 'nope.png', syntax: 'directive' as const };
    expect(await resolveMediaRefs(DOC, [imageRef, missing, videoRef])).toEqual([
      IMAGE,
      null,
      VIDEO,
    ]);
    expect(calls('get-files-exist')).toHaveLength(1);
    expect(calls('get-file-info')).toHaveLength(0);
  });

  it('命中：解析后同步可读，再次解析不发 IPC；没解析过的为 undefined', async () => {
    expect(peekResolvedMedia(DOC, imageRef)).toBeUndefined();
    await resolveMediaPath(DOC, imageRef);
    expect(peekResolvedMedia(DOC, imageRef)).toBe(IMAGE);
    mock.invoke.mockClear();
    expect(await resolveMediaPath(DOC, imageRef)).toBe(IMAGE);
    expect(mock.invoke).not.toHaveBeenCalled();
  });

  it('实时渲染的查找（findExistingMedia）也写入同一份缓存', async () => {
    expect(await findExistingMedia(DOC, videoRef.src)).toBe(VIDEO);
    expect(peekResolvedMedia(DOC, videoRef)).toBe(VIDEO);
  });

  it('同一引用并发解析只探测一次', async () => {
    const [a, b] = await Promise.all([
      resolveMediaPath(DOC, imageRef),
      resolveMediaPath(DOC, imageRef),
    ]);
    expect([a, b]).toEqual([IMAGE, IMAGE]);
    expect(calls('get-files-exist')).toHaveLength(1);
  });

  it('失效：资料变化通知或手动失效后需要重新解析', async () => {
    await resolveMediaPath(DOC, imageRef);
    notifyWorkspaceFilesChanged();
    expect(peekResolvedMedia(DOC, imageRef)).toBeUndefined();
    await resolveMediaPath(DOC, imageRef);
    invalidateMediaResolveCache();
    expect(peekResolvedMedia(DOC, imageRef)).toBeUndefined();
  });

  it('失效前已发出的探测结果不写入缓存（避免旧路径复活）', async () => {
    const pending = resolveMediaPath(DOC, imageRef);
    invalidateMediaResolveCache();
    expect(await pending).toBe(IMAGE);
    expect(peekResolvedMedia(DOC, imageRef)).toBeUndefined();
  });

  it('过期条目仍可同步读取，下一次异步解析重新探测', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    await resolveMediaPath(DOC, imageRef);
    existing.delete(IMAGE);
    now.mockReturnValue(1_000 + STALE_AFTER_MS + 1);
    expect(peekResolvedMedia(DOC, imageRef)).toBe(IMAGE);
    expect(await resolveMediaPath(DOC, imageRef)).toBeNull();
    expect(peekResolvedMedia(DOC, imageRef)).toBeNull();
  });

  it('主进程不回答（工作区外 / 还没登记）时用静默的批量查询，不调用会记错误日志的 get-file-info', async () => {
    outside.add(IMAGE);
    outside.add('/p/x.png');
    expect(await probeExistingPaths([IMAGE, '/p/x.png'])).toEqual(new Set([IMAGE]));
    expect(calls('get-file-info')).toHaveLength(0);
    expect(calls('get-file-info-batch').map(([, list]) => list)).toEqual([[IMAGE, '/p/x.png']]);
  });

  it('超过单批上限时分批', async () => {
    const paths = Array.from({ length: PROBE_BATCH_MAX + 5 }, (_, index) => `/p/${index}.png`);
    await probeExistingPaths(paths);
    expect(calls('get-files-exist').map(([, list]) => (list as string[]).length)).toEqual([
      PROBE_BATCH_MAX,
      5,
    ]);
  });
});

describe('referenceWarmup', () => {
  it('文档变化后防抖预热；只有最后一次生效', async () => {
    vi.useFakeTimers();
    const source = (text: string) => ({ documentPath: DOC, text, workPath: '/p', files: [] });
    scheduleReferenceWarmup(source('::image[a]{src="novels/a/资料/v.mp4"}'));
    scheduleReferenceWarmup(source('::image[图]{src="novels/a/资料/图.webp"}'));
    await vi.advanceTimersByTimeAsync(299);
    expect(calls('get-files-exist')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5);
    expect(calls('get-files-exist')).toHaveLength(1);
    expect(peekResolvedMedia(DOC, imageRef)).toBe(IMAGE);
    expect(peekResolvedMedia(DOC, videoRef)).toBeUndefined();
  });

  it('warmDocumentMedia 解析 Markdown 图片（相对文档目录）', async () => {
    existing.add('/p/img/x.png');
    await warmDocumentMedia({
      documentPath: DOC,
      text: '![x](img/x.png)',
      workPath: '/p',
      files: [],
    });
    expect(peekResolvedMedia(DOC, { src: 'img/x.png', syntax: 'markdown' })).toBe('/p/img/x.png');
  });
});
