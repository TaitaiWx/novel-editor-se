import React, { useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { VscSparkle } from 'react-icons/vsc';
import Popover from '../Popover';
import Tooltip from '../Tooltip';
import { ContinuationPanel } from './ContinuationPanel';
import { useContinuationPanel } from './useContinuationPanel';
import styles from './styles.module.scss';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform);
export const CONTINUATION_TIP = `AI 续写：按长度与方向生成建议，采纳后才写入正文（行内续写 ${IS_MAC ? '⌥\\' : 'Alt+\\'}）`;

interface ContinuationButtonProps {
  editorViewRef?: React.MutableRefObject<EditorView | null>;
}

const openAiSettings = () =>
  window.dispatchEvent(new CustomEvent('open-settings-tab', { detail: 'ai' }));

/** 编辑器文件栏上的「续写」胶囊按钮（在「灵感」旁），点击打开续写面板 */
const ContinuationButton: React.FC<ContinuationButtonProps> = ({ editorViewRef }) => {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const panel = useContinuationPanel(open, editorViewRef);

  return (
    <span className={styles.pillSlot}>
      <Tooltip content={CONTINUATION_TIP} position="bottom">
        <button
          ref={anchorRef}
          type="button"
          className={styles.pill}
          aria-label="续写"
          aria-haspopup="dialog"
          aria-expanded={open}
          data-testid="continuation-pill"
          onClick={() => setOpen((value) => !value)}
        >
          <VscSparkle className={styles.icon} aria-hidden="true" />
          <span className={styles.pillLabel}>续写</span>
        </button>
      </Tooltip>
      <Popover
        open={open}
        anchorRef={anchorRef}
        placement="bottom"
        align="end"
        className={styles.popover}
        onClose={() => setOpen(false)}
        closeOnOutsideClick
        closeOnEscape
        zIndex={1500}
      >
        <div className={styles.title} data-testid="continuation-panel">
          AI 续写
        </div>
        <ContinuationPanel
          providers={panel.providers}
          resolvedProvider={panel.resolvedProvider}
          configured={panel.configured}
          state={panel.state}
          notice={panel.notice}
          onGenerate={panel.generate}
          onAccept={panel.accept}
          onDiscard={panel.discard}
          onNext={panel.next}
          onRetry={panel.retry}
          onOpenSettings={() => {
            setOpen(false);
            openAiSettings();
          }}
        />
      </Popover>
    </span>
  );
};

export default ContinuationButton;
