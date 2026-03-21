import React from 'react';
import styles from './styles.module.scss';
import { WORKFLOW_DEFS, WORKFLOW_KEYS } from './useAiWorkflow';
import type { WorkflowKey } from './useAiWorkflow';

interface AIWorkflowSelectorProps {
  workflow: WorkflowKey;
  setWorkflow: (key: WorkflowKey) => void;
  prompt: string;
  setPrompt: (prompt: string) => void;
  contentLabel: string;
  contextCounts: { lore: number; characters: number };
  loading: boolean;
  onRun: () => void;
  historyCount: number;
  showHistory: boolean;
  onToggleHistory: () => void;
  /** 重置为干净状态（新建分析） */
  onNewSession?: () => void;
  /** 是否有分析结果（控制新建按钮显示） */
  hasResult?: boolean;
}

export const AIWorkflowSelector: React.FC<AIWorkflowSelectorProps> = React.memo(
  ({
    workflow,
    setWorkflow,
    prompt,
    setPrompt,
    contentLabel,
    contextCounts,
    loading,
    onRun,
    historyCount,
    showHistory,
    onToggleHistory,
    onNewSession,
    hasResult,
  }) => (
    <>
      {/* 上下文概览 */}
      <div className={styles.aiContextBar}>
        <span className={styles.aiContextChip}>正文 {contentLabel}</span>
        <span className={styles.aiContextChip}>人物 {contextCounts.characters}</span>
        <span className={styles.aiContextChip}>设定 {contextCounts.lore}</span>
      </div>

      {/* 工作流选择 */}
      <div className={styles.aiWorkflowBar}>
        {WORKFLOW_KEYS.map((key) => (
          <button
            key={key}
            className={`${styles.aiWorkflowChip} ${workflow === key ? styles.aiWorkflowChipActive : ''}`}
            onClick={() => {
              setWorkflow(key);
              setPrompt(WORKFLOW_DEFS[key].prompt);
            }}
          >
            {WORKFLOW_DEFS[key].title}
          </button>
        ))}
      </div>

      {/* 当前工作流提示 */}
      <div className={styles.aiWorkflowHint}>{WORKFLOW_DEFS[workflow].desc}</div>

      {/* 输入区 */}
      <textarea
        className={styles.aiPromptInput}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        placeholder="输入自定义指令，或点击上方工作流自动填充..."
      />

      {/* 操作栏 */}
      <div className={styles.aiActionBar}>
        <button className={styles.aiRunButton} onClick={onRun} disabled={loading || !prompt.trim()}>
          {loading ? '分析中...' : '发送'}
        </button>
        {onNewSession && hasResult && (
          <button className={styles.aiHistoryButton} onClick={onNewSession} title="新建分析">
            新建
          </button>
        )}
        <button className={styles.aiHistoryButton} onClick={onToggleHistory} title="历史记录">
          {showHistory ? '返回' : `历史 (${historyCount})`}
        </button>
      </div>
    </>
  )
);
