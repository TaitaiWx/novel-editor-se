/**
 * AI 网络代理（设置中心「AI → 网络代理」，主进程与渲染进程共用的协议与校验）
 *
 * - 全局一份代理设置：跟随系统代理，或手动填写代理地址（http / https / socks4 / socks5，host:port，不含账号密码与路径）
 * - 只有勾选了「通过代理访问」的模型（ModelEntry.useProxy）才走代理，其余直连
 * - 保存在 userData/ai-providers.json 的 proxy 字段（不是密钥）
 */

export type AIProxyMode = 'system' | 'manual';

export interface AIProxySettings {
  mode: AIProxyMode;
  /** 手动模式的代理地址，例如 http://127.0.0.1:7890、socks5://127.0.0.1:1080 */
  url?: string;
}

export const DEFAULT_AI_PROXY: AIProxySettings = { mode: 'system' };

export const AI_PROXY_PROTOCOLS = ['http:', 'https:', 'socks4:', 'socks5:'] as const;

/** 校验并规范化代理地址；空字符串返回 ''，无效时抛出带中文说明的错误 */
export function normalizeProxyUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('代理地址无效');
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length > 512) throw new Error('代理地址过长');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('代理地址格式不正确，例如 http://127.0.0.1:7890');
  }
  if (!(AI_PROXY_PROTOCOLS as readonly string[]).includes(url.protocol)) {
    throw new Error('代理地址只支持 http / https / socks4 / socks5');
  }
  if (url.username || url.password) throw new Error('代理地址不能包含账号密码');
  if (!url.hostname || !url.port)
    throw new Error('代理地址需要包含主机和端口，例如 127.0.0.1:7890');
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
    throw new Error('代理地址只填协议、主机和端口');
  }
  return `${url.protocol}//${url.host}`;
}

/** 规范化整份设置（宽松读取用 lenient=true：无效地址丢弃并回退到系统代理） */
export function normalizeProxySettings(value: unknown, lenient = false): AIProxySettings {
  const record =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  if (record.mode !== 'manual') return { ...DEFAULT_AI_PROXY };
  try {
    const url = normalizeProxyUrl(record.url ?? '');
    if (!url) throw new Error('请填写代理地址');
    return { mode: 'manual', url };
  } catch (error) {
    if (lenient) return { ...DEFAULT_AI_PROXY };
    throw error;
  }
}
