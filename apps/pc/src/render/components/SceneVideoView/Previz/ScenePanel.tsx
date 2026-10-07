/**
 * 预演侧栏「场景」：时段氛围（白天 / 黄昏 / 夜晚）与简单道具（添加、选中、旋转、移除）。
 */
import React from 'react';
import { VscAdd, VscTrash } from 'react-icons/vsc';
import Tooltip from '../../Tooltip';
import { Choice, Slider } from './controls';
import { MOODS, PROP_PRESETS, propPreset, toDegrees, toRadians } from './presets';
import type { PrevizScene } from './usePrevizScene';
import styles from './styles.module.scss';

const MOOD_OPTIONS = MOODS.map((mood) => ({ id: mood.id, label: mood.label }));

/** 同类道具编号：墙 1、墙 2… */
function propLabels(props: PrevizScene['props']): Map<string, string> {
  const counts = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const prop of props) {
    const label = propPreset(prop.kind).label;
    const index = (counts.get(label) ?? 0) + 1;
    counts.set(label, index);
    labels.set(prop.id, index > 1 ? `${label} ${index}` : label);
  }
  return labels;
}

const ScenePanel: React.FC<{ scene: PrevizScene }> = ({ scene }) => {
  const { props, selectedId } = scene;
  const labels = propLabels(props);
  const selected = props.find((prop) => prop.id === selectedId) ?? null;

  return (
    <section className={styles.group} aria-label="场景">
      <h3>场景</h3>
      <Choice label="时段" options={MOOD_OPTIONS} value={scene.mood} onChange={scene.setMood} />
      <div className={styles.addRow}>
        {PROP_PRESETS.map((preset) => (
          <button
            key={preset.kind}
            type="button"
            className={styles.addChip}
            aria-label={`添加道具：${preset.label}`}
            onClick={() => scene.addProp(preset.kind)}
          >
            <VscAdd aria-hidden />
            {preset.label}
          </button>
        ))}
      </div>
      {props.length > 0 && (
        <div className={styles.itemList} role="listbox" aria-label="预演道具">
          {props.map((prop) => (
            <button
              key={prop.id}
              type="button"
              role="option"
              aria-selected={prop.id === selectedId}
              className={prop.id === selectedId ? styles.itemActive : styles.item}
              onClick={() => scene.setSelectedId(prop.id)}
            >
              {labels.get(prop.id)}
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div className={styles.detail}>
          <div className={styles.detailHead}>
            <span className={styles.detailName}>{labels.get(selected.id)}</span>
            <Tooltip content="从舞台移除（Delete）">
              <button
                type="button"
                className={styles.iconButton}
                aria-label={`移除道具：${labels.get(selected.id)}`}
                onClick={() => scene.removeItem(selected.id)}
              >
                <VscTrash />
              </button>
            </Tooltip>
          </div>
          <Slider
            label="道具朝向"
            min={-180}
            max={180}
            step={15}
            unit="°"
            value={toDegrees(selected.rotation)}
            onChange={(degrees) => scene.setRotation(selected.id, toRadians(degrees))}
          />
        </div>
      )}
    </section>
  );
};

export default ScenePanel;
