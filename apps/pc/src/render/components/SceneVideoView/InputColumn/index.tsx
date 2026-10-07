import React, { useId, useMemo } from 'react';
import { VscClose } from 'react-icons/vsc';
import { ASPECT_RATIOS, type AspectRatio } from '@novel-editor/video';
import type { AIProviderInfo } from '@/render/types/ai-api';
import { SCENE_SHOT_DURATIONS, SCENE_VIDEO_STYLES, type SceneVideoState } from '../sceneVideoState';
import styles from './styles.module.scss';

export interface InputCharacter {
  name: string;
  avatar?: string;
}

export interface InputColumnProps {
  state: SceneVideoState;
  onChange: (updater: (prev: SceneVideoState) => SceneVideoState) => void;
  characters: readonly InputCharacter[];
  loreTitles: readonly string[];
  videoProviders: readonly AIProviderInfo[];
  servicesLoaded: boolean;
  pendingSeed: string | null;
  onApplySeed: () => void;
  onDismissSeed: () => void;
  onOpenSettings: () => void;
}

const ORIGIN_HINT_LIMIT = 2;

function initialOf(name: string): string {
  return Array.from(name.trim())[0] ?? '?';
}

function isUsableAvatar(avatar: string | undefined): avatar is string {
  return Boolean(avatar && /^(https?:\/\/|data:image\/)/i.test(avatar));
}

/** 左栏「输入」：场景正文、地点、人物、风格、比例、每镜时长、视频服务；缺什么只做浅色提示，不阻止 */
const InputColumn: React.FC<InputColumnProps> = ({
  state,
  onChange,
  characters,
  loreTitles,
  videoProviders,
  servicesLoaded,
  pendingSeed,
  onApplySeed,
  onDismissSeed,
  onOpenSettings,
}) => {
  // React 的 id 带冒号，datalist 的 list 属性按选择器解析，去掉更稳妥
  const idPrefix = `scene-video-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const avatarByName = useMemo(
    () => new Map(characters.map((item) => [item.name, item.avatar])),
    [characters]
  );
  const addable = characters.filter((item) => !state.characters.includes(item.name));
  const missingAvatars = state.characters.filter((name) => !isUsableAvatar(avatarByName.get(name)));
  const hasAvatar = state.characters.some((name) => isUsableAvatar(avatarByName.get(name)));
  const isCustomStyle = !(SCENE_VIDEO_STYLES as readonly string[]).includes(state.style);
  const provider =
    videoProviders.find((item) => item.id === state.providerId) ?? videoProviders[0] ?? null;

  const hints: string[] = [];
  if (!state.location.trim()) hints.push('补一个地点（可从设定里选）画面会更稳定');
  missingAvatars
    .slice(0, ORIGIN_HINT_LIMIT)
    .forEach((name) => hints.push(`补一张${name}的形象图效果更好（人物卡里设置头像）`));

  return (
    <section className={styles.column} aria-label="输入">
      <h2 className={styles.title}>输入</h2>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${idPrefix}-source`}>
          场景正文
          <span className={styles.labelMeta}>
            {state.chapter} · {state.scene}
          </span>
        </label>
        {pendingSeed !== null && (
          <div className={styles.seedHint} role="status">
            <span>已载入上次保存的分镜。这次选中的文字与保存的场景正文不同。</span>
            <span className={styles.seedActions}>
              <button type="button" className={styles.linkButton} onClick={onApplySeed}>
                用选中的文字替换
              </button>
              <button type="button" className={styles.linkButton} onClick={onDismissSeed}>
                保持不变
              </button>
            </span>
          </div>
        )}
        <textarea
          id={`${idPrefix}-source`}
          className={styles.textarea}
          rows={10}
          value={state.sourceText}
          placeholder="粘贴或改写这一场的正文，分镜按它来拆"
          onChange={(event) => {
            const sourceText = event.target.value;
            onChange((prev) => ({ ...prev, sourceText }));
          }}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${idPrefix}-location`}>
          地点
        </label>
        <input
          id={`${idPrefix}-location`}
          className={styles.input}
          list={`${idPrefix}-lore`}
          value={state.location}
          placeholder={loreTitles.length ? '从设定中选择，或直接输入' : '例如：青石镇 · 镇口老槐树'}
          onChange={(event) => {
            const location = event.target.value;
            onChange((prev) => ({ ...prev, location }));
          }}
        />
        <datalist id={`${idPrefix}-lore`}>
          {loreTitles.map((title) => (
            <option key={title} value={title} />
          ))}
        </datalist>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>人物</span>
        <div className={styles.chips}>
          {state.characters.map((name) => {
            const avatar = avatarByName.get(name);
            return (
              <span key={name} className={styles.chip}>
                {isUsableAvatar(avatar) ? (
                  <img className={styles.avatar} src={avatar} alt="" draggable={false} />
                ) : (
                  <span className={styles.avatarFallback} aria-hidden="true">
                    {initialOf(name)}
                  </span>
                )}
                {name}
                <button
                  type="button"
                  className={styles.chipRemove}
                  aria-label={`移除人物 ${name}`}
                  onClick={() =>
                    onChange((prev) => ({
                      ...prev,
                      characters: prev.characters.filter((item) => item !== name),
                    }))
                  }
                >
                  <VscClose />
                </button>
              </span>
            );
          })}
          {state.characters.length === 0 && (
            <span className={styles.muted}>正文里没有识别到人物库中的人物</span>
          )}
        </div>
        {addable.length > 0 && (
          <select
            className={styles.select}
            aria-label="添加人物"
            value=""
            onChange={(event) => {
              const name = event.target.value;
              if (!name) return;
              onChange((prev) => ({ ...prev, characters: [...prev.characters, name] }));
            }}
          >
            <option value="">＋ 添加人物</option>
            {addable.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        )}
        {hasAvatar && (
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={state.useAvatarReference}
              onChange={(event) => {
                const useAvatarReference = event.target.checked;
                onChange((prev) => ({ ...prev, useAvatarReference }));
              }}
            />
            用人物头像作首帧参考（模型支持时）
          </label>
        )}
      </div>

      <div className={styles.field}>
        <span className={styles.label}>风格</span>
        <div className={styles.segmented} role="radiogroup" aria-label="风格">
          {SCENE_VIDEO_STYLES.map((style) => (
            <button
              key={style}
              type="button"
              role="radio"
              aria-checked={state.style === style}
              className={state.style === style ? styles.segmentActive : styles.segment}
              onClick={() => onChange((prev) => ({ ...prev, style }))}
            >
              {style}
            </button>
          ))}
        </div>
        <input
          className={styles.input}
          aria-label="自定义风格"
          value={isCustomStyle ? state.style : ''}
          placeholder="自定义，例如：赛璐璐动画、胶片颗粒"
          onChange={(event) => {
            const style = event.target.value;
            onChange((prev) => ({ ...prev, style: style || SCENE_VIDEO_STYLES[0] }));
          }}
        />
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${idPrefix}-ratio`}>
            画面比例
          </label>
          <select
            id={`${idPrefix}-ratio`}
            className={styles.select}
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
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${idPrefix}-duration`}>
            每镜时长
          </label>
          <select
            id={`${idPrefix}-duration`}
            className={styles.select}
            value={state.shotDurationSec}
            onChange={(event) => {
              const shotDurationSec = Number(event.target.value);
              onChange((prev) => ({ ...prev, shotDurationSec }));
            }}
          >
            {SCENE_SHOT_DURATIONS.map((value) => (
              <option key={value} value={value}>
                {value} 秒
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>视频服务</span>
        {!servicesLoaded ? (
          <span className={styles.muted}>读取中…</span>
        ) : videoProviders.length === 0 ? (
          <div className={styles.serviceEmpty} data-testid="scene-video-no-provider">
            <strong>先在设置中心配置视频服务</strong>
            <span>支持 MiniMax（海螺）与 Seedance。没有配置也可以先写分镜、导出分镜表。</span>
            <button type="button" className={styles.button} onClick={onOpenSettings}>
              打开设置中心
            </button>
          </div>
        ) : (
          <div className={styles.row}>
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
            {provider && (
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
            )}
          </div>
        )}
      </div>

      {hints.length > 0 && (
        <ul className={styles.hints} aria-label="补全建议">
          {hints.map((hint) => (
            <li key={hint}>{hint}</li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default InputColumn;
