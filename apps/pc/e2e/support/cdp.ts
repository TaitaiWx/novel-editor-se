/**
 * 极简 Chrome DevTools Protocol 客户端
 *
 * 只依赖 Node 24 内置的全局 WebSocket，不引入 Playwright / WebdriverIO 等重型依赖。
 * 支持：发送命令并等待结果、订阅事件、连接关闭时拒绝所有挂起的请求。
 */

export type CdpParams = Record<string, unknown>;
export type CdpEventHandler = (params: CdpParams) => void;

interface PendingCall {
  method: string;
  resolve: (value: CdpParams) => void;
  reject: (error: Error) => void;
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: CdpParams;
  result?: CdpParams;
  error?: { code: number; message: string; data?: string };
}

export class CdpClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private readonly listeners = new Map<string, Set<CdpEventHandler>>();
  private closed = false;

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => this.handleMessage(String(event.data)));
    socket.addEventListener('close', () => this.handleClose());
  }

  /** 连接到某个 target 的 webSocketDebuggerUrl */
  static connect(url: string, timeoutMs = 10_000): Promise<CdpClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`连接 CDP 超时: ${url}`));
      }, timeoutMs);
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(new CdpClient(socket));
      });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error(`连接 CDP 失败: ${url}`));
      });
    });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  send<T extends CdpParams = CdpParams>(
    method: string,
    params: CdpParams = {},
    timeoutMs = 30_000
  ): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error(`CDP 连接已关闭，无法执行 ${method}`));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 命令超时: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method: string, handler: CdpEventHandler): () => void {
    const set = this.listeners.get(method) ?? new Set<CdpEventHandler>();
    set.add(handler);
    this.listeners.set(method, set);
    return () => set.delete(handler);
  }

  close(): void {
    if (this.closed) return;
    try {
      this.socket.close();
    } catch {
      // 忽略：进程可能已退出
    }
    this.handleClose();
  }

  private handleMessage(raw: string): void {
    let message: CdpMessage;
    try {
      message = JSON.parse(raw) as CdpMessage;
    } catch {
      return;
    }
    if (typeof message.id === 'number') {
      const call = this.pending.get(message.id);
      if (!call) return;
      this.pending.delete(message.id);
      if (message.error) {
        call.reject(new Error(`${call.method} 失败: ${message.error.message}`));
      } else {
        call.resolve(message.result ?? {});
      }
      return;
    }
    if (message.method) {
      const handlers = this.listeners.get(message.method);
      handlers?.forEach((handler) => handler(message.params ?? {}));
    }
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const call of this.pending.values()) {
      call.reject(new Error(`CDP 连接已关闭（${call.method} 未完成）`));
    }
    this.pending.clear();
  }
}
