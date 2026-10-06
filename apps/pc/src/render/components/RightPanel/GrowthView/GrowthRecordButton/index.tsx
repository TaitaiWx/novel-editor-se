import React, { useRef, useState } from 'react';
import Popover from '../../../Popover';
import { GrowthRecordForm, type GrowthRecordFormProps } from '../GrowthRecordForm';
import styles from './styles.module.scss';

type GrowthRecordButtonProps = Omit<GrowthRecordFormProps, 'onCancel' | 'onDone'> & {
  /** primary：成长卡标题区的主按钮；compact：右侧面板中的小按钮 */
  variant?: 'primary' | 'compact';
  /** 首次引导定位用 */
  tourTarget?: string;
};

/** 「记一笔」按钮 + 弹出的记录表单（Esc / 点击外部关闭） */
export const GrowthRecordButton: React.FC<GrowthRecordButtonProps> = ({
  variant = 'primary',
  tourTarget,
  ...formProps
}) => {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const close = () => setOpen(false);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={variant === 'primary' ? styles.primary : styles.compact}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`为 ${formProps.sheet.name} 记一笔`}
        data-growth-tour={tourTarget}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.plus} aria-hidden="true">
          +
        </span>
        记一笔
      </button>
      <Popover
        open={open}
        anchorRef={anchorRef}
        align="end"
        placement="bottom"
        className={styles.popover}
        onClose={close}
        closeOnOutsideClick
        closeOnEscape
        zIndex={2000}
      >
        <div className={styles.title}>
          为 <strong>{formProps.sheet.name}</strong> 记一笔
        </div>
        <GrowthRecordForm
          key={`${formProps.sheet.name}-${formProps.defaultChapter ?? ''}`}
          {...formProps}
          onCancel={close}
          onDone={close}
        />
      </Popover>
    </>
  );
};

export default GrowthRecordButton;
