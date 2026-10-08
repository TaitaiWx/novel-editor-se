/**
 * AI 请求的代理通道：勾选了「通过代理访问」的模型用一个独立的 Electron 会话（内存分区）发请求，
 * 会话按设置中心「AI → 网络代理」配置（跟随系统代理 / 手动地址）；其余模型照常用 Node fetch 直连。
 *
 * - 用 Chromium 网络栈（session.fetch）而不是给 Node fetch 加代理库：支持 http / https / socks4 / socks5、
 *   系统代理（含 PAC），不新增依赖；流式响应与 AbortSignal 照常可用
 * - 手动模式下 loopback 也走代理（`<-loopback>`）：勾选了代理的模型就全部经过代理，行为可预期
 * - 设置变化时下一次请求前重新 setProxy 并断开旧连接（setProxy 是异步的，请求会等它完成）
 */
import type { AIProxySettings } from '../../shared/ai-proxy';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** 需要的最小会话接口（便于单测注入假会话） */
export interface ProxySession {
  setProxy(config: {
    mode?: 'system' | 'fixed_servers';
    proxyRules?: string;
    proxyBypassRules?: string;
  }): Promise<void>;
  closeAllConnections?(): Promise<void>;
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

export const AI_PROXY_PARTITION = 'novel-editor-ai-proxy';

/** 代理设置 → Electron setProxy 参数（纯函数） */
export function toSessionProxyConfig(settings: AIProxySettings): {
  mode: 'system' | 'fixed_servers';
  proxyRules?: string;
  proxyBypassRules?: string;
} {
  if (settings.mode === 'manual' && settings.url) {
    return { mode: 'fixed_servers', proxyRules: settings.url, proxyBypassRules: '<-loopback>' };
  }
  return { mode: 'system' };
}

export class ProxyFetcher {
  private appliedKey: string | null = null;
  /** 正在应用的设置（并发请求等同一次 setProxy，不重复设置） */
  private pending: { key: string; promise: Promise<void> } | null = null;
  private session: ProxySession | null = null;

  constructor(
    private readonly getSession: () => ProxySession,
    private readonly getSettings: () => AIProxySettings
  ) {}

  /** 确保会话的代理与当前设置一致 */
  private async ensure(): Promise<ProxySession> {
    this.session ??= this.getSession();
    const session = this.session;
    const config = toSessionProxyConfig(this.getSettings());
    const key = JSON.stringify(config);
    if (this.pending?.key === key) {
      await this.pending.promise;
      return session;
    }
    if (key === this.appliedKey && !this.pending) return session;
    const promise = (async () => {
      await session.setProxy(config);
      await session.closeAllConnections?.();
      this.appliedKey = key;
    })();
    const pending = { key, promise };
    this.pending = pending;
    try {
      await promise;
    } finally {
      if (this.pending === pending) this.pending = null;
    }
    return session;
  }

  /** 走代理的 fetch（注入到 Provider 配置 / 成片下载） */
  readonly fetch: FetchLike = async (input, init) => {
    const session = await this.ensure();
    return session.fetch(input, init);
  };
}
