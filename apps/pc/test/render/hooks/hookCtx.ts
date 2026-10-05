import { vi, type Mock } from 'vitest';

/** 与 ToastApi 结构一致的 spy 集合 */
export interface ToastSpy {
  show: Mock<(message: string, options?: unknown) => void>;
  success: Mock<(message: string, duration?: number) => void>;
  error: Mock<(message: string, duration?: number) => void>;
  warning: Mock<(message: string, duration?: number) => void>;
  info: Mock<(message: string, duration?: number) => void>;
}

export function makeToast(): ToastSpy {
  return {
    show: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  };
}

/** 与 DialogApi 结构一致的 spy 集合，默认确认 / 返回 null */
export interface DialogSpy {
  confirm: Mock<(title: string, message?: string) => Promise<boolean>>;
  prompt: Mock<
    (title: string, placeholder?: string, defaultValue?: string) => Promise<string | null>
  >;
}

export function makeDialog(
  options: { confirm?: boolean; prompts?: Array<string | null> } = {}
): DialogSpy {
  const queue = [...(options.prompts ?? [])];
  return {
    confirm: vi.fn(async () => options.confirm ?? true),
    prompt: vi.fn(async () => (queue.length > 0 ? (queue.shift() ?? null) : null)),
  };
}

export function ref<T>(current: T): { current: T } {
  return { current };
}

/** 创建一个可手动 resolve/reject 的 promise */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
