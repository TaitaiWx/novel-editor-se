// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ResourceViewer, {
  BinaryContentViewer,
  isPreviewableResourcePath,
  isTextBackedPreviewResourcePath,
} from '@/render/components/ResourceViewer';
import { installElectronMock, uninstallElectronMock } from '../hooks/electronMock';

// ─── pdfjs mock ──────────────────────────────────────────────────────────
const pdfState = vi.hoisted(() => ({
  numPages: 2,
  fail: false,
  destroy: vi.fn(async () => undefined),
}));

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: () => ({
    promise: pdfState.fail
      ? Promise.reject(new Error('坏的 PDF'))
      : Promise.resolve({
          numPages: pdfState.numPages,
          getPage: async (n: number) => ({
            getViewport: ({ scale }: { scale: number }) => ({
              width: 100 * scale,
              height: 140 * scale,
              n,
            }),
            render: () => ({ promise: Promise.resolve() }),
          }),
        }),
    destroy: pdfState.destroy,
  }),
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.js' }));

type Binary = { base64Content: string; byteSize: number; mimeType: string };

beforeEach(() => {
  pdfState.numPages = 2;
  pdfState.fail = false;
  let counter = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({}) as unknown as CanvasRenderingContext2D
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(
    () => `data:image/png;base64,page${(counter += 1)}`
  );
});

afterEach(() => {
  uninstallElectronMock();
  vi.restoreAllMocks();
});

function mockBinary(result: Binary | Error, text = '<svg/>') {
  return installElectronMock((channel) => {
    if (channel === 'read-file') return text;
    if (channel === 'read-file-binary') {
      if (result instanceof Error) throw result;
      return result;
    }
    return undefined;
  });
}

describe('ResourceViewer 工具函数', () => {
  it('isPreviewableResourcePath 识别可预览类型', () => {
    expect(isPreviewableResourcePath(null)).toBe(false);
    expect(isPreviewableResourcePath('__untitled__:1')).toBe(false);
    expect(isPreviewableResourcePath('/a/b.PNG')).toBe(true);
    expect(isPreviewableResourcePath('/a/b.pdf')).toBe(true);
    expect(isPreviewableResourcePath('/a/b.mp3')).toBe(true);
    expect(isPreviewableResourcePath('/a/b.mov')).toBe(true);
    expect(isPreviewableResourcePath('/a/b.md')).toBe(false);
    expect(isPreviewableResourcePath('/a/b.unknown')).toBe(false);
  });

  it('isTextBackedPreviewResourcePath 仅 svg', () => {
    expect(isTextBackedPreviewResourcePath('/a/x.svg')).toBe(true);
    expect(isTextBackedPreviewResourcePath('/a/x.png')).toBe(false);
    expect(isTextBackedPreviewResourcePath(null)).toBe(false);
  });
});

describe('ResourceViewer', () => {
  it('无文件时显示空状态', () => {
    render(<ResourceViewer filePath={null} />);
    expect(screen.getByText('选择资源开始预览')).toBeTruthy();
  });

  // BUG: ResourceViewer/index.tsx 向 EmptyState 传 title="选择资源开始预览" + variant="file"，
  // 但 EmptyState/index.tsx 的 getDefaultContent 在 variant 为 'file'/'folder' 时
  // 忽略传入的 title/description，实际显示通用的"暂无文件 / 请选择一个文件夹查看内容"。
  it('无文件时应显示资源预览专属的空状态文案', () => {
    render(<ResourceViewer filePath={null} />);
    expect(screen.getByText('选择资源开始预览')).toBeTruthy();
  });

  it('不可预览文件显示错误', async () => {
    installElectronMock();
    render(<ResourceViewer filePath="/p/a.md" />);
    expect(await screen.findByText('当前文件不是可预览资源')).toBeTruthy();
  });

  it('图片：渲染 img、标签、大小', async () => {
    const mock = mockBinary({ base64Content: 'AAAA', byteSize: 2048, mimeType: 'image/png' });
    render(<ResourceViewer filePath="/p/cover.png" settingsComponent={<span>设置</span>} />);
    const img = (await screen.findByAltText('cover.png')) as HTMLImageElement;
    expect(img.src).toBe('data:image/png;base64,AAAA');
    expect(screen.getByText('图片预览')).toBeTruthy();
    expect(screen.getByText('image/png · 2.0 KB')).toBeTruthy();
    expect(screen.getByText('设置')).toBeTruthy();
    expect(mock.invoke).toHaveBeenCalledWith('read-file-binary', '/p/cover.png');
  });

  it('SVG 走 read-file 文本路径', async () => {
    const mock = mockBinary(new Error('不应调用'), '<svg>hi</svg>');
    render(<ResourceViewer filePath="/p/logo.svg" />);
    const img = (await screen.findByAltText('logo.svg')) as HTMLImageElement;
    expect(img.src.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(screen.getByText('SVG 预览')).toBeTruthy();
    expect(screen.getByText('image/svg+xml · 13 B')).toBeTruthy();
    expect(mock.invoke).toHaveBeenCalledWith('read-file', '/p/logo.svg');
  });

  it('音频：显示元数据并在 loadedmetadata 后显示时长', async () => {
    mockBinary({ base64Content: 'AA', byteSize: 3 * 1024 * 1024, mimeType: 'audio/mpeg' });
    const { container } = render(<ResourceViewer filePath="/p/a.mp3" />);
    expect(await screen.findByText('音频预览')).toBeTruthy();
    expect(screen.getByText('读取中')).toBeTruthy();
    expect(screen.getAllByText('3.00 MB').length).toBeGreaterThan(0);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'duration', { configurable: true, value: 125.4 });
    fireEvent.loadedMetadata(audio);
    expect(screen.getByText('2:05')).toBeTruthy();
    Object.defineProperty(audio, 'duration', { configurable: true, value: Infinity });
    fireEvent.loadedMetadata(audio);
    expect(screen.getByText('读取中')).toBeTruthy();
  });

  it('视频：渲染 video 与大小', async () => {
    mockBinary({ base64Content: 'AA', byteSize: 500, mimeType: 'video/mp4' });
    const { container } = render(<ResourceViewer filePath="/p/v.mp4" />);
    expect(await screen.findByText('视频预览')).toBeTruthy();
    expect(container.querySelector('video source')?.getAttribute('src')).toBe(
      'data:video/mp4;base64,AA'
    );
    expect(screen.getAllByText('500 B').length).toBeGreaterThan(0);
  });

  it('返回未知 mime 时显示"暂不支持预览"，空 mime 回退到扩展名', async () => {
    mockBinary({ base64Content: 'AA', byteSize: 0, mimeType: 'application/zip' });
    const { unmount } = render(<ResourceViewer filePath="/p/v.mp4" />);
    expect(await screen.findByText('当前类型暂不支持预览')).toBeTruthy();
    expect(screen.getByText('application/zip · 0 KB')).toBeTruthy();
    expect(screen.getByText('文本内容')).toBeTruthy();
    unmount();

    mockBinary({ base64Content: 'AA', byteSize: 1, mimeType: '' });
    render(<ResourceViewer filePath="/p/x.jpg" />);
    expect(await screen.findByText('image/jpeg · 1 B')).toBeTruthy();
  });

  it('IPC 失败显示错误信息', async () => {
    mockBinary(new Error('磁盘读取失败'));
    render(<ResourceViewer filePath="/p/x.png" />);
    expect(await screen.findByText('磁盘读取失败')).toBeTruthy();
    expect(screen.getByText('资源预览失败')).toBeTruthy();
  });

  it('非 Error 异常使用默认文案', async () => {
    installElectronMock(() => {
      throw 'boom';
    });
    render(<ResourceViewer filePath="/p/x.png" />);
    expect(await screen.findByText('资源预览加载失败')).toBeTruthy();
  });

  it('PDF：渲染缩略图并翻页', async () => {
    mockBinary({ base64Content: btoa('%PDF'), byteSize: 10, mimeType: 'application/pdf' });
    render(<ResourceViewer filePath="/p/doc.pdf" />);
    expect(await screen.findByText('PDF 预览')).toBeTruthy();
    expect(await screen.findByText('第 1 / 2 页')).toBeTruthy();
    await waitFor(() => expect(screen.getByAltText('第 2 页')).toBeTruthy());
    expect(screen.getByAltText('PDF 第 1 页')).toBeTruthy();

    const prev = screen.getByRole('button', { name: '上一页' }) as HTMLButtonElement;
    const next = screen.getByRole('button', { name: '下一页' }) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    fireEvent.click(next);
    expect(screen.getByText('第 2 / 2 页')).toBeTruthy();
    await waitFor(() => expect(screen.getByAltText('PDF 第 2 页')).toBeTruthy());
    expect(next.disabled).toBe(true);
    fireEvent.click(prev);
    expect(screen.getByText('第 1 / 2 页')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /第 2 页/ }));
    expect(screen.getByText('第 2 / 2 页')).toBeTruthy();
  });

  it('PDF 加载失败显示错误', async () => {
    pdfState.fail = true;
    mockBinary({ base64Content: btoa('x'), byteSize: 1, mimeType: 'application/pdf' });
    render(<ResourceViewer filePath="/p/doc.pdf" />);
    expect(await screen.findByText('PDF 预览失败: 坏的 PDF')).toBeTruthy();
  });

  it('PDF 画布不可用时显示错误', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    mockBinary({ base64Content: btoa('x'), byteSize: 1, mimeType: 'application/pdf' });
    render(<ResourceViewer filePath="/p/doc.pdf" />);
    expect(await screen.findByText('PDF 预览失败: 无法创建 PDF 预览画布')).toBeTruthy();
  });

  it('卸载时销毁 PDF loadingTask', async () => {
    mockBinary({ base64Content: btoa('x'), byteSize: 1, mimeType: 'application/pdf' });
    const { unmount } = render(<ResourceViewer filePath="/p/doc.pdf" />);
    await screen.findByText('第 1 / 2 页');
    unmount();
    expect(pdfState.destroy).toHaveBeenCalled();
  });

  // BUG: ResourceViewer 的加载 effect 没有取消/竞态保护（无 disposed 标记）。
  // 快速从 A 切到 B 时，若 A 的 IPC 晚于 B 返回，会用 A 的内容覆盖 B 的预览。
  it('快速切换文件时旧请求结果不应覆盖新文件', async () => {
    const resolvers = new Map<string, (v: Binary) => void>();
    installElectronMock(
      (_channel, filePath) =>
        new Promise<Binary>((resolve) => {
          resolvers.set(String(filePath), resolve);
        })
    );
    const { rerender } = render(<ResourceViewer filePath="/p/a.png" />);
    rerender(<ResourceViewer filePath="/p/b.png" />);
    await act(async () => {
      resolvers.get('/p/b.png')?.({ base64Content: 'BBBB', byteSize: 1, mimeType: 'image/png' });
    });
    await act(async () => {
      resolvers.get('/p/a.png')?.({ base64Content: 'AAAA', byteSize: 1, mimeType: 'image/png' });
    });
    const img = screen.getByAltText('b.png') as HTMLImageElement;
    expect(img.src).toBe('data:image/png;base64,BBBB');
  });
});

describe('BinaryContentViewer', () => {
  it('无文件返回 null', () => {
    const { container } = render(<BinaryContentViewer filePath={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('展示原始 base64 内容与元数据', async () => {
    mockBinary({ base64Content: 'QUJD', byteSize: 3, mimeType: 'application/octet-stream' });
    render(<BinaryContentViewer filePath="/p/raw.bin" settingsComponent={<i>s</i>} />);
    expect(await screen.findByText('QUJD')).toBeTruthy();
    expect(screen.getByText('原始内容')).toBeTruthy();
    expect(screen.getByText('raw.bin')).toBeTruthy();
    expect(screen.getByText('Base64')).toBeTruthy();
    expect(screen.queryByText('已截断显示')).toBeNull();
  });

  it('超长内容截断', async () => {
    mockBinary({ base64Content: 'A'.repeat(64 * 1024 + 10), byteSize: 99999, mimeType: 'x/y' });
    render(<BinaryContentViewer filePath="/p/raw.bin" />);
    expect(await screen.findByText('已截断显示')).toBeTruthy();
  });

  it('读取失败显示错误', async () => {
    mockBinary(new Error('无权限'));
    render(<BinaryContentViewer filePath="/p/raw.bin" />);
    expect(await screen.findByText('无权限')).toBeTruthy();
    expect(screen.getByText('资源内容加载失败')).toBeTruthy();
  });

  it('非 Error 异常使用默认文案', async () => {
    installElectronMock(() => {
      throw 1;
    });
    render(<BinaryContentViewer filePath="/p/raw.bin" />);
    expect(await screen.findByText('无法读取资源内容')).toBeTruthy();
  });
});
