/**
 * 预演可用的 AI 模型：已配置 Key 且已启用的文本服务（与「AI 生成分镜」同一判断，useVideoServices.pickTextProvider），
 * 每个服务列出当前模型与可选模型；默认选设置中心的默认 AI（openai-compatible），其次第一个可用服务。
 * 只读 configured 标记，不涉及任何密钥。
 */
import { useEffect, useMemo, useState } from 'react';
import type { AIProviderInfo } from '@/render/types/ai-api';
import { pickTextProvider } from '../useVideoServices';
import type { PrevizModelChoice } from './previzGeneration';

export interface PrevizModelOption {
  value: string;
  label: string;
  choice: PrevizModelChoice;
}

const SEPARATOR = '::';

export function modelOptionsFrom(providers: readonly AIProviderInfo[]): PrevizModelOption[] {
  const ready = providers.filter((item) => item.kind === 'text' && item.configured && item.enabled);
  const preferred = pickTextProvider(providers);
  const ordered = [...ready].sort(
    (a, b) => Number(b.id === preferred) - Number(a.id === preferred)
  );
  return ordered.flatMap((provider) => {
    const models = Array.from(new Set([provider.model, ...provider.models].filter(Boolean)));
    const list = models.length ? models : [''];
    return list.map((model) => ({
      value: `${provider.id}${SEPARATOR}${model}`,
      label: model ? `${provider.label} · ${model}` : provider.label,
      choice: { providerId: provider.id, model },
    }));
  });
}

export function usePrevizModels(): {
  loaded: boolean;
  options: PrevizModelOption[];
  value: string;
  setValue: (value: string) => void;
  selected: PrevizModelChoice | null;
} {
  const [providers, setProviders] = useState<AIProviderInfo[] | null>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) {
      setProviders([]);
      return;
    }
    let cancelled = false;
    ipc
      .invoke('ai-providers-list')
      .then((result) => {
        if (!cancelled) setProviders(result.ok ? result.data : []);
      })
      .catch(() => {
        if (!cancelled) setProviders([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const options = useMemo(() => modelOptionsFrom(providers ?? []), [providers]);
  const current = options.find((option) => option.value === value) ?? options[0] ?? null;
  return {
    loaded: providers !== null,
    options,
    value: current?.value ?? '',
    setValue,
    selected: current?.choice ?? null,
  };
}
