import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { compareChapterFileNames, compareVolumeDirNames } from '@novel-editor/core/story-layout';
import type { EditorAssistConfig } from '@/render/components/TextEditor';
import type { Character } from '@/render/components/RightPanel/types';
import {
  findGrowthSheetForCharacter,
  findLastAppearance,
  type ChapterRef,
} from '@/render/components/CharacterHoverCard/model';
import { mountCharacterHoverCard } from '@/render/components/CharacterHoverCard/mount';
import { createCharacterWorkspaceTab } from '@/render/utils/workspace';
import { loadAvatarSource } from '@/render/utils/characterAvatar';
import { getAIStreamRouter } from '@/render/utils/aiStreamRouter';
import { createContinuationService } from '@/render/utils/continuationService';
import { loadWritingSources } from '@/render/utils/writingSources';
import {
  NOVEL_EDITOR_FILE_SAVED_EVENT,
  type NovelEditorFileSavedDetail,
} from '@/render/utils/editor-events';
import { useWorkGrowthSnapshot } from './useWorkGrowthSnapshot';
import type { WorkspaceState } from './state/useWorkspaceState';
import type { EntitiesState } from './state/useEntitiesState';
import type { WorkspaceDerivedState } from './useWorkspaceDerivedState';
import type { TabActions } from './useTabActions';

export type UseEditorAssistContext = Pick<WorkspaceState, 'folderPath' | 'dbReady'> &
  Partial<Pick<WorkspaceState, 'workScopePath'>> &
  Pick<EntitiesState, 'workspaceCharacters'> &
  Pick<WorkspaceDerivedState, 'activeDocumentTab' | 'storyFileNodes'> &
  Pick<TabActions, 'openFileInTab'>;

/** 人物卡片「记一笔」请求：在卡片按钮处弹出成长记录 */
export interface GrowthRecordRequest {
  name: string;
  aliases: string[];
  anchor: DOMRect;
}

const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '');

/** 章节标签：相对作品目录、去掉扩展名，例如「第一卷-离乡 · 001-启程」 */
export function chapterLabel(path: string, workPath: string | null): string {
  const normalized = normalize(path);
  const base = workPath ? normalize(workPath) : '';
  const relative =
    base && normalized.startsWith(`${base}/`) ? normalized.slice(base.length + 1) : normalized;
  return relative
    .replace(/\.[^./]+$/, '')
    .split('/')
    .filter(Boolean)
    .join(' · ');
}

/** 两个章节路径的先后：目录按卷序（支持中文数字），文件名按章序（与正文树一致） */
export function compareChapterPaths(a: string, b: string): number {
  const left = normalize(a).split('/');
  const right = normalize(b).split('/');
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] === right[index]) continue;
    const leftIsFile = index === left.length - 1;
    const rightIsFile = index === right.length - 1;
    // 同一层里，直接放在作品目录下的章节排在各卷之前
    if (leftIsFile !== rightIsFile) return leftIsFile ? -1 : 1;
    return leftIsFile
      ? compareChapterFileNames(left[index], right[index])
      : compareVolumeDirNames(left[index], right[index]);
  }
  return left.length - right.length;
}

/** 当前作品的章节（按卷序、章序排列） */
export function workChapters(
  nodes: ReadonlyArray<{ path: string }>,
  workPath: string | null
): ChapterRef[] {
  const base = workPath ? `${normalize(workPath)}/` : '';
  return nodes
    .filter((node) => !base || normalize(node.path).startsWith(base))
    .map((node) => node.path)
    .sort(compareChapterPaths)
    .map((path) => ({ path, label: chapterLabel(path, workPath) }));
}

/**
 * 编辑器辅助的上层数据：人物悬停卡片（人物卡 + 成长档案 + 头像 + 上次出场）与续写服务。
 * 返回给 TextEditor 的配置只在人物列表变化时更新，其余数据经 ref 读取最新值。
 */
export function useEditorAssist(ctx: UseEditorAssistContext) {
  const { activeDocumentTab, dbReady, openFileInTab, storyFileNodes, workspaceCharacters } = ctx;
  const workPath = ctx.workScopePath ?? ctx.folderPath;
  const snapshot = useWorkGrowthSnapshot(workPath);
  const [growthRecord, setGrowthRecord] = useState<GrowthRecordRequest | null>(null);
  const chapters = useMemo(
    () => workChapters(storyFileNodes, workPath),
    [storyFileNodes, workPath]
  );

  const latest = useRef({
    workPath,
    snapshot,
    chapters,
    activeDocumentTab,
    dbReady,
    openFileInTab,
  });
  latest.current = { workPath, snapshot, chapters, activeDocumentTab, dbReady, openFileInTab };
  const charactersRef = useRef<readonly Character[]>(workspaceCharacters);
  charactersRef.current = workspaceCharacters;

  // 章节正文缓存（上次出场查找用）；保存后失效
  const textCache = useRef(new Map<string, Promise<string>>());
  useEffect(() => {
    textCache.current.clear();
  }, [workPath]);
  useEffect(() => {
    const onSaved = (event: Event) => {
      const detail = (event as CustomEvent<NovelEditorFileSavedDetail>).detail;
      if (detail?.filePath) textCache.current.delete(detail.filePath);
    };
    document.addEventListener(NOVEL_EDITOR_FILE_SAVED_EVENT, onSaved);
    return () => document.removeEventListener(NOVEL_EDITOR_FILE_SAVED_EVENT, onSaved);
  }, []);
  const readChapter = useCallback((path: string) => {
    let cached = textCache.current.get(path);
    if (!cached) {
      cached = window.electron.ipcRenderer
        .invoke('read-file', path)
        .then((text) => (typeof text === 'string' ? text : ''))
        .catch(() => '');
      textCache.current.set(path, cached);
    }
    return cached;
  }, []);

  const renderCharacterCard = useCallback<NonNullable<EditorAssistConfig['renderCharacterCard']>>(
    (dom, characterId, actions) => {
      const character = charactersRef.current.find((item) => item.id === characterId);
      if (!character) return () => undefined;
      const current = latest.current;
      const sheet = current.snapshot?.initialized
        ? findGrowthSheetForCharacter(current.snapshot.sheets, character)
        : null;
      const growth =
        sheet && current.snapshot ? { sheet, ruleset: current.snapshot.ruleset } : null;
      const tokens = [character.name, ...(character.aliases ?? [])];
      return mountCharacterHoverCard(dom, {
        character,
        growth,
        canRecord: Boolean(current.snapshot?.initialized),
        loadAvatar: () => loadAvatarSource(character.avatar, current.workPath),
        loadLastAppearance: () =>
          findLastAppearance(current.chapters, tokens, current.activeDocumentTab, readChapter),
        onOpen: () => {
          actions.close();
          latest.current.openFileInTab(createCharacterWorkspaceTab(character));
        },
        onRecord: (anchor) => {
          setGrowthRecord({
            name: sheet?.name ?? character.name,
            aliases: character.aliases ?? [],
            anchor,
          });
          actions.close();
        },
        onHighlightAll: actions.highlightAll,
      });
    },
    [readChapter]
  );

  const continuation = useMemo(() => {
    const ipc = window.electron?.ipcRenderer;
    const router = getAIStreamRouter();
    if (!ipc || !router) return null;
    return createContinuationService({
      loadSources: (filePath) =>
        loadWritingSources({
          ipc,
          workPath: latest.current.workPath,
          filePath,
          characters: charactersRef.current,
          dbReady: latest.current.dbReady,
        }),
      listProviders: async () => {
        const result = await ipc.invoke('ai-providers-list');
        return result.ok ? result.data : [];
      },
      prepareStream: () => router.prepare(),
      startStream: (payload) => ipc.invoke('ai-stream-start', payload),
      cancelStream: (streamId) => {
        void ipc.invoke('ai-stream-cancel', streamId).catch(() => undefined);
      },
      subscribe: (streamId, listener) => router.subscribe(streamId, listener),
    });
  }, []);

  const openAiSettings = useCallback(() => {
    window.dispatchEvent(new CustomEvent('open-settings-tab', { detail: 'ai' }));
  }, []);

  const editorAssist = useMemo<EditorAssistConfig>(
    () => ({
      characters: workspaceCharacters,
      renderCharacterCard,
      continuation,
      openAiSettings,
    }),
    [continuation, openAiSettings, renderCharacterCard, workspaceCharacters]
  );

  return {
    editorAssist,
    growthRecord,
    closeGrowthRecord: useCallback(() => setGrowthRecord(null), []),
    assistWorkPath: workPath,
  };
}

export type EditorAssistApi = ReturnType<typeof useEditorAssist>;
