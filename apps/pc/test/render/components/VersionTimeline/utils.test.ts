import { describe, expect, it } from 'vitest';
import {
  CLIENT_MIME_BY_EXT,
  buildBinaryPreviewState,
  buildDataUrl,
  buildSvgPreviewState,
  buildTextDataUrl,
  computeProgressRatio,
  filterSnapshots,
  formatByteSize,
  formatDate,
  formatDuration,
  getFileName,
  guessMimeTypeByPath,
} from '@/render/components/VersionTimeline/utils';
import type {
  SnapshotFileContent,
  SnapshotInfo,
  SnapshotJobStatus,
} from '@/render/components/VersionTimeline/types';

const NOW = new Date(2026, 9, 5, 12, 0, 0);

const makeSnapshot = (id: number, message: string, date: Date): SnapshotInfo => ({
  id,
  message,
  date: date.toISOString(),
  totalFiles: 1,
  totalBytes: 10,
});

const makeJob = (overrides: Partial<SnapshotJobStatus> = {}): SnapshotJobStatus => ({
  id: 'job',
  status: 'running',
  stage: 'scanning',
  discoveredFiles: 0,
  processedFiles: 0,
  totalFiles: 0,
  processedBytes: 0,
  totalBytes: 0,
  snapshotId: null,
  error: null,
  ...overrides,
});

describe('formatByteSize', () => {
  it('空值与 0 显示 0 KB', () => {
    expect(formatByteSize(null)).toBe('0 KB');
    expect(formatByteSize(undefined)).toBe('0 KB');
    expect(formatByteSize(0)).toBe('0 KB');
  });

  it('按 B / KB / MB 分级', () => {
    expect(formatByteSize(512)).toBe('512 B');
    expect(formatByteSize(1536)).toBe('1.5 KB');
    expect(formatByteSize(5 * 1024 * 1024)).toBe('5.00 MB');
  });
});

describe('formatDuration', () => {
  it('null 或非有限数显示读取中', () => {
    expect(formatDuration(null)).toBe('时长读取中');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('时长读取中');
    expect(formatDuration(Number.NaN)).toBe('时长读取中');
  });

  it('格式化为 m:ss，负数归零', () => {
    expect(formatDuration(65.4)).toBe('1:05');
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(-3)).toBe('0:00');
  });
});

describe('data url 构造', () => {
  it('buildDataUrl 拼接 base64', () => {
    expect(buildDataUrl('image/png', 'AAA')).toBe('data:image/png;base64,AAA');
  });

  it('buildTextDataUrl 对内容进行 URI 编码', () => {
    expect(buildTextDataUrl('image/svg+xml', '<svg a="1"/>')).toBe(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg a="1"/>')}`
    );
  });
});

describe('guessMimeTypeByPath', () => {
  it('空路径或未知扩展名返回 octet-stream', () => {
    expect(guessMimeTypeByPath(null)).toBe('application/octet-stream');
    expect(guessMimeTypeByPath('/a/b.unknown')).toBe('application/octet-stream');
  });

  it('按扩展名匹配（忽略大小写）', () => {
    expect(guessMimeTypeByPath('/a/B.PNG')).toBe('image/png');
    expect(guessMimeTypeByPath('/a/chapter.md')).toBe('text/markdown');
    expect(guessMimeTypeByPath('C:\\x\\clip.webm')).toBe('video/webm');
  });

  it('映射表包含常见媒体类型', () => {
    expect(CLIENT_MIME_BY_EXT['.pdf']).toBe('application/pdf');
    expect(CLIENT_MIME_BY_EXT['.mp3']).toBe('audio/mpeg');
  });
});

describe('formatDate', () => {
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

  it('相对时间分级', () => {
    expect(formatDate(ago(30 * 1000), NOW)).toBe('刚刚');
    expect(formatDate(ago(5 * 60 * 1000), NOW)).toBe('5 分钟前');
    expect(formatDate(ago(3 * 60 * 60 * 1000), NOW)).toBe('3 小时前');
    expect(formatDate(ago(2 * 24 * 60 * 60 * 1000), NOW)).toBe('2 天前');
  });

  it('超过 7 天显示日期', () => {
    const dateStr = ago(10 * 24 * 60 * 60 * 1000);
    expect(formatDate(dateStr, NOW)).toBe(
      new Date(dateStr).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
    );
  });
});

describe('filterSnapshots', () => {
  const day = 24 * 60 * 60 * 1000;
  const snapshots = [
    makeSnapshot(1, 'Today Draft', new Date(NOW.getTime() - 60 * 1000)),
    makeSnapshot(2, '第二章 修订', new Date(NOW.getTime() - 3 * day)),
    makeSnapshot(3, 'old draft', new Date(NOW.getTime() - 20 * day)),
    makeSnapshot(4, 'ancient', new Date(NOW.getTime() - 60 * day)),
  ];
  const ids = (list: SnapshotInfo[]) => list.map((item) => item.id);

  it('无条件时返回全部', () => {
    expect(ids(filterSnapshots(snapshots, '', 'all', NOW))).toEqual([1, 2, 3, 4]);
  });

  it('关键词去空格且忽略大小写', () => {
    expect(ids(filterSnapshots(snapshots, '  DRAFT ', 'all', NOW))).toEqual([1, 3]);
    expect(ids(filterSnapshots(snapshots, '修订', 'all', NOW))).toEqual([2]);
  });

  it('按时间范围筛选', () => {
    expect(ids(filterSnapshots(snapshots, '', 'today', NOW))).toEqual([1]);
    expect(ids(filterSnapshots(snapshots, '', '7d', NOW))).toEqual([1, 2]);
    expect(ids(filterSnapshots(snapshots, '', '30d', NOW))).toEqual([1, 2, 3]);
  });

  it('关键词与时间范围同时生效', () => {
    expect(ids(filterSnapshots(snapshots, 'draft', '7d', NOW))).toEqual([1]);
  });
});

describe('getFileName', () => {
  it('处理 POSIX 路径与空值', () => {
    expect(getFileName('/a/b/c.md')).toBe('c.md');
    expect(getFileName(null)).toBeNull();
  });

  it('Windows 反斜杠路径取最后一级文件名', () => {
    expect(getFileName('C:\\a\\b.md')).toBe('b.md');
  });

  it('忽略末尾分隔符，混合分隔符也能正确取名', () => {
    expect(getFileName('a\\b/')).toBe('b');
  });
});

describe('computeProgressRatio', () => {
  it('无任务或总数为 0 时为 0', () => {
    expect(computeProgressRatio(null)).toBe(0);
    expect(computeProgressRatio(makeJob({ totalFiles: 0, processedFiles: 3 }))).toBe(0);
  });

  it('按已处理/总数计算并封顶为 1', () => {
    expect(computeProgressRatio(makeJob({ totalFiles: 4, processedFiles: 1 }))).toBe(0.25);
    expect(computeProgressRatio(makeJob({ totalFiles: 4, processedFiles: 9 }))).toBe(1);
  });
});

describe('预览状态构造', () => {
  const snapshot = makeSnapshot(7, 'v7', NOW);
  const makeFile = (overrides: Partial<SnapshotFileContent>): SnapshotFileContent => ({
    content: null,
    base64Content: 'QUJD',
    isBinary: true,
    mimeType: 'image/png',
    byteSize: 3,
    ...overrides,
  });
  const currentBinary = { base64Content: 'REVG', byteSize: 4, mimeType: 'image/png' };

  it('SVG 快照：有当前内容时生成双侧 data url', () => {
    const state = buildSvgPreviewState(
      snapshot,
      { ...makeFile({ mimeType: 'image/svg+xml' }), content: '<svg/>' },
      '<svg></svg>'
    );
    expect(state).toEqual({
      snapshotId: 7,
      snapshotMessage: 'v7',
      mimeType: 'image/svg+xml',
      byteSize: 3,
      dataUrl: buildTextDataUrl('image/svg+xml', '<svg/>'),
      kind: 'image',
      currentDataUrl: buildTextDataUrl('image/svg+xml', '<svg></svg>'),
      currentByteSize: 11,
      currentMimeType: 'image/svg+xml',
    });
  });

  it('SVG 快照：当前内容不可读时当前侧为 null', () => {
    const state = buildSvgPreviewState(
      snapshot,
      { ...makeFile({ mimeType: 'image/svg+xml' }), content: '<svg/>' },
      null
    );
    expect(state.currentDataUrl).toBeNull();
    expect(state.currentByteSize).toBeNull();
    expect(state.currentMimeType).toBeNull();
  });

  it.each([
    ['image/png', 'image'],
    ['application/pdf', 'pdf'],
    ['audio/mpeg', 'audio'],
    ['video/mp4', 'video'],
  ] as const)('二进制快照 %s → kind=%s', (mimeType, kind) => {
    const state = buildBinaryPreviewState(snapshot, makeFile({ mimeType }), currentBinary);
    expect(state).toEqual({
      snapshotId: 7,
      snapshotMessage: 'v7',
      mimeType,
      byteSize: 3,
      dataUrl: buildDataUrl(mimeType, 'QUJD'),
      kind,
      currentDataUrl: buildDataUrl('image/png', 'REVG'),
      currentByteSize: 4,
      currentMimeType: 'image/png',
    });
  });

  it('媒体快照但当前文件不可读时当前侧为 null', () => {
    const state = buildBinaryPreviewState(snapshot, makeFile({}), null);
    expect(state.kind).toBe('image');
    expect(state.currentDataUrl).toBeNull();
    expect(state.currentByteSize).toBeNull();
    expect(state.currentMimeType).toBeNull();
  });

  it('非媒体类型或缺少 base64 时退化为 binary（不含 dataUrl 字段）', () => {
    const zip = buildBinaryPreviewState(
      snapshot,
      makeFile({ mimeType: 'application/zip' }),
      currentBinary
    );
    expect(zip).toEqual({
      snapshotId: 7,
      snapshotMessage: 'v7',
      mimeType: 'application/zip',
      byteSize: 3,
      kind: 'binary',
      currentByteSize: 4,
      currentMimeType: 'image/png',
    });
    expect('dataUrl' in zip).toBe(false);
    expect('currentDataUrl' in zip).toBe(false);

    const noData = buildBinaryPreviewState(snapshot, makeFile({ base64Content: null }), null);
    expect(noData.kind).toBe('binary');
    expect(noData.currentByteSize).toBeNull();
  });
});
