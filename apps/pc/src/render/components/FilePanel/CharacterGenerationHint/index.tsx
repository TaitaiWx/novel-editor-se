import React, { useMemo } from 'react';
import {
  formatAssistantGenerationMetrics,
  formatAssistantGenerationProgress,
  type AssistantArtifactGenerationStatus,
} from '../../../utils/assistantGeneration';
import styles from './styles.module.scss';

interface CharacterGenerationHintProps {
  status: AssistantArtifactGenerationStatus;
}

/** 角色分区下方的 AI 生成状态提示（运行中 / 成功 / 为空 / 失败） */
const CharacterGenerationHint: React.FC<CharacterGenerationHintProps> = ({ status }) => {
  const progress = useMemo(() => formatAssistantGenerationProgress(status), [status]);
  const metrics = useMemo(() => formatAssistantGenerationMetrics(status), [status]);
  const stateClassName =
    status.state === 'running'
      ? styles.sectionStatusRunning
      : status.state === 'error'
        ? styles.sectionStatusError
        : status.state === 'empty'
          ? styles.sectionStatusEmpty
          : styles.sectionStatusSuccess;

  return (
    <div className={`${styles.sectionStatusHint} ${stateClassName}`}>
      <div className={styles.sectionStatusText}>{status.message}</div>
      {(progress || metrics) && (
        <div className={styles.sectionStatusMeta}>
          {[progress, metrics].filter(Boolean).join(' · ')}
        </div>
      )}
    </div>
  );
};

export default CharacterGenerationHint;
