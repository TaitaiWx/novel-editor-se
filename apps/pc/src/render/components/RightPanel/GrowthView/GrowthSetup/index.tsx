import React, { useState } from 'react';
import type { GrowthTemplate } from '@novel-editor/core/growth';
import { GROWTH_GUIDE_SUMMARY } from '../growthGuide';
import styles from './styles.module.scss';

const TEMPLATES: Array<[GrowthTemplate, string, string]> = [
  ['dnd', 'DND 风格', '六维属性、20 级经验表，附示例技能与三选一（推荐）'],
  ['blank', '空白规则', '只有等级曲线，属性和技能自己定义'],
];

const STEPS = [
  '为角色建一张成长卡',
  '每写完一章，点「记一笔」',
  '战力涨太快或配角被遗忘时，才会提醒你',
];

interface GrowthSetupProps {
  busy: boolean;
  /** 创建后自动为该角色建卡 */
  pendingName?: string | null;
  compact?: boolean;
  error?: string | null;
  onCreate: (template: GrowthTemplate) => void;
  onOpenHelp: () => void;
}

/** 第一次使用：说明用途，选择规则模板后创建 资料/记忆/ */
export const GrowthSetup: React.FC<GrowthSetupProps> = ({
  busy,
  pendingName = null,
  compact = false,
  error = null,
  onCreate,
  onOpenHelp,
}) => {
  const [template, setTemplate] = useState<GrowthTemplate>('dnd');

  return (
    <section
      className={`${styles.setup} ${compact ? styles.compact : ''}`}
      aria-label="开始使用成长档案"
    >
      <h2 className={styles.title}>角色成长档案</h2>
      <p className={styles.summary}>{GROWTH_GUIDE_SUMMARY}</p>
      <ol className={styles.steps}>
        {STEPS.map((step, index) => (
          <li key={step}>
            <span className={styles.stepIndex}>{index + 1}</span>
            {step}
          </li>
        ))}
      </ol>
      <div className={styles.templates} role="radiogroup" aria-label="规则模板">
        {TEMPLATES.map(([key, name, desc]) => (
          <label
            key={key}
            className={`${styles.template} ${template === key ? styles.templateActive : ''}`}
          >
            <input
              type="radio"
              name="growth-template"
              checked={template === key}
              onChange={() => setTemplate(key)}
            />
            <span className={styles.templateName}>{name}</span>
            <span className={styles.templateDesc}>{desc}</span>
          </label>
        ))}
      </div>
      {pendingName && <p className={styles.note}>开始后会自动为「{pendingName}」建立成长卡。</p>}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          disabled={busy}
          onClick={() => onCreate(template)}
        >
          开始使用
        </button>
        <button type="button" className={styles.secondary} onClick={onOpenHelp}>
          使用说明
        </button>
      </div>
      <p className={styles.footnote}>
        数据保存在项目的 资料/记忆/ 文件夹，可用 Git 管理，与命令行 ne growth 共用。
      </p>
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
    </section>
  );
};

export default GrowthSetup;
