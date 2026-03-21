import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import styles from './styles.module.scss';
import { useAiConfig } from './useAiConfig';
import { useAiHistory } from './useAiHistory';
import type { HistoryRecord } from './useAiHistory';
import { useAiWorkflow, WORKFLOW_DEFS } from './useAiWorkflow';
import type { WorkflowKey } from './useAiWorkflow';
import { AIWorkflowSelector } from './AIWorkflowSelector';
import { AIHistoryDrawer } from './AIHistoryDrawer';
import { AIResultPanel, AIFixActionsBar } from './AIResultPanel';
import { createAISessionChannel } from '../../utils/aiSessionChannel';
import {
  buildAISessionStorageKey,
  parseAISessionSnapshot,
  type AISessionSnapshot,
} from '../../state/aiSessionSnapshot';

const SETUP_STEPS = [
  { step: 1, title: '打开设置中心', desc: '点击下方按钮，进入「AI」配置页面' },
  { step: 2, title: '选择服务商', desc: '支持 OpenAI、DeepSeek、OpenRouter 等兼容接口' },
  { step: 3, title: '填写 API Key', desc: '从服务商后台获取密钥，粘贴即可' },
];

function snapshotSignature(snapshot: AISessionSnapshot): string {
  return JSON.stringify({
    workflow: snapshot.workflow,
    result: snapshot.result,
    snapshotFilePath: snapshot.snapshotFilePath,
    prompt: snapshot.prompt,
    fixResults: snapshot.fixResults || {},
    activeFilePath: snapshot.activeFilePath || null,
    inlineDiff: snapshot.inlineDiff || null,
    pendingApplyQueue: snapshot.pendingApplyQueue || [],
  });
}

export type AISessionState = AISessionSnapshot;

export const AIView: React.FC<{
  folderPath: string | null;
  content: string;
  filePath?: string | null;
  onApplyFix?: (
    original: string,
    modified: string,
    targetPath?: string,
    targetLine?: number
  ) => void;
  onOpenFile?: (filePath: string) => void;
  onOpenSettings?: () => void;
  /** 可选：父组件传入 ref，AIView 会持续同步当前状态供窗口切换时保存 */
  stateRef?: React.MutableRefObject<AISessionState | null>;
  /** 可选：初始状态（从主窗口传递过来的 AI 会话快照） */
  initialState?: AISessionState;
  /** 独立窗口模式：跳过本地写盘，修复委托给主窗口 */
  skipDiskWrite?: boolean;
  /** 独立窗口模式：将修复数据发到主窗口展示 diff */
  onDelegateFix?: (payload: {
    filePath: string;
    original: string;
    modified: string;
    explanation?: string;
    proposedFullContent?: string;
    targetLine?: number;
  }) => void;
  /** 在编辑器中展示内联 diff 预览（fix 生成后立即标注修改区域） */
  onPreviewDiff?: (original: string, modified: string) => void;
}> = React.memo(
  ({
    folderPath,
    content,
    filePath,
    onApplyFix,
    onOpenFile,
    onOpenSettings,
    stateRef,
    initialState,
    skipDiskWrite,
    onDelegateFix,
    onPreviewDiff,
  }) => {
    const aiConfig = useAiConfig();
    const {
      history,
      activeHistoryId,
      setActiveHistoryId,
      showHistory,
      setShowHistory,
      toggleHistory,
      addRecord,
      deleteRecord,
    } = useAiHistory(folderPath);
    const {
      prompt,
      setPrompt,
      result,
      setResult,
      loading,
      workflow,
      setWorkflow,
      contextCounts,
      copied,
      saved,
      snapshotFilePath,
      setSnapshotFilePath,
      handleCopy,
      handleSave,
      handleAutoFix,
      handleApplyFixToSource,
      fixResults,
      setFixResults,
      saveFixResult,
      removeFixResult,
      runAI,
    } = useAiWorkflow({
      folderPath,
      content,
      filePath,
      onApplyFix,
      onOpenFile,
      addRecord,
      skipDiskWrite,
      onDelegateFix,
      onPreviewDiff,
    });

    const sessionStorageKey = useMemo(() => buildAISessionStorageKey(folderPath), [folderPath]);
    const sessionSnapshotRef = useRef<AISessionSnapshot | null>(null);

    const buildLocalSnapshot = useCallback((): AISessionSnapshot => {
      const prev = sessionSnapshotRef.current || {
        workflow: 'consistency',
        result: '',
        snapshotFilePath: null,
        prompt: '',
        fixResults: {},
        inlineDiff: null,
        pendingApplyQueue: [],
      };
      return {
        ...prev,
        workflow,
        result,
        snapshotFilePath,
        prompt,
        fixResults,
        activeFilePath: filePath,
      };
    }, [workflow, result, snapshotFilePath, prompt, fixResults, filePath]);

    // ─── 向父组件同步当前状态（供窗口切换时保存） ─────────────────────────
    useEffect(() => {
      if (stateRef) {
        stateRef.current = {
          workflow,
          result,
          snapshotFilePath,
          prompt,
          fixResults,
          activeFilePath: filePath,
        };
      }
    }, [stateRef, workflow, result, snapshotFilePath, prompt, fixResults, filePath]);

    // ─── BroadcastChannel 实时跨窗口同步 ──────────────────────────────────
    const channelRef = useRef<ReturnType<typeof createAISessionChannel> | null>(null);
    const lastIncomingSignatureRef = useRef('');
    const lastBroadcastSignatureRef = useRef('');
    useEffect(() => {
      const ch = createAISessionChannel();
      channelRef.current = ch;
      ch.onMessage((incoming, incomingSessionKey) => {
        if (incomingSessionKey && incomingSessionKey !== sessionStorageKey) return;
        const sig = snapshotSignature(incoming);
        if (sig === lastIncomingSignatureRef.current) return;
        lastIncomingSignatureRef.current = sig;
        sessionSnapshotRef.current = incoming;
        setWorkflow(incoming.workflow as WorkflowKey);
        setResult(incoming.result);
        setPrompt(incoming.prompt);
        setFixResults(incoming.fixResults || {});
        const incomingActivePath = incoming.activeFilePath || incoming.snapshotFilePath || null;
        if (incomingActivePath && incomingActivePath !== filePath && onOpenFile) {
          onOpenFile(incomingActivePath);
        }
        if (incoming.snapshotFilePath) setSnapshotFilePath(incoming.snapshotFilePath);
      });
      return () => ch.close();
    }, [
      sessionStorageKey,
      setWorkflow,
      setResult,
      setPrompt,
      setFixResults,
      setSnapshotFilePath,
      filePath,
      onOpenFile,
    ]);

    // 广播本地状态变化
    useEffect(() => {
      const snapshot = buildLocalSnapshot();
      const sig = snapshotSignature(snapshot);
      if (sig === lastBroadcastSignatureRef.current) return;
      lastBroadcastSignatureRef.current = sig;
      sessionSnapshotRef.current = snapshot;
      channelRef.current?.broadcast(snapshot, sessionStorageKey);
    }, [buildLocalSnapshot, sessionStorageKey]);

    // ─── SQLite 单一数据源：恢复 AI 会话状态 ──────────────────────────────
    const restoredFromStoreRef = useRef(false);
    useEffect(() => {
      if (restoredFromStoreRef.current) return;
      if (initialState) return; // initialState 优先（窗口切换场景）

      const ipc = window.electron?.ipcRenderer;
      if (!ipc) return;

      let cancelled = false;
      const restoreFromStore = async () => {
        try {
          const raw = (await ipc.invoke('db-settings-get', sessionStorageKey)) as string | null;
          const parsed = parseAISessionSnapshot(raw);
          if (!parsed || cancelled) return;
          restoredFromStoreRef.current = true;
          sessionSnapshotRef.current = parsed;

          setWorkflow((parsed.workflow as WorkflowKey) || 'consistency');
          setResult(parsed.result || '');
          setPrompt(parsed.prompt || '');
          setFixResults(parsed.fixResults || {});

          const restoredActivePath = parsed.activeFilePath || parsed.snapshotFilePath || null;
          if (restoredActivePath && restoredActivePath !== filePath && onOpenFile) {
            onOpenFile(restoredActivePath);
          }
          setSnapshotFilePath(parsed.snapshotFilePath || null);
        } catch {
          // ignore parse / io errors
        }
      };

      void restoreFromStore();
      return () => {
        cancelled = true;
      };
    }, [
      initialState,
      sessionStorageKey,
      filePath,
      onOpenFile,
      setWorkflow,
      setResult,
      setPrompt,
      setFixResults,
      setSnapshotFilePath,
    ]);

    // ─── SQLite 单一数据源：持久化 AI 会话状态（防抖） ───────────────────
    const persistTimerRef = useRef<number | null>(null);
    useEffect(() => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) return;

      const nextState = buildLocalSnapshot();
      sessionSnapshotRef.current = nextState;

      if (persistTimerRef.current) {
        window.clearTimeout(persistTimerRef.current);
      }
      persistTimerRef.current = window.setTimeout(() => {
        ipc.invoke('db-settings-set', sessionStorageKey, JSON.stringify(nextState)).catch(() => {});
      }, 180);

      return () => {
        if (persistTimerRef.current) {
          window.clearTimeout(persistTimerRef.current);
          persistTimerRef.current = null;
        }
      };
    }, [buildLocalSnapshot, sessionStorageKey]);

    // ─── 从 initialState 恢复状态（新窗口打开时） ────────────────────────
    const restoredRef = useRef(false);
    useEffect(() => {
      if (initialState && !restoredRef.current) {
        restoredRef.current = true;
        setWorkflow(initialState.workflow as WorkflowKey);
        setResult(initialState.result);
        setPrompt(initialState.prompt);
        setFixResults(initialState.fixResults || {});
        const restoredActivePath = initialState.activeFilePath || initialState.snapshotFilePath;
        if (restoredActivePath && restoredActivePath !== filePath && onOpenFile) {
          onOpenFile(restoredActivePath);
        }
        if (initialState.snapshotFilePath) setSnapshotFilePath(initialState.snapshotFilePath);
      }
    }, [
      initialState,
      setWorkflow,
      setResult,
      setPrompt,
      setFixResults,
      setSnapshotFilePath,
      filePath,
      onOpenFile,
    ]);

    // ─── 新建分析（重置为干净状态） ────────────────────────────────────────
    const handleNewSession = useCallback(() => {
      setWorkflow('consistency');
      setPrompt(WORKFLOW_DEFS.consistency.prompt);
      setResult('');
      setFixResults({});
      setSnapshotFilePath(filePath || null);
      setActiveHistoryId(null);
    }, [
      setWorkflow,
      setPrompt,
      setResult,
      setFixResults,
      setSnapshotFilePath,
      setActiveHistoryId,
      filePath,
    ]);

    // ─── Restore a history record ────────────────────────────────────────────
    const restoreRecord = useCallback(
      (record: HistoryRecord) => {
        setWorkflow(record.workflow as WorkflowKey);
        setPrompt(record.prompt);
        setResult(record.result);
        setFixResults({});
        setActiveHistoryId(record.id);
        setShowHistory(false);
        if (record.filePath) setSnapshotFilePath(record.filePath);
      },
      [
        setWorkflow,
        setPrompt,
        setResult,
        setFixResults,
        setActiveHistoryId,
        setShowHistory,
        setSnapshotFilePath,
      ]
    );

    const handleDeleteRecord = useCallback(
      (id: string) => {
        if (activeHistoryId === id) setResult('');
        deleteRecord(id);
      },
      [activeHistoryId, deleteRecord, setResult]
    );

    // ─── 配置加载中 ───
    if (!aiConfig.loaded) {
      return null;
    }

    // ─── AI 未配置：显示引导 ───
    if (!aiConfig.ready) {
      return (
        <div className={styles.aiSetupGuide}>
          <div className={styles.aiSetupIcon}>AI</div>
          <div className={styles.aiSetupTitle}>开启 AI 写作助手</div>
          <div className={styles.aiSetupDesc}>
            配置 API Key 后，即可使用一致性诊断、设定补全、人物诊断、情节分析等 AI 辅助功能。
          </div>
          <div className={styles.aiSetupSteps}>
            {SETUP_STEPS.map((item) => (
              <div key={item.step} className={styles.aiSetupStep}>
                <span className={styles.aiSetupStepNum}>{item.step}</span>
                <div>
                  <div className={styles.aiSetupStepTitle}>{item.title}</div>
                  <div className={styles.aiSetupStepDesc}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
          {onOpenSettings && (
            <button className={styles.aiSetupButton} onClick={onOpenSettings}>
              前往设置
            </button>
          )}
        </div>
      );
    }

    // ─── AI 已配置：写作工作台 ───
    const contentLen = content.length;
    const contentLabel =
      contentLen >= 10000
        ? `${(contentLen / 10000).toFixed(1)} 万字`
        : `${Math.max(1, Math.ceil(contentLen / 1000))}k 字`;

    return (
      <div className={styles.aiWorkbench}>
        <AIWorkflowSelector
          workflow={workflow}
          setWorkflow={setWorkflow}
          prompt={prompt}
          setPrompt={setPrompt}
          contentLabel={contentLabel}
          contextCounts={contextCounts}
          loading={loading}
          onRun={() => runAI()}
          historyCount={history.length}
          showHistory={showHistory}
          onToggleHistory={toggleHistory}
          onNewSession={handleNewSession}
          hasResult={!!result}
        />

        {/* 复制 / 保存 */}
        {!showHistory && result && !loading && (
          <AIFixActionsBar copied={copied} saved={saved} onCopy={handleCopy} onSave={handleSave} />
        )}

        {/* 历史 / 结果 */}
        {showHistory ? (
          <AIHistoryDrawer
            history={history}
            activeHistoryId={activeHistoryId}
            onRestore={restoreRecord}
            onDelete={handleDeleteRecord}
          />
        ) : (
          <AIResultPanel
            result={result}
            loading={loading}
            onAutoFix={handleAutoFix}
            onApplyFixToSource={handleApplyFixToSource}
            persistedFixes={fixResults}
            onPersistFix={saveFixResult}
            onRejectFix={removeFixResult}
          />
        )}
      </div>
    );
  }
);
