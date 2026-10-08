/**
 * 场景视频顶部工具栏：标题｜全局设置（风格 / 比例 / 每镜时长 / 视频服务 / 形象图首帧）｜费用预估 + 生成
 */
import React from 'react';
import { VscAdd, VscGoToFile, VscMute, VscUnmute } from 'react-icons/vsc';
import { ASPECT_RATIOS, type AspectRatio } from '@novel-editor/video';
import type { AIProviderInfo } from '@/render/types/ai-api';
import Select from '../../Select';
import Tooltip from '../../Tooltip';
import { SCENE_SHOT_DURATIONS, SCENE_VIDEO_STYLES, type SceneVideoState } from '../sceneVideoState';
import styles from './styles.module.scss';

/** 自定义风格：去掉首尾空白，限制 80 字；空内容不采用 */
export function normalizeCustomStyle(text: string): string | null {
  const value = text.trim().replace(/\s+/g, ' ');
  if (!value) return null;
  return Array.from(value).slice(0, 80).join('');
}

/** 自定义每镜时长：1–60 的整数秒（小数四舍五入），否则不采用 */
export function normalizeCustomDuration(text: string): string | null {
  const value = Number(text.trim());
  if (!Number.isFinite(value)) return null;
  const seconds = Math.round(value);
  return seconds >= 1 && seconds <= 60 ? String(seconds) : null;
}

export interface ToolbarProps {
  state: SceneVideoState;
  onChange: (updater: (prev: SceneVideoState) => SceneVideoState) => void;
  videoProviders: readonly AIProviderInfo[];
  servicesLoaded: boolean;
  saveText: string;
  saveTone: 'idle' | 'ok' | 'error';
  estimateText: string;
  pendingCount: number;
  submitting: boolean;
  canAddShot: boolean;
  onGenerate: () => void;
  onAddShot: () => void;
  onReveal: () => void;
  onOpenSettings: () => void;
}

const Toolbar: React.FC<ToolbarProps> = ({
  state,
  onChange,
  videoProviders,
  servicesLoaded,
  saveText,
  saveTone,
  estimateText,
  pendingCount,
  submitting,
  canAddShot,
  onGenerate,
  onAddShot,
  onReveal,
  onOpenSettings,
}) => {
  const provider =
    videoProviders.find((item) => item.id === state.providerId) ?? videoProviders[0] ?? null;
  const generateLabel = submitting
    ? '提交中…'
    : pendingCount > 0
      ? `生成 ${pendingCount} 个镜头`
      : '镜头都已生成';
  return (
    <header className={styles.toolbar}>
      <div className={styles.heading}>
        <h1 className={styles.title}>场景视频</h1>
        <span className={styles.meta}>
          {state.chapter} · {state.scene}
        </span>
        {saveText && (
          <span className={styles.save} data-tone={saveTone}>
            {saveText}
          </span>
        )}
      </div>

      <div className={styles.settings}>
        <Tooltip content="画面风格：选预设，或在列表底部写自己的风格（质感、光线、镜头语言等）">
          <Select
            className={styles.select}
            aria-label="风格"
            value={state.style}
            options={SCENE_VIDEO_STYLES.map((style) => ({ value: style, label: style }))}
            custom={{
              label: '自定义',
              placeholder: '例如：胶片颗粒、逆光、浅景深',
              normalize: normalizeCustomStyle,
            }}
            onChange={(style) => onChange((prev) => ({ ...prev, style }))}
          />
        </Tooltip>
        <Tooltip content="画面比例">
          <Select<AspectRatio>
            className={styles.select}
            aria-label="画面比例"
            value={state.aspectRatio}
            options={ASPECT_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))}
            onChange={(aspectRatio) => {
              onChange((prev) => ({
                ...prev,
                aspectRatio,
                storyboard: { ...prev.storyboard, aspectRatio },
              }));
            }}
          />
        </Tooltip>
        <Tooltip content="拆分镜时每个镜头的默认时长：选预设，或在列表底部填 1–60 秒">
          <Select
            className={styles.select}
            aria-label="每镜时长"
            value={String(state.shotDurationSec)}
            options={SCENE_SHOT_DURATIONS.map((value) => ({
              value: String(value),
              label: `每镜 ${value} 秒`,
            }))}
            custom={{
              label: '自定义秒数',
              placeholder: '1–60',
              normalize: normalizeCustomDuration,
            }}
            onChange={(value) => {
              const shotDurationSec = Number(value);
              onChange((prev) => ({ ...prev, shotDurationSec }));
            }}
          />
        </Tooltip>
        {!servicesLoaded ? null : videoProviders.length === 0 ? (
          <Tooltip content="在设置中心添加视频模型（MiniMax 海螺 / Seedance）；没有配置也可以先拆分镜">
            <button
              type="button"
              className={styles.button}
              data-testid="scene-video-no-provider"
              onClick={onOpenSettings}
            >
              添加视频模型
            </button>
          </Tooltip>
        ) : (
          <>
            <Tooltip content="视频模型（在设置中心「AI → 视频」里添加与设置默认）">
              <Select
                className={styles.select}
                aria-label="视频模型"
                value={provider?.id ?? ''}
                options={videoProviders.map((item) => ({ value: item.id, label: item.label }))}
                onChange={(providerId) => {
                  onChange((prev) => ({ ...prev, providerId, model: undefined }));
                }}
              />
            </Tooltip>
            {provider && (
              <Tooltip
                content={
                  provider.supportsAudio
                    ? '让视频服务同时生成与画面同步的声音（环境音、音效、台词）；关闭后只生成画面'
                    : `${provider.label} 目前不支持生成声音（成片保留服务返回的音轨）`
                }
              >
                <button
                  type="button"
                  className={styles.toggle}
                  role="switch"
                  aria-checked={Boolean(provider.supportsAudio && state.withAudio)}
                  aria-label="生成声音"
                  data-testid="scene-video-audio-toggle"
                  disabled={!provider.supportsAudio}
                  onClick={() => onChange((prev) => ({ ...prev, withAudio: !prev.withAudio }))}
                >
                  {provider.supportsAudio && state.withAudio ? (
                    <VscUnmute aria-hidden="true" />
                  ) : (
                    <VscMute aria-hidden="true" />
                  )}
                  <span>生成声音</span>
                </button>
              </Tooltip>
            )}
          </>
        )}
      </div>

      <div className={styles.actions}>
        <span className={styles.estimate} data-testid="scene-video-estimate">
          {estimateText}
        </span>
        <Tooltip content="在末尾添加一个空白镜头">
          <button
            type="button"
            className={styles.iconButton}
            aria-label="添加镜头"
            disabled={!canAddShot}
            onClick={onAddShot}
          >
            <VscAdd />
          </button>
        </Tooltip>
        <Tooltip content="在左侧资料中定位这一场的文件夹（分镜表、成片、样片）">
          <button
            type="button"
            className={styles.iconButton}
            aria-label="在资料中查看"
            onClick={onReveal}
          >
            <VscGoToFile />
          </button>
        </Tooltip>
        <Tooltip
          content={
            provider
              ? '提交还没有成片的镜头；完成后自动保存到资料，全部完成后自动合成样片'
              : '先配置视频服务'
          }
        >
          <button
            type="button"
            className={styles.primary}
            disabled={!provider || submitting || pendingCount === 0}
            onClick={onGenerate}
          >
            {generateLabel}
          </button>
        </Tooltip>
      </div>
    </header>
  );
};

export default Toolbar;
