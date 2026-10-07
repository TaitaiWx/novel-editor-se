import { vi } from 'vitest';

/** 记录绘制调用的假 2D 上下文（只实现本包用到的 API） */
export function createFakeContext() {
  const calls: { op: string; args: unknown[]; alpha: number }[] = [];
  const context = {
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    calls,
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn((...args: unknown[]) => calls.push({ op: 'clearRect', args, alpha: 1 })),
    fillRect: vi.fn((...args: unknown[]) =>
      calls.push({ op: 'fillRect', args, alpha: context.globalAlpha })
    ),
    strokeRect: vi.fn(),
    drawImage: vi.fn((...args: unknown[]) =>
      calls.push({ op: 'drawImage', args, alpha: context.globalAlpha })
    ),
    fillText: vi.fn((...args: unknown[]) =>
      calls.push({ op: 'fillText', args, alpha: context.globalAlpha })
    ),
    measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
  };
  return context;
}

export type FakeContext = ReturnType<typeof createFakeContext>;

/** 假 OffscreenCanvas：vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas) */
export class FakeOffscreenCanvas {
  static instances: FakeOffscreenCanvas[] = [];
  readonly context = createFakeContext();
  constructor(
    public width: number,
    public height: number
  ) {
    FakeOffscreenCanvas.instances.push(this);
  }
  getContext(type: string) {
    return type === '2d' ? this.context : null;
  }
}

/** 简单图像源 */
export function fakeImage(width: number, height: number) {
  return { width, height } as unknown as ImageBitmap;
}
