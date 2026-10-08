import React from 'react';
import sharedStyles from '../styles.module.scss';
import styles from './styles.module.scss';

interface FieldRowProps {
  label: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}

/** 面板里的一行：左侧标签与说明，右侧控件（与设置中心其他分区同一行式布局） */
const FieldRow: React.FC<FieldRowProps> = ({ label, description, children }) => (
  <div className={`${sharedStyles.formRow} ${styles.fieldRow}`}>
    <div className={sharedStyles.formMeta}>
      <div className={sharedStyles.formLabel}>{label}</div>
      {description && <div className={sharedStyles.formDesc}>{description}</div>}
    </div>
    <div className={styles.fieldControl}>{children}</div>
  </div>
);

export default FieldRow;
