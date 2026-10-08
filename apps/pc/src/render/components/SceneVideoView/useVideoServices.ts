import { useCallback, useEffect, useState } from 'react';
import type { AIProviderInfo, VideoSettingsInfo } from '@/render/types/ai-api';
import { BUILTIN_TEXT_PROVIDER_ID, pickDefaultTextProvider } from '@/render/utils/textProviders';

/** 内置默认文本服务；分镜优先用默认写作 AI（utils/textProviders），其次用其他已配置的文本服务 */
export const DEFAULT_TEXT_PROVIDER_ID = BUILTIN_TEXT_PROVIDER_ID;

export interface VideoServicesState {
  loaded: boolean;
  /** 已配置 Key 且已启用的视频服务（MiniMax / Seedance） */
  videoProviders: AIProviderInfo[];
  /** 分镜用的文本服务；没有可用的文本服务时为 null（使用按段落拆分） */
  textProviderId: string | null;
  settings: VideoSettingsInfo | null;
}

const EMPTY: VideoServicesState = {
  loaded: false,
  videoProviders: [],
  textProviderId: null,
  settings: null,
};

/** 分镜 / 预演用的文本服务：默认写作 AI（选定的 > 内置默认 > 第一个可用的） */
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
        videoProviders: list.filter(
          (item) => item.kind === 'video' && item.configured && item.enabled
        ),
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
