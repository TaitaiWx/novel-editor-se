/**
 * 「添加模型」的服务商预设：地址协议、默认模型、DeepSeek 与官方文档一致、等价旧地址
 */
import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '@novel-editor/ai';
import { AI_MODEL_PRESETS, findPreset, sameServiceBaseUrl } from '../../src/shared/ai-models';

describe('AI 模型预设', () => {
  it('每个预设都用 https 地址（本地 Ollama 除外，用 http://localhost）', () => {
    for (const preset of AI_MODEL_PRESETS) {
      if (preset.key === 'custom') {
        expect(preset.baseUrl).toBe('');
        continue;
      }
      const url = new URL(preset.baseUrl);
      if (preset.key === 'ollama') {
        expect(url.protocol).toBe('http:');
        expect(url.hostname).toBe('localhost');
      } else {
        expect(url.protocol, preset.key).toBe('https:');
      }
      expect(preset.baseUrl.endsWith('/'), preset.key).toBe(false);
    }
  });

  it('除自定义外每个预设都有非空的默认模型（第一个），且建议列表不重复', () => {
    for (const preset of AI_MODEL_PRESETS) {
      if (preset.key === 'custom') continue;
      const [first] = preset.models;
      expect(first?.trim(), preset.key).toBeTruthy();
      expect(preset.models).toContain(first);
      expect(new Set(preset.models).size, preset.key).toBe(preset.models.length);
    }
  });

  it('预设的协议实现都在注册表里，且能力一致；注册表默认模型在自己的建议列表里', () => {
    const registry = createDefaultRegistry();
    const descriptors = registry.list();
    for (const preset of AI_MODEL_PRESETS) {
      const descriptor = descriptors.find((item) => item.id === preset.vendor);
      expect(descriptor, preset.key).toBeTruthy();
      expect(descriptor?.kind).toBe(preset.capability);
    }
    for (const descriptor of descriptors) {
      expect(descriptor.models, descriptor.id).toContain(descriptor.defaultModel);
      expect(new URL(descriptor.defaultBaseUrl).protocol, descriptor.id).toBe('https:');
    }
  });

  it('DeepSeek 与官方文档一致（api-docs.deepseek.com，2026-10-08）', () => {
    const deepseek = findPreset('deepseek');
    expect(deepseek).toMatchObject({
      capability: 'text',
      vendor: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com',
      models: ['deepseek-flash', 'deepseek-v4-pro'],
    });
  });

  it('等价旧地址：DeepSeek 带 / 不带 /v1、Ollama localhost / 127.0.0.1 视为同一服务', () => {
    expect(sameServiceBaseUrl('https://api.deepseek.com/v1/', 'https://api.deepseek.com')).toBe(
      true
    );
    expect(sameServiceBaseUrl('http://127.0.0.1:11434/v1', 'http://localhost:11434/v1')).toBe(true);
    expect(sameServiceBaseUrl('https://api.x.ai/v1/', 'https://api.x.ai/v1')).toBe(true);
    expect(sameServiceBaseUrl('https://api.deepseek.com/v1', 'https://api.openai.com/v1')).toBe(
      false
    );
    expect(sameServiceBaseUrl('', '')).toBe(false);
  });
});
