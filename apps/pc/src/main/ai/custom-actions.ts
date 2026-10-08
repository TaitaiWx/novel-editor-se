/**
 * 添加 / 删除自己的 AI 服务（主进程校验渲染进程传入的全部字段）
 *
 * - 文本：OpenAI 兼容（custom-text-<n>），名称 + 接口地址必填
 * - 视频 / 图片 / 语音：选一个同类内置厂商实现（custom-<kind>-<n>），名称必填，接口地址省略时用厂商默认
 * - Key 可同时写入（只写不读）；任一字段校验失败都撤销登记，不留半成品
 */
import { AIError, toAIError } from '@novel-editor/ai';
import type { AICustomProviderInput, AIProviderUpdate } from '../../shared/ai';
import type { CredentialStore } from './credential-store';
import { resolveCustomMediaVendor } from './custom-media';
import {
  isCustomMediaId,
  isCustomTextId,
  normalizeBaseUrl,
  type ProviderConfigStore,
} from './provider-config';
import { isRecord } from './request';

export interface CustomActionDeps {
  credentials: CredentialStore;
  configs: ProviderConfigStore;
  clock?: () => Date;
}

const MAX_KEY_LENGTH = 4096;

function badRequest(error: unknown): AIError {
  return new AIError({ kind: 'bad-request', message: toAIError(error).message });
}

/** 添加后的初始配置（地址 / 模型 / 单价 / 声音），只取对应类型用得到的字段 */
function initialConfig(input: AICustomProviderInput, kind: string): AIProviderUpdate {
  const update: AIProviderUpdate = {
    baseUrl: typeof input.baseUrl === 'string' ? input.baseUrl : undefined,
    model: typeof input.model === 'string' ? input.model : undefined,
  };
  if (kind === 'video' && typeof input.pricePerSecond === 'number') {
    update.pricePerSecond = input.pricePerSecond;
  }
  if (kind === 'speech' && typeof input.voice === 'string') update.voice = input.voice;
  return update;
}

/** 添加一个自己的服务，返回分配的 id */
export function addCustomProvider(deps: CustomActionDeps, input: AICustomProviderInput): string {
  if (!isRecord(input)) throw new AIError({ kind: 'bad-request', message: '无效的配置' });
  const kind = input.kind ?? 'text';
  let baseUrl: string | undefined;
  try {
    baseUrl = normalizeBaseUrl(input.baseUrl);
  } catch (error) {
    throw badRequest(error);
  }
  if (kind === 'text' && !baseUrl) {
    throw new AIError({ kind: 'bad-request', message: '请填写接口地址' });
  }
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  if (apiKey.length > MAX_KEY_LENGTH) {
    throw new AIError({ kind: 'bad-request', message: 'API Key 过长' });
  }
  const createdAt = (deps.clock ?? (() => new Date()))().toISOString();

  let id: string;
  try {
    if (kind === 'text') {
      id = deps.configs.addCustomText(input.label, createdAt).id;
    } else {
      const resolved = resolveCustomMediaVendor(kind, input.vendor);
      id = deps.configs.addCustomMedia(
        resolved.kind,
        resolved.vendor.id,
        input.label,
        createdAt
      ).id;
    }
  } catch (error) {
    throw badRequest(error);
  }

  try {
    deps.configs.update(id, initialConfig({ ...input, baseUrl }, kind));
    if (apiKey) deps.credentials.set(id, apiKey);
  } catch (error) {
    // 地址 / 模型 / 单价校验失败：撤销登记
    if (kind === 'text') deps.configs.removeCustomText(id);
    else deps.configs.removeCustomMedia(id);
    deps.credentials.delete(id);
    throw badRequest(error);
  }
  return id;
}

/** 删除自己添加的服务（连同 Key 与配置）；内置服务不能删除 */
export function removeCustomProvider(deps: CustomActionDeps, providerId: unknown): boolean {
  if (isCustomTextId(providerId)) {
    deps.credentials.delete(providerId);
    return deps.configs.removeCustomText(providerId);
  }
  if (isCustomMediaId(providerId)) {
    deps.credentials.delete(providerId);
    return deps.configs.removeCustomMedia(providerId);
  }
  throw new AIError({ kind: 'bad-request', message: '只能删除自己添加的服务' });
}
