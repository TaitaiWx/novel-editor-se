import React, { useEffect, useState } from 'react';
import { VscFileMedia } from 'react-icons/vsc';
import Tooltip from '../Tooltip';
import {
  REFERENCE_STATE_EVENT,
  announceReferenceAutoSource,
  requestToggleReference,
  type ReferenceAutoSource,
  type ReferenceItem,
} from '../../utils/referencePane';
import styles from './styles.module.scss';

interface ReferenceButtonProps {
  /** 当前作品人物的三视图 / 形象图（排在本章引用与场景视频之后） */
  fallback?: ReferenceItem[];
  /** 当前文档（正文引用的媒体、本章场景视频）；变化时通知窗格，自动模式下跟着更新 */
  source?: ReferenceAutoSource;
}

const EMPTY: ReferenceItem[] = [];

/** 编辑器文件栏「参考」胶囊：打开 / 收起编辑器右侧的参考窗格（以自动模式打开，跟随当前文档） */
const ReferenceButton: React.FC<ReferenceButtonProps> = ({ fallback = EMPTY, source }) => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onState = (event: Event) => {
      setOpen(Boolean((event as CustomEvent<{ open: boolean }>).detail?.open));
    };
    window.addEventListener(REFERENCE_STATE_EVENT, onState);
    return () => window.removeEventListener(REFERENCE_STATE_EVENT, onState);
  }, []);
  useEffect(() => {
    announceReferenceAutoSource({ fallback, source });
  }, [fallback, source]);
  const tip = open
    ? '收起参考窗格'
    : '在编辑器旁边看本章引用的图片 / 视频、场景视频和人物图（可拖动排序、拖入资料）';
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
          onClick={() => requestToggleReference(fallback, source)}
        >
          <VscFileMedia className={styles.icon} aria-hidden="true" />
          <span className={styles.label}>参考</span>
        </button>
      </Tooltip>
    </span>
  );
};

export default ReferenceButton;
