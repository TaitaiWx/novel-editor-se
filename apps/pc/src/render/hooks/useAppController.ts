import { useRendererPreparation } from './useRendererPreparation';
import { useRendererReadyReporting } from './useRendererReadyReporting';
import { useWorkspaceState } from './state/useWorkspaceState';
import { useTabsState } from './state/useTabsState';
import { useLayoutState } from './state/useLayoutState';
import { useEditorState } from './state/useEditorState';
import { useAiSessionState } from './state/useAiSessionState';
import { useEntitiesState } from './state/useEntitiesState';
import { useSettingsState } from './state/useSettingsState';
import { useUiState } from './state/useUiState';
import { useWorkspaceDerivedState } from './useWorkspaceDerivedState';
import { useGeneratedMaterialCleanup } from './useGeneratedMaterialCleanup';
import { useStoryOrderSync } from './useStoryOrderSync';
import { useEditorSession } from './useEditorSession';
import { useAiSessionSync } from './useAiSessionSync';
import { usePaneLayout } from './usePaneLayout';
import { useTabActions } from './useTabActions';
import { useAppSettingsActions } from './useAppSettingsActions';
import { useProjectLoader } from './useProjectLoader';
import { useWorkspaceCreation } from './useWorkspaceCreation';
import { useWorkspaceEntityActions } from './useWorkspaceEntityActions';
import { useScopedContentReader } from './useScopedContentReader';
import { useFileOperations } from './useFileOperations';
import { useEditorInteractions } from './useEditorInteractions';
import { useGlobalShortcuts } from './useGlobalShortcuts';
import { useFocusModeEscape } from './useFocusModeEscape';
import { useProjectExport } from './useProjectExport';
import { useAiWindowBridge } from './useAiWindowBridge';
import { useRightPanelPopout } from './useRightPanelPopout';
import { useSidebarClipboardShortcuts } from './useSidebarClipboardShortcuts';
import { useWorkspaceEntities } from './useWorkspaceEntities';
import { useLibraryGeneration } from './useLibraryGeneration';
import { useScopedAssistantGeneration } from './useScopedAssistantGeneration';
import { useContextMenuItems } from './useContextMenuItems';
import { useChapterMaterials } from './useChapterMaterials';
import { useScopedAssistantArtifacts } from './useScopedAssistantArtifacts';
import { useWorkspaceTabContent } from './useWorkspaceTabContent';
import { useOpenSettingsTabListener } from './useOpenSettingsTabListener';
import { useAboutDialogListener } from './useAboutDialogListener';
import { useAppMenu } from './useAppMenu';
import { useAssistantDialogHandlers } from './useAssistantDialogHandlers';
import { useGrowthEntry } from './useGrowthEntry';
import { useGuiSessionPublisher } from './useGuiSessionPublisher';
import { useWorkScope } from './useWorkScope';
import { useInspirationDialog } from './useInspirationDialog';
import { useAssistantContext } from './useAssistantContext';
import { useEditorAssist } from './useEditorAssist';
import { useSceneVideoEntry } from './useSceneVideoEntry';

/**
 * 应用组合根的全部 hook 调用：声明各领域状态，并按依赖把状态与动作接到各业务 hook。
 *
 * 注意：下列 hook 的调用顺序与拆分前 App.tsx 中代码块的顺序保持一致，
 * 以保证各 useEffect 的执行 / 清理顺序不变。新增或调整 hook 时请保持该顺序。
 * 每个业务 hook 只接收它所需的领域状态（类型见各 hook 的 Context 定义）。
 */
export function useAppController() {
  // ─── 领域状态与派生状态 ─────────────────────────────────────────
  useRendererReadyReporting();
  const workspaceState = useWorkspaceState();
  const tabsState = useTabsState();
  const layoutState = useLayoutState();
  const editorState = useEditorState(workspaceState.folderPath);
  const aiState = useAiSessionState(workspaceState.folderPath);
  const entitiesState = useEntitiesState();
  const settingsState = useSettingsState();
  const uiState = useUiState();
  const derived = useWorkspaceDerivedState({ ...workspaceState, ...tabsState, ...entitiesState });

  // ─── 项目 / 会话同步（effect 顺序敏感） ─────────────────────────
  useGeneratedMaterialCleanup({ ...workspaceState, ...uiState });
  const storyOrder = useStoryOrderSync(workspaceState);
  const editorSession = useEditorSession({ ...workspaceState, ...tabsState, ...editorState });
  useAiSessionSync({ ...tabsState, ...editorState, ...aiState });
  const layout = usePaneLayout(layoutState);

  // ─── 动作（无 effect，仅 useCallback / useMemo） ───────────────
  const tabs = useTabActions({ ...tabsState, ...layoutState, ...uiState });
  const settingsActions = useAppSettingsActions({ ...settingsState, ...uiState });
  const loader = useProjectLoader({
    ...workspaceState,
    ...tabsState,
    ...layoutState,
    ...entitiesState,
    ...settingsState,
    ...uiState,
    ...tabs,
  });
  const creation = useWorkspaceCreation({
    ...workspaceState,
    ...tabsState,
    ...editorState,
    ...entitiesState,
    ...uiState,
    ...tabs,
    ...loader,
  });
  const entityActions = useWorkspaceEntityActions({
    ...workspaceState,
    ...tabsState,
    ...entitiesState,
    ...uiState,
    ...tabs,
    ...creation,
  });
  // 成长档案入口（文件面板分区、工作区标签、人物详情按钮）；effect 只读 资料/记忆/，与其他 hook 无顺序依赖
  const growthEntry = useGrowthEntry({ ...workspaceState, ...uiState, ...tabs, ...derived });
  // 当前作品：角色 / 设定 / 成长档案 / 资料跟随作品；恢复上次选择、打开别的作品的章节时自动切换
  const workScopeApi = useWorkScope({ ...workspaceState, ...uiState, ...derived, ...loader });
  const contentReader = useScopedContentReader({ ...workspaceState, ...editorState, ...derived });
  const fileOps = useFileOperations({
    ...workspaceState,
    ...tabsState,
    ...entitiesState,
    ...uiState,
    ...derived,
    ...tabs,
    ...editorSession,
    ...storyOrder,
    ...loader,
    ...contentReader,
  });
  const editor = useEditorInteractions({
    ...workScopeApi,
    ...tabsState,
    ...layoutState,
    ...editorState,
    ...aiState,
    ...uiState,
    ...layout,
    ...tabs,
    ...loader,
  });

  // ─── 全局事件 / 跨窗口通信 ─────────────────────────────────────
  useGlobalShortcuts({
    ...tabsState,
    ...layoutState,
    ...settingsState,
    ...layout,
    ...tabs,
    ...loader,
    ...creation,
    ...editor,
    ...growthEntry,
  });
  // 专注模式下 Esc 退出（弹层 / 搜索面板 / 输入法组字优先消费 Esc）
  useFocusModeEscape(layoutState.focusMode, tabs.toggleFocusMode);
  const projectExport = useProjectExport({ ...workspaceState, ...uiState });
  useAiWindowBridge({ ...editorState, ...aiState, ...uiState, ...tabs });
  const { handlePopOutRightPanel } = useRightPanelPopout({
    ...workspaceState,
    ...tabsState,
    ...layoutState,
    ...editorState,
    ...layout,
  });
  useSidebarClipboardShortcuts({
    ...workspaceState,
    ...tabsState,
    ...layoutState,
    ...uiState,
    ...fileOps,
  });
  useWorkspaceEntities({ ...workspaceState, ...entitiesState });
  // GUI 会话发布（.novel-editor/session.json，供 CLI ne status 读取）；只读状态，无顺序依赖
  useGuiSessionPublisher({ ...workspaceState, ...tabsState });
  useRendererPreparation(tabsState.untitledTabContents, uiState.toast);

  // ─── AI 生成与右键菜单 ─────────────────────────────────────────
  const libraryGeneration = useLibraryGeneration({
    ...workspaceState,
    ...entitiesState,
    ...uiState,
    ...settingsActions,
    ...creation,
    ...loader,
    ...contentReader,
  });
  const scopedGeneration = useScopedAssistantGeneration({
    ...workspaceState,
    ...aiState,
    ...entitiesState,
    ...uiState,
    ...derived,
    ...settingsActions,
    ...creation,
    ...tabs,
    ...loader,
    ...contentReader,
  });
  // 章节关联资料（右键菜单「关联到当前章」与 AI 助手「上下文」共用）；
  // 右键菜单没有 effect，提前到它之前调用不改变 effect 顺序
  const chapterMaterials = useChapterMaterials({
    ...workspaceState,
    ...entitiesState,
    ...derived,
  });
  const { contextMenuItems } = useContextMenuItems({
    ...workspaceState,
    ...entitiesState,
    ...uiState,
    ...loader,
    ...creation,
    ...entityActions,
    ...growthEntry,
    ...fileOps,
    ...projectExport,
    ...libraryGeneration,
    ...scopedGeneration,
    ...derived,
    ...chapterMaterials,
  });

  // ─── 助手上下文 / 工作区标签内容 ─────────────────────────────
  useScopedAssistantArtifacts({ ...aiState, ...derived });
  const assistantContext = useAssistantContext({
    ...aiState,
    ...derived,
    ...scopedGeneration,
    ...chapterMaterials,
    ...tabs,
  });
  const {
    workspaceTabLabels,
    editorCharacterHighlights,
    referenceFallback,
    referenceSource,
    specialTabContent,
  } = useWorkspaceTabContent({
    ...workspaceState,
    ...tabsState,
    ...editorState,
    ...entitiesState,
    ...derived,
    ...tabs,
    ...creation,
    ...entityActions,
    ...growthEntry,
    ...editor,
  });
  useOpenSettingsTabListener(uiState);
  // 应用菜单「关于」/ 状态栏「关于…」打开关于对话框；只设置显隐，无顺序依赖
  useAboutDialogListener(uiState);
  // 应用菜单命令（设置、检查更新、视图切换、查找、保存 / 另存为、帮助）；只订阅事件，无顺序依赖
  useAppMenu({ ...uiState, ...settingsState, ...layout, ...tabs, ...loader, ...fileOps });
  const { handleAssistantApplyFix, handleAssistantPreviewDiff } = useAssistantDialogHandlers({
    ...tabsState,
    ...editorState,
    ...aiState,
  });
  // 灵感抽签弹窗（工具栏按钮 / 快捷键 / 大纲版本来源）；只订阅打开事件，无顺序依赖
  const inspiration = useInspirationDialog(editorState);
  // 编辑器辅助（人物悬停卡片 / 续写）：读取当前作品的成长档案，只监听成长档案变化与文件保存事件
  const editorAssistApi = useEditorAssist({
    ...workspaceState,
    ...entitiesState,
    ...derived,
    ...tabs,
  });
  // 场景视频入口（文件栏按钮 / 卷纲条目 / 应用菜单 / 快捷键）；只订阅事件，无顺序依赖
  useSceneVideoEntry({ ...editorState, ...uiState, ...tabs, ...derived });

  return {
    workspaceState,
    tabsState,
    layoutState,
    editorState,
    aiState,
    entitiesState,
    settingsState,
    uiState,
    derived,
    layout,
    tabs,
    editorSession,
    settingsActions,
    loader,
    creation,
    entityActions,
    growthEntry,
    workScopeApi,
    fileOps,
    editor,
    projectExport,
    handlePopOutRightPanel,
    contextMenuItems,
    assistantContext,
    workspaceTabLabels,
    editorCharacterHighlights,
    referenceFallback,
    referenceSource,
    specialTabContent,
    handleAssistantApplyFix,
    handleAssistantPreviewDiff,
    inspiration,
    editorAssistApi,
  };
}
