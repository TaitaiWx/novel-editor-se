import React, { useRef, useState } from 'react';
import { AiOutlineQuestionCircle } from 'react-icons/ai';
import Popover from '../../Popover';
import Tooltip from '../../Tooltip';
import styles from './styles.module.scss';

export interface PlanGuideContent {
  /** 一句话：这是什么 */
  summary: string;
  /** 3 步怎么用 */
  steps: readonly string[];
}

export const OUTLINE_GUIDE: PlanGuideContent = {
  summary: '章纲 = 这一章要写的几个要点。',
  steps: [
    '点「生成章纲」，从 3 种写法里挑一个（没开 AI 时是「从正文整理」）。',
    '写的时候看着要点写；点要点会跳到正文对应位置。',
    '不满意就再生成一次，旧的会自动存成版本，随时能换回来。',
  ],
};

export const VOLUME_GUIDE: PlanGuideContent = {
  summary: '卷纲 = 这一卷分几段、每段要完成什么，自动从正文整理，不用填。',
  steps: [
    '直接看「列表」：每一幕下面是章和场，点标题跳到正文。',
    '想要建议就点「生成卷纲」，从 3 种结构里挑一个；顶部那句话可以不填。',
    '「节奏 / 人物线 / 伏笔」是同一份数据的其他看法，需要时再看。',
  ],
};

/** 章纲 / 卷纲顶部的一句话说明 +「怎么用」（3 步），降低第一次使用的门槛 */
const PlanGuide: React.FC<{ guide: PlanGuideContent; label: string }> = ({ guide, label }) => {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.guide} data-testid="plan-guide">
      <span className={styles.summary}>{guide.summary}</span>
      <Tooltip content={`${label}怎么用`}>
        <button
          ref={anchorRef}
          type="button"
          className={styles.help}
          aria-label={`${label}怎么用`}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <AiOutlineQuestionCircle aria-hidden="true" />
          怎么用
        </button>
      </Tooltip>
      <Popover
        open={open}
        anchorRef={anchorRef}
        placement="bottom"
        align="end"
        offset={4}
        role="dialog"
        onClose={() => setOpen(false)}
        closeOnOutsideClick
        closeOnEscape
      >
        <div className={styles.panel} aria-label={`${label}怎么用`}>
          <strong>{guide.summary}</strong>
          <ol>
            {guide.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      </Popover>
    </div>
  );
};

export default PlanGuide;
