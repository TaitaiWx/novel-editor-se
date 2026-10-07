/**
 * 预演侧栏：描述这个镜头的动作 / 走位 → 选模型 →「生成预演」；下面是可折叠的「微调」。
 * 主要靠描述 + AI 生成，手动只保留最少的微调（拖人物、环绕机位、重置、时段、动作库）。
 */
import React, { useId, useState } from 'react';
import { VscChevronDown, VscChevronRight, VscLoading } from 'react-icons/vsc';
import { PREVIZ_MOODS, type PrevizMood } from '@novel-editor/video';
import Select from '../../Select';
import Tooltip from '../../Tooltip';
import { Choice } from './controls';
import { MOODS } from './presets';
import type { PrevizModelOption } from './usePrevizModels';
import styles from './styles.module.scss';

interface DirectorPanelProps {
  action: string;
  onActionChange: (value: string) => void;
  models: { loaded: boolean; options: PrevizModelOption[]; value: string };
  onModelChange: (value: string) => void;
  generating: boolean;
  onGenerate: () => void;
  notes: readonly string[];
  summary?: string;
  mood: PrevizMood;
  onMoodChange: (mood: PrevizMood) => void;
  onResetCamera: () => void;
  onResetBlocking: () => void;
  disabled: boolean;
  /** 动作库（列出 / 导入 BVH），放在「微调」里 */
  motionLibrary?: React.ReactNode;
}

const MOOD_OPTIONS = PREVIZ_MOODS.map((id) => ({
  id,
  label: MOODS.find((mood) => mood.id === id)?.label ?? id,
}));

const DirectorPanel: React.FC<DirectorPanelProps> = ({
  action,
  onActionChange,
  models,
  onModelChange,
  generating,
  onGenerate,
  notes,
  summary,
  mood,
  onMoodChange,
  onResetCamera,
  onResetBlocking,
  disabled,
  motionLibrary,
}) => {
  const id = useId();
  const [tuneOpen, setTuneOpen] = useState(false);
  const noModel = models.loaded && models.options.length === 0;
  return (
    <div className={styles.sideScroll}>
      <section className={styles.group}>
        <label className={styles.groupTitle} htmlFor={`${id}-action`}>
          镜头动作与走位
        </label>
        <textarea
          id={`${id}-action`}
          className={styles.actionInput}
          value={action}
          rows={7}
          placeholder="例如：林舟从画面左侧走到老槐树下停住，回头看向苏晴；镜头缓慢推近"
          onChange={(event) => onActionChange(event.target.value)}
        />
        <span className={styles.fieldHint}>
          已带入镜头画面描述与出场人物，可以补充谁从哪走到哪、朝向和机位
        </span>
      </section>
      <section className={styles.group}>
        <span className={styles.groupTitle}>模型</span>
        <Select
          block
          aria-label="预演模型"
          value={models.value}
          placeholder={models.loaded ? '没有可用的 AI（使用默认走位）' : '读取中…'}
          disabled={noModel || !models.loaded}
          options={models.options.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
          onChange={onModelChange}
        />
        <button
          type="button"
          className={styles.primary}
          disabled={disabled || generating}
          onClick={onGenerate}
        >
          {generating ? (
            <>
              <VscLoading aria-hidden="true" className={styles.spin} /> 生成中…
            </>
          ) : (
            '生成预演'
          )}
        </button>
        {summary && <p className={styles.summary}>{summary}</p>}
        {notes.length > 0 && (
          <ul className={styles.notes} role="status">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </section>
      <section className={styles.group}>
        <button
          type="button"
          className={styles.disclosure}
          aria-expanded={tuneOpen}
          onClick={() => setTuneOpen((open) => !open)}
        >
          {tuneOpen ? (
            <VscChevronDown aria-hidden="true" />
          ) : (
            <VscChevronRight aria-hidden="true" />
          )}
          微调
        </button>
        {tuneOpen && (
          <div className={styles.tune} data-testid="previz-tune">
            <span className={styles.fieldHint}>
              在画面里拖动人物：整段走位一起平移；拖动空白处：环绕机位
            </span>
            <Choice<PrevizMood>
              label="时段"
              options={MOOD_OPTIONS}
              value={mood}
              onChange={onMoodChange}
            />
            <div className={styles.tuneActions}>
              <Tooltip content="机位回到生成时的样子">
                <button type="button" className={styles.tool} onClick={onResetCamera}>
                  重置机位
                </button>
              </Tooltip>
              <Tooltip content="人物走位回到生成时的样子">
                <button type="button" className={styles.tool} onClick={onResetBlocking}>
                  还原走位
                </button>
              </Tooltip>
            </div>
            {motionLibrary}
          </div>
        )}
      </section>
    </div>
  );
};

export default DirectorPanel;
