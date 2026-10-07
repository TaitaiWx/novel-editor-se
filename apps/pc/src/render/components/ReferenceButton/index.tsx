import React, { useEffect, useState } from 'react';
import { VscFileMedia } from 'react-icons/vsc';
import Tooltip from '../Tooltip';
import {
  REFERENCE_STATE_EVENT,
  requestToggleReference,
  type ReferenceItem,
} from '../../utils/referencePane';
import styles from './styles.module.scss';

interface ReferenceButtonProps {
  /** 窗格还没有内容时放进去的默认参考（当前作品人物的三视图 / 形象图） */
  fallback?: ReferenceItem[];
}

/** 编辑器文件栏「参考」胶囊：打开 / 收起编辑器右侧的参考窗格 */
const ReferenceButton: React.FC<ReferenceButtonProps> = ({ fallback = [] }) => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onState = (event: Event) => {
      setOpen(Boolean((event as CustomEvent<{ open: boolean }>).detail?.open));
    };
    window.addEventListener(REFERENCE_STATE_EVENT, onState);
    return () => window.removeEventListener(REFERENCE_STATE_EVENT, onState);
  }, []);
  const tip = open
    ? '收起参考窗格'
    : fallback.length
      ? `在编辑器旁边看图片 / 视频（先放本作品 ${fallback.length} 张人物图）`
      : '在编辑器旁边看图片 / 视频';
  return (
    <span className={styles.slot}>
      <Tooltip content={tip} position="bottom">
        <button
          type="button"
          className={open ? `${styles.pill} ${styles.active}` : styles.pill}
          aria-label="参考"
          aria-pressed={open}
          data-testid="reference-pill"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => requestToggleReference(fallback)}
        >
          <VscFileMedia className={styles.icon} aria-hidden="true" />
          <span className={styles.label}>参考</span>
        </button>
      </Tooltip>
    </span>
  );
};

export default ReferenceButton;
