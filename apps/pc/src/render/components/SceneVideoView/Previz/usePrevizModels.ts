/**
 * 预演可用的 AI 模型：设置中心「AI → 文本」里已配置 Key 且已启用的模型（每条一个选项，显示名称即选项文字），
 * 默认文本模型在前并默认选中（utils/textProviders）。只读 configured 标记，不涉及任何密钥。
 */
import { useEffect, useMemo, useState } from 'react';
import type { AIProviderInfo } from '@/render/types/ai-api';
import { usableModels } from '@/render/utils/textProviders';
import type { PrevizModelChoice } from './previzGeneration';

export interface PrevizModelOption {
  value: string;
  label: string;
  choice: PrevizModelChoice;
}

export function modelOptionsFrom(providers: readonly AIProviderInfo[]): PrevizModelOption[] {
  return usableModels(providers, 'text').map((provider) => ({
    value: provider.id,
    label: provider.label,
    choice: { providerId: provider.id, model: provider.model },
  }));
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
