/**
 * 模型列表的增删改（主进程校验渲染进程传入的全部字段）
 *
 * - 添加：能力与协议实现必须一致（协议实现的 kind = 能力）；预设必须属于这个能力与协议；
 *   OpenAI 兼容协议必须填接口地址；显示名称省略时为「服务商 · 模型」
 * - 沿用 Key（reuseKeyFrom）：只允许同一协议 + 同一接口地址（含预设写明的等价旧地址）、已保存 Key 的模型；Key 在主进程内复制，渲染进程拿不到
 * - 任一字段校验失败都不留半成品（模型与 Key 一起撤销）
 */
import {
  AIError,
  toAIError,
  type ProviderDescriptor,
  type ProviderRegistry,
} from '@novel-editor/ai';
import type { AIModelInput, AIProviderUpdate } from '../../shared/ai';
import {
  defaultModelLabel,
  findPreset,
  sameServiceBaseUrl,
  isAICapability,
  presetForVendor,
  presetProviderName,
} from '../../shared/ai-models';
import type { CredentialStore } from './credential-store';
import {
  isModelId,
  normalizeBaseUrl,
  normalizeModelName,
  type ModelEntry,
  type ProviderConfigStore,
} from './provider-config';
import { isRecord } from './request';

export interface ModelActionDeps {
  credentials: CredentialStore;
  configs: ProviderConfigStore;
  registry: ProviderRegistry;
}

const MAX_KEY_LENGTH = 4096;

export function badRequest(error: unknown): AIError {
  return new AIError({ kind: 'bad-request', message: toAIError(error).message });
}

/** 服务商名称：预设名称 > 协议实现名称 */
export function providerLabelOf(
  entry: Pick<ModelEntry, 'preset' | 'vendor' | 'capability'>,
  descriptor: ProviderDescriptor | undefined
): string {
  const preset = findPreset(entry.preset);
  if (preset && preset.capability === entry.capability) return presetProviderName(preset);
  const byVendor = presetForVendor(entry.vendor);
  return byVendor ? presetProviderName(byVendor) : (descriptor?.label ?? entry.vendor);
}

/** 协议实现：必须已注册且能力一致 */
export function vendorFor(
  registry: ProviderRegistry,
  capability: unknown,
  vendor: unknown
): ProviderDescriptor {
  if (!isAICapability(capability)) throw badRequest('无效的模型类型');
  const descriptor = typeof vendor === 'string' ? registry.get(vendor) : undefined;
  if (!descriptor || descriptor.kind !== capability) {
    throw badRequest('服务商与模型类型不一致');
  }
  return descriptor;
}

/** 某条模型实际使用的接口地址（没有填写时为协议默认） */
export function effectiveBaseUrl(
  entry: Pick<ModelEntry, 'baseUrl'>,
  descriptor: ProviderDescriptor | undefined
): string {
  return entry.baseUrl || descriptor?.defaultBaseUrl || '';
}

/** 初始参数：只取这个能力用得到的字段 */
function initialUpdate(input: AIModelInput, baseUrl: string, model: string): AIProviderUpdate {
  const update: AIProviderUpdate = { baseUrl, model };
  if (typeof input.enabled === 'boolean') update.enabled = input.enabled;
  if (typeof input.useProxy === 'boolean') update.useProxy = input.useProxy;
  if (input.capability === 'text') {
    if (typeof input.temperature === 'number') update.temperature = input.temperature;
    if (typeof input.maxTokens === 'number') update.maxTokens = input.maxTokens;
    if (typeof input.contextTokens === 'number') update.contextTokens = input.contextTokens;
  }
  if (input.capability === 'video' && typeof input.pricePerSecond === 'number') {
    update.pricePerSecond = input.pricePerSecond;
  }
  if (input.capability === 'speech' && typeof input.voice === 'string') update.voice = input.voice;
  return update;
}

/** 沿用 Key：同一协议 + 同一接口地址、已保存 Key 的模型；返回 Key（只在主进程内使用） */
function reusableKey(
  deps: ModelActionDeps,
  sourceId: unknown,
  vendor: ProviderDescriptor,
  baseUrl: string
): string {
  if (!isModelId(sourceId)) throw badRequest('要沿用 Key 的模型无效');
  const source = deps.configs.getEntry(sourceId);
  if (!source || source.vendor !== vendor.id) throw badRequest('只能沿用同一服务商的 Key');
  if (!sameServiceBaseUrl(effectiveBaseUrl(source, vendor), baseUrl || vendor.defaultBaseUrl)) {
    throw badRequest('只能沿用同一接口地址的 Key');
  }
  const key = deps.credentials.get(source.id);
  if (!key) throw badRequest('要沿用的模型还没有保存 Key');
  return key;
}

/** 添加一个模型，返回新条目 */
export function addModel(deps: ModelActionDeps, input: AIModelInput): ModelEntry {
  if (!isRecord(input)) throw badRequest('无效的配置');
  const vendor = vendorFor(deps.registry, input.capability, input.vendor);
  const capability = vendor.kind;
  let preset: string | undefined;
  if (input.preset !== undefined) {
    const found = findPreset(typeof input.preset === 'string' ? input.preset : undefined);
    if (!found || found.capability !== capability || found.vendor !== vendor.id) {
      throw badRequest('服务商预设与模型类型不一致');
    }
    preset = found.key;
  }
  let baseUrl: string;
  let model: string;
  try {
    baseUrl = normalizeBaseUrl(input.baseUrl) ?? '';
    model = normalizeModelName(input.model) ?? '';
  } catch (error) {
    throw badRequest(error);
  }
  if (vendor.id === 'openai-compatible' && !baseUrl) throw badRequest('请填写接口地址');
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  if (apiKey.length > MAX_KEY_LENGTH) throw badRequest('API Key 过长');
  const reused =
    input.reuseKeyFrom !== undefined && !apiKey
      ? reusableKey(deps, input.reuseKeyFrom, vendor, baseUrl)
      : '';
  const label =
    typeof input.label === 'string' && input.label.trim()
      ? input.label
      : defaultModelLabel(
          providerLabelOf({ preset, vendor: vendor.id, capability }, vendor),
          model || vendor.defaultModel
        );

  let entry: ModelEntry;
  try {
    entry = deps.configs.add(
      { capability, vendor: vendor.id, label, ...(preset ? { preset } : {}) },
      initialUpdate({ ...input, capability }, baseUrl, model)
    );
  } catch (error) {
    throw badRequest(error);
  }
  const secret = apiKey || reused;
  if (secret) {
    try {
      deps.credentials.set(entry.id, secret);
    } catch (error) {
      deps.configs.remove(entry.id);
      throw badRequest(error);
    }
  }
  return entry;
}

/** 修改一个模型（显示名称、地址、模型、参数、启用；Key 只写） */
export function updateModel(
  deps: ModelActionDeps,
  id: unknown,
  update: AIProviderUpdate
): ModelEntry {
  if (!isModelId(id)) throw badRequest('无效的模型 id');
  if (!isRecord(update)) throw badRequest('无效的配置');
  const current = deps.configs.getEntry(id);
  if (!current) throw badRequest('找不到这个模型');
  if (current.vendor === 'openai-compatible' && update.baseUrl !== undefined) {
    if (typeof update.baseUrl === 'string' && !update.baseUrl.trim()) {
      throw badRequest('请填写接口地址');
    }
  }
  let entry: ModelEntry;
  try {
    entry = deps.configs.update(id, update);
  } catch (error) {
    throw badRequest(error);
  }
  if (update.clearKey === true) deps.credentials.delete(id);
  if (typeof update.apiKey === 'string' && update.apiKey.trim()) {
    try {
      deps.credentials.set(id, update.apiKey);
    } catch (error) {
      throw badRequest(error);
    }
  }
  return entry;
}

/** 删除一个模型（连同 Key） */
export function removeModel(deps: ModelActionDeps, id: unknown): boolean {
  if (!isModelId(id)) throw badRequest('无效的模型 id');
  const removed = deps.configs.remove(id);
  deps.credentials.delete(id);
  return removed;
}

/**
 * 旧版 ai-providers-set 的兼容：内置服务 id（grok、minimax-video…）还没有对应模型时，
 * 写入 Key / 地址 / 模型会以这个 id 新建一条模型（保持旧调用方可用）
 */
export function ensureLegacyEntry(
  deps: ModelActionDeps,
  id: string,
  update: AIProviderUpdate
): void {
  if (deps.configs.getEntry(id)) return;
  const descriptor = deps.registry.get(id);
  const creates =
    (typeof update.apiKey === 'string' && update.apiKey.trim()) ||
    typeof update.baseUrl === 'string' ||
    typeof update.model === 'string';
  if (!descriptor || !isAICapability(descriptor.kind) || !creates) {
    throw badRequest('找不到这个模型');
  }
  const model = typeof update.model === 'string' && update.model.trim() ? update.model : '';
  const preset = presetForVendor(id);
  try {
    deps.configs.add({
      id,
      capability: descriptor.kind,
      vendor: id,
      label: defaultModelLabel(
        providerLabelOf(
          { preset: preset?.key, vendor: id, capability: descriptor.kind },
          descriptor
        ),
        model || descriptor.defaultModel
      ),
      ...(preset && preset.capability === descriptor.kind ? { preset: preset.key } : {}),
    });
  } catch (error) {
    throw badRequest(error);
  }
}
