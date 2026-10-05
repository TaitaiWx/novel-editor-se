// @vitest-environment happy-dom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SnapshotList from '@/render/components/VersionTimeline/SnapshotList';
import SnapshotFilterBar from '@/render/components/VersionTimeline/SnapshotFilterBar';
import SnapshotProgress from '@/render/components/VersionTimeline/SnapshotProgress';
import PreviewPanel from '@/render/components/VersionTimeline/PreviewPanel';
import VideoPreviewCard from '@/render/components/VersionTimeline/VideoPreviewCard';
import AudioPreviewCard from '@/render/components/VersionTimeline/AudioPreviewCard';
import { getFileTypeMeta } from '@/render/components/VersionTimeline/fileTypeMeta';
import type {
  PreviewState,
  SnapshotInfo,
  SnapshotJobStatus,
} from '@/render/components/VersionTimeline/types';

const snapshots: SnapshotInfo[] = [
  { id: 1, date: new Date().toISOString(), message: '第一版', totalFiles: 3, totalBytes: 10 },
  { id: 2, date: new Date().toISOString(), message: '第二版', totalFiles: 5, totalBytes: 20 },
];

describe('SnapshotList', () => {
  const renderList = () => {
    const handlers = {
      onSelect: vi.fn(),
      onRename: vi.fn(),
      onRestore: vi.fn(),
      onDelete: vi.fn(),
    };
    const utils = render(
      <SnapshotList
        snapshots={snapshots}
        fileTypeMeta={getFileTypeMeta('image/png')}
        {...handlers}
      />
    );
    return { ...utils, handlers };
  };

  it('渲染条目、文件数与类型徽标', () => {
    const { container } = renderList();
    expect(screen.getByText('第一版')).toBeTruthy();
    expect(screen.getByText('5 个文件')).toBeTruthy();
    expect(container.querySelectorAll('.commitItem')).toHaveLength(2);
    expect(container.querySelectorAll('.commitTypeBadge.fileTypeimage')).toHaveLength(2);
    expect(screen.getAllByText('刚刚')).toHaveLength(2);
  });

  it('仅在非末项绘制连接线', () => {
    const { container } = renderList();
    expect(container.querySelectorAll('.timelineLine')).toHaveLength(1);
  });

  it('点击条目与操作按钮触发对应回调', () => {
    const { handlers } = renderList();
    fireEvent.click(screen.getByText('第二版'));
    expect(handlers.onSelect).toHaveBeenCalledWith(snapshots[1]);

    fireEvent.click(screen.getAllByTitle('重命名版本')[0]);
    expect(handlers.onRename).toHaveBeenCalledWith(snapshots[0], expect.anything());
    fireEvent.click(screen.getAllByTitle('恢复当前文件到此版本')[0]);
    expect(handlers.onRestore).toHaveBeenCalledWith(snapshots[0], expect.anything());
    fireEvent.click(screen.getAllByTitle('删除版本')[1]);
    expect(handlers.onDelete).toHaveBeenCalledWith(snapshots[1], expect.anything());
  });
});

describe('SnapshotFilterBar', () => {
  it('展示计数、高亮当前筛选并回传变更', () => {
    const onSearchQueryChange = vi.fn();
    const onTimeFilterChange = vi.fn();
    render(
      <SnapshotFilterBar
        searchQuery="abc"
        onSearchQueryChange={onSearchQueryChange}
        timeFilter="7d"
        onTimeFilterChange={onTimeFilterChange}
        filteredCount={2}
        totalCount={5}
      />
    );
    expect(screen.getByText('2 / 5')).toBeTruthy();
    expect(screen.getByText('7 天').className).toContain('filterChipActive');
    expect(screen.getByText('全部').className).not.toContain('filterChipActive');

    const input = screen.getByPlaceholderText('按版本说明筛选') as HTMLInputElement;
    expect(input.value).toBe('abc');
    fireEvent.change(input, { target: { value: 'xyz' } });
    expect(onSearchQueryChange).toHaveBeenCalledWith('xyz');

    fireEvent.click(screen.getByText('今天'));
    expect(onTimeFilterChange).toHaveBeenCalledWith('today');
  });
});

describe('SnapshotProgress', () => {
  const baseJob: SnapshotJobStatus = {
    id: 'j',
    status: 'running',
    stage: 'scanning',
    discoveredFiles: 7,
    processedFiles: 0,
    totalFiles: 0,
    processedBytes: 2048,
    totalBytes: 4096,
    snapshotId: null,
    error: null,
  };

  it('扫描阶段显示不定进度', () => {
    const { container } = render(<SnapshotProgress job={baseJob} />);
    expect(screen.getByText('正在扫描项目文件...')).toBeTruthy();
    expect(screen.getByText('0/7')).toBeTruthy();
    expect(screen.getByText('已处理 2 KB / 4 KB')).toBeTruthy();
    const fill = container.querySelector('.progressBarFill') as HTMLElement;
    expect(fill.className).toContain('progressBarIndeterminate');
    expect(fill.style.width).toBe('');
  });

  it('写入阶段按比例设置宽度', () => {
    const { container } = render(
      <SnapshotProgress
        job={{ ...baseJob, stage: 'persisting', totalFiles: 4, processedFiles: 1 }}
      />
    );
    expect(screen.getByText('正在写入版本快照...')).toBeTruthy();
    expect(screen.getByText('1/7')).toBeTruthy();
    const fill = container.querySelector('.progressBarFill') as HTMLElement;
    expect(fill.className).not.toContain('progressBarIndeterminate');
    expect(fill.style.width).toBe('25%');
  });
});

describe('PreviewPanel', () => {
  const baseState: PreviewState = {
    snapshotId: 1,
    snapshotMessage: '第一版',
    mimeType: 'application/zip',
    byteSize: 2048,
    kind: 'binary',
    currentByteSize: null,
    currentMimeType: null,
  };

  const renderPanel = (previewState: PreviewState, canRestore = true) => {
    const props = {
      onPdfPageChange: vi.fn(),
      onRestore: vi.fn(),
      onClose: vi.fn(),
    };
    const utils = render(
      <PreviewPanel
        previewState={previewState}
        canRestore={canRestore}
        pdfComparePage={1}
        {...props}
      />
    );
    return { ...utils, props };
  };

  it('binary：展示双侧元信息，当前文件不可读时显示占位', () => {
    renderPanel(baseState);
    expect(screen.getByText('第一版 · application/zip · 2.0 KB')).toBeTruthy();
    expect(screen.getByText('application/zip')).toBeTruthy();
    expect(screen.getByText('无法读取')).toBeTruthy();
    expect(screen.getByText('0 KB')).toBeTruthy();
  });

  it('按钮触发恢复与关闭；无文件时隐藏恢复按钮', () => {
    const { props, unmount } = renderPanel(baseState);
    fireEvent.click(screen.getByText('恢复当前文件'));
    expect(props.onRestore).toHaveBeenCalled();
    fireEvent.click(screen.getByText('关闭预览'));
    expect(props.onClose).toHaveBeenCalled();
    unmount();

    renderPanel(baseState, false);
    expect(screen.queryByText('恢复当前文件')).toBeNull();
  });

  it('image：渲染快照与当前图片', () => {
    const { container } = renderPanel({
      ...baseState,
      mimeType: 'image/png',
      kind: 'image',
      dataUrl: 'data:image/png;base64,AAA',
      currentDataUrl: 'data:image/png;base64,BBB',
      currentMimeType: 'image/png',
      currentByteSize: 512,
    });
    const images = container.querySelectorAll('img');
    expect(images).toHaveLength(2);
    expect(images[0].getAttribute('src')).toBe('data:image/png;base64,AAA');
    expect(images[1].getAttribute('alt')).toBe('当前文件');
    expect(screen.getByText('image/png · 512 B')).toBeTruthy();
  });

  it('image：当前文件缺失时显示占位', () => {
    renderPanel({
      ...baseState,
      mimeType: 'image/png',
      kind: 'image',
      dataUrl: 'data:image/png;base64,AAA',
      currentDataUrl: null,
    });
    expect(screen.getByText('当前文件暂时无法读取')).toBeTruthy();
  });
});

describe('VideoPreviewCard', () => {
  it('有数据时渲染播放器与元信息', () => {
    const { container } = render(
      <VideoPreviewCard
        title="版本快照"
        dataUrl="data:video/mp4;base64,AAA"
        mimeType="video/mp4"
        byteSize={2 * 1024 * 1024}
        emptyText="无法加载"
      />
    );
    expect(screen.getByText('版本快照')).toBeTruthy();
    expect(container.querySelector('video')?.getAttribute('src')).toBe('data:video/mp4;base64,AAA');
    expect(screen.getByText('video/mp4')).toBeTruthy();
    expect(screen.getByText('2.00 MB')).toBeTruthy();
  });

  it('无数据时显示空文案', () => {
    const { container } = render(
      <VideoPreviewCard title="当前文件" dataUrl={null} emptyText="当前文件暂时无法读取" />
    );
    expect(screen.getByText('当前文件暂时无法读取')).toBeTruthy();
    expect(container.querySelector('video')).toBeNull();
  });
});

describe('AudioPreviewCard', () => {
  it('无数据时显示空文案', () => {
    const { container } = render(
      <AudioPreviewCard title="当前文件" dataUrl={null} emptyText="当前文件暂时无法读取" />
    );
    expect(screen.getByText('当前文件')).toBeTruthy();
    expect(screen.getByText('当前文件暂时无法读取')).toBeTruthy();
    expect(container.querySelector('audio')).toBeNull();
  });
});
