/**
 * 主进程 AI 运行时：按需创建 CredentialStore / ProviderConfigStore / AIService 单例
 *
 * 密钥与 Provider 配置是应用全局的（userData），设置中心 JSON 跟随当前打开的数据库。
 * 数据库打开后（db-init / db-init-default）调用 onDatabaseOpened：迁移明文 Key、恢复视频任务轮询。
 */
import { app, safeStorage, session } from 'electron';
import path from 'path';
import { isDatabaseReady, settingsOps } from '@novel-editor/store';
import { CREDENTIALS_FILE_NAME, CredentialStore } from './credential-store';
import { PROVIDER_CONFIG_FILE_NAME, ProviderConfigStore } from './provider-config';
import { AI_PROXY_PARTITION, ProxyFetcher } from './proxy-fetch';
import { AIService } from './service';
import { migratePlaintextApiKey, SETTINGS_CENTER_KEY } from './settings-secrets';

let credentials: CredentialStore | null = null;
let configs: ProviderConfigStore | null = null;
let service: AIService | null = null;
let proxyFetcher: ProxyFetcher | null = null;
const databaseOpenedListeners = new Set<() => void>();

function userDataPath(fileName: string): string {
  return path.join(app.getPath('userData'), fileName);
}

export function getCredentialStore(): CredentialStore {
  credentials ??= new CredentialStore(userDataPath(CREDENTIALS_FILE_NAME), safeStorage);
  return credentials;
}

export function getProviderConfigStore(): ProviderConfigStore {
  // 旧版 ai-providers.json 迁移时按 Key 判断哪些内置服务配置过
  configs ??= new ProviderConfigStore(userDataPath(PROVIDER_CONFIG_FILE_NAME), {
    hasCredential: (id) => getCredentialStore().has(id),
  });
  return configs;
}

/** 勾选了「通过代理访问」的模型使用的代理通道（独立内存会话，按「AI → 网络代理」设置） */
export function getProxyFetcher(): ProxyFetcher {
  proxyFetcher ??= new ProxyFetcher(
    () => session.fromPartition(AI_PROXY_PARTITION, { cache: false }),
    () => getProviderConfigStore().getProxy()
  );
  return proxyFetcher;
}

export function getAIService(): AIService {
  service ??= new AIService({
    credentials: getCredentialStore(),
    configs: getProviderConfigStore(),
    readSettings: () => (isDatabaseReady() ? settingsOps.get(SETTINGS_CENTER_KEY) : undefined),
    proxyFetch: (input, init) => getProxyFetcher().fetch(input, init),
  });
  return service;
}

/** 数据库打开后的回调（视频任务队列注册，用于重启后恢复轮询） */
export function onDatabaseOpened(listener: () => void): () => void {
  databaseOpenedListeners.add(listener);
  return () => databaseOpenedListeners.delete(listener);
}

/** 数据库打开后调用：把设置 JSON 中的明文 Key 移入安全存储，并通知视频队列恢复 */
export function handleDatabaseOpened(): void {
  try {
    const outcome = migratePlaintextApiKey(settingsOps, getCredentialStore());
    if (outcome.conflict) {
      console.warn('[ai] 数据库中的明文 API Key 与已保存的 Key 不同，已保留安全存储中的 Key');
    }
  } catch (error) {
    console.warn('[ai] 迁移明文 API Key 失败:', error);
  }
  for (const listener of databaseOpenedListeners) {
    try {
      listener();
    } catch (error) {
      console.warn('[ai] 数据库打开回调失败:', error);
    }
  }
}

/** 测试用：重置单例 */
export function resetAIRuntimeForTests(): void {
  credentials = null;
  configs = null;
  service = null;
  proxyFetcher = null;
  databaseOpenedListeners.clear();
}
