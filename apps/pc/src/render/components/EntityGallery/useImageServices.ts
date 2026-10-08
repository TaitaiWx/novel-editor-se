import { useCallback, useEffect, useState } from 'react';
import type { AIProviderInfo } from '@/render/types/ai-api';
import { usableModels } from '@/render/utils/textProviders';

/** 已配置并启用的图片模型（默认模型在前）；窗口重新获得焦点时刷新 */
export function useImageServices(): { loaded: boolean; providers: AIProviderInfo[] } {
  const [state, setState] = useState<{ loaded: boolean; providers: AIProviderInfo[] }>({
    loaded: false,
    providers: [],
  });
  const reload = useCallback(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) {
      setState({ loaded: true, providers: [] });
      return;
    }
    void ipc
      .invoke('ai-providers-list')
      .catch(() => null)
      .then((result) => {
        const list = result?.ok ? result.data : [];
        setState({ loaded: true, providers: usableModels(list, 'image') });
      });
  }, []);
  useEffect(() => {
    reload();
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [reload]);
  return state;
}
