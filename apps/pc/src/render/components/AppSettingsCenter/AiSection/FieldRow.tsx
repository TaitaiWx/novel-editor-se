import React from 'react';
import { SettingsRow } from '../layout';
import styles from './styles.module.scss';

interface FieldRowProps {
  label: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}

/** 模型面板里的一行：与设置中心其他分区同一行式布局（layout/SettingsRow），左右加内边距 */
const FieldRow: React.FC<FieldRowProps> = ({ label, description, children }) => (
  <SettingsRow label={label} description={description} control="field" className={styles.fieldRow}>
    {children}
  </SettingsRow>
);

export default FieldRow;
