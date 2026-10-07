/**
 * 预演侧栏「人物」：人物列表（选中 / 移除 / 从本场人物添加）、姿势、朝向与微调（头部转向、抬右手）。
 */
import React from 'react';
import { VscAdd, VscTrash } from 'react-icons/vsc';
import Tooltip from '../../Tooltip';
import { Choice, Slider } from './controls';
import { POSE_PRESETS, toDegrees, toRadians } from './presets';
import type { PrevizScene } from './usePrevizScene';
import styles from './styles.module.scss';

const POSE_OPTIONS = POSE_PRESETS.map((pose) => ({ id: pose.id, label: pose.label }));

interface FigurePanelProps {
  scene: PrevizScene;
  /** 本场全部人物（可添加到舞台上的候选） */
  availableCharacters: readonly string[];
}

const FigurePanel: React.FC<FigurePanelProps> = ({ scene, availableCharacters }) => {
  const { figures, selectedId } = scene;
  const selected = figures.find((figure) => figure.id === selectedId) ?? null;
  const onStage = new Set(figures.map((figure) => figure.name));
  const candidates = availableCharacters.filter((name) => name && !onStage.has(name));
  const genericName = () => {
    let index = figures.length + 1;
    while (onStage.has(`人物${index}`)) index += 1;
    return `人物${index}`;
  };

  return (
    <section className={styles.group} aria-label="人物">
      <h3>
        人物<span className={styles.count}>{figures.length}</span>
      </h3>
      <div className={styles.itemList} role="listbox" aria-label="预演人物">
        {figures.map((figure) => (
          <button
            key={figure.id}
            type="button"
            role="option"
            aria-selected={figure.id === selectedId}
            className={figure.id === selectedId ? styles.itemActive : styles.item}
            onClick={() => scene.setSelectedId(figure.id)}
          >
            <span className={styles.dot} style={{ background: figure.color }} />
            {figure.name}
          </button>
        ))}
      </div>
      <div className={styles.addRow}>
        {candidates.map((name) => (
          <button
            key={name}
            type="button"
            className={styles.addChip}
            aria-label={`添加人物：${name}`}
            onClick={() => scene.addFigure(name)}
          >
            <VscAdd aria-hidden />
            {name}
          </button>
        ))}
        <Tooltip content="添加一个木偶小人">
          <button
            type="button"
            className={styles.addChip}
            aria-label="添加人物"
            onClick={() => scene.addFigure(genericName())}
          >
            <VscAdd aria-hidden />
            {candidates.length ? '其他' : '添加人物'}
          </button>
        </Tooltip>
      </div>
      {selected && (
        <div className={styles.detail}>
          <div className={styles.detailHead}>
            <span className={styles.dot} style={{ background: selected.color }} />
            <span className={styles.detailName}>{selected.name}</span>
            <Tooltip content="从舞台移除（Delete）">
              <button
                type="button"
                className={styles.iconButton}
                aria-label={`移除人物：${selected.name}`}
                onClick={() => scene.removeItem(selected.id)}
              >
                <VscTrash />
              </button>
            </Tooltip>
          </div>
          <Choice
            label="姿势"
            variant="grid"
            options={POSE_OPTIONS}
            value={selected.pose}
            onChange={(pose) => scene.updateFigure(selected.id, { pose }, '')}
          />
          <Slider
            label="人物朝向"
            min={-180}
            max={180}
            step={15}
            unit="°"
            value={toDegrees(selected.rotation)}
            onChange={(degrees) => scene.setRotation(selected.id, toRadians(degrees))}
          />
          <Slider
            label="头部转向"
            min={-80}
            max={80}
            step={5}
            unit="°"
            value={selected.headTurn ?? 0}
            onChange={(headTurn) =>
              scene.updateFigure(selected.id, { headTurn }, `head:${selected.id}`)
            }
          />
          <Slider
            label="抬右手"
            min={0}
            max={170}
            step={5}
            unit="°"
            value={selected.armRaise ?? 0}
            onChange={(armRaise) =>
              scene.updateFigure(selected.id, { armRaise }, `arm:${selected.id}`)
            }
          />
        </div>
      )}
    </section>
  );
};

export default FigurePanel;
