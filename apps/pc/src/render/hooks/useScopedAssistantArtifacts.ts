import React from 'react';
import { createAssistantArtifactStorageKey } from '@/render/utils/workspace';
import {
  createAssistantGenerationStatusStorageKey,
  parseAssistantArtifactGenerationStatus,
} from '@/render/utils/assistantGeneration';
import {
  parseAssistantScopedCharacters,
  parseAssistantScopedLore,
  parseAssistantScopedMaterials,
} from '@/render/app/aiGeneration';
import type { WorkspaceDerivedState } from './useWorkspaceDerivedState';
import type { AiSessionState } from './state/useAiSessionState';

export type UseScopedAssistantArtifactsContext = Pick<
  WorkspaceDerivedState,
  'currentAssistantScope'
> &
  Pick<
    AiSessionState,
    | 'setAssistantCharacterGenerationStatus'
    | 'setAssistantScopedCharacters'
    | 'setAssistantScopedLoreEntries'
    | 'setAssistantScopedMaterials'
  >;

/**
 * 加载并监听当前作用域下已生成的助手上下文产物
 */
export function useScopedAssistantArtifacts(ctx: UseScopedAssistantArtifactsContext) {
  const {
    currentAssistantScope,
    setAssistantCharacterGenerationStatus,
    setAssistantScopedCharacters,
    setAssistantScopedLoreEntries,
    setAssistantScopedMaterials,
  } = ctx;

  React.useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc || !currentAssistantScope) {
      setAssistantScopedCharacters([]);
      setAssistantCharacterGenerationStatus(null);
      setAssistantScopedLoreEntries([]);
      setAssistantScopedMaterials([]);
      return;
    }

    const characterKey = createAssistantArtifactStorageKey(
      'characters',
      currentAssistantScope.kind,
      currentAssistantScope.path
    );
    const loreKey = createAssistantArtifactStorageKey(
      'lore',
      currentAssistantScope.kind,
      currentAssistantScope.path
    );
    const materialKey = createAssistantArtifactStorageKey(
      'materials',
      currentAssistantScope.kind,
      currentAssistantScope.path
    );
    const characterStatusKey = createAssistantGenerationStatusStorageKey(
      'characters',
      currentAssistantScope.kind,
      currentAssistantScope.path
    );
    if (!characterKey || !loreKey || !materialKey || !characterStatusKey) {
      setAssistantScopedCharacters([]);
      setAssistantCharacterGenerationStatus(null);
      setAssistantScopedLoreEntries([]);
      setAssistantScopedMaterials([]);
      return;
    }

    let cancelled = false;
    const loadScopedArtifacts = async () => {
      try {
        const [characterRaw, characterStatusRaw, loreRaw, materialRaw] = (await Promise.all([
          ipc.invoke('db-settings-get', characterKey),
          ipc.invoke('db-settings-get', characterStatusKey),
          ipc.invoke('db-settings-get', loreKey),
          ipc.invoke('db-settings-get', materialKey),
        ])) as [string | null, string | null, string | null, string | null];
        if (cancelled) return;
        setAssistantScopedCharacters(parseAssistantScopedCharacters(characterRaw));
        setAssistantCharacterGenerationStatus(
          parseAssistantArtifactGenerationStatus(characterStatusRaw)
        );
        setAssistantScopedLoreEntries(parseAssistantScopedLore(loreRaw));
        setAssistantScopedMaterials(parseAssistantScopedMaterials(materialRaw));
      } catch {
        if (cancelled) return;
        setAssistantScopedCharacters([]);
        setAssistantCharacterGenerationStatus(null);
        setAssistantScopedLoreEntries([]);
        setAssistantScopedMaterials([]);
      }
    };

    const watchedKeys = new Set([characterKey, characterStatusKey, loreKey, materialKey]);
    const dispose = ipc.on?.('settings-updated', (_event, key?: string) => {
      if (typeof key === 'string' && watchedKeys.has(key)) {
        void loadScopedArtifacts();
      }
    });
    void loadScopedArtifacts();
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [currentAssistantScope]);
}
