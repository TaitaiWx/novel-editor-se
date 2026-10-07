/**
 * 场景视频顶部工具栏：标题｜全局设置（风格 / 比例 / 每镜时长 / 视频服务 / 形象图首帧）｜费用预估 + 生成
 */
import React from 'react';
import { VscAdd, VscGoToFile } from 'react-icons/vsc';
import { ASPECT_RATIOS, type AspectRatio } from '@novel-editor/video';
import type { AIProviderInfo } from '@/render/types/ai-api';
import Tooltip from '../../Tooltip';
import { SCENE_SHOT_DURATIONS, SCENE_VIDEO_STYLES, type SceneVideoState } from '../sceneVideoState';
import styles from './styles.module.scss';

export interface ToolbarProps {
  state: SceneVideoState;
  onChange: (updater: (prev: SceneVideoState) => SceneVideoState) => void;
  videoProviders: readonly AIProviderInfo[];
  servicesLoaded: boolean;
  /** 场景里有人物带形象图时才显示「形象图作首帧」 */
  hasAvatar: boolean;
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
  hasAvatar,
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
  const presetStyle = (SCENE_VIDEO_STYLES as readonly string[]).includes(state.style);
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
        <Tooltip content="画面风格（场景检查器里可以自定义）">
          <select
            className={styles.select}
            aria-label="风格"
            value={presetStyle ? state.style : ''}
            onChange={(event) => {
              const style = event.target.value;
              if (style) onChange((prev) => ({ ...prev, style }));
            }}
          >
            {!presetStyle && <option value="">{state.style}</option>}
            {SCENE_VIDEO_STYLES.map((style) => (
              <option key={style} value={style}>
                {style}
              </option>
            ))}
          </select>
        </Tooltip>
        <Tooltip content="画面比例">
          <select
            className={styles.select}
            aria-label="画面比例"
            value={state.aspectRatio}
            onChange={(event) => {
              const aspectRatio = event.target.value as AspectRatio;
              onChange((prev) => ({
                ...prev,
                aspectRatio,
                storyboard: { ...prev.storyboard, aspectRatio },
              }));
            }}
          >
            {ASPECT_RATIOS.map((ratio) => (
              <option key={ratio} value={ratio}>
                {ratio}
              </option>
            ))}
          </select>
        </Tooltip>
        <Tooltip content="拆分镜时每个镜头的默认时长">
          <select
            className={styles.select}
            aria-label="每镜时长"
            value={state.shotDurationSec}
            onChange={(event) => {
              const shotDurationSec = Number(event.target.value);
              onChange((prev) => ({ ...prev, shotDurationSec }));
            }}
          >
            {SCENE_SHOT_DURATIONS.map((value) => (
              <option key={value} value={value}>
                每镜 {value} 秒
              </option>
            ))}
          </select>
        </Tooltip>
        {!servicesLoaded ? null : videoProviders.length === 0 ? (
          <Tooltip content="支持 MiniMax（海螺）与 Seedance；没有配置也可以先拆分镜">
            <button
              type="button"
              className={styles.button}
              data-testid="scene-video-no-provider"
              onClick={onOpenSettings}
            >
              配置视频服务
            </button>
          </Tooltip>
        ) : (
          <>
            <Tooltip content="视频服务">
              <select
                className={styles.select}
                aria-label="视频服务"
                value={provider?.id ?? ''}
                onChange={(event) => {
                  const providerId = event.target.value;
                  onChange((prev) => ({ ...prev, providerId, model: undefined }));
                }}
              >
                {videoProviders.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Tooltip>
            {provider && (
              <Tooltip content="视频模型">
                <select
                  className={styles.select}
                  aria-label="视频模型"
                  value={state.model ?? provider.model}
                  onChange={(event) => {
                    const model = event.target.value;
                    onChange((prev) => ({ ...prev, providerId: provider.id, model }));
                  }}
                >
                  {Array.from(new Set([provider.model, ...provider.models])).map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </Tooltip>
            )}
          </>
        )}
        {hasAvatar && (
          <Tooltip content="把人物的形象图作为首帧参考（模型支持时），人物更稳定">
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={state.useAvatarReference}
                onChange={(event) => {
                  const useAvatarReference = event.target.checked;
                  onChange((prev) => ({ ...prev, useAvatarReference }));
                }}
              />
              形象图作首帧
            </label>
          </Tooltip>
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
