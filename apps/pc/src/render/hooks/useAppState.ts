import { useState, useRef, useMemo, useReducer } from 'react';
import { type AISessionSnapshot, buildAISessionStorageKey } from '@/render/state/aiSessionSnapshot';
import type { AssistantArtifactGenerationStatus } from '@/render/utils/assistantGeneration';
import type {
  AssistantScopedCharacter,
  AssistantScopedLore,
  AssistantScopedMaterial,
  ContextMenuState,
  CreatingType,
  CursorPosition,
  KnowledgeExportOptions,
} from '@/render/app/types';
import type { Character, LoreEntry } from '@/render/components/RightPanel/types';
import { DEFAULT_SETTINGS_DRAFT, type SettingsDraft } from '@/render/utils/appSettings';
import type { EditorView } from '@codemirror/view';
import type { EditorViewportSnapshot } from '@/render/components/TextEditor';
import type { FileNode } from '@/render/types';
import type { SettingsTab } from '@/render/components/AppSettingsCenter';
import { type StoryOrderMap, createStoryOrderStorageKey } from '@/render/utils/workspace';
import { buildEditorSessionStorageKey } from '@/render/app/editorSession';
import { createAISessionChannel } from '@/render/utils/aiSessionChannel';
import {
  fixSessionSelectors,
  initialFixSessionState,
  reduceFixSession,
} from '@/render/state/fixSessionState';
import { useDialog } from '@/render/components/Dialog';
import { useToast } from '@/render/components/Toast';

// 显式命名上下文类型，便于声明文件输出（原始接口未导出）
type RawToastApi = ReturnType<typeof useToast>;
type RawDialogApi = ReturnType<typeof useDialog>;
export type ToastApi = Pick<RawToastApi, keyof RawToastApi>;
export type DialogApi = Pick<RawDialogApi, keyof RawDialogApi>;

/**
 * 应用根组件的全部共享状态、ref 与派生 key（只声明，不含副作用）
 */
export function useAppState() {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Tab management
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [untitledTabContents, setUntitledTabContents] = useState<Record<string, string>>({});
  const [initialViewportSnapshots, setInitialViewportSnapshots] = useState<
    Record<string, EditorViewportSnapshot>
  >({});
  const [filePanelRevealRequest, setFilePanelRevealRequest] = useState<{
    path: string;
    id: string;
  } | null>(null);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(
    DEFAULT_SETTINGS_DRAFT.general.collapseRightPanelOnStartup
  );
  const [rightPanelPoppedOut, setRightPanelPoppedOut] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [editorContent, setEditorContent] = useState('');
  const [cursorPosition, setCursorPosition] = useState<CursorPosition>({ line: 1, column: 1 });
  const [encoding, setEncoding] = useState('UTF-8');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [creatingType, setCreatingType] = useState<CreatingType>(null);
  const [clipboard, setClipboard] = useState<string[]>([]);
  const [scrollToLine, setScrollToLine] = useState<{ line: number; id: string } | null>(null);
  const [replaceLineRequest, setReplaceLineRequest] = useState<{
    line: number;
    text: string;
    id: number;
  } | null>(null);
  const [transientHighlightLine, setTransientHighlightLine] = useState<{
    line: number;
    id: string;
  } | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showSettingsCenter, setShowSettingsCenter] = useState(false);
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [settingsCenterTab, setSettingsCenterTab] = useState<SettingsTab>('general');
  const [appSettings, setAppSettings] = useState<SettingsDraft>(DEFAULT_SETTINGS_DRAFT);
  const [workspaceCharacters, setWorkspaceCharacters] = useState<Character[]>([]);
  const [workspaceLoreEntries, setWorkspaceLoreEntries] = useState<LoreEntry[]>([]);
  const [workspaceProjectName, setWorkspaceProjectName] = useState<string | null>(null);
  const [workspaceCharactersVersion, bumpWorkspaceCharactersVersion] = useReducer(
    (count: number) => count + 1,
    0
  );
  const [workspaceLoreVersion, bumpWorkspaceLoreVersion] = useReducer(
    (count: number) => count + 1,
    0
  );
  const [storyOrderMap, setStoryOrderMap] = useState<StoryOrderMap>({});
  const [chapterMaterialPaths, setChapterMaterialPaths] = useState<string[]>([]);
  const [materialUsageMap, setMaterialUsageMap] = useState<Record<string, string>>({});
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
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showKnowledgeExportDialog, setShowKnowledgeExportDialog] = useState(false);
  const [knowledgeExportOptions, setKnowledgeExportOptions] = useState<KnowledgeExportOptions>({
    includeCharacters: true,
    includeLore: true,
    includeMaterials: true,
  });
  const [editorReloadToken, setEditorReloadToken] = useState(0);
  const [fixState, dispatchFixCommand] = useReducer(reduceFixSession, initialFixSessionState);
  const [dbReady, setDbReady] = useState(false);

  // 修复流程状态（selector 只读）
  const inlineDiff = fixSessionSelectors.inlineDiff(fixState);
  const diffState = fixSessionSelectors.diffState(fixState);
  const pendingApplyQueue = fixSessionSelectors.pendingApplyQueue(fixState);
  // 编辑器 EditorView ref（用于精确事务替换）
  const editorViewRef = useRef<EditorView | null>(null);
  const aiSessionChannelRef = useRef<ReturnType<typeof createAISessionChannel> | null>(null);
  const aiSessionRef = useRef<AISessionSnapshot | null>(null);
  const aiSessionKey = useMemo(() => buildAISessionStorageKey(folderPath), [folderPath]);
  const editorSessionKey = useMemo(() => buildEditorSessionStorageKey(folderPath), [folderPath]);
  const storyOrderStorageKey = useMemo(() => createStoryOrderStorageKey(folderPath), [folderPath]);

  const [leftPanelWidth, setLeftPanelWidth] = useState(260);
  const [rightPanelWidth, setRightPanelWidth] = useState(300);

  // Untitled tab counter
  const untitledCounterRef = useRef(0);

  // Store pre-focus-mode state to restore when exiting
  const preFocusStateRef = useRef({
    sidebarCollapsed: false,
    rightPanelCollapsed: DEFAULT_SETTINGS_DRAFT.general.collapseRightPanelOnStartup,
  });

  const toast: ToastApi = useToast();
  const dialog: DialogApi = useDialog();

  const folderPathRef = useRef(folderPath);
  folderPathRef.current = folderPath;
  const appSettingsRef = useRef(appSettings);
  appSettingsRef.current = appSettings;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const filePanelRevealCounterRef = useRef(0);
  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs;
  const filesRef = useRef(files);
  filesRef.current = files;
  const storyOrderMapRef = useRef(storyOrderMap);
  storyOrderMapRef.current = storyOrderMap;
  const editorContentRef = useRef(editorContent);
  editorContentRef.current = editorContent;
  const editorViewportSnapshotsRef = useRef<Record<string, EditorViewportSnapshot>>({});
  const restoredEditorSessionKeyRef = useRef<string | null>(null);
  const editorSessionHydratedRef = useRef(false);
  const persistEditorSessionTimerRef = useRef<number | null>(null);
  const cleanedGeneratedMaterialFoldersRef = useRef<Set<string>>(new Set());
  // 通过 ref 间接引用 refreshCurrentFolder，避免跨声明顺序依赖（TDZ）
  const refreshCurrentFolderRef = useRef<(() => Promise<void>) | null>(null);

  // 侧边栏焦点跟踪（VS Code 风格：mousedown 判断是否在侧边栏区域内）
  const sidebarRef = useRef<HTMLDivElement>(null);
  const appMainRef = useRef<HTMLDivElement>(null);
  const sidebarFocusedRef = useRef(false);
  const sidebarCollapsedRef = useRef(sidebarCollapsed);
  sidebarCollapsedRef.current = sidebarCollapsed;
  const rightPanelCollapsedRef = useRef(rightPanelCollapsed);
  rightPanelCollapsedRef.current = rightPanelCollapsed;
  // Keep current width in refs to avoid stale closures in drag handlers
  const leftPanelWidthRef = useRef(leftPanelWidth);
  leftPanelWidthRef.current = leftPanelWidth;
  const rightPanelWidthRef = useRef(rightPanelWidth);
  rightPanelWidthRef.current = rightPanelWidth;

  return {
    files,
    setFiles,
    folderPath,
    setFolderPath,
    isLoading,
    setIsLoading,
    openTabs,
    setOpenTabs,
    activeTab,
    setActiveTab,
    untitledTabContents,
    setUntitledTabContents,
    initialViewportSnapshots,
    setInitialViewportSnapshots,
    filePanelRevealRequest,
    setFilePanelRevealRequest,
    sidebarCollapsed,
    setSidebarCollapsed,
    rightPanelCollapsed,
    setRightPanelCollapsed,
    rightPanelPoppedOut,
    setRightPanelPoppedOut,
    focusMode,
    setFocusMode,
    editorContent,
    setEditorContent,
    cursorPosition,
    setCursorPosition,
    encoding,
    setEncoding,
    contextMenu,
    setContextMenu,
    creatingType,
    setCreatingType,
    clipboard,
    setClipboard,
    scrollToLine,
    setScrollToLine,
    replaceLineRequest,
    setReplaceLineRequest,
    transientHighlightLine,
    setTransientHighlightLine,
    showShortcuts,
    setShowShortcuts,
    showSettingsCenter,
    setShowSettingsCenter,
    showAIAssistant,
    setShowAIAssistant,
    settingsCenterTab,
    setSettingsCenterTab,
    appSettings,
    setAppSettings,
    workspaceCharacters,
    setWorkspaceCharacters,
    workspaceLoreEntries,
    setWorkspaceLoreEntries,
    workspaceProjectName,
    setWorkspaceProjectName,
    workspaceCharactersVersion,
    bumpWorkspaceCharactersVersion,
    workspaceLoreVersion,
    bumpWorkspaceLoreVersion,
    storyOrderMap,
    setStoryOrderMap,
    chapterMaterialPaths,
    setChapterMaterialPaths,
    materialUsageMap,
    setMaterialUsageMap,
    assistantScopedCharacters,
    setAssistantScopedCharacters,
    assistantCharacterGenerationStatus,
    setAssistantCharacterGenerationStatus,
    assistantScopedLoreEntries,
    setAssistantScopedLoreEntries,
    assistantScopedMaterials,
    setAssistantScopedMaterials,
    showVersionHistory,
    setShowVersionHistory,
    showKnowledgeExportDialog,
    setShowKnowledgeExportDialog,
    knowledgeExportOptions,
    setKnowledgeExportOptions,
    editorReloadToken,
    setEditorReloadToken,
    fixState,
    dispatchFixCommand,
    dbReady,
    setDbReady,
    inlineDiff,
    diffState,
    pendingApplyQueue,
    editorViewRef,
    aiSessionChannelRef,
    aiSessionRef,
    aiSessionKey,
    editorSessionKey,
    storyOrderStorageKey,
    leftPanelWidth,
    setLeftPanelWidth,
    rightPanelWidth,
    setRightPanelWidth,
    untitledCounterRef,
    preFocusStateRef,
    toast,
    dialog,
    folderPathRef,
    appSettingsRef,
    activeTabRef,
    filePanelRevealCounterRef,
    openTabsRef,
    filesRef,
    storyOrderMapRef,
    editorContentRef,
    editorViewportSnapshotsRef,
    restoredEditorSessionKeyRef,
    editorSessionHydratedRef,
    persistEditorSessionTimerRef,
    cleanedGeneratedMaterialFoldersRef,
    refreshCurrentFolderRef,
    sidebarRef,
    appMainRef,
    sidebarFocusedRef,
    sidebarCollapsedRef,
    rightPanelCollapsedRef,
    leftPanelWidthRef,
    rightPanelWidthRef,
  };
}

export type AppState = ReturnType<typeof useAppState>;
