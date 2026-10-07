import { getStructureClassifier } from '@/render/utils/structureRules';
import { useCallback, useEffect, useRef } from 'react';
import {
  OPEN_SCENE_VIDEO_EVENT,
  setSceneVideoSeed,
  type OpenSceneVideoDetail,
} from '@/render/components/SceneVideoView/events';
import {
  resolveSceneSource,
  type SceneSource,
} from '@/render/components/SceneVideoView/sceneSource';
import { createSceneVideoWorkspaceTab, isStoryFilePath } from '@/render/utils/workspace';
import type { EditorState } from './state/useEditorState';
import type { UiState } from './state/useUiState';
import type { TabActions } from './useTabActions';
import type { WorkspaceDerivedState } from './useWorkspaceDerivedState';

export type UseSceneVideoEntryContext = Pick<EditorState, 'editorViewRef'> &
  Pick<UiState, 'toast'> &
  Pick<TabActions, 'openFileInTab'> &
  Pick<WorkspaceDerivedState, 'activeDocumentTab'>;

const NO_CHAPTER_HINT = '先打开一章，选中一段正文或把光标放在「第X场」里，再打开场景视频';

/** 场景视频快捷键（与应用菜单「编辑 → 场景视频…」一致，见 main/shortcuts/config.ts） */
export function isSceneVideoShortcut(event: KeyboardEvent): boolean {
  // macOS 上 Alt 会改变 event.key（√），按物理键位判断
  return (
    event.code === 'KeyV' &&
    Boolean(event.metaKey || event.ctrlKey) &&
    event.altKey &&
    !event.shiftKey &&
    !event.isComposing
  );
}

/**
 * 场景视频入口：响应文件栏按钮 / 卷纲条目 / 应用菜单（窗口事件）与快捷键，
 * 从选区 / 光标所在的「第X场」/ 指定场景名解析出场景正文，打开 `__workspace__:scene-video:<章>#<场景>` 标签。
 */
export function useSceneVideoEntry(ctx: UseSceneVideoEntryContext) {
  const { activeDocumentTab, editorViewRef, openFileInTab, toast } = ctx;
  const busyRef = useRef(false);

  const openSceneVideo = useCallback(
    async (detail: OpenSceneVideoDetail = {}) => {
      const chapterPath = detail.chapterPath ?? activeDocumentTab;
      if (!chapterPath || !isStoryFilePath(chapterPath)) {
        toast.info(NO_CHAPTER_HINT);
        return;
      }
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        let source: SceneSource;
        const view = editorViewRef.current;
        if (view && chapterPath === activeDocumentTab) {
          const { state } = view;
          const selection = state.selection.main;
          // 卷纲条目指定了场景时忽略编辑器里的选区
          const selectionText =
            detail.scene || selection.empty ? '' : state.sliceDoc(selection.from, selection.to);
          source = resolveSceneSource({
            docText: state.doc.toString(),
            selectionText,
            selectionLine: state.doc.lineAt(selection.from).number,
            cursorLine: detail.line ?? state.doc.lineAt(selection.head).number,
            sceneTitle: detail.scene,
            classify: getStructureClassifier(),
          });
        } else {
          const ipc = window.electron?.ipcRenderer;
          const docText = ipc ? await ipc.invoke('read-file', chapterPath).catch(() => '') : '';
          source = resolveSceneSource({
            docText,
            sceneTitle: detail.scene,
            cursorLine: detail.line,
            classify: getStructureClassifier(),
          });
        }
        if (!source.text.trim()) {
          toast.info(NO_CHAPTER_HINT);
          return;
        }
        const tab = createSceneVideoWorkspaceTab({ chapterPath, scene: source.scene });
        setSceneVideoSeed(tab, { sourceText: source.text, origin: source.origin });
        openFileInTab(tab);
      } finally {
        busyRef.current = false;
      }
    },
    [activeDocumentTab, editorViewRef, openFileInTab, toast]
  );

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenSceneVideoDetail | undefined>).detail;
      void openSceneVideo(detail ?? {});
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSceneVideoShortcut(event)) return;
      event.preventDefault();
      void openSceneVideo();
    };
    // 应用菜单「编辑 → 场景视频…」经 useAppMenu 转为同一个窗口事件
    window.addEventListener(OPEN_SCENE_VIDEO_EVENT, onOpen);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener(OPEN_SCENE_VIDEO_EVENT, onOpen);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [openSceneVideo]);

  return { openSceneVideo };
}

export type SceneVideoEntryApi = ReturnType<typeof useSceneVideoEntry>;
