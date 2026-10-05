import { useMemo, useReducer, useRef, useState } from 'react';
import { type AISessionSnapshot, buildAISessionStorageKey } from '@/render/state/aiSessionSnapshot';
import type { AssistantArtifactGenerationStatus } from '@/render/utils/assistantGeneration';
import type {
  AssistantScopedCharacter,
  AssistantScopedLore,
  AssistantScopedMaterial,
} from '@/render/app/types';
import { createAISessionChannel } from '@/render/utils/aiSessionChannel';
import {
  fixSessionSelectors,
  initialFixSessionState,
  reduceFixSession,
} from '@/render/state/fixSessionState';

/**
 * AI 会话领域状态：修复流程（内联 diff / 对比 / 待应用队列）、跨窗口 AI 会话通道，
 * 以及助手作用域内的人物/设定/资料与生成状态（只声明，不含副作用）
 *
 * @param folderPath 当前工作区路径，用于派生 AI 会话存储 key
 */
export function useAiSessionState(folderPath: string | null) {
  const [fixState, dispatchFixCommand] = useReducer(reduceFixSession, initialFixSessionState);
  const [assistantScopedCharacters, setAssistantScopedCharacters] = useState<
    AssistantScopedCharacter[]
  >([]);
  const [assistantCharacterGenerationStatus, setAssistantCharacterGenerationStatus] =
    useState<AssistantArtifactGenerationStatus | null>(null);
  const [assistantScopedLoreEntries, setAssistantScopedLoreEntries] = useState<
    AssistantScopedLore[]
  >([]);
  const [assistantScopedMaterials, setAssistantScopedMaterials] = useState<
    AssistantScopedMaterial[]
  >([]);

  // 修复流程状态（selector 只读）
  const inlineDiff = fixSessionSelectors.inlineDiff(fixState);
  const diffState = fixSessionSelectors.diffState(fixState);
  const pendingApplyQueue = fixSessionSelectors.pendingApplyQueue(fixState);
  const aiSessionChannelRef = useRef<ReturnType<typeof createAISessionChannel> | null>(null);
  const aiSessionRef = useRef<AISessionSnapshot | null>(null);
  const aiSessionKey = useMemo(() => buildAISessionStorageKey(folderPath), [folderPath]);

  return {
    fixState,
    dispatchFixCommand,
    inlineDiff,
    diffState,
    pendingApplyQueue,
    aiSessionChannelRef,
    aiSessionRef,
    aiSessionKey,
    assistantScopedCharacters,
    setAssistantScopedCharacters,
    assistantCharacterGenerationStatus,
    setAssistantCharacterGenerationStatus,
    assistantScopedLoreEntries,
    setAssistantScopedLoreEntries,
    assistantScopedMaterials,
    setAssistantScopedMaterials,
  };
}

export type AiSessionState = ReturnType<typeof useAiSessionState>;
