// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  exportChoicesFor,
  exportFileName,
  exportMediaFile,
  exportMediaWithToast,
  generatedFormatOf,
  planMediaExport,
  saveGeneratedMedia,
} from '@/render/utils/mediaExport';
import { installElectronMock, uninstallElectronMock } from '../hooks/electronMock';

afterEach(() => {
  uninstallElectronMock();
});

describe('导出方式（planMediaExport）', () => {
  it('图片：同格式原样复制（jpg = jpeg），换格式时转换为 PNG / JPEG / WebP', () => {
    expect(planMediaExport('/p/a.png')).toEqual({ mode: 'copy', format: 'png' });
    expect(planMediaExport('/p/a.png', 'png')).toEqual({ mode: 'copy', format: 'png' });
    expect(planMediaExport('/p/a.JPG', 'jpeg')).toEqual({ mode: 'copy', format: 'jpg' });
    expect(planMediaExport('/p/a.webp', 'png')).toEqual({
      mode: 'convert',
      format: 'png',
      mime: 'image/png',
    });
    expect(planMediaExport('/p/a.png', 'jpg')).toEqual({
      mode: 'convert',
      format: 'jpeg',
      mime: 'image/jpeg',
    });
    expect(planMediaExport('/p/a.svg', '.webp')).toEqual({
      mode: 'convert',
      format: 'webp',
      mime: 'image/webp',
    });
    expect(planMediaExport('/p/a.png', 'gif')).toBeNull();
  });

  it('视频：只按原容器导出，绝不转码；非媒体文件不支持', () => {
    expect(planMediaExport('/p/镜头1-v1.mp4')).toEqual({ mode: 'copy', format: 'mp4' });
    expect(planMediaExport('/p/样片.webm', 'webm')).toEqual({ mode: 'copy', format: 'webm' });
    expect(planMediaExport('/p/a.mov', 'mp4')).toBeNull();
    expect(planMediaExport('/p/a.md')).toBeNull();
  });

  it('可选格式：图片三种，视频只有原格式，其他没有', () => {
    expect(exportChoicesFor('/p/a.webp').map((choice) => choice.label)).toEqual([
      'PNG',
      'JPEG',
      'WebP',
    ]);
    expect(exportChoicesFor('/p/a.mp4')).toEqual([{ format: 'mp4', label: 'MP4' }]);
    expect(exportChoicesFor('/p/a.txt')).toEqual([]);
  });

  it('建议文件名：去掉原扩展名换成目标格式（jpeg 用 .jpg），可用标题', () => {
    expect(exportFileName('/p/三视图.webp', 'png')).toBe('三视图.png');
    expect(exportFileName('/p/三视图.webp', 'jpeg', '林舟 · 三视图')).toBe('林舟 · 三视图.jpg');
    expect(exportFileName('C:\\p\\离港.mp4', 'mp4')).toBe('离港.mp4');
  });
});

describe('exportMediaFile', () => {
  it('同格式：直接交给主进程复制（不读文件）', async () => {
    const mock = installElectronMock((channel) =>
      channel === 'media-export' ? { saved: true, filePath: '/d/离港.mp4' } : null
    );
    await expect(exportMediaFile({ sourcePath: '/p/离港.mp4' })).resolves.toEqual({
      saved: true,
      filePath: '/d/离港.mp4',
    });
    expect(mock.invoke).toHaveBeenCalledTimes(1);
    expect(mock.invoke).toHaveBeenCalledWith('media-export', {
      sourcePath: '/p/离港.mp4',
      defaultName: '离港.mp4',
      format: 'mp4',
    });
  });

  it('换格式：先读取文件再转换；转换失败时返回错误、不调用导出', async () => {
    const mock = installElectronMock((channel) =>
      channel === 'read-file-binary' ? { base64Content: 'AAAA', mimeType: 'image/webp' } : null
    );
    // happy-dom 无法真正解码图片
    const result = await exportMediaFile({ sourcePath: '/p/a.webp', format: 'png' });
    expect(result.saved).toBe(false);
    expect(result.error).toBeTruthy();
    expect(mock.invoke).toHaveBeenCalledWith('read-file-binary', '/p/a.webp');
    expect(mock.invoke).not.toHaveBeenCalledWith('media-export', expect.anything());
  });

  it('不支持的格式 / 没有 IPC 时返回错误', async () => {
    await expect(exportMediaFile({ sourcePath: '/p/a.png' })).resolves.toMatchObject({
      saved: false,
    });
    installElectronMock();
    await expect(exportMediaFile({ sourcePath: '/p/a.mov', format: 'mp4' })).resolves.toEqual({
      saved: false,
      error: '这个文件不能导出为该格式',
    });
  });

  it('exportMediaWithToast：保存后提示位置，失败提示原因，取消时不提示', async () => {
    const toast = { success: vi.fn(), error: vi.fn() };
    let response: unknown = { saved: true, filePath: '/d/a.png' };
    installElectronMock((channel) => (channel === 'media-export' ? response : null));
    await exportMediaWithToast({ sourcePath: '/p/a.png' }, toast);
    expect(toast.success).toHaveBeenCalledWith('已导出到 /d/a.png', 5000);
    response = { saved: false };
    await exportMediaWithToast({ sourcePath: '/p/a.png' }, toast);
    expect(toast.error).not.toHaveBeenCalled();
    response = { saved: false, error: '文件不在当前打开的项目内' };
    await exportMediaWithToast({ sourcePath: '/p/a.png' }, toast);
    expect(toast.error).toHaveBeenCalledWith('导出失败：文件不在当前打开的项目内');
  });
});

describe('播放器截图 / 录制保存（saveGeneratedMedia）', () => {
  it('按 MIME 选择格式，把字节交给主进程', async () => {
    const mock = installElectronMock((channel) =>
      channel === 'media-save-generated' ? { saved: true, filePath: '/d/离港.webm' } : null
    );
    const blob = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], {
      type: 'video/webm;codecs=vp9,opus',
    });
    expect(await saveGeneratedMedia(blob, '离港.webm')).toEqual({
      saved: true,
      filePath: '/d/离港.webm',
    });
    const [channel, request] = mock.invoke.mock.calls[0] as [
      string,
      { defaultName: string; format: string; data: Uint8Array },
    ];
    expect(channel).toBe('media-save-generated');
    expect(request.format).toBe('webm');
    expect(request.defaultName).toBe('离港.webm');
    expect(Array.from(request.data)).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  });

  it('不支持的格式 / 没有 IPC 时返回错误', async () => {
    expect(generatedFormatOf('image/png')).toBe('png');
    expect(generatedFormatOf('video/mp4;codecs=avc1')).toBe('mp4');
    expect(generatedFormatOf('image/gif')).toBeNull();
    expect(
      (await saveGeneratedMedia(new Blob(['x'], { type: 'image/png' }), 'a.png')).error
    ).toMatch(/无法保存/);
    installElectronMock();
    expect(
      (await saveGeneratedMedia(new Blob(['x'], { type: 'image/gif' }), 'a.gif')).error
    ).toMatch(/不支持/);
  });
});
