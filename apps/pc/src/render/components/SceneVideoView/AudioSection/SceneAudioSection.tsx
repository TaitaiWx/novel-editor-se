/**
 * 场景检查器「声音」分区：配音语言、配音服务、背景音乐（本地文件 / 无）、环境音、对白时自动压低配乐。
 * 配乐 / 环境音文件由主进程弹出「打开」对话框并复制进 资料/音乐/，这里只保存相对作品目录的路径。
 */
import React from 'react';
import { VscClose } from 'react-icons/vsc';
import {
  DEFAULT_BGM,
  VOICE_LANGUAGES,
  type BgmSource,
  type BgmSpec,
  type SceneAudio,
} from '@novel-editor/video';
import type { AIProviderInfo } from '@/render/types/ai-api';
import NumberInput from '../../NumberInput';
import Select from '../../Select';
import Switch from '../../Switch';
import Tooltip from '../../Tooltip';
import AudioPreview from './AudioPreview';
import styles from './styles.module.scss';

export interface SceneAudioSectionProps {
  audio: SceneAudio;
  onChange: (updater: (prev: SceneAudio) => SceneAudio) => void;
  speechProviders: readonly AIProviderInfo[];
  /** 当前视频服务能生成声音（环境声描述会写进视频提示词） */
  videoSupportsAudio: boolean;
  onImport: (kind: 'bgm' | 'ambience') => Promise<string | null>;
  loadWorkAudio: (relativePath: string) => Promise<Uint8Array>;
}

const BGM_SOURCES: { value: BgmSource; label: string; disabled?: boolean }[] = [
  { value: 'none', label: '无配乐' },
  { value: 'file', label: '本地音乐文件' },
  { value: 'generate', label: 'AI 生成（即将支持）', disabled: true },
];

function fileNameOf(relativePath: string): string {
  return relativePath.split(/[\\/]/).pop() ?? relativePath;
}

/** 0..1 ↔ 百分比 */
const toPercent = (value: number) => Math.round(value * 100);
const fromPercent = (value: number) => Math.min(1, Math.max(0, value / 100));

const SceneAudioSection: React.FC<SceneAudioSectionProps> = ({
  audio,
  onChange,
  speechProviders,
  videoSupportsAudio,
  onImport,
  loadWorkAudio,
}) => {
  const bgm: BgmSpec = audio.bgm ?? DEFAULT_BGM;
  const setBgm = (patch: Partial<BgmSpec>) =>
    onChange((prev) => ({ ...prev, bgm: { ...DEFAULT_BGM, ...prev.bgm, ...patch } }));
  const languageOptions = VOICE_LANGUAGES.some((item) => item.code === audio.language)
    ? VOICE_LANGUAGES
    : [...VOICE_LANGUAGES, { code: audio.language, label: audio.language }];

  const chooseBgm = async () => {
    const path = await onImport('bgm');
    if (path) setBgm({ source: 'file', path });
  };
  const chooseAmbience = async () => {
    const path = await onImport('ambience');
    if (path) {
      onChange((prev) => ({
        ...prev,
        ambience: { volume: 0.4, ...prev.ambience, path },
      }));
    }
  };

  return (
    <section className={styles.section} aria-label="声音" data-testid="scene-audio-section">
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>声音</h3>
      </div>
      <div className={styles.row}>
        <label className={styles.field}>
          <span className={styles.label}>配音语言</span>
          <Select
            block
            size="lg"
            aria-label="配音语言"
            data-testid="scene-audio-language"
            value={audio.language}
            options={languageOptions.map((item) => ({
              value: item.code,
              label: `${item.label}（${item.code}）`,
              textValue: item.label,
            }))}
            onChange={(language) => onChange((prev) => ({ ...prev, language }))}
          />
        </label>
        {speechProviders.length > 1 && (
          <label className={styles.field}>
            <span className={styles.label}>配音模型</span>
            <Select
              block
              size="lg"
              aria-label="配音模型"
              value={audio.speechProviderId ?? speechProviders[0]?.id ?? ''}
              options={speechProviders.map((item) => ({ value: item.id, label: item.label }))}
              onChange={(speechProviderId) => onChange((prev) => ({ ...prev, speechProviderId }))}
            />
          </label>
        )}
      </div>
      {speechProviders.length === 0 && (
        <p className={styles.muted}>
          还没有配音模型：在设置中心「AI → 语音」里添加模型（OpenAI 兼容或 MiniMax）后，
          镜头里的对白可以一键生成配音。
        </p>
      )}

      <div className={styles.field}>
        <span className={styles.label}>背景音乐</span>
        <Select<BgmSource>
          block
          size="lg"
          aria-label="背景音乐"
          value={bgm.source}
          options={BGM_SOURCES}
          onChange={(source) => {
            if (source === 'file' && !bgm.path) void chooseBgm();
            else setBgm({ source });
          }}
        />
        {bgm.source === 'file' && (
          <div className={styles.row}>
            <span className={styles.fileName} data-testid="scene-audio-bgm-file">
              {bgm.path ? fileNameOf(bgm.path) : '还没有选择文件'}
            </span>
            <Tooltip content="选择本地音乐，复制到 资料/音乐/（MP3 / WAV / OGG / FLAC / M4A，≤ 50MB）">
              <button type="button" className={styles.linkButton} onClick={() => void chooseBgm()}>
                {bgm.path ? '更换' : '选择文件'}
              </button>
            </Tooltip>
          </div>
        )}
        {bgm.source === 'file' && bgm.path && (
          <>
            <AudioPreview
              source={bgm.path}
              load={loadWorkAudio}
              label="试听背景音乐"
              testId="scene-audio-bgm-preview"
            />
            <div className={styles.row}>
              <label className={styles.field}>
                <span className={styles.label}>音量</span>
                <NumberInput
                  block
                  aria-label="背景音乐音量"
                  min={0}
                  max={100}
                  step={5}
                  suffix="%"
                  value={toPercent(bgm.volume)}
                  onChange={(value) => setBgm({ volume: fromPercent(value) })}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>淡入</span>
                <NumberInput
                  block
                  aria-label="背景音乐淡入（秒）"
                  min={0}
                  max={30}
                  step={0.5}
                  precision={1}
                  suffix="秒"
                  value={bgm.fadeInSec}
                  onChange={(fadeInSec) => setBgm({ fadeInSec })}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>淡出</span>
                <NumberInput
                  block
                  aria-label="背景音乐淡出（秒）"
                  min={0}
                  max={30}
                  step={0.5}
                  precision={1}
                  suffix="秒"
                  value={bgm.fadeOutSec}
                  onChange={(fadeOutSec) => setBgm({ fadeOutSec })}
                />
              </label>
            </div>
          </>
        )}
      </div>

      <div className={styles.field}>
        <span className={styles.label}>环境音</span>
        <input
          className={styles.input}
          aria-label="环境音描述"
          value={audio.ambience?.prompt ?? ''}
          placeholder={
            videoSupportsAudio
              ? '例如：雨声、远处的狗叫（会写进视频提示词）'
              : '例如：雨声、远处的狗叫（视频服务支持声音时写进提示词）'
          }
          onChange={(event) => {
            const prompt = event.target.value;
            onChange((prev) => ({
              ...prev,
              ambience: { volume: 0.4, ...prev.ambience, prompt: prompt || undefined },
            }));
          }}
        />
        <div className={styles.row}>
          <span className={styles.fileName}>
            {audio.ambience?.path ? fileNameOf(audio.ambience.path) : '没有环境音文件'}
          </span>
          <Tooltip content="选择本地环境音（循环铺满整条样片），复制到 资料/音乐/">
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => void chooseAmbience()}
            >
              {audio.ambience?.path ? '更换' : '选择文件'}
            </button>
          </Tooltip>
          {audio.ambience?.path && (
            <Tooltip content="不用环境音文件">
              <button
                type="button"
                className={styles.iconButton}
                aria-label="移除环境音文件"
                onClick={() =>
                  onChange((prev) => ({
                    ...prev,
                    ambience: prev.ambience ? { ...prev.ambience, path: undefined } : undefined,
                  }))
                }
              >
                <VscClose />
              </button>
            </Tooltip>
          )}
        </div>
        {audio.ambience?.path && (
          <NumberInput
            block
            aria-label="环境音音量"
            min={0}
            max={100}
            step={5}
            suffix="%"
            value={toPercent(audio.ambience.volume)}
            onChange={(value) =>
              onChange((prev) => ({
                ...prev,
                ambience: { ...(prev.ambience ?? { volume: 0.4 }), volume: fromPercent(value) },
              }))
            }
          />
        )}
      </div>

      <Switch
        checked={audio.ducking}
        onChange={(ducking) => onChange((prev) => ({ ...prev, ducking }))}
        label="对白时自动压低配乐"
        description="样片里有人说话时，背景音乐降低约 12dB，说完再恢复"
        data-testid="scene-audio-ducking"
      />
    </section>
  );
};

export default SceneAudioSection;
