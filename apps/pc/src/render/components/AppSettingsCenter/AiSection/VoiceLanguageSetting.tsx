import React, { useEffect, useState } from 'react';
import { DEFAULT_VOICE_LANGUAGE, VOICE_LANGUAGES } from '@novel-editor/video';
import type { AIIpcResult, VideoSettingsInfo } from '../../../types/ai-api';
import Select from '../../Select';
import { SettingsRow } from '../layout';

/** 配音默认语言（新的场景视频使用；保存在 ai-providers.json 的视频设置里） */
const VoiceLanguageSetting: React.FC = () => {
  const [language, setLanguage] = useState<string>(DEFAULT_VOICE_LANGUAGE);
  useEffect(() => {
    void window.electron?.ipcRenderer
      .invoke('video-settings-get')
      .then((result: AIIpcResult<VideoSettingsInfo>) => {
        if (result?.ok && result.data.voiceLanguage) setLanguage(result.data.voiceLanguage);
      })
      .catch(() => undefined);
  }, []);
  return (
    <SettingsRow
      label="配音默认语言"
      description="新的场景视频使用；每一场可在「场景 → 声音」里改。"
      control="field"
    >
      <Select
        block
        size="lg"
        aria-label="配音默认语言"
        value={language}
        options={VOICE_LANGUAGES.map((item) => ({
          value: item.code,
          label: `${item.label}（${item.code}）`,
          textValue: item.label,
        }))}
        onChange={(next) => {
          setLanguage(next);
          void window.electron?.ipcRenderer
            .invoke('video-settings-set', { voiceLanguage: next })
            .catch(() => undefined);
        }}
      />
    </SettingsRow>
  );
};

export default VoiceLanguageSetting;
