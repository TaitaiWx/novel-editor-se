import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  proxyFetch: vi.fn(),
  fetchFor: vi.fn(),
  resolveDefaultId: vi.fn(),
  generate: vi.fn(),
}));

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock('../../src/main/ai/runtime', () => ({
  getAIService: () => ({
    getImageProvider: () => ({
      id: 'grok-image',
      supportsReferences: false,
      generate: state.generate,
    }),
    resolveDefaultId: state.resolveDefaultId,
    fetchFor: state.fetchFor,
  }),
}));

import { generateImages } from '../../src/main/handlers/entity-media';

/** 最小的 PNG 文件头 */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('generateImages：厂商只返回图片地址时的下载', () => {
  beforeEach(() => {
    state.proxyFetch.mockReset().mockResolvedValue(new Response(PNG));
    state.fetchFor.mockReset();
    state.resolveDefaultId.mockReset().mockReturnValue('image-1');
    state.generate
      .mockReset()
      .mockResolvedValue({ images: [{ url: 'https://imgen.x.ai/a.png', mimeType: 'image/png' }] });
  });

  it('模型勾选了代理：用该模型的代理通道下载（默认模型按默认解析）', async () => {
    state.fetchFor.mockReturnValue(state.proxyFetch);
    const result = await generateImages({ prompt: '灯塔' }, null);
    expect(state.fetchFor).toHaveBeenCalledWith('image-1');
    expect(state.proxyFetch).toHaveBeenCalledWith('https://imgen.x.ai/a.png');
    expect(result.images[0].dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('指定模型时按该模型；没有代理时用普通 fetch', async () => {
    state.fetchFor.mockReturnValue(undefined);
    const direct = vi.fn(async () => new Response(PNG));
    vi.stubGlobal('fetch', direct);
    try {
      await generateImages({ prompt: '灯塔', providerId: 'image-2' }, null);
      expect(state.fetchFor).toHaveBeenCalledWith('image-2');
      expect(direct).toHaveBeenCalledWith('https://imgen.x.ai/a.png');
      expect(state.proxyFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
