import React from 'react';
import styles from '../../styles.module.scss';
import {
  OUTLINE_AI_GRANULARITY_LABELS,
  OUTLINE_AI_STYLE_LABELS,
  type OutlineAiGenerationOptions,
  type OutlineAiGranularity,
  type OutlineAiStyle,
} from '../../outline-import';
import { OUTLINE_AI_PRESETS } from '../helpers';

interface OutlineAiPresetPanelProps {
  aiOptionsLabel: string;
  aiOutlineOptions: OutlineAiGenerationOptions;
  setAiOutlineOptions: React.Dispatch<React.SetStateAction<OutlineAiGenerationOptions>>;
  importing: boolean;
}

/**
 * AI 生成大纲预设面板：预设卡片 + 风格 / 粒度 / 层级深度单项调整。
 */
export const OutlineAiPresetPanel: React.FC<OutlineAiPresetPanelProps> = ({
  aiOptionsLabel,
  aiOutlineOptions,
  setAiOutlineOptions,
  importing,
}) => {
  const aiPresets = OUTLINE_AI_PRESETS;

  return (
    <div className={styles.outlineAiPresetPanel}>
      <div className={styles.outlineAiPresetHeader}>
        <span className={styles.outlineAiPresetTitle}>AI 生成预设</span>
        <span className={styles.outlineAiPresetMeta}>{aiOptionsLabel}</span>
      </div>
      <div className={styles.outlineAiPresetGrid}>
        {aiPresets.map((preset) => {
          const active =
            aiOutlineOptions.style === preset.value.style &&
            aiOutlineOptions.granularity === preset.value.granularity &&
            aiOutlineOptions.maxDepth === preset.value.maxDepth;
          return (
            <button
              key={preset.key}
              className={`${styles.outlineAiPresetCard} ${active ? styles.outlineAiPresetCardActive : ''}`}
              onClick={() => setAiOutlineOptions(preset.value)}
              disabled={importing}
            >
              <span className={styles.outlineAiPresetCardTitle}>{preset.label}</span>
              <span className={styles.outlineAiPresetCardDesc}>{preset.description}</span>
              <span className={styles.outlineAiPresetCardMeta}>
                {OUTLINE_AI_STYLE_LABELS[preset.value.style]} /{' '}
                {OUTLINE_AI_GRANULARITY_LABELS[preset.value.granularity]} / {preset.value.maxDepth}{' '}
                层
              </span>
            </button>
          );
        })}
      </div>
      <div className={styles.outlineAiPresetControls}>
        <div className={styles.outlineAiPresetGroup}>
          <span className={styles.outlineAiPresetGroupLabel}>风格</span>
          {(['balanced', 'cinematic', 'detailed', 'suspense'] as OutlineAiStyle[]).map((style) => (
            <button
              key={style}
              className={`${styles.outlineAiPresetOption} ${aiOutlineOptions.style === style ? styles.outlineAiPresetOptionActive : ''}`}
              onClick={() => setAiOutlineOptions((prev) => ({ ...prev, style }))}
              disabled={importing}
            >
              {OUTLINE_AI_STYLE_LABELS[style]}
            </button>
          ))}
        </div>
        <div className={styles.outlineAiPresetGroup}>
          <span className={styles.outlineAiPresetGroupLabel}>粒度</span>
          {(['coarse', 'medium', 'fine'] as OutlineAiGranularity[]).map((granularity) => (
            <button
              key={granularity}
              className={`${styles.outlineAiPresetOption} ${aiOutlineOptions.granularity === granularity ? styles.outlineAiPresetOptionActive : ''}`}
              onClick={() => setAiOutlineOptions((prev) => ({ ...prev, granularity }))}
              disabled={importing}
            >
              {OUTLINE_AI_GRANULARITY_LABELS[granularity]}
            </button>
          ))}
        </div>
        <div className={styles.outlineAiPresetGroup}>
          <span className={styles.outlineAiPresetGroupLabel}>层级深度</span>
          {[1, 2, 3, 4].map((depth) => (
            <button
              key={depth}
              className={`${styles.outlineAiPresetOption} ${aiOutlineOptions.maxDepth === depth ? styles.outlineAiPresetOptionActive : ''}`}
              onClick={() => setAiOutlineOptions((prev) => ({ ...prev, maxDepth: depth }))}
              disabled={importing}
            >
              {depth} 层
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
