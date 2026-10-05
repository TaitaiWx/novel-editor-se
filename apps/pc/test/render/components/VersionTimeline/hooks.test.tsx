// @vitest-environment happy-dom
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSnapshotHistory } from '@/render/components/VersionTimeline/useSnapshotHistory';
import { useSnapshotJob } from '@/render/components/VersionTimeline/useSnapshotJob';
import { useSnapshotActions } from '@/render/components/VersionTimeline/useSnapshotActions';
import type { SnapshotInfo } from '@/render/components/VersionTimeline/types';

const { toast, dialog } = vi.hoisted(() => ({
  toast: {
    show: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
  dialog: {
    confirm: vi.fn(),
    prompt: vi.fn(),
  },
}));

vi.mock('@/render/components/Toast', () => ({ useToast: () => toast }));
vi.mock('@/render/components/Dialog', () => ({ useDialog: () => dialog }));

type InvokeHandler = (channel: string, ...args: unknown[]) => unknown;

const invoke = vi.fn<InvokeHandler>();

const snapshot: SnapshotInfo = {
  id: 3,
  date: '2026-10-05T00:00:00.000Z',
  message: 'v3',
  totalFiles: 2,
  totalBytes: 100,
};

const makeMouseEvent = () => ({ stopPropagation: vi.fn() }) as unknown as React.MouseEvent;

beforeEach(() => {
  invoke.mockReset();
  Object.values(toast).forEach((fn) => fn.mockReset());
  dialog.confirm.mockReset();
  dialog.prompt.mockReset();
  Object.defineProperty(window, 'electron', {
    value: { ipcRenderer: { invoke } },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useSnapshotHistory', () => {
  it('可见且有工作区时自动加载版本列表', async () => {
    invoke.mockResolvedValue([snapshot]);
    const { result } = renderHook(() =>
      useSnapshotHistory({ visible: true, folderPath: '/proj', filePath: '/proj/a.md' })
    );

    await waitFor(() => expect(result.current.snapshots).toEqual([snapshot]));
    expect(invoke).toHaveBeenCalledWith('db-version-list', '/proj', '/proj/a.md', 50);
    expect(result.current.loading).toBe(false);
  });

  it('不可见或无工作区时不加载', async () => {
    renderHook(() => useSnapshotHistory({ visible: false, folderPath: '/proj', filePath: null }));
    renderHook(() => useSnapshotHistory({ visible: true, folderPath: null, filePath: null }));
    await Promise.resolve();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('加载失败时清空列表', async () => {
    invoke.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() =>
      useSnapshotHistory({ visible: true, folderPath: '/proj', filePath: null })
    );
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.snapshots).toEqual([]);
  });
});

describe('useSnapshotJob', () => {
  it('无工作区时不创建任务', async () => {
    const loadHistory = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useSnapshotJob({ folderPath: null, loadHistory }));
    await act(async () => {
      await result.current.handleCreateSnapshot();
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('创建任务后轮询直到完成并刷新列表', async () => {
    vi.useFakeTimers();
    const loadHistory = vi.fn().mockResolvedValue(undefined);
    const running = {
      id: 'job-1',
      status: 'running',
      stage: 'persisting',
      discoveredFiles: 4,
      processedFiles: 1,
      totalFiles: 4,
      processedBytes: 10,
      totalBytes: 40,
      snapshotId: null,
      error: null,
    };
    const completed = { ...running, status: 'completed', stage: 'completed', snapshotId: 9 };
    const statuses = [running, completed];
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db-version-start-create') return 'job-1';
      if (channel === 'db-version-job-status') return statuses.shift();
      return null;
    });

    const { result } = renderHook(() => useSnapshotJob({ folderPath: '/proj', loadHistory }));
    await act(async () => {
      await result.current.handleCreateSnapshot();
    });
    expect(invoke).toHaveBeenCalledWith('db-version-start-create', '/proj');
    expect(result.current.snapshotJob).toEqual(running);
    expect(result.current.pollTimerRef.current).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(result.current.snapshotJob).toEqual(completed);
    expect(result.current.pollTimerRef.current).toBeNull();
    expect(toast.success).toHaveBeenCalledWith('版本保存成功');
    expect(loadHistory).toHaveBeenCalledTimes(1);
  });

  it('完成但无新快照时提示无更改', async () => {
    const loadHistory = vi.fn().mockResolvedValue(undefined);
    invoke.mockImplementation(async (channel: string) =>
      channel === 'db-version-start-create'
        ? 'job-2'
        : { id: 'job-2', status: 'completed', snapshotId: null, error: null }
    );
    const { result } = renderHook(() => useSnapshotJob({ folderPath: '/proj', loadHistory }));
    await act(async () => {
      await result.current.handleCreateSnapshot();
    });
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('当前没有新的更改需要保存'));
    expect(loadHistory).not.toHaveBeenCalled();
  });

  it('任务失败与状态丢失', async () => {
    const loadHistory = vi.fn().mockResolvedValue(undefined);
    invoke.mockImplementation(async (channel: string) =>
      channel === 'db-version-start-create'
        ? 'job-3'
        : { id: 'job-3', status: 'failed', snapshotId: null, error: 'disk full' }
    );
    const { result } = renderHook(() => useSnapshotJob({ folderPath: '/proj', loadHistory }));
    await act(async () => {
      await result.current.handleCreateSnapshot();
    });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('保存版本失败: disk full'));

    invoke.mockImplementation(async (channel: string) =>
      channel === 'db-version-start-create' ? 'job-4' : null
    );
    await act(async () => {
      await result.current.handleCreateSnapshot();
    });
    await waitFor(() => expect(result.current.snapshotJob).toBeNull());
  });

  it('启动任务失败时提示错误', async () => {
    invoke.mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() =>
      useSnapshotJob({ folderPath: '/proj', loadHistory: vi.fn() })
    );
    await act(async () => {
      await result.current.handleCreateSnapshot();
    });
    expect(toast.error).toHaveBeenCalledWith('保存版本失败: nope');
    expect(result.current.snapshotJob).toBeNull();
  });
});

describe('useSnapshotActions', () => {
  const setup = (overrides: { filePath?: string | null } = {}) => {
    const options = {
      folderPath: '/proj',
      filePath: overrides.filePath === undefined ? '/proj/a.md' : overrides.filePath,
      onClose: vi.fn(),
      onDiffRequest: vi.fn(),
      onRestoreFile: vi.fn(),
      loadHistory: vi.fn().mockResolvedValue(undefined),
      setPreviewState: vi.fn(),
    };
    const { result } = renderHook(() => useSnapshotActions(options));
    return { options, result };
  };

  it('删除：取消确认时不调用 IPC，确认后删除并刷新', async () => {
    const { options, result } = setup();
    const event = makeMouseEvent();
    dialog.confirm.mockResolvedValueOnce(false);
    await act(async () => {
      await result.current.handleDeleteCommit(snapshot, event);
    });
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();

    dialog.confirm.mockResolvedValueOnce(true);
    invoke.mockResolvedValue(undefined);
    await act(async () => {
      await result.current.handleDeleteCommit(snapshot, makeMouseEvent());
    });
    expect(invoke).toHaveBeenCalledWith('db-version-delete', 3);
    expect(toast.success).toHaveBeenCalledWith('版本已删除');
    expect(options.loadHistory).toHaveBeenCalled();
  });

  it('重命名：名称未变化时跳过，变化后调用 IPC', async () => {
    const { options, result } = setup();
    dialog.prompt.mockResolvedValueOnce('v3');
    await act(async () => {
      await result.current.handleRenameCommit(snapshot, makeMouseEvent());
    });
    expect(invoke).not.toHaveBeenCalled();

    dialog.prompt.mockResolvedValueOnce('新名称');
    invoke.mockResolvedValue(undefined);
    await act(async () => {
      await result.current.handleRenameCommit(snapshot, makeMouseEvent());
    });
    expect(invoke).toHaveBeenCalledWith('db-version-rename', 3, '新名称');
    expect(toast.success).toHaveBeenCalledWith('版本已重命名');
    expect(options.loadHistory).toHaveBeenCalled();
  });

  it('查看文本版本：触发 Diff 并关闭弹窗', async () => {
    const { options, result } = setup();
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db-version-get-file-content') {
        return {
          content: 'old',
          base64Content: null,
          isBinary: false,
          mimeType: 'text/markdown',
          byteSize: 3,
        };
      }
      if (channel === 'read-file') return 'new';
      return null;
    });
    await act(async () => {
      await result.current.handleViewDiff(snapshot);
    });
    expect(invoke).toHaveBeenCalledWith('db-version-get-file-content', '/proj', 3, '/proj/a.md');
    expect(options.onDiffRequest).toHaveBeenCalledWith('old', 'new', 'v3', '当前版本');
    expect(toast.success).toHaveBeenCalledWith('版本对比已加载');
    expect(options.onClose).toHaveBeenCalled();
    expect(options.setPreviewState).not.toHaveBeenCalled();
  });

  it('查看图片版本：读取当前二进制并设置预览', async () => {
    const { options, result } = setup({ filePath: '/proj/a.png' });
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db-version-get-file-content') {
        return {
          content: null,
          base64Content: 'QUJD',
          isBinary: true,
          mimeType: 'image/png',
          byteSize: 3,
        };
      }
      if (channel === 'read-file-binary') {
        return { base64Content: 'REVG', byteSize: 4, mimeType: 'image/png' };
      }
      return null;
    });
    await act(async () => {
      await result.current.handleViewDiff(snapshot);
    });
    expect(invoke).toHaveBeenCalledWith('read-file-binary', '/proj/a.png');
    expect(options.setPreviewState).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotId: 3,
        kind: 'image',
        dataUrl: 'data:image/png;base64,QUJD',
        currentDataUrl: 'data:image/png;base64,REVG',
        currentByteSize: 4,
      })
    );
    expect(options.onDiffRequest).not.toHaveBeenCalled();
  });

  it('查看 SVG 版本：当前文件读取失败时当前侧为空', async () => {
    const { options, result } = setup({ filePath: '/proj/a.svg' });
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db-version-get-file-content') {
        return {
          content: '<svg/>',
          base64Content: null,
          isBinary: false,
          mimeType: 'image/svg+xml',
          byteSize: 6,
        };
      }
      throw new Error('read fail');
    });
    await act(async () => {
      await result.current.handleViewDiff(snapshot);
    });
    expect(options.setPreviewState).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'image', currentDataUrl: null, currentMimeType: null })
    );
  });

  it('查看版本失败时提示错误；无文件路径时不处理', async () => {
    const { result } = setup();
    invoke.mockRejectedValue(new Error('gone'));
    await act(async () => {
      await result.current.handleViewDiff(snapshot);
    });
    expect(toast.error).toHaveBeenCalledWith('加载版本失败: gone');

    invoke.mockReset();
    const noFile = setup({ filePath: null });
    await act(async () => {
      await noFile.result.current.handleViewDiff(snapshot);
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('恢复：确认后调用 IPC、回调并关闭预览', async () => {
    const { options, result } = setup();
    dialog.confirm.mockResolvedValueOnce(true);
    invoke.mockResolvedValue(undefined);
    await act(async () => {
      await result.current.handleRestoreSnapshot(snapshot, makeMouseEvent());
    });
    expect(invoke).toHaveBeenCalledWith('db-version-restore-file', '/proj', 3, '/proj/a.md');
    expect(options.onRestoreFile).toHaveBeenCalledWith('/proj/a.md');
    expect(options.setPreviewState).toHaveBeenCalledWith(null);
    expect(toast.success).toHaveBeenCalledWith('已恢复到所选版本');
  });

  it('恢复失败时提示错误', async () => {
    const { options, result } = setup();
    dialog.confirm.mockResolvedValueOnce(true);
    invoke.mockRejectedValue(new Error('locked'));
    await act(async () => {
      await result.current.handleRestoreSnapshot(snapshot, makeMouseEvent());
    });
    expect(toast.error).toHaveBeenCalledWith('恢复版本失败: locked');
    expect(options.setPreviewState).not.toHaveBeenCalled();
  });
});
