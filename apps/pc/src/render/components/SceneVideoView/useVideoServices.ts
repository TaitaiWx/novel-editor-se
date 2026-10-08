import { useCallback, useEffect, useState } from 'react';
import type { AIProviderInfo, VideoSettingsInfo } from '@/render/types/ai-api';
import { pickDefaultTextProvider, usableModels } from '@/render/utils/textProviders';

export interface VideoServicesState {
  loaded: boolean;
  /** 已配置 Key 且已启用的视频模型（默认模型在前） */
  videoProviders: AIProviderInfo[];
  /** 分镜用的文本模型；没有可用的文本模型时为 null（使用按段落拆分） */
  textProviderId: string | null;
  settings: VideoSettingsInfo | null;
}

const EMPTY: VideoServicesState = {
  loaded: false,
  videoProviders: [],
  textProviderId: null,
  settings: null,
};

/** 分镜 / 预演用的文本模型：默认文本模型（可用时）> 第一个可用的 */
export function pickTextProvider(providers: readonly AIProviderInfo[]): string | null {
  return pickDefaultTextProvider(providers)?.id ?? null;
}

/** 读取 AI / 视频服务配置（只有 configured 标记，不含任何密钥）；窗口重新获得焦点时刷新 */
export function useVideoServices(): VideoServicesState & { reload: () => void } {
  const [state, setState] = useState<VideoServicesState>(EMPTY);

  const reload = useCallback(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) {
      setState({ ...EMPTY, loaded: true });
      return;
    }
    void Promise.all([
      ipc.invoke('ai-providers-list').catch(() => null),
      ipc.invoke('video-settings-get').catch(() => null),
    ]).then(([providers, settings]) => {
      const list = providers?.ok ? providers.data : [];
      setState({
        loaded: true,
        videoProviders: usableModels(list, 'video'),
        textProviderId: pickTextProvider(list),
        settings: settings?.ok ? settings.data : null,
      });
    });
  }, []);

  useEffect(() => {
    reload();
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [reload]);

  return { ...state, reload };
}
