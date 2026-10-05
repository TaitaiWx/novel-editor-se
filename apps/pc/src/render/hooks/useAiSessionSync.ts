import React, { useRef } from 'react';
import { type AISessionSnapshot, parseAISessionSnapshot } from '@/render/state/aiSessionSnapshot';
import { createAISessionChannel } from '@/render/utils/aiSessionChannel';
import { fnv1a32 } from '@/render/components/RightPanel/utils';
import type { TabsState } from './state/useTabsState';
import type { EditorState } from './state/useEditorState';
import type { AiSessionState } from './state/useAiSessionState';

export type UseAiSessionSyncContext = Pick<TabsState, 'activeTabRef'> &
  Pick<EditorState, 'editorViewRef' | 'setScrollToLine'> &
  Pick<
    AiSessionState,
    | 'aiSessionChannelRef'
    | 'aiSessionKey'
    | 'aiSessionRef'
    | 'dispatchFixCommand'
    | 'inlineDiff'
    | 'pendingApplyQueue'
  >;

/**
 * AI 会话快照：跨窗口广播接收、恢复与节流持久化
 */
export function useAiSessionSync(ctx: UseAiSessionSyncContext) {
  const {
    activeTabRef,
    aiSessionChannelRef,
    aiSessionKey,
    aiSessionRef,
    dispatchFixCommand,
    editorViewRef,
    inlineDiff,
    pendingApplyQueue,
    setScrollToLine,
  } = ctx;

  React.useEffect(() => {
    const ch = createAISessionChannel();
    aiSessionChannelRef.current = ch;
    ch.onMessage((incoming, incomingSessionKey) => {
      if (incomingSessionKey && incomingSessionKey !== aiSessionKey) return;
      aiSessionRef.current = incoming;
      dispatchFixCommand({
        type: 'FIX_SESSION_HYDRATED',
        inlineDiff: incoming.inlineDiff || null,
        pendingApplyQueue: incoming.pendingApplyQueue || [],
      });

      // 单向同步时补齐滚动联动：当收到预览 diff，自动滚动到对应行
      if (incoming.inlineDiff && editorViewRef.current) {
        const line = editorViewRef.current.state.doc.lineAt(
          Math.min(incoming.inlineDiff.from, editorViewRef.current.state.doc.length)
        );
        setScrollToLine({
          line: line.number,
          id: fnv1a32(`diff:${incoming.inlineDiff.from}:${incoming.inlineDiff.to}`),
        });
      }
    });
    return () => ch.close();
  }, [aiSessionKey]);

  React.useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    let cancelled = false;
    const restoreSession = async () => {
      try {
        const raw = (await ipc.invoke('db-settings-get', aiSessionKey)) as string | null;
        const parsed = parseAISessionSnapshot(raw);
        if (!parsed || cancelled) return;
        aiSessionRef.current = parsed;
        dispatchFixCommand({
          type: 'FIX_SESSION_HYDRATED',
          inlineDiff: parsed.inlineDiff || null,
          pendingApplyQueue: parsed.pendingApplyQueue || [],
        });
      } catch {
        // ignore
      }
    };
    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, [aiSessionKey]);

  const persistSessionTimerRef = useRef<number | null>(null);
  React.useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    const base = aiSessionRef.current || {
      workflow: 'consistency',
      result: '',
      snapshotFilePath: null,
      prompt: '',
      fixResults: {},
      activeFilePath: activeTabRef.current,
    };
    const nextSnapshot: AISessionSnapshot = {
      ...base,
      activeFilePath: activeTabRef.current,
      inlineDiff,
      pendingApplyQueue,
    };
    aiSessionRef.current = nextSnapshot;

    if (persistSessionTimerRef.current) {
      window.clearTimeout(persistSessionTimerRef.current);
    }
    persistSessionTimerRef.current = window.setTimeout(() => {
      ipc.invoke('db-settings-set', aiSessionKey, JSON.stringify(nextSnapshot)).catch(() => {});
    }, 180);

    return () => {
      if (persistSessionTimerRef.current) {
        window.clearTimeout(persistSessionTimerRef.current);
        persistSessionTimerRef.current = null;
      }
    };
  }, [inlineDiff, pendingApplyQueue, aiSessionKey]);
}
