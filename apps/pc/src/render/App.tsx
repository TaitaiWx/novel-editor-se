import React, {
  Suspense,
  lazy,
  useState,
  useCallback,
  useRef,
  useMemo,
  useReducer,
  useEffect,
} from 'react';
import { EditorView } from '@codemirror/view';
import type { FileNode } from './types';
import TitleBar from './components/TitleBar';
import FilePanel, {
  type ObjectContextMenuEvent,
  type ObjectContextMenuTarget,
} from './components/FilePanel';
import ContentPanel from './components/ContentPanel';
import { PanelResizer } from './components/PanelResizer';
import { AIAssistantDialog } from './components/RightPanel/AIAssistantDialog';
import { AiConfigProvider } from './components/RightPanel/useAiConfig';
import StatusBar from './components/StatusBar';
import ContextMenu from './components/ContextMenu';
import ShortcutsHelp from './components/ShortcutsHelp';
import AppSettingsCenter from './components/AppSettingsCenter';
import type { SettingsTab } from './components/AppSettingsCenter';
import { useToast } from './components/Toast';
import { useDialog } from './components/Dialog';
import type { ContextMenuEvent } from './components/FileTree';
import styles from './App.module.scss';
import { initKeyboardShortcuts } from './components/ShortcutsHelp/shortcuts/initKeyboardShortcuts';
import { cleanupKeyboardShortcuts } from './components/ShortcutsHelp/shortcuts/cleanupKeyboardShortcuts';
import {
  preciseReplaceWithReport,
  formatPreciseReplaceReport,
  normalizedSearch as normalizedSearchInDoc,
} from './utils/preciseReplace';
import { createAISessionChannel } from './utils/aiSessionChannel';
import { useMessagePort } from './utils/useMessagePort';
import { useCrdtOpsSender } from './utils/useCrdtOpsChannel';
import { throttle } from './utils/throttle';
import type { ThrottledFunction } from './utils/throttle';
import { PortChannel } from '../shared/portChannels';
import type { EditorViewportSnapshot } from './components/TextEditor';
import type { PersistedOutlineScopeInput } from './types/electron-api';
import { setInlineDiffEffect } from './components/TextEditor/inline-diff';
import {
  createGraphLayoutStorageKey,
  createRelationStorageKey,
  extractJsonBlock,
  fnv1a32,
  mapCharacterRows,
  mergeCharacterGraphResults,
  normalizePersonName,
  parseCharacterAttributes,
  parseCharacterGraphAIResult,
  splitTextIntoChunks,
} from './components/RightPanel/utils';
import { buildLoreDedupKey, loadLoreEntriesByFolder } from './components/RightPanel/lore-data';
import type { Character, LoreEntry, CharacterGraphAIResult } from './components/RightPanel/types';
import {
  buildAISessionStorageKey,
  parseAISessionSnapshot,
  type AISessionSnapshot,
} from './state/aiSessionSnapshot';
import { isImeComposing } from './utils/ime';
import {
  createAssistantArtifactStorageKey,
  createChapterMaterialsStorageKey,
  createCharacterWorkspaceTab,
  createLoreWorkspaceTab,
  createStoryOrderStorageKey,
  createVolumeWorkspaceTab,
  findStoryParentPath,
  flattenFileNodes,
  isStoryFilePath,
  isWorkspaceTab,
  parseCharacterWorkspaceTab,
  parseLoreWorkspaceTab,
  parseVolumeWorkspaceTab,
  resolveOrderedStoryChildren,
  splitWorkspaceFiles,
  shouldEnableChapterAssistant,
  type AssistantScopeKind,
  type StoryOrderMap,
  WORKSPACE_TAB_CHARACTERS,
  WORKSPACE_TAB_LABELS,
  WORKSPACE_TAB_LORE,
} from './utils/workspace';
import { splitChapters } from './utils/chapterSplitter';
import {
  reduceFixSession,
  initialFixSessionState,
  fixSessionSelectors,
  type FixDiffState,
} from './state/fixSessionState';
import {
  type SettingsDraft,
  DEFAULT_SETTINGS_DRAFT,
  SETTINGS_STORAGE_KEY,
  matchShortcutEvent,
  mergeSettingsDraft,
} from './utils/appSettings';

const VersionTimeline = lazy(() => import('./components/VersionTimeline'));
const DiffEditor = lazy(() => import('./components/DiffEditor'));
const RightPanel = lazy(() => import('./components/RightPanel'));
const CharactersView = lazy(() =>
  import('./components/RightPanel/CharactersView').then((module) => ({
    default: module.CharactersView,
  }))
);
const LoreView = lazy(() =>
  import('./components/RightPanel/LoreView').then((module) => ({ default: module.LoreView }))
);
const VolumeWorkspaceView = lazy(() => import('./components/VolumeWorkspaceView'));

type CreatingType = 'file' | 'directory' | null;
type StoryCreateKind = 'volume' | 'chapter' | 'draft-folder' | 'draft';
type AIGenerationScope = 'current-content' | 'current-chapter' | 'whole-project';

interface AssistantScopeTarget {
  kind: AssistantScopeKind;
  path: string;
  label: string;
}

interface AssistantScopedCharacter {
  name: string;
  role: string;
  description: string;
}

interface GeneratedLoreDraft {
  category: LoreEntry['category'];
  title: string;
  summary: string;
  tags: string[];
}

interface AssistantScopedLore {
  category: LoreEntry['category'];
  title: string;
  summary: string;
}

interface GeneratedMaterialDraft {
  title: string;
  summary: string;
  kind: 'reference' | 'scene' | 'character' | 'setting' | 'research';
  relatedChapter?: string;
  keywords: string[];
}

interface AssistantScopedMaterial {
  title: string;
  summary: string;
  kind: GeneratedMaterialDraft['kind'];
  relatedChapter?: string;
}

function findNodeInTree(nodes: FileNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children) {
      const found = findNodeInTree(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

function isDraftLikeName(name: string): boolean {
  return /(draft|sample|test|outline|note|草稿|样稿|测试|片段|提纲|灵感)/i.test(name);
}

function isVolumeLikeName(name: string): boolean {
  return /(^第[一二三四五六七八九十百千万零〇\d]+卷)|(^volume\s*\d+)|(^part\s*\d+)|(^act\s*\d+)|(^卷[\s_-]?\d+)/i.test(
    name.replace(/\.[^.]+$/, '')
  );
}

function isMaterialLikeName(name: string): boolean {
  return /(资料|素材|media|material|materials|asset|assets|reference|references|research|image|images|doc|docs|pdf)/i.test(
    name
  );
}

function ensureMarkdownFileName(name: string): string {
  return /\.[^./\\]+$/.test(name) ? name : `${name}.md`;
}

const INVALID_FILE_NAME_CHARACTERS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

function sanitizeBaseName(name: string): string {
  // 逐字符清洗文件名，避免依赖复杂正则并兼容 Windows 非法文件名字符规则。
  const sanitizedCharacters: string[] = [];

  for (const character of name) {
    const codePoint = character.codePointAt(0) ?? 0;
    const isControlCharacter = codePoint >= 0 && codePoint <= 0x1f;

    sanitizedCharacters.push(
      isControlCharacter || INVALID_FILE_NAME_CHARACTERS.has(character) ? ' ' : character
    );
  }

  return sanitizedCharacters.join('').replace(/\s+/g, ' ').trim();
}

function buildUniqueMarkdownName(baseName: string, existingNames: Set<string>): string {
  const normalizedBase = sanitizeBaseName(baseName) || '未命名';
  let candidate = ensureMarkdownFileName(normalizedBase);
  if (!existingNames.has(candidate)) {
    existingNames.add(candidate);
    return candidate;
  }
  let index = 2;
  while (existingNames.has(ensureMarkdownFileName(`${normalizedBase}-${index}`))) {
    index += 1;
  }
  candidate = ensureMarkdownFileName(`${normalizedBase}-${index}`);
  existingNames.add(candidate);
  return candidate;
}

function getAIGenerationScopeLabel(scope: AIGenerationScope): string {
  switch (scope) {
    case 'current-content':
      return '当前内容';
    case 'current-chapter':
      return '当前章节';
    case 'whole-project':
      return '整部作品';
    default:
      return '当前内容';
  }
}

function parseLoreGenerationResult(raw: string): GeneratedLoreDraft[] {
  const json = extractJsonBlock(raw);
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as {
      entries?: Array<{
        category?: string;
        title?: string;
        summary?: string;
        tags?: string[];
      }>;
    };
    return (parsed.entries || [])
      .map(
        (item): GeneratedLoreDraft => ({
          category:
            item.category === 'world' ||
            item.category === 'faction' ||
            item.category === 'system' ||
            item.category === 'term'
              ? item.category
              : 'world',
          title: item.title?.trim() || '',
          summary: item.summary?.trim() || '',
          tags: Array.isArray(item.tags)
            ? item.tags
                .filter((tag): tag is string => typeof tag === 'string')
                .map((tag) => tag.trim())
            : [],
        })
      )
      .filter((item) => item.title);
  } catch {
    return [];
  }
}

function parseMaterialGenerationResult(raw: string): GeneratedMaterialDraft[] {
  const json = extractJsonBlock(raw);
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as {
      materials?: Array<{
        title?: string;
        summary?: string;
        kind?: string;
        relatedChapter?: string;
        keywords?: string[];
      }>;
    };
    return (parsed.materials || [])
      .map(
        (item): GeneratedMaterialDraft => ({
          title: item.title?.trim() || '',
          summary: item.summary?.trim() || '',
          kind:
            item.kind === 'scene' ||
            item.kind === 'character' ||
            item.kind === 'setting' ||
            item.kind === 'research'
              ? item.kind
              : 'reference',
          relatedChapter: item.relatedChapter?.trim() || '',
          keywords: Array.isArray(item.keywords)
            ? item.keywords
                .filter((keyword): keyword is string => typeof keyword === 'string')
                .map((keyword) => keyword.trim())
                .filter(Boolean)
            : [],
        })
      )
      .filter((item) => item.title && item.summary);
  } catch {
    return [];
  }
}

function getParentDirectory(path: string): string | null {
  const normalized = path.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash > 0 ? normalized.slice(0, lastSlash) : null;
}

function getFileExtension(name: string): string {
  const matched = name.match(/(\.[^./\\]+)$/);
  return matched ? matched[1] : '';
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

interface CursorPosition {
  line: number;
  column: number;
}

type ContextMenuTargetState =
  | { kind: 'background' }
  | { kind: 'file'; node: FileNode }
  | { kind: 'object'; target: ObjectContextMenuTarget };

interface ContextMenuState {
  x: number;
  y: number;
  target: ContextMenuTargetState;
}

interface PersistedEditorSession {
  openTabs: string[];
  activeTab: string | null;
  viewportSnapshots: Record<string, EditorViewportSnapshot>;
}

function isUntitledTabPath(path: string | null): boolean {
  return typeof path === 'string' && path.startsWith('__untitled__:');
}

function isChangelogTabPath(path: string | null): boolean {
  return typeof path === 'string' && path.startsWith('__changelog__:');
}

function buildEditorSessionStorageKey(folderPath: string | null): string | null {
  return folderPath ? `novel-editor:editor-session:${folderPath}` : null;
}

const CHAPTER_MATERIALS_STORAGE_PREFIX = 'novel-editor:chapter-materials:';

function parseAssistantScopedCharacters(raw: string | null): AssistantScopedCharacter[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as AssistantScopedCharacter[];
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (item): item is AssistantScopedCharacter =>
              Boolean(item) && typeof item.name === 'string' && item.name.trim().length > 0
          )
          .map((item) => ({
            name: item.name.trim(),
            role: item.role?.trim() || '',
            description: item.description?.trim() || '',
          }))
      : [];
  } catch {
    return [];
  }
}

function parseAssistantScopedLore(raw: string | null): AssistantScopedLore[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as AssistantScopedLore[];
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (item): item is AssistantScopedLore =>
              Boolean(item) && typeof item.title === 'string' && item.title.trim().length > 0
          )
          .map((item) => ({
            category:
              item.category === 'world' ||
              item.category === 'faction' ||
              item.category === 'system' ||
              item.category === 'term'
                ? item.category
                : 'world',
            title: item.title.trim(),
            summary: item.summary?.trim() || '',
          }))
      : [];
  } catch {
    return [];
  }
}

function parseAssistantScopedMaterials(raw: string | null): AssistantScopedMaterial[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as AssistantScopedMaterial[];
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (item): item is AssistantScopedMaterial =>
              Boolean(item) && typeof item.title === 'string' && item.title.trim().length > 0
          )
          .map((item) => ({
            title: item.title.trim(),
            summary: item.summary?.trim() || '',
            kind:
              item.kind === 'scene' ||
              item.kind === 'character' ||
              item.kind === 'setting' ||
              item.kind === 'research'
                ? item.kind
                : 'reference',
            relatedChapter: item.relatedChapter?.trim() || '',
          }))
      : [];
  } catch {
    return [];
  }
}

function normalizeWorkspacePath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

function isPathInWorkspace(path: string, folderPath: string): boolean {
  const normalizedFolder = normalizeWorkspacePath(folderPath).replace(/\/+$/, '');
  const normalizedPath = normalizeWorkspacePath(path);
  return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
}

function getNodeDisplayName(path: string): string {
  const fileName = path.split('/').pop() || path.split('\\').pop() || path;
  return fileName.replace(/\.[^.]+$/, '');
}

function formatMaterialUsageLabel(chapterNames: string[]): string {
  const unique = Array.from(new Set(chapterNames.filter(Boolean)));
  if (unique.length === 0) return '';
  if (unique.length <= 2) {
    return `用于 ${unique.join('、')}`;
  }
  return `用于 ${unique.slice(0, 2).join('、')} 等 ${unique.length} 章`;
}

function parseStoryOrderMap(raw: string | null): StoryOrderMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).map(([path, value]) => [
        path,
        Array.from(
          new Set(
            Array.isArray(value)
              ? value.filter(
                  (item): item is string => typeof item === 'string' && item.trim().length > 0
                )
              : []
          )
        ),
      ])
    );
  } catch {
    return {};
  }
}

function replacePathPrefix(path: string, oldPath: string, newPath: string): string {
  if (path === oldPath) return newPath;
  if (path.startsWith(`${oldPath}/`) || path.startsWith(`${oldPath}\\`)) {
    return `${newPath}${path.slice(oldPath.length)}`;
  }
  return path;
}

function remapWorkspaceTabPath(path: string, oldPath: string, newPath: string): string {
  const volumePath = parseVolumeWorkspaceTab(path);
  if (volumePath) {
    const nextVolumePath = replacePathPrefix(volumePath, oldPath, newPath);
    return nextVolumePath === volumePath ? path : createVolumeWorkspaceTab(nextVolumePath);
  }
  return replacePathPrefix(path, oldPath, newPath);
}

function isPathSameOrDescendant(path: string, parentPath: string): boolean {
  return (
    path === parentPath || path.startsWith(`${parentPath}/`) || path.startsWith(`${parentPath}\\`)
  );
}

function buildUniqueMovedName(originalName: string, siblingNames: Set<string>): string {
  if (!siblingNames.has(originalName)) return originalName;

  const extension = getFileExtension(originalName);
  const baseName = extension ? stripExtension(originalName) : originalName;
  let index = 2;
  let candidateName = `${baseName}-${index}${extension}`;

  while (siblingNames.has(candidateName)) {
    index += 1;
    candidateName = `${baseName}-${index}${extension}`;
  }

  return candidateName;
}

function remapStoryOrderMapPaths(
  storyOrderMap: StoryOrderMap,
  oldPath: string,
  newPath: string
): StoryOrderMap {
  return Object.fromEntries(
    Object.entries(storyOrderMap).map(([parentPath, orderedPaths]) => [
      replacePathPrefix(parentPath, oldPath, newPath),
      Array.from(
        new Set(orderedPaths.map((itemPath) => replacePathPrefix(itemPath, oldPath, newPath)))
      ),
    ])
  );
}

function moveStoryPathRelative(
  orderedPaths: string[],
  sourcePath: string,
  targetPath: string,
  mode: 'before' | 'after'
): string[] {
  const nextPaths = [...orderedPaths];
  const sourceIndex = nextPaths.indexOf(sourcePath);
  const targetIndex = nextPaths.indexOf(targetPath);

  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return orderedPaths;
  }

  const [movedPath] = nextPaths.splice(sourceIndex, 1);
  const nextTargetIndex = nextPaths.indexOf(targetPath);
  if (!movedPath || nextTargetIndex < 0) {
    return orderedPaths;
  }
  nextPaths.splice(mode === 'after' ? nextTargetIndex + 1 : nextTargetIndex, 0, movedPath);
  return nextPaths;
}

function areCharactersEqual(left: Character[], right: Character[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const next = right[index];
    return (
      item.id === next.id &&
      item.name === next.name &&
      item.role === next.role &&
      item.description === next.description &&
      item.avatar === next.avatar
    );
  });
}

function areLoreEntriesEqual(left: LoreEntry[], right: LoreEntry[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const next = right[index];
    return (
      item.id === next.id &&
      item.title === next.title &&
      item.summary === next.summary &&
      item.category === next.category &&
      item.createdAt === next.createdAt &&
      item.updatedAt === next.updatedAt &&
      item.tags.length === next.tags.length &&
      item.tags.every((tag, tagIndex) => tag === next.tags[tagIndex])
    );
  });
}

function parseEditorSessionSnapshot(raw: string | null): PersistedEditorSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedEditorSession>;
    return {
      openTabs: Array.isArray(parsed.openTabs)
        ? parsed.openTabs.filter((item): item is string => typeof item === 'string')
        : [],
      activeTab: typeof parsed.activeTab === 'string' ? parsed.activeTab : null,
      viewportSnapshots:
        parsed.viewportSnapshots && typeof parsed.viewportSnapshots === 'object'
          ? Object.fromEntries(
              Object.entries(parsed.viewportSnapshots).filter(
                ([path, snapshot]) =>
                  typeof path === 'string' &&
                  snapshot !== null &&
                  typeof snapshot === 'object' &&
                  typeof (snapshot as EditorViewportSnapshot).anchor === 'number' &&
                  typeof (snapshot as EditorViewportSnapshot).head === 'number' &&
                  typeof (snapshot as EditorViewportSnapshot).scrollTop === 'number' &&
                  typeof (snapshot as EditorViewportSnapshot).scrollLeft === 'number'
              )
            )
          : {},
    };
  } catch {
    return null;
  }
}

function sameViewportSnapshot(
  left: EditorViewportSnapshot | undefined,
  right: EditorViewportSnapshot
): boolean {
  return Boolean(
    left &&
      left.anchor === right.anchor &&
      left.head === right.head &&
      left.scrollTop === right.scrollTop &&
      left.scrollLeft === right.scrollLeft
  );
}

const App: React.FC = () => {
  const hasReportedRendererReadyRef = useRef(false);
  const hasReportedRendererHealthReadyRef = useRef(false);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Tab management
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [initialViewportSnapshots, setInitialViewportSnapshots] = useState<
    Record<string, EditorViewportSnapshot>
  >({});

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
  const [assistantScopedLoreEntries, setAssistantScopedLoreEntries] = useState<
    AssistantScopedLore[]
  >([]);
  const [assistantScopedMaterials, setAssistantScopedMaterials] = useState<
    AssistantScopedMaterial[]
  >([]);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
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

  // Panel resize widths (VSCode-style draggable 3-pane layout)
  // Left/right panels have NO minimum — they auto-collapse when dragged below threshold (VSCode behavior)
  const LEFT_COLLAPSED_WIDTH = 36;
  const RIGHT_COLLAPSED_WIDTH = 32;
  const LEFT_COLLAPSE_THRESHOLD = 100;
  const RIGHT_COLLAPSE_THRESHOLD = 120;
  const LEFT_MAX = 480;
  const RIGHT_MAX = 520;
  const CENTER_MIN = 320;
  const [leftPanelWidth, setLeftPanelWidth] = useState(260);
  const [rightPanelWidth, setRightPanelWidth] = useState(300);

  // Untitled tab counter
  const untitledCounterRef = useRef(0);

  // Store pre-focus-mode state to restore when exiting
  const preFocusStateRef = useRef({
    sidebarCollapsed: false,
    rightPanelCollapsed: DEFAULT_SETTINGS_DRAFT.general.collapseRightPanelOnStartup,
  });

  const toast = useToast();
  const dialog = useDialog();

  useEffect(() => {
    if (hasReportedRendererReadyRef.current) return;
    hasReportedRendererReadyRef.current = true;
    window.electron?.ipcRenderer?.invoke('app-renderer-ready').catch(() => undefined);
  }, []);

  useEffect(() => {
    if (hasReportedRendererHealthReadyRef.current) return;
    hasReportedRendererHealthReadyRef.current = true;

    let cancelled = false;
    let idleId: number | null = null;
    let raf1 = 0;
    let raf2 = 0;
    let timeoutId: number | null = null;

    const reportRendererHealth = () => {
      if (cancelled) return;
      window.electron?.ipcRenderer?.invoke('app-renderer-health-ready').catch(() => undefined);
    };

    const scheduleFallback = () => {
      raf1 = window.requestAnimationFrame(() => {
        raf2 = window.requestAnimationFrame(reportRendererHealth);
      });
    };

    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(reportRendererHealth, { timeout: 3000 });
      timeoutId = window.setTimeout(scheduleFallback, 3200);
    } else {
      scheduleFallback();
    }

    return () => {
      cancelled = true;
      if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
      if (raf1) window.cancelAnimationFrame(raf1);
      if (raf2) window.cancelAnimationFrame(raf2);
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  const folderPathRef = useRef(folderPath);
  folderPathRef.current = folderPath;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
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

  React.useEffect(() => {
    let cancelled = false;
    const ipc = window.electron?.ipcRenderer;

    if (!ipc || !storyOrderStorageKey) {
      storyOrderMapRef.current = {};
      setStoryOrderMap({});
      return;
    }

    const loadStoryOrderMap = async () => {
      try {
        const raw = (await ipc.invoke('db-settings-get', storyOrderStorageKey)) as string | null;
        if (cancelled) return;
        const nextStoryOrderMap = parseStoryOrderMap(raw);
        storyOrderMapRef.current = nextStoryOrderMap;
        setStoryOrderMap(nextStoryOrderMap);
      } catch {
        if (cancelled) return;
        storyOrderMapRef.current = {};
        setStoryOrderMap({});
      }
    };

    void loadStoryOrderMap();
    return () => {
      cancelled = true;
    };
  }, [storyOrderStorageKey]);

  const syncInitialViewportSnapshots = useCallback(
    (next: Record<string, EditorViewportSnapshot>) => {
      editorViewportSnapshotsRef.current = next;
      setInitialViewportSnapshots(next);
    },
    []
  );

  const isPersistableTabPath = useCallback((path: string | null, nodes: FileNode[]): boolean => {
    if (!path || isUntitledTabPath(path)) return false;
    if (isChangelogTabPath(path)) return true;
    const node = findNodeInTree(nodes, path);
    return node?.type === 'file';
  }, []);

  const schedulePersistEditorSession = useCallback(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc || !editorSessionKey || !editorSessionHydratedRef.current) return;

    const persistedActiveTab = isPersistableTabPath(activeTabRef.current, filesRef.current)
      ? activeTabRef.current
      : null;
    const persistedOpenTabs = openTabsRef.current.filter((path) =>
      isPersistableTabPath(path, filesRef.current)
    );
    const nextOpenTabs = persistedActiveTab
      ? Array.from(new Set([...persistedOpenTabs, persistedActiveTab]))
      : persistedOpenTabs;
    const viewportSnapshots = Object.fromEntries(
      Object.entries(editorViewportSnapshotsRef.current).filter(([path]) =>
        isPersistableTabPath(path, filesRef.current)
      )
    ) as Record<string, EditorViewportSnapshot>;
    const nextSession: PersistedEditorSession = {
      openTabs: nextOpenTabs,
      activeTab: persistedActiveTab,
      viewportSnapshots,
    };

    if (persistEditorSessionTimerRef.current) {
      window.clearTimeout(persistEditorSessionTimerRef.current);
    }
    persistEditorSessionTimerRef.current = window.setTimeout(() => {
      ipc.invoke('db-settings-set', editorSessionKey, JSON.stringify(nextSession)).catch(() => {});
    }, 180);
  }, [editorSessionKey, isPersistableTabPath]);

  const persistStoryOrderMap = useCallback(async (nextStoryOrderMap: StoryOrderMap) => {
    const ipc = window.electron?.ipcRenderer;
    const storageKey = createStoryOrderStorageKey(folderPathRef.current);
    if (!ipc || !storageKey) return;
    await ipc.invoke('db-settings-set', storageKey, JSON.stringify(nextStoryOrderMap));
  }, []);

  const remapPathReferences = useCallback(
    (oldPath: string, newPath: string) => {
      if (oldPath === newPath) return;

      setOpenTabs((prev) =>
        Array.from(new Set(prev.map((tabPath) => remapWorkspaceTabPath(tabPath, oldPath, newPath))))
      );

      const nextActiveTab = remapWorkspaceTabPath(activeTabRef.current || '', oldPath, newPath);
      if (activeTabRef.current && nextActiveTab !== activeTabRef.current) {
        setActiveTab(nextActiveTab);
      }

      const currentSnapshots = editorViewportSnapshotsRef.current;
      let changed = false;
      const nextSnapshots = Object.fromEntries(
        Object.entries(currentSnapshots).map(([path, snapshot]) => {
          const nextPath = replacePathPrefix(path, oldPath, newPath);
          if (nextPath !== path) changed = true;
          return [nextPath, snapshot];
        })
      ) as Record<string, EditorViewportSnapshot>;

      if (changed) {
        syncInitialViewportSnapshots(nextSnapshots);
        schedulePersistEditorSession();
      }
    },
    [schedulePersistEditorSession, syncInitialViewportSnapshots]
  );

  const moveViewportSnapshot = useCallback(
    (fromPath: string, toPath: string) => {
      if (fromPath === toPath) return;
      const current = editorViewportSnapshotsRef.current;
      const snapshot = current[fromPath];
      if (!snapshot) return;
      const next = { ...current, [toPath]: snapshot };
      delete next[fromPath];
      syncInitialViewportSnapshots(next);
      schedulePersistEditorSession();
    },
    [schedulePersistEditorSession, syncInitialViewportSnapshots]
  );

  const removeViewportSnapshots = useCallback(
    (predicate: (path: string) => boolean) => {
      const current = editorViewportSnapshotsRef.current;
      let changed = false;
      const next = Object.fromEntries(
        Object.entries(current).filter(([path, snapshot]) => {
          const keep = !predicate(path);
          if (!keep) changed = true;
          return keep && Boolean(snapshot);
        })
      ) as Record<string, EditorViewportSnapshot>;
      if (changed) {
        syncInitialViewportSnapshots(next);
        schedulePersistEditorSession();
      }
    },
    [schedulePersistEditorSession, syncInitialViewportSnapshots]
  );

  const handleViewportSnapshotChange = useCallback(
    (filePath: string, snapshot: EditorViewportSnapshot) => {
      const previous = editorViewportSnapshotsRef.current[filePath];
      if (sameViewportSnapshot(previous, snapshot)) return;
      editorViewportSnapshotsRef.current = {
        ...editorViewportSnapshotsRef.current,
        [filePath]: snapshot,
      };
      schedulePersistEditorSession();
    },
    [schedulePersistEditorSession]
  );

  React.useEffect(() => {
    if (!editorSessionKey) {
      restoredEditorSessionKeyRef.current = null;
      editorSessionHydratedRef.current = false;
      syncInitialViewportSnapshots({});
      return;
    }

    restoredEditorSessionKeyRef.current = null;
    editorSessionHydratedRef.current = false;
    syncInitialViewportSnapshots({});
  }, [editorSessionKey, syncInitialViewportSnapshots]);

  React.useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc || !editorSessionKey) return;
    if (restoredEditorSessionKeyRef.current === editorSessionKey) return;

    let cancelled = false;
    const restoreEditorSession = async () => {
      try {
        const raw = (await ipc.invoke('db-settings-get', editorSessionKey)) as string | null;
        if (cancelled) return;
        const parsed = parseEditorSessionSnapshot(raw);
        if (parsed) {
          const restoredOpenTabs = parsed.openTabs.filter((path) =>
            isPersistableTabPath(path, files)
          );
          const restoredActiveTab = isPersistableTabPath(parsed.activeTab, files)
            ? parsed.activeTab
            : null;
          const nextOpenTabs = restoredActiveTab
            ? Array.from(new Set([...restoredOpenTabs, restoredActiveTab]))
            : restoredOpenTabs;
          const nextViewportSnapshots = Object.fromEntries(
            Object.entries(parsed.viewportSnapshots).filter(([path]) =>
              isPersistableTabPath(path, files)
            )
          ) as Record<string, EditorViewportSnapshot>;

          syncInitialViewportSnapshots(nextViewportSnapshots);
          setOpenTabs(nextOpenTabs);
          setActiveTab(restoredActiveTab || nextOpenTabs[nextOpenTabs.length - 1] || null);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) {
          restoredEditorSessionKeyRef.current = editorSessionKey;
          editorSessionHydratedRef.current = true;
        }
      }
    };

    void restoreEditorSession();
    return () => {
      cancelled = true;
    };
  }, [editorSessionKey, files, isPersistableTabPath, syncInitialViewportSnapshots]);

  React.useEffect(() => {
    schedulePersistEditorSession();
  }, [openTabs, activeTab, schedulePersistEditorSession]);

  React.useEffect(() => {
    return () => {
      if (persistEditorSessionTimerRef.current) {
        window.clearTimeout(persistEditorSessionTimerRef.current);
      }
    };
  }, []);

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

  const resolvePaneLayout = useCallback(
    (options?: {
      nextSidebarCollapsed?: boolean;
      nextRightPanelCollapsed?: boolean;
      preferExpanding?: 'left' | 'right';
    }) => {
      const containerWidth = appMainRef.current?.offsetWidth ?? 0;

      let nextSidebarCollapsed = options?.nextSidebarCollapsed ?? sidebarCollapsedRef.current;
      let nextRightPanelCollapsed =
        options?.nextRightPanelCollapsed ?? rightPanelCollapsedRef.current;
      let nextLeftWidth = Math.min(LEFT_MAX, leftPanelWidthRef.current);
      let nextRightWidth = Math.min(RIGHT_MAX, rightPanelWidthRef.current);

      if (containerWidth > 0) {
        const availableForSides = Math.max(0, containerWidth - CENTER_MIN);
        // First pass: keep both sides visible whenever possible by shrinking widths.
        if (!nextSidebarCollapsed && !nextRightPanelCollapsed) {
          const desiredTotal = nextLeftWidth + nextRightWidth;
          if (desiredTotal > availableForSides) {
            if (options?.preferExpanding === 'right') {
              nextLeftWidth = Math.max(0, availableForSides - nextRightWidth);
              if (nextLeftWidth + nextRightWidth > availableForSides) {
                nextRightWidth = Math.max(0, availableForSides - nextLeftWidth);
              }
            } else {
              nextRightWidth = Math.max(0, availableForSides - nextLeftWidth);
              if (nextLeftWidth + nextRightWidth > availableForSides) {
                nextLeftWidth = Math.max(0, availableForSides - nextRightWidth);
              }
            }
          }

          // Only collapse as a last resort when one side has effectively no drawable width.
          if (nextLeftWidth <= 0.5 && availableForSides > RIGHT_COLLAPSED_WIDTH) {
            nextSidebarCollapsed = true;
          }
          if (nextRightWidth <= 0.5 && availableForSides > LEFT_COLLAPSED_WIDTH) {
            nextRightPanelCollapsed = true;
          }
        }

        // Second pass: enforce center minimum with collapsed side widths if one side is hidden.
        if (!nextSidebarCollapsed && nextRightPanelCollapsed) {
          nextLeftWidth = Math.min(
            LEFT_MAX,
            Math.max(0, availableForSides - RIGHT_COLLAPSED_WIDTH)
          );
          if (nextLeftWidth <= 0.5) nextSidebarCollapsed = true;
        } else if (nextSidebarCollapsed && !nextRightPanelCollapsed) {
          nextRightWidth = Math.min(
            RIGHT_MAX,
            Math.max(0, availableForSides - LEFT_COLLAPSED_WIDTH)
          );
          if (nextRightWidth <= 0.5) nextRightPanelCollapsed = true;
        }
      }

      if (sidebarCollapsedRef.current !== nextSidebarCollapsed) {
        setSidebarCollapsed(nextSidebarCollapsed);
      }
      if (rightPanelCollapsedRef.current !== nextRightPanelCollapsed) {
        setRightPanelCollapsed(nextRightPanelCollapsed);
      }
      if (Math.abs(leftPanelWidthRef.current - nextLeftWidth) > 0.5) {
        setLeftPanelWidth(nextLeftWidth);
      }
      if (Math.abs(rightPanelWidthRef.current - nextRightWidth) > 0.5) {
        setRightPanelWidth(nextRightWidth);
      }
    },
    [CENTER_MIN, LEFT_COLLAPSED_WIDTH, LEFT_MAX, RIGHT_COLLAPSED_WIDTH, RIGHT_MAX]
  );

  const handleExpandSidebar = useCallback(() => {
    resolvePaneLayout({ nextSidebarCollapsed: false, preferExpanding: 'left' });
  }, [resolvePaneLayout]);

  const handleCollapseSidebar = useCallback(() => {
    setSidebarCollapsed(true);
  }, []);

  const handleToggleSidebar = useCallback(() => {
    if (sidebarCollapsedRef.current) {
      handleExpandSidebar();
      return;
    }
    handleCollapseSidebar();
  }, [handleCollapseSidebar, handleExpandSidebar]);

  const handleLeftResizerMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = leftPanelWidthRef.current;
    const onMouseMove = (ev: MouseEvent) => {
      const next = startWidth + (ev.clientX - startX);
      // Auto-collapse when dragged below threshold (VSCode behavior)
      if (next < LEFT_COLLAPSE_THRESHOLD) {
        setSidebarCollapsed(true);
        return;
      }
      const containerWidth = appMainRef.current?.offsetWidth ?? 0;
      const rightWidth = rightPanelCollapsedRef.current
        ? RIGHT_COLLAPSED_WIDTH
        : rightPanelWidthRef.current;
      const maxAllowed = containerWidth - CENTER_MIN - rightWidth;

      // Expanding left panel can force right panel to auto-collapse to preserve center minimum width.
      if (next > maxAllowed && !rightPanelCollapsedRef.current) {
        setRightPanelCollapsed(true);
        const maxAfterCollapse = containerWidth - CENTER_MIN - RIGHT_COLLAPSED_WIDTH;
        setLeftPanelWidth(Math.min(LEFT_MAX, maxAfterCollapse, next));
        return;
      }

      setLeftPanelWidth(Math.min(LEFT_MAX, maxAllowed, next));
      if (sidebarCollapsedRef.current) setSidebarCollapsed(false);
    };
    const cleanup = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', cleanup);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', cleanup);
  }, []);

  const handleRightResizerMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = rightPanelWidthRef.current;
    const onMouseMove = (ev: MouseEvent) => {
      // Dragging the right resizer leftward enlarges the right panel
      const next = startWidth - (ev.clientX - startX);
      // Auto-collapse when dragged below threshold
      if (next < RIGHT_COLLAPSE_THRESHOLD) {
        setRightPanelCollapsed(true);
        return;
      }
      const containerWidth = appMainRef.current?.offsetWidth ?? 0;
      const leftWidth = sidebarCollapsedRef.current
        ? LEFT_COLLAPSED_WIDTH
        : leftPanelWidthRef.current;
      const maxAllowed = containerWidth - CENTER_MIN - leftWidth;

      // Expanding right panel can force left panel to auto-collapse to preserve center minimum width.
      if (next > maxAllowed && !sidebarCollapsedRef.current) {
        setSidebarCollapsed(true);
        const maxAfterCollapse = containerWidth - CENTER_MIN - LEFT_COLLAPSED_WIDTH;
        setRightPanelWidth(Math.min(RIGHT_MAX, maxAfterCollapse, next));
        return;
      }

      setRightPanelWidth(Math.min(RIGHT_MAX, maxAllowed, next));
      if (rightPanelCollapsedRef.current) setRightPanelCollapsed(false);
    };
    const cleanup = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', cleanup);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', cleanup);
  }, []);

  React.useEffect(() => {
    const onResize = () => resolvePaneLayout();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [resolvePaneLayout]);

  const initializeProjectStore = useCallback(async (projectFolderPath: string) => {
    if (!window.electron?.ipcRenderer) return;
    const dbDir = `${projectFolderPath}/.novel-editor`;
    await window.electron.ipcRenderer.invoke('db-init', dbDir);
    const existing = await window.electron.ipcRenderer.invoke(
      'db-novel-get-by-folder',
      projectFolderPath
    );
    if (!existing) {
      const projectName = projectFolderPath.split('/').pop() || projectFolderPath;
      await window.electron.ipcRenderer.invoke(
        'db-novel-create',
        projectName,
        projectFolderPath,
        ''
      );
    }
  }, []);

  // Tab helpers
  const openFileInTab = useCallback((filePath: string) => {
    setOpenTabs((prev) => {
      if (prev.includes(filePath)) return prev;
      return [...prev, filePath];
    });
    setActiveTab(filePath);
  }, []);

  const closeTab = useCallback((filePath: string) => {
    setOpenTabs((prev) => {
      const newTabs = prev.filter((t) => t !== filePath);
      // If we're closing the active tab, activate adjacent tab
      if (activeTabRef.current === filePath) {
        const closedIndex = prev.indexOf(filePath);
        const nextTab = newTabs[Math.min(closedIndex, newTabs.length - 1)] || null;
        setActiveTab(nextTab);
      }
      return newTabs;
    });
  }, []);

  // Create new untitled tab (Cmd+N, like VS Code)
  const handleNewTab = useCallback(() => {
    const num = ++untitledCounterRef.current;
    const untitledPath = `__untitled__:Untitled-${num}`;
    setOpenTabs((prev) => [...prev, untitledPath]);
    setActiveTab(untitledPath);
  }, []);

  // Focus mode toggle (uses refs for stable closure — no deps on panel state)
  const toggleFocusMode = useCallback(() => {
    setFocusMode((prev) => {
      if (!prev) {
        // 进入专注模式：如果没有打开的 tab，自动新建一个
        if (openTabsRef.current.length === 0) {
          const num = ++untitledCounterRef.current;
          const untitledPath = `__untitled__:Untitled-${num}`;
          setOpenTabs([untitledPath]);
          setActiveTab(untitledPath);
        }
        preFocusStateRef.current = {
          sidebarCollapsed: sidebarCollapsedRef.current,
          rightPanelCollapsed: rightPanelCollapsedRef.current,
        };
        setSidebarCollapsed(true);
        setRightPanelCollapsed(true);
      } else {
        setSidebarCollapsed(preFocusStateRef.current.sidebarCollapsed);
        setRightPanelCollapsed(preFocusStateRef.current.rightPanelCollapsed);
      }
      return !prev;
    });
  }, []);

  const refreshCurrentFolder = useCallback(async () => {
    const currentFolderPath = folderPathRef.current;
    if (!currentFolderPath) return;
    setIsLoading(true);
    try {
      if (!window.electron?.ipcRenderer) {
        toast.error('Electron IPC 不可用');
        return;
      }
      const result = await window.electron.ipcRenderer.invoke('refresh-folder', currentFolderPath);
      if (result) {
        setFiles(result.files);
      }
    } catch (error) {
      console.error('Error refreshing folder:', error);
      toast.error(`刷新文件夹失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  const loadDefaultPath = useCallback(async () => {
    setIsLoading(true);
    try {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) {
        console.warn('Electron IPC not available, skipping default path load');
        return;
      }

      // 启动期先并行初始化默认数据库和上次工作区，减少纯等待时间。
      const [, lastFolder] = await Promise.all([
        ipc.invoke('db-init-default'),
        ipc.invoke('get-last-folder'),
      ]);
      setDbReady(true);

      let startupSettings = DEFAULT_SETTINGS_DRAFT;
      try {
        const rawSettings = (await ipc.invoke('db-settings-get', SETTINGS_STORAGE_KEY)) as
          | string
          | null;
        const nextSettings = mergeSettingsDraft(rawSettings);
        startupSettings = nextSettings;
        setAppSettings(nextSettings);
        setRightPanelCollapsed(nextSettings.general.collapseRightPanelOnStartup);
      } catch {
        setAppSettings(DEFAULT_SETTINGS_DRAFT);
        setRightPanelCollapsed(DEFAULT_SETTINGS_DRAFT.general.collapseRightPanelOnStartup);
      }

      if (lastFolder) {
        await initializeProjectStore(lastFolder);
        const result = await ipc.invoke('refresh-folder', lastFolder);
        void ipc.invoke('add-recent-folder', lastFolder);
        if (result) {
          setFolderPath(result.path);
          setFiles(result.files);
        }
      } else {
        setFolderPath(null);
        setFiles([]);
        setWorkspaceProjectName(null);
      }

      // 更新检查不阻塞首屏渲染。
      void ipc
        .invoke('check-just-updated')
        .then((updateResult) => {
          if (updateResult.updated && startupSettings.general.openChangelogAfterUpdate) {
            openFileInTab('__changelog__:更新日志');
          }
        })
        .catch(() => {
          // 忽略检查失败
        });
    } catch (error) {
      console.error('Error loading default path:', error);
    } finally {
      setIsLoading(false);
    }
  }, [initializeProjectStore]);

  const handleOpenLocal = useCallback(async () => {
    setIsLoading(true);
    try {
      if (!window.electron?.ipcRenderer) {
        toast.error('Electron IPC 不可用');
        return;
      }
      const result = await window.electron.ipcRenderer.invoke('open-local-folder');
      if (result) {
        await initializeProjectStore(result.path);
        await window.electron.ipcRenderer.invoke('add-recent-folder', result.path);
        setFolderPath(result.path);
        setFiles(result.files);
        setWorkspaceProjectName(null);
        setOpenTabs([]);
        setActiveTab(null);
      }
    } catch (error) {
      console.error('Error opening folder:', error);
      toast.error(`打开文件夹失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsLoading(false);
    }
  }, [toast, initializeProjectStore]);

  const handleOpenSampleData = useCallback(async () => {
    setIsLoading(true);
    try {
      if (!window.electron?.ipcRenderer) return;
      const samplePath = await window.electron.ipcRenderer.invoke('open-sample-data');
      await initializeProjectStore(samplePath);
      await window.electron.ipcRenderer.invoke('add-recent-folder', samplePath);
      const result = await window.electron.ipcRenderer.invoke('refresh-folder', samplePath);
      if (result) {
        setFolderPath(result.path);
        setFiles(result.files);
        setWorkspaceProjectName(null);
        setOpenTabs([]);
        setActiveTab(null);
      }
    } catch (error) {
      console.error('Error opening sample data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [initializeProjectStore]);

  const handleCreateFile = useCallback(() => {
    if (!folderPathRef.current) return;
    setCreatingType('file');
  }, []);

  const handleCreateDirectory = useCallback(() => {
    if (!folderPathRef.current) return;
    setCreatingType('directory');
  }, []);

  const handleCreateMaterialDirectory = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    const folder = folderPathRef.current;
    if (!ipc || !folder) return;

    const name = await dialog.prompt('新建资料目录', '请输入资料目录名称', '新资料');
    if (!name?.trim()) return;

    const defaultRoot =
      filesRef.current.find((node) => node.type === 'directory' && isMaterialLikeName(node.name))
        ?.path ?? null;

    const targetRoot =
      defaultRoot ||
      (
        (await ipc.invoke('create-directory', folder, '资料')) as {
          success: boolean;
          dirPath: string;
        }
      ).dirPath;

    try {
      await ipc.invoke('create-directory', targetRoot, name.trim());
      await refreshCurrentFolder();
      toast.success('资料目录创建成功');
    } catch (error) {
      toast.error(`新建资料目录失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [dialog, refreshCurrentFolder, toast]);

  const getCurrentNovelId = useCallback(async (): Promise<number | null> => {
    const ipc = window.electron?.ipcRenderer;
    const folder = folderPathRef.current;
    if (!ipc || !folder) return null;
    const novel = (await ipc.invoke('db-novel-get-by-folder', folder)) as { id: number } | null;
    return novel?.id ?? null;
  }, []);

  const handleCreateCharacter = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    const novelId = await getCurrentNovelId();
    if (!ipc || !novelId) return;

    const name = await dialog.prompt('新建人物', '请输入人物名称', '新人物');
    if (!name?.trim()) return;
    const role = await dialog.prompt('人物定位', '请输入角色定位（可选）', '');

    try {
      const result = (await ipc.invoke(
        'db-character-create',
        novelId,
        name.trim(),
        role?.trim() || '',
        '',
        '{}'
      )) as { lastInsertRowid?: number | bigint };
      const nextRows = (await ipc.invoke('db-character-list', novelId)) as Array<{
        id: number;
        name: string;
        role: string;
        description: string;
        attributes: string;
      }>;
      setWorkspaceCharacters(mapCharacterRows(nextRows));
      const createdId = Number(result?.lastInsertRowid);
      if (Number.isFinite(createdId) && createdId > 0) {
        openFileInTab(createCharacterWorkspaceTab({ id: createdId }));
      } else {
        openFileInTab(WORKSPACE_TAB_CHARACTERS);
      }
      toast.success('人物创建成功');
    } catch (error) {
      toast.error(`新建人物失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [dialog, getCurrentNovelId, openFileInTab, toast]);

  const handleCreateLoreEntry = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    const folder = folderPathRef.current;
    if (!ipc || !folder) return;

    const title = await dialog.prompt('新建设定', '请输入设定名称', '新设定');
    if (!title?.trim()) return;

    try {
      await ipc.invoke(
        'db-world-setting-create-by-folder',
        folder,
        'world',
        title.trim(),
        '',
        '[]'
      );
      const nextEntries = await loadLoreEntriesByFolder(folder);
      setWorkspaceLoreEntries(nextEntries);
      const createdEntry = nextEntries.find((entry) => entry.title === title.trim());
      if (createdEntry) {
        openFileInTab(createLoreWorkspaceTab({ id: createdEntry.id }));
      } else {
        openFileInTab(WORKSPACE_TAB_LORE);
      }
      toast.success('设定创建成功');
    } catch (error) {
      toast.error(`新建设定失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [dialog, openFileInTab, toast]);

  const resolveStoryCreateTargetDir = useCallback((kind: StoryCreateKind): string | null => {
    const folder = folderPathRef.current;
    if (!folder) return null;
    const currentTab = activeTabRef.current;
    const activeVolumePath = parseVolumeWorkspaceTab(currentTab);
    const selectedStoryNode = currentTab
      ? findNodeInTree(splitWorkspaceFiles(filesRef.current).storyNodes, currentTab)
      : null;

    if (kind === 'volume') return folder;

    if (kind === 'chapter') {
      if (activeVolumePath) return activeVolumePath;
      if (selectedStoryNode?.type === 'directory' && !isDraftLikeName(selectedStoryNode.name)) {
        return selectedStoryNode.path;
      }
      if (selectedStoryNode?.type === 'file') {
        const parentDir = getParentDirectory(selectedStoryNode.path);
        if (parentDir) return parentDir;
      }
      return folder;
    }

    if (kind === 'draft-folder' || kind === 'draft') {
      if (selectedStoryNode?.type === 'directory') return selectedStoryNode.path;
      if (selectedStoryNode?.type === 'file') {
        const parentDir = getParentDirectory(selectedStoryNode.path);
        if (parentDir) return parentDir;
      }
      if (activeVolumePath) return activeVolumePath;
      return folder;
    }

    return folder;
  }, []);

  const suggestStoryCreateName = useCallback((kind: StoryCreateKind, targetDir: string): string => {
    const childNodes =
      targetDir === folderPathRef.current
        ? splitWorkspaceFiles(filesRef.current).storyNodes
        : findNodeInTree(filesRef.current, targetDir)?.children || [];
    if (kind === 'volume') {
      const volumeCount = childNodes.filter(
        (node) => node.type === 'directory' && !isDraftLikeName(node.name)
      ).length;
      return `第${volumeCount + 1}卷`;
    }
    if (kind === 'chapter') {
      const chapterCount = childNodes.filter(
        (node) =>
          node.type === 'file' &&
          (!isDraftLikeName(node.name) || /第.+[章节幕回篇集]/.test(node.name))
      ).length;
      return `第${chapterCount + 1}章 未命名`;
    }
    if (kind === 'draft-folder') {
      const draftDirCount = childNodes.filter(
        (node) => node.type === 'directory' && isDraftLikeName(node.name)
      ).length;
      return draftDirCount === 0 ? '样稿' : `样稿${draftDirCount + 1}`;
    }
    const draftCount = childNodes.filter(
      (node) => node.type === 'file' && isDraftLikeName(node.name)
    ).length;
    return draftCount === 0 ? '样稿' : `样稿-${draftCount + 1}`;
  }, []);

  const handleCreateStoryItem = useCallback(
    async (kind: StoryCreateKind) => {
      const ipc = window.electron?.ipcRenderer;
      const targetDir = resolveStoryCreateTargetDir(kind);
      if (!ipc || !targetDir) return;
      const defaultName = suggestStoryCreateName(kind, targetDir);
      const labelMap: Record<StoryCreateKind, string> = {
        volume: '新建卷',
        chapter: '新建章节',
        'draft-folder': '新建稿夹',
        draft: '新建稿',
      };
      const name = await dialog.prompt(labelMap[kind], '请输入名称', defaultName);
      if (!name?.trim()) return;

      try {
        if (kind === 'volume' || kind === 'draft-folder') {
          const result = (await ipc.invoke('create-directory', targetDir, name.trim())) as {
            success: boolean;
            dirPath: string;
          };
          await refreshCurrentFolder();
          if (kind === 'volume') {
            openFileInTab(createVolumeWorkspaceTab(result.dirPath));
          }
          toast.success(`${labelMap[kind]}成功`);
          return;
        }

        const fileName = ensureMarkdownFileName(name.trim());
        const result = (await ipc.invoke('create-file', targetDir, fileName)) as {
          success: boolean;
          filePath: string;
        };
        await refreshCurrentFolder();
        openFileInTab(result.filePath);
        toast.success(`${labelMap[kind]}成功`);
      } catch (error) {
        toast.error(
          `${labelMap[kind]}失败: ${error instanceof Error ? error.message : '未知错误'}`
        );
      }
    },
    [
      dialog,
      openFileInTab,
      refreshCurrentFolder,
      resolveStoryCreateTargetDir,
      suggestStoryCreateName,
      toast,
    ]
  );

  // Determine target directory for inline creation based on selection
  // null = root level, string = specific directory path
  const createTargetPath = useMemo<string | null>(() => {
    if (!creatingType || !folderPath) return null;
    if (!activeTab) return null;
    const selectedNode = findNodeInTree(files, activeTab);
    if (!selectedNode) return null; // untitled or not in tree → root
    if (selectedNode.type === 'directory') return selectedNode.path;
    // File at root level → root
    if (files.some((n) => n.path === activeTab)) return null;
    // File in subdirectory → parent directory
    const lastSlash = Math.max(activeTab.lastIndexOf('/'), activeTab.lastIndexOf('\\'));
    return lastSlash > 0 ? activeTab.substring(0, lastSlash) : null;
  }, [creatingType, folderPath, activeTab, files]);

  const handleInlineCreate = useCallback(
    async (type: 'file' | 'directory', name: string) => {
      const targetDir = createTargetPath ?? folderPathRef.current;
      if (!targetDir) return;
      if (!window.electron?.ipcRenderer) {
        toast.error('Electron IPC 不可用');
        setCreatingType(null);
        return;
      }
      try {
        if (type === 'file') {
          await window.electron.ipcRenderer.invoke('create-file', targetDir, name);
          toast.success(`文件 "${name}" 创建成功`);
        } else {
          await window.electron.ipcRenderer.invoke('create-directory', targetDir, name);
          toast.success(`目录 "${name}" 创建成功`);
        }
        await refreshCurrentFolder();
      } catch (error) {
        toast.error(`创建失败: ${error instanceof Error ? error.message : '未知错误'}`);
      } finally {
        setCreatingType(null);
      }
    },
    [toast, refreshCurrentFolder, createTargetPath]
  );

  const handleCancelCreate = useCallback(() => {
    setCreatingType(null);
  }, []);

  const handleImportFile = useCallback(async () => {
    if (!window.electron?.ipcRenderer) return;
    try {
      const result = (await window.electron.ipcRenderer.invoke('import-file')) as {
        previews: { fileName: string; content: string }[];
        errors: { filePath: string; error: string }[];
      } | null;
      if (!result) return; // 用户取消
      // Open each preview as an untitled tab (no disk write — user saves manually)
      for (const preview of result.previews) {
        ++untitledCounterRef.current;
        const tabPath = `__untitled__:${preview.fileName}`;
        setOpenTabs((prev) => [...prev, tabPath]);
        setActiveTab(tabPath);
        setEditorContent(preview.content);
      }
      if (result.previews.length > 0) {
        toast.success('文件已转换，可自行编辑后保存');
      }
      if (result.errors.length > 0) {
        toast.error(`${result.errors.length} 个文件转换失败`);
      }
    } catch (error) {
      toast.error(`导入失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [toast]);

  const handleFileSelect = useCallback(
    (filePath: string) => {
      openFileInTab(filePath);
    },
    [openFileInTab]
  );
  const handleOpenCharacters = useCallback(() => {
    openFileInTab(WORKSPACE_TAB_CHARACTERS);
  }, [openFileInTab]);
  const handleOpenLore = useCallback(() => {
    openFileInTab(WORKSPACE_TAB_LORE);
  }, [openFileInTab]);
  const handleOpenCharacterNode = useCallback(
    (characterId: number) => {
      openFileInTab(createCharacterWorkspaceTab({ id: characterId }));
    },
    [openFileInTab]
  );
  const handleOpenLoreNode = useCallback(
    (entryId: number) => {
      openFileInTab(createLoreWorkspaceTab({ id: entryId }));
    },
    [openFileInTab]
  );

  const handleRenameProject = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    const folder = folderPathRef.current;
    if (!ipc || !folder) return;
    const novel = (await ipc.invoke('db-novel-get-by-folder', folder)) as {
      id: number;
      name?: string | null;
    } | null;
    if (!novel?.id) return;
    const currentName = (
      workspaceProjectName ||
      novel.name ||
      folder.split('/').pop() ||
      ''
    ).trim();
    const nextName = await dialog.prompt('修改作品名', '请输入新的作品名', currentName);
    if (!nextName?.trim() || nextName.trim() === currentName) return;

    try {
      await ipc.invoke('db-novel-update', novel.id, { name: nextName.trim() });
      setWorkspaceProjectName(nextName.trim());
      toast.success('作品名已更新');
    } catch (error) {
      toast.error(`修改作品名失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [dialog, toast, workspaceProjectName]);

  const syncWorkspaceCharacters = useCallback((nextCharacters: Character[]) => {
    setWorkspaceCharacters((prev) =>
      areCharactersEqual(prev, nextCharacters) ? prev : nextCharacters
    );
  }, []);

  const syncWorkspaceLoreEntries = useCallback((nextEntries: LoreEntry[]) => {
    setWorkspaceLoreEntries((prev) =>
      areLoreEntriesEqual(prev, nextEntries) ? prev : nextEntries
    );
  }, []);
  const handleOpenVolumeNode = useCallback(
    (volumePath: string) => {
      openFileInTab(createVolumeWorkspaceTab(volumePath));
    },
    [openFileInTab]
  );

  const buildProjectAssistantScope = useCallback((): AssistantScopeTarget | null => {
    const folder = folderPathRef.current;
    if (!folder) return null;
    return {
      kind: 'project',
      path: folder,
      label: workspaceProjectName?.trim() || getNodeDisplayName(folder),
    };
  }, [workspaceProjectName]);

  const buildVolumeAssistantScope = useCallback((volumePath: string): AssistantScopeTarget => {
    const node = findNodeInTree(filesRef.current, volumePath) as FileNode | null;
    return {
      kind: 'volume',
      path: volumePath,
      label:
        node?.name ||
        (folderPathRef.current === volumePath ? '未分卷' : getNodeDisplayName(volumePath)),
    };
  }, []);

  const buildChapterAssistantScope = useCallback(
    (chapterPath: string): AssistantScopeTarget => ({
      kind: 'chapter',
      path: chapterPath,
      label: getNodeDisplayName(chapterPath),
    }),
    []
  );

  const handleDeleteFile = useCallback(
    async (filePath: string) => {
      if (!window.electron?.ipcRenderer) return;
      const name = filePath.split('/').pop() || filePath;
      const confirmed = await dialog.confirm('删除文件', `确定要删除 "${name}" 吗？`);
      if (!confirmed) return;
      try {
        await window.electron.ipcRenderer.invoke('delete-file', filePath);
        closeTab(filePath);
        removeViewportSnapshots((path) => path === filePath);
        await refreshCurrentFolder();
        toast.success(`已删除 "${name}"`);
      } catch (error) {
        toast.error(`删除文件失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [toast, dialog, refreshCurrentFolder, closeTab]
  );

  const handleDeleteDirectory = useCallback(
    async (dirPath: string) => {
      if (!window.electron?.ipcRenderer) return;
      const name = dirPath.split('/').pop() || dirPath;
      const confirmed = await dialog.confirm(
        '删除文件夹',
        `确定要删除文件夹 "${name}" 及其所有内容吗？`
      );
      if (!confirmed) return;
      try {
        await window.electron.ipcRenderer.invoke('delete-directory', dirPath);
        // Close any tabs under this directory
        setOpenTabs((prev) => prev.filter((t) => !t.startsWith(dirPath)));
        removeViewportSnapshots((path) => path.startsWith(dirPath));
        if (activeTabRef.current?.startsWith(dirPath)) {
          setActiveTab(null);
        }
        await refreshCurrentFolder();
        toast.success(`已删除文件夹 "${name}"`);
      } catch (error) {
        toast.error(`删除目录失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [toast, dialog, refreshCurrentFolder]
  );

  const handleDeleteVolumeNode = useCallback(
    async (volumePath: string, isSynthetic = false) => {
      if (isSynthetic) {
        toast.info('未分卷用于承接未归档正文，不能直接删除');
        return;
      }
      await handleDeleteDirectory(volumePath);
    },
    [handleDeleteDirectory, toast]
  );

  const handleDeleteCharacterNode = useCallback(
    async (characterId: number) => {
      const ipc = window.electron?.ipcRenderer;
      const target = workspaceCharacters.find((item) => item.id === characterId);
      if (!ipc || !target) return;
      const confirmed = await dialog.confirm('删除人物', `确定要删除人物 "${target.name}" 吗？`);
      if (!confirmed) return;

      try {
        await ipc.invoke('db-character-delete', characterId);
        setWorkspaceCharacters((prev) => prev.filter((item) => item.id !== characterId));
        const workspaceTab = createCharacterWorkspaceTab({ id: characterId });
        setOpenTabs((prev) => prev.filter((tab) => tab !== workspaceTab));
        if (activeTabRef.current === workspaceTab) {
          setActiveTab(WORKSPACE_TAB_CHARACTERS);
        }
        toast.success(`已删除人物 "${target.name}"`);
      } catch (error) {
        toast.error(`删除人物失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [dialog, toast, workspaceCharacters]
  );

  const handleRenameCharacterNode = useCallback(
    async (characterId: number) => {
      const ipc = window.electron?.ipcRenderer;
      const target = workspaceCharacters.find((item) => item.id === characterId);
      if (!ipc || !target) return;
      const nextName = await dialog.prompt('修改人物名', '请输入新的人物名', target.name);
      const normalizedName = nextName?.trim();
      if (!normalizedName || normalizedName === target.name) return;

      try {
        const novelId = await getCurrentNovelId();
        const existingRows = novelId
          ? ((await ipc.invoke('db-character-list', novelId)) as Array<{
              id: number;
              name: string;
              role: string;
              description: string;
              attributes: string;
            }>)
          : [];
        const matchedRow = existingRows.find((item) => item.id === characterId);
        await ipc.invoke('db-character-update', characterId, {
          name: normalizedName,
          role: target.role,
          description: target.description,
          attributes:
            matchedRow?.attributes ||
            JSON.stringify(target.avatar ? { avatar: target.avatar } : {}),
        });
        setWorkspaceCharacters((prev) =>
          prev.map((item) => (item.id === characterId ? { ...item, name: normalizedName } : item))
        );
        toast.success(`人物已更名为 "${normalizedName}"`);
      } catch (error) {
        toast.error(`修改人物名失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [dialog, getCurrentNovelId, toast, workspaceCharacters]
  );

  const handleDeleteLoreNode = useCallback(
    async (entryId: number) => {
      const ipc = window.electron?.ipcRenderer;
      const target = workspaceLoreEntries.find((item) => item.id === entryId);
      if (!ipc || !target) return;
      const confirmed = await dialog.confirm('删除设定', `确定要删除设定 "${target.title}" 吗？`);
      if (!confirmed) return;

      try {
        await ipc.invoke('db-world-setting-delete', entryId);
        setWorkspaceLoreEntries((prev) => prev.filter((item) => item.id !== entryId));
        const workspaceTab = createLoreWorkspaceTab({ id: entryId });
        setOpenTabs((prev) => prev.filter((tab) => tab !== workspaceTab));
        if (activeTabRef.current === workspaceTab) {
          setActiveTab(WORKSPACE_TAB_LORE);
        }
        toast.success(`已删除设定 "${target.title}"`);
      } catch (error) {
        toast.error(`删除设定失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [dialog, toast, workspaceLoreEntries]
  );

  const handleRenameLoreNode = useCallback(
    async (entryId: number) => {
      const ipc = window.electron?.ipcRenderer;
      const target = workspaceLoreEntries.find((item) => item.id === entryId);
      if (!ipc || !target) return;
      const nextTitle = await dialog.prompt('修改设定名', '请输入新的设定名', target.title);
      const normalizedTitle = nextTitle?.trim();
      if (!normalizedTitle || normalizedTitle === target.title) return;

      try {
        await ipc.invoke('db-world-setting-update', entryId, {
          title: normalizedTitle,
          content: target.summary,
          tags: JSON.stringify(target.tags),
        });
        setWorkspaceLoreEntries((prev) =>
          prev.map((item) => (item.id === entryId ? { ...item, title: normalizedTitle } : item))
        );
        toast.success(`设定已更名为 "${normalizedTitle}"`);
      } catch (error) {
        toast.error(`修改设定名失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [dialog, toast, workspaceLoreEntries]
  );

  const handleRename = useCallback(
    async (oldPath: string) => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) return;
      const oldName = oldPath.split('/').pop() || oldPath;
      const storyNode = findNodeInTree(splitWorkspaceFiles(filesRef.current).storyNodes, oldPath);
      const isStoryDocument = storyNode?.type === 'file';
      const oldExtension = isStoryDocument ? getFileExtension(oldName) : '';
      const promptDefaultName = isStoryDocument ? stripExtension(oldName) : oldName;
      const nextInputName = await dialog.prompt('重命名', '请输入新名称', promptDefaultName);
      const normalizedInputName = nextInputName?.trim();
      if (!normalizedInputName) return;

      // 中文说明：正文文件统一保留原扩展名，避免用户关心文件类型。
      const nextName = isStoryDocument
        ? `${stripExtension(normalizedInputName)}${oldExtension}`
        : normalizedInputName;

      if (nextName === oldName) return;
      const parentDir = oldPath.substring(0, oldPath.lastIndexOf('/'));
      const newPath = `${parentDir}/${nextName}`;
      try {
        await ipc.invoke('rename-file', oldPath, newPath);
        const nextStoryOrderMap = remapStoryOrderMapPaths(
          storyOrderMapRef.current,
          oldPath,
          newPath
        );
        storyOrderMapRef.current = nextStoryOrderMap;
        setStoryOrderMap(nextStoryOrderMap);
        await persistStoryOrderMap(nextStoryOrderMap);
        remapPathReferences(oldPath, newPath);
        await refreshCurrentFolder();
        toast.success(`已重命名为 "${isStoryDocument ? stripExtension(nextName) : nextName}"`);
      } catch (error) {
        toast.error(`重命名失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [toast, dialog, persistStoryOrderMap, refreshCurrentFolder, remapPathReferences]
  );

  const handleReorderStoryNode = useCallback(
    async (sourcePath: string, targetPath: string, mode: 'before' | 'after' | 'inside') => {
      const ipc = window.electron?.ipcRenderer;
      const folder = folderPathRef.current;
      if (!ipc || !folder || sourcePath === targetPath) return;

      const storyNodes = splitWorkspaceFiles(filesRef.current).storyNodes;
      const sourceNode = findNodeInTree(storyNodes, sourcePath);
      const sourceParentPath = findStoryParentPath(storyNodes, folder, sourcePath);
      if (!sourceNode || !sourceParentPath) return;
      if (sourceNode.type === 'directory' && isPathSameOrDescendant(targetPath, sourcePath)) {
        return;
      }

      const destinationParentPath =
        mode === 'inside' ? targetPath : findStoryParentPath(storyNodes, folder, targetPath);
      if (!destinationParentPath) return;

      const sourceOrderedPaths = resolveOrderedStoryChildren(
        storyNodes,
        folder,
        sourceParentPath,
        storyOrderMapRef.current
      ).map((node) => node.path);
      const destinationOrderedPaths = resolveOrderedStoryChildren(
        storyNodes,
        folder,
        destinationParentPath,
        storyOrderMapRef.current
      ).map((node) => node.path);

      if (destinationParentPath === sourceParentPath) {
        const nextOrderedPaths =
          mode === 'inside'
            ? [...sourceOrderedPaths.filter((path) => path !== sourcePath), sourcePath]
            : moveStoryPathRelative(sourceOrderedPaths, sourcePath, targetPath, mode);

        if (
          nextOrderedPaths === sourceOrderedPaths ||
          nextOrderedPaths.join('|') === sourceOrderedPaths.join('|')
        ) {
          return;
        }

        const previousStoryOrderMap = storyOrderMapRef.current;
        const nextStoryOrderMap = {
          ...previousStoryOrderMap,
          [sourceParentPath]: nextOrderedPaths,
        };

        storyOrderMapRef.current = nextStoryOrderMap;
        setStoryOrderMap(nextStoryOrderMap);

        try {
          await persistStoryOrderMap(nextStoryOrderMap);
        } catch (error) {
          storyOrderMapRef.current = previousStoryOrderMap;
          setStoryOrderMap(previousStoryOrderMap);
          toast.error(`调整顺序失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
        return;
      }

      const siblingNames = new Set(
        destinationOrderedPaths
          .filter((path) => path !== sourcePath)
          .map((path) => findNodeInTree(storyNodes, path)?.name)
          .filter((name): name is string => Boolean(name))
      );
      const nextName = buildUniqueMovedName(sourceNode.name, siblingNames);
      const newPath = `${destinationParentPath}/${nextName}`;
      if (newPath === sourcePath) return;

      const previousStoryOrderMap = storyOrderMapRef.current;

      try {
        await ipc.invoke('rename-file', sourcePath, newPath);
        let nextStoryOrderMap = remapStoryOrderMapPaths(previousStoryOrderMap, sourcePath, newPath);
        const nextDestinationPaths = destinationOrderedPaths.filter((path) => path !== sourcePath);

        if (mode === 'inside') {
          nextDestinationPaths.push(newPath);
        } else {
          const targetIndex = nextDestinationPaths.indexOf(targetPath);
          if (targetIndex < 0) {
            nextDestinationPaths.push(newPath);
          } else {
            nextDestinationPaths.splice(
              mode === 'after' ? targetIndex + 1 : targetIndex,
              0,
              newPath
            );
          }
        }

        nextStoryOrderMap = {
          ...nextStoryOrderMap,
          [sourceParentPath]: sourceOrderedPaths.filter((path) => path !== sourcePath),
          [destinationParentPath]: Array.from(new Set(nextDestinationPaths)),
        };

        storyOrderMapRef.current = nextStoryOrderMap;
        setStoryOrderMap(nextStoryOrderMap);
        await persistStoryOrderMap(nextStoryOrderMap);
        remapPathReferences(sourcePath, newPath);
        await refreshCurrentFolder();
      } catch (error) {
        toast.error(`移动正文失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [persistStoryOrderMap, refreshCurrentFolder, remapPathReferences, toast]
  );

  const handleCopyFile = useCallback((filePath: string) => {
    setClipboard([filePath]);
  }, []);

  const handlePasteFiles = useCallback(
    async (targetDir: string) => {
      if (!window.electron?.ipcRenderer) return;
      try {
        // 优先使用应用内剪贴板；若为空，尝试读取系统剪贴板中的文件路径（macOS Finder 场景）
        let pathsToPaste = clipboard;
        if (pathsToPaste.length === 0) {
          pathsToPaste = await window.electron.ipcRenderer.invoke('read-clipboard-file-paths');
        }
        if (pathsToPaste.length === 0) return;
        await window.electron.ipcRenderer.invoke('paste-files', pathsToPaste, targetDir);
        await refreshCurrentFolder();
        toast.success('已粘贴');
      } catch (error) {
        toast.error(`粘贴失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [clipboard, toast, refreshCurrentFolder]
  );

  // 拖放导入：从 Finder/Explorer 拖入文件到目录面板（复用 paste-files IPC）
  const handleDropFiles = useCallback(
    async (filePaths: string[]) => {
      if (!window.electron?.ipcRenderer || filePaths.length === 0) return;
      const targetDir = folderPathRef.current;
      if (!targetDir) {
        toast.error('请先打开一个文件夹');
        return;
      }
      try {
        await window.electron.ipcRenderer.invoke('paste-files', filePaths, targetDir);
        await refreshCurrentFolder();
        toast.success(`已导入 ${filePaths.length} 个文件`);
      } catch (error) {
        toast.error(`导入失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [toast, refreshCurrentFolder]
  );

  React.useEffect(() => {
    const timer = setTimeout(() => {
      loadDefaultPath();
    }, 100);

    return () => {
      clearTimeout(timer);
    };
  }, [loadDefaultPath]);

  // Keyboard shortcuts
  React.useEffect(() => {
    initKeyboardShortcuts();
    const onNewFile = () => handleCreateFile();
    const onOpenFolder = () => handleOpenLocal();
    const onKeyDown = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return;
      const mod = e.ctrlKey || e.metaKey;
      // Cmd+Q: 退出应用（渲染进程兜底，确保 Menu accelerator 失效时仍可退出）
      if (mod && e.key === 'q') {
        e.preventDefault();
        window.electron?.ipcRenderer?.invoke('app-quit');
        return;
      }
      if (matchShortcutEvent(e, appSettings.shortcuts.toggleSidebar)) {
        e.preventDefault();
        handleToggleSidebar();
        return;
      }
      if (e.key === 'F11' || matchShortcutEvent(e, appSettings.shortcuts.toggleFocusMode)) {
        e.preventDefault();
        toggleFocusMode();
        return;
      }
      if (matchShortcutEvent(e, appSettings.shortcuts.closeTab)) {
        e.preventDefault();
        if (activeTabRef.current) {
          closeTab(activeTabRef.current);
        }
        return;
      }
      // Cmd+N: 新建标签
      if (mod && !e.shiftKey && e.key === 'n') {
        e.preventDefault();
        handleNewTab();
      }
    };

    window.addEventListener('app:new-file', onNewFile);
    window.addEventListener('app:open-folder', onOpenFolder);
    window.addEventListener('keydown', onKeyDown);

    // 侧边栏焦点跟踪：鼠标按下时记录是否在侧边栏范围内（VS Code 同款方案）
    const onMouseDown = (e: MouseEvent) => {
      sidebarFocusedRef.current = !!sidebarRef.current?.contains(e.target as Node);
    };
    document.addEventListener('mousedown', onMouseDown);

    // 阻止 Electron 默认的文件拖放行为（拖入文件时浏览器会导航到该文件）
    const preventDefaultDrag = (e: DragEvent) => e.preventDefault();
    document.addEventListener('dragover', preventDefaultDrag);
    document.addEventListener('drop', preventDefaultDrag);

    return () => {
      cleanupKeyboardShortcuts();
      window.removeEventListener('app:new-file', onNewFile);
      window.removeEventListener('app:open-folder', onOpenFolder);
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('dragover', preventDefaultDrag);
      document.removeEventListener('drop', preventDefaultDrag);
    };
  }, [
    appSettings.shortcuts,
    closeTab,
    handleNewTab,
    handleOpenLocal,
    handleToggleSidebar,
    toggleFocusMode,
  ]);

  // 导出项目：将整个项目目录复制到用户选择的位置
  const handleExportProject = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    const folder = folderPathRef.current;
    if (!folder) {
      toast.error('请先打开一个项目文件夹');
      return;
    }
    try {
      const result = (await ipc.invoke('export-project', folder)) as {
        success: boolean;
        destPath?: string;
        error?: string;
      } | null;
      if (!result) return; // 用户取消
      if (result.success) {
        toast.success(`项目已导出到: ${result.destPath}`);
      } else if (result.error) {
        toast.error(`导出失败: ${result.error}`);
      }
    } catch (error) {
      toast.error(`导出失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [toast]);

  // 监听原生菜单的导出项目快捷键
  React.useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    const dispose = ipc.on('menu-export-project', handleExportProject);
    return () => {
      dispose?.();
    };
  }, [handleExportProject]);

  // 监听 AI 独立窗口发来的事件
  React.useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;

    // AI 窗口请求打开文件
    const disposeOpenFile = ipc.on('open-file-from-ai', (_event: unknown, filePath: string) => {
      openFileInTab(filePath);
    });

    // AI 窗口请求打开设置
    const disposeOpenSettings = ipc.on('open-settings-from-ai', () => {
      setSettingsCenterTab('ai');
      setShowSettingsCenter(true);
    });

    // AI 窗口提交修复 → 精确局部替换 + 写盘
    const disposeApplyFix = ipc.on(
      'ai-apply-fix-request',
      async (
        _event: unknown,
        payload: {
          filePath: string;
          original: string;
          modified: string;
          explanation?: string;
          proposedFullContent?: string;
          targetLine?: number;
        }
      ) => {
        const {
          filePath: fp,
          original,
          modified,
          targetLine: delegatedTargetLine,
          proposedFullContent,
        } = payload;

        // 1. 打开目标 tab
        openFileInTab(fp);

        // 2. 等待 EditorView 就绪（tab 切换可能是异步的）
        const waitForView = (): Promise<void> =>
          new Promise((resolve) => {
            if (editorViewRef.current) {
              resolve();
            } else {
              const timer = setTimeout(resolve, 200);
              const check = setInterval(() => {
                if (editorViewRef.current) {
                  clearInterval(check);
                  clearTimeout(timer);
                  resolve();
                }
              }, 20);
            }
          });
        await waitForView();

        const view = editorViewRef.current;
        let fullContent = proposedFullContent || '';
        let matchFrom = -1;
        let sourceForLine = '';
        if (view) {
          const doc = view.state.doc.toString();
          sourceForLine = doc;
          matchFrom = doc.indexOf(original);
          if (!fullContent) {
            const result = preciseReplaceWithReport(doc, original, modified);
            if (!result.content) {
              toast.error('AI 修复未命中，已生成诊断报告');
              console.warn(formatPreciseReplaceReport(result.report));
              return;
            }
            fullContent = result.content;
          }
        } else {
          try {
            const diskContent = (await ipc.invoke('read-file', fp)) as string;
            sourceForLine = diskContent;
            matchFrom = diskContent.indexOf(original);
            if (!fullContent) {
              const result = preciseReplaceWithReport(diskContent, original, modified);
              if (!result.content) {
                toast.error('AI 修复未命中');
                return;
              }
              fullContent = result.content;
            }
          } catch {
            toast.error('文件读写失败');
            return;
          }
        }

        const targetLine =
          delegatedTargetLine ||
          (matchFrom >= 0 ? sourceForLine.slice(0, matchFrom).split('\n').length : 1);

        // AI 侧已确认应用，这里直接落盘，不再触发编辑器二次确认
        dispatchFixCommand({ type: 'FIX_APPLY_STARTED' });
        try {
          await ipc.invoke('write-file', fp, fullContent);
          if (view) {
            // ── 原子事务：文档变更 + diff 装饰在同一个 CM6 transaction 中 ──
            // 这样 StateField 先处理 effect（创建装饰），再遇到 docChanged 时已经 return，
            // 装饰不会被 Decoration.none 清除
            const newFrom = fullContent.indexOf(modified);
            if (newFrom >= 0) {
              const diffEffect = setInlineDiffEffect.of({
                from: newFrom,
                to: newFrom + modified.length,
                oldText: original,
                newText: modified,
              });
              view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: fullContent },
                effects: diffEffect,
                selection: { anchor: newFrom },
                scrollIntoView: true,
              });
            } else {
              view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: fullContent },
              });
            }
            setEditorContent(view.state.doc.toString());
          } else {
            setEditorContent(fullContent);
            setEditorReloadToken((prev) => prev + 1);
          }
        } catch {
          dispatchFixCommand({ type: 'FIX_APPLY_FAILED', error: '文件写入失败' });
          toast.error('文件写入失败');
          return;
        }
        dispatchFixCommand({ type: 'FIX_APPLY_SUCCEEDED' });

        // React state 同步（仅用于 SQLite 持久化，CM6 装饰已在上方原子事务中设置）
        if (matchFrom >= 0) {
          const newFrom = fullContent.indexOf(modified);
          if (newFrom >= 0) {
            dispatchFixCommand({
              type: 'FIX_PREVIEW_READY',
              inlineDiff: {
                from: newFrom,
                to: newFrom + modified.length,
                oldText: original,
                newText: modified,
              },
            });
          }
        }

        if (targetLine > 0) {
          setScrollToLine({
            line: targetLine,
            id: fnv1a32(`apply:${targetLine}:${original}`),
          });
          setTransientHighlightLine({
            line: targetLine,
            id: fnv1a32(`apply:${targetLine}:${original}`),
          });
        }
      }
    );

    return () => {
      disposeOpenFile?.();
      disposeOpenSettings?.();
      disposeApplyFix?.();
    };
  }, [openFileInTab, toast]);

  // 监听右侧面板独立窗口关闭 → 恢复三栏布局
  React.useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    const dispose = ipc.on('right-panel-window-closed', () => {
      setRightPanelPoppedOut(false);
      resolvePaneLayout({ nextRightPanelCollapsed: false, preferExpanding: 'right' });
    });
    return () => {
      dispose?.();
    };
  }, [resolvePaneLayout]);

  const handlePopOutRightPanel = useCallback(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc || !folderPath) return;
    const hasTab = !!activeTab;
    void ipc.invoke('open-right-panel-window', folderPath, editorContentRef.current, hasTab);
    setRightPanelPoppedOut(true);
  }, [folderPath, activeTab]);

  // MessagePort 直连：当独立窗口建立端口通道后，内容变化直接 postMessage 到面板
  // 数据驱动 —— 主窗口是唯一数据源，零 main-process 开销
  const { connected: portConnected, send: sendToPanel } = useMessagePort<string>(
    PortChannel.ContentSync
  );
  // 协同编辑预留：增量操作流独立通道（与全文字符串同步解耦）
  useCrdtOpsSender();

  // 节流发送 —— throttle 包裹 send，高频打字时限制到 ≈20fps（50ms 间隔）
  // 用函数级 throttle 而非 useThrottle hook：消除中间 state + 额外渲染，
  // editorContent 变化在同一渲染周期内触发节流发送，leading 首触即发 + trailing 尾值不丢
  const throttledSendRef = useRef<ThrottledFunction<(d: string) => void> | null>(null);
  if (!throttledSendRef.current) {
    throttledSendRef.current = throttle((data: string) => sendToPanel(data), 50);
  }

  React.useEffect(() => {
    if (!rightPanelPoppedOut || !portConnected) {
      throttledSendRef.current?.cancel();
      return;
    }
    // editorContent 变化 → 节流发送
    // portConnected 由 false→true 时也触发（leading edge），等价于 "push on connect"
    throttledSendRef.current!(editorContent);
  }, [rightPanelPoppedOut, portConnected, editorContent]);

  // 组件卸载时 flush 残余的 trailing 调用，确保最后一次变更送达
  React.useEffect(() => () => throttledSendRef.current?.flush(), []);

  // 侧边栏 Cmd+C/V 快捷键（独立 effect，确保 clipboard 最新值始终可用）
  React.useEffect(() => {
    /** 判断当前焦点是否在文本编辑区（输入框 / CodeMirror / contenteditable） */
    const isEditingText = () => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName.toUpperCase();
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        el.getAttribute('contenteditable') === 'true' ||
        !!el.closest('.cm-editor')
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return;
      if (!sidebarFocusedRef.current) return;
      if (isEditingText()) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      if (e.key === 'c') {
        // 复制：仅对真实文件路径（排除 __untitled__、__changelog__ 等虚拟路径）
        const tab = activeTabRef.current;
        if (tab && !tab.startsWith('__')) {
          e.preventDefault();
          setClipboard([tab]);
        }
      } else if (e.key === 'v') {
        // 粘贴：优先应用内剪贴板，其次系统剪贴板（Finder 复制的文件）
        e.preventDefault();
        const tab = activeTabRef.current;
        let targetDir = folderPathRef.current;
        if (tab && !tab.startsWith('__') && tab.includes('/')) {
          const node = findNodeInTree(filesRef.current, tab);
          if (node?.type === 'directory') {
            targetDir = tab;
          } else {
            targetDir = tab.substring(0, tab.lastIndexOf('/'));
          }
        }
        if (targetDir) handlePasteFiles(targetDir);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clipboard, handlePasteFiles]);

  const handleFileContextMenu = useCallback((event: ContextMenuEvent) => {
    setContextMenu({ x: event.x, y: event.y, target: { kind: 'file', node: event.node } });
  }, []);

  const handleObjectContextMenu = useCallback((event: ObjectContextMenuEvent) => {
    setContextMenu({ x: event.x, y: event.y, target: { kind: 'object', target: event.target } });
  }, []);

  const handleBackgroundContextMenu = useCallback((pos: { x: number; y: number }) => {
    setContextMenu({ x: pos.x, y: pos.y, target: { kind: 'background' } });
  }, []);

  // Save untitled file: prompt for name, write to disk, replace tab
  const handleSaveUntitled = useCallback(
    async (untitledPath: string, content: string) => {
      const currentFolder = folderPathRef.current;
      if (!currentFolder || !window.electron?.ipcRenderer) {
        toast.error('请先打开一个文件夹');
        return;
      }
      const fileName = await dialog.prompt('保存文件', '请输入文件名', '');
      if (!fileName) return;
      const newPath = `${currentFolder}/${fileName}`;
      try {
        await window.electron.ipcRenderer.invoke('write-file', newPath, content);
        // Replace untitled tab with real file path
        setOpenTabs((prev) => prev.map((t) => (t === untitledPath ? newPath : t)));
        moveViewportSnapshot(untitledPath, newPath);
        if (activeTabRef.current === untitledPath) {
          setActiveTab(newPath);
        }
        await refreshCurrentFolder();
        toast.success(`文件 "${fileName}" 已保存`);
      } catch (error) {
        toast.error(`保存失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [toast, dialog, refreshCurrentFolder]
  );

  const handleContentChange = useCallback((content: string) => {
    setEditorContent(content);
  }, []);

  const handleCursorChange = useCallback((pos: CursorPosition) => {
    setCursorPosition(pos);
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleToggleRightPanel = useCallback(() => {
    if (rightPanelCollapsedRef.current) {
      resolvePaneLayout({ nextRightPanelCollapsed: false, preferExpanding: 'right' });
      return;
    }
    setRightPanelCollapsed(true);
  }, [resolvePaneLayout]);

  const handleScrollProcessed = useCallback(() => {
    setScrollToLine(null);
  }, []);

  const handleTransientHighlightProcessed = useCallback(() => {
    setTransientHighlightLine(null);
  }, []);

  const handleScrollToLine = useCallback((line: number, contentKey?: string) => {
    setScrollToLine({ line, id: fnv1a32(contentKey ?? `line:${line}`) });
  }, []);

  const replaceIdRef = useRef(0);
  const handleReplaceLineText = useCallback((line: number, text: string) => {
    setReplaceLineRequest({ line, text, id: ++replaceIdRef.current });
  }, []);

  const handleTransientHighlightLine = useCallback((line: number) => {
    setTransientHighlightLine({ line, id: fnv1a32(`line:${line}`) });
  }, []);

  const handleDiffRequest = useCallback(
    (original: string, modified: string, originalLabel: string, modifiedLabel: string) => {
      const nextDiff: FixDiffState = { original, modified, originalLabel, modifiedLabel };
      dispatchFixCommand({ type: 'FIX_DIFF_VIEW_OPEN', diffState: nextDiff });
    },
    []
  );

  const handleCloseDiff = useCallback(() => {
    dispatchFixCommand({ type: 'FIX_CLEAR' });
  }, []);

  // 接受 AI 修复：写入文件并刷新编辑器
  const handleAcceptFix = useCallback(async () => {
    const fix = pendingApplyQueue[0] || null;
    if (!fix) return;
    dispatchFixCommand({ type: 'FIX_APPLY_STARTED' });
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    try {
      await ipc.invoke('write-file', fix.filePath, fix.content);

      // 强制同步：接受修改后总是打开并聚焦目标 tab，再更新编辑器与定位
      openFileInTab(fix.filePath);
      setEditorContent(fix.content);
      if (typeof fix.targetLine === 'number' && fix.targetLine > 0) {
        handleScrollToLine(fix.targetLine);
        handleTransientHighlightLine(fix.targetLine);
      }
      setEditorReloadToken((prev) => prev + 1);
    } catch {
      dispatchFixCommand({ type: 'FIX_APPLY_FAILED', error: '文件写入失败' });
      return;
    }
    dispatchFixCommand({ type: 'FIX_APPLY_SUCCEEDED' });
  }, [openFileInTab, handleScrollToLine, handleTransientHighlightLine, pendingApplyQueue]);

  const handleVersionRestore = useCallback(
    async (restoredFilePath: string) => {
      await refreshCurrentFolder();
      if (activeTabRef.current === restoredFilePath) {
        setEditorReloadToken((prev) => prev + 1);
      }
    },
    [refreshCurrentFolder]
  );

  // ─── Tab 右键菜单操作 ─────────────────────────────────────────────
  const handleCloseOtherTabs = useCallback((filePath: string) => {
    setOpenTabs([filePath]);
    setActiveTab(filePath);
  }, []);

  const handleCloseAllTabs = useCallback(() => {
    setOpenTabs([]);
    setActiveTab(null);
  }, []);

  React.useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc || !folderPath) {
      setWorkspaceCharacters([]);
      setWorkspaceLoreEntries([]);
      setWorkspaceProjectName(null);
      return;
    }
    let cancelled = false;
    const loadWorkspaceEntities = async () => {
      try {
        const novel = (await ipc.invoke('db-novel-get-by-folder', folderPath)) as {
          id: number;
          name?: string | null;
        } | null;
        const [characterRows, loreEntries] = await Promise.all([
          novel
            ? (ipc.invoke('db-character-list', novel.id) as Promise<
                Array<{
                  id: number;
                  name: string;
                  role: string;
                  description: string;
                  attributes: string;
                }>
              >)
            : Promise.resolve([]),
          loadLoreEntriesByFolder(folderPath),
        ]);
        if (cancelled) return;
        setWorkspaceProjectName(novel?.name || folderPath.split('/').pop() || null);
        setWorkspaceCharacters(mapCharacterRows(characterRows));
        setWorkspaceLoreEntries(loreEntries);
      } catch {
        if (cancelled) return;
        setWorkspaceProjectName(folderPath.split('/').pop() || null);
        setWorkspaceCharacters([]);
        setWorkspaceLoreEntries([]);
      }
    };
    void loadWorkspaceEntities();
    return () => {
      cancelled = true;
    };
  }, [folderPath]);

  const activeWorkspaceTab = useMemo(
    () => (isWorkspaceTab(activeTab) ? activeTab : null),
    [activeTab]
  );
  const activeDocumentTab = useMemo(
    () => (isWorkspaceTab(activeTab) ? null : activeTab),
    [activeTab]
  );
  const chapterAssistantEnabled = useMemo(
    () => shouldEnableChapterAssistant(activeDocumentTab),
    [activeDocumentTab]
  );
  const selectedCharacterTabId = useMemo(
    () => parseCharacterWorkspaceTab(activeWorkspaceTab),
    [activeWorkspaceTab]
  );
  const selectedLoreEntryTabId = useMemo(
    () => parseLoreWorkspaceTab(activeWorkspaceTab),
    [activeWorkspaceTab]
  );
  const selectedVolumePath = useMemo(
    () => parseVolumeWorkspaceTab(activeWorkspaceTab),
    [activeWorkspaceTab]
  );
  const { storyNodes: workspaceStoryNodes, materialNodes: workspaceMaterialNodes } = useMemo(
    () => splitWorkspaceFiles(files),
    [files]
  );
  const materialFiles = useMemo(
    () => flattenFileNodes(workspaceMaterialNodes),
    [workspaceMaterialNodes]
  );
  const materialFileMap = useMemo(
    () => new Map(materialFiles.map((item) => [item.path, item])),
    [materialFiles]
  );
  const linkedMaterialFiles = useMemo(
    () =>
      chapterMaterialPaths.map((path) => materialFileMap.get(path)).filter(Boolean) as FileNode[],
    [chapterMaterialPaths, materialFileMap]
  );
  const rootVolumeNode = useMemo(() => {
    if (!folderPath) return null;
    const looseNodes = workspaceStoryNodes.filter(
      (node) => !(node.type === 'directory' && isVolumeLikeName(node.name))
    );
    if (looseNodes.length === 0) return null;
    return {
      name: '未分卷',
      path: folderPath,
      type: 'directory' as const,
      children: looseNodes,
    };
  }, [folderPath, workspaceStoryNodes]);
  const selectedVolumeNode = useMemo(() => {
    if (!selectedVolumePath) return null;
    const existingNode = findNodeInTree(files, selectedVolumePath);
    if (existingNode?.type === 'directory') return existingNode;
    if (rootVolumeNode && folderPath && selectedVolumePath === folderPath) {
      return rootVolumeNode;
    }
    return null;
  }, [files, folderPath, rootVolumeNode, selectedVolumePath]);
  const currentAssistantScope = useMemo<AssistantScopeTarget | null>(() => {
    if (activeDocumentTab && isStoryFilePath(activeDocumentTab)) {
      return {
        kind: 'chapter',
        path: activeDocumentTab,
        label: getNodeDisplayName(activeDocumentTab),
      };
    }
    if (selectedVolumePath) {
      const label = selectedVolumeNode?.name || getNodeDisplayName(selectedVolumePath);
      return {
        kind: 'volume',
        path: selectedVolumePath,
        label,
      };
    }
    if (!folderPath) return null;
    return {
      kind: 'project',
      path: folderPath,
      label: workspaceProjectName?.trim() || getNodeDisplayName(folderPath),
    };
  }, [activeDocumentTab, folderPath, selectedVolumeNode, selectedVolumePath, workspaceProjectName]);
  const currentOutlineScope = useMemo<PersistedOutlineScopeInput | null>(() => {
    if (!currentAssistantScope) return null;
    return {
      kind: currentAssistantScope.kind,
      path: currentAssistantScope.path,
    };
  }, [currentAssistantScope]);
  const storyFileNodes = useMemo(
    () =>
      flattenFileNodes(workspaceStoryNodes).filter(
        (node): node is FileNode & { type: 'file' } =>
          node.type === 'file' && isStoryFilePath(node.path)
      ),
    [workspaceStoryNodes]
  );

  const getStoryFilesForScope = useCallback(
    (scope: AssistantScopeTarget): Array<FileNode & { type: 'file' }> => {
      if (scope.kind === 'chapter') {
        const targetNode = findNodeInTree(filesRef.current, scope.path);
        return targetNode?.type === 'file' && isStoryFilePath(targetNode.path)
          ? [targetNode as FileNode & { type: 'file' }]
          : [];
      }

      if (scope.kind === 'volume') {
        const targetNode =
          (findNodeInTree(filesRef.current, scope.path) as FileNode | null) ||
          (rootVolumeNode && scope.path === rootVolumeNode.path ? rootVolumeNode : null);
        if (!targetNode || targetNode.type !== 'directory') return [];
        return flattenFileNodes(targetNode.children || []).filter(
          (node): node is FileNode & { type: 'file' } =>
            node.type === 'file' && isStoryFilePath(node.path)
        );
      }

      return storyFileNodes;
    },
    [rootVolumeNode, storyFileNodes]
  );

  const readStoryDocumentText = useCallback(
    async (filePath: string): Promise<string> => {
      const ipc = window.electron?.ipcRenderer;
      if (activeDocumentTab === filePath) {
        return editorContentRef.current || '';
      }
      if (!ipc) {
        throw new Error('Electron IPC 不可用');
      }
      return (await ipc.invoke('read-file', filePath)) as string;
    },
    [activeDocumentTab]
  );

  const resolveAIGenerationContext = useCallback(
    async (scope: AIGenerationScope): Promise<{ content: string; label: string }> => {
      if (scope === 'current-content') {
        const currentContent = editorContentRef.current.trim();
        if (!currentContent) {
          throw new Error('当前没有可用于生成的打开内容');
        }
        return { content: currentContent, label: getAIGenerationScopeLabel(scope) };
      }

      if (scope === 'current-chapter') {
        if (!activeDocumentTab || !isStoryFilePath(activeDocumentTab)) {
          throw new Error('请先打开一个正文章节或样稿');
        }
        const chapterContent = (await readStoryDocumentText(activeDocumentTab)).trim();
        if (!chapterContent) {
          throw new Error('当前章节内容为空，无法生成');
        }
        return {
          content: chapterContent,
          label: `${getAIGenerationScopeLabel(scope)} · ${getNodeDisplayName(activeDocumentTab)}`,
        };
      }

      if (storyFileNodes.length === 0) {
        throw new Error('当前作品没有可用的正文内容');
      }

      const sections: string[] = [];
      let totalLength = 0;
      for (const node of storyFileNodes) {
        const raw = (await readStoryDocumentText(node.path)).trim();
        if (!raw) continue;
        const section = `# ${getNodeDisplayName(node.path)}\n\n${raw}`;
        if (totalLength + section.length > 120000 && sections.length > 0) break;
        sections.push(section);
        totalLength += section.length;
      }

      const merged = sections.join('\n\n');
      if (!merged.trim()) {
        throw new Error('整部作品当前没有可用于生成的正文内容');
      }
      return { content: merged, label: getAIGenerationScopeLabel(scope) };
    },
    [activeDocumentTab, readStoryDocumentText, storyFileNodes]
  );

  const resolveScopeTargetContext = useCallback(
    async (scope: AssistantScopeTarget): Promise<{ content: string; label: string }> => {
      if (scope.kind === 'chapter') {
        const content = (await readStoryDocumentText(scope.path)).trim();
        if (!content) {
          throw new Error('当前章节内容为空，无法生成');
        }
        return {
          content,
          label: `当前章节 · ${scope.label}`,
        };
      }

      const scopedFiles = getStoryFilesForScope(scope);
      if (scopedFiles.length === 0) {
        throw new Error(
          scope.kind === 'volume' ? '当前卷没有可用的正文内容' : '当前作品没有可用的正文内容'
        );
      }

      const sections: string[] = [];
      let totalLength = 0;
      for (const node of scopedFiles) {
        const raw = (await readStoryDocumentText(node.path)).trim();
        if (!raw) continue;
        const section = `# ${getNodeDisplayName(node.path)}\n\n${raw}`;
        if (totalLength + section.length > 120000 && sections.length > 0) break;
        sections.push(section);
        totalLength += section.length;
      }

      const content = sections.join('\n\n').trim();
      if (!content) {
        throw new Error(
          scope.kind === 'volume' ? '当前卷没有可用于生成的内容' : '当前作品没有可用于生成的内容'
        );
      }
      return {
        content,
        label: `${scope.kind === 'volume' ? '当前卷' : '当前作品'} · ${scope.label}`,
      };
    },
    [getStoryFilesForScope, readStoryDocumentText]
  );

  const persistScopedAssistantArtifacts = useCallback(
    async (
      scope: AssistantScopeTarget,
      payload: {
        characters?: AssistantScopedCharacter[];
        lore?: AssistantScopedLore[];
        materials?: AssistantScopedMaterial[];
      }
    ) => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) return;

      const jobs: Promise<unknown>[] = [];
      if (payload.characters) {
        const key = createAssistantArtifactStorageKey('characters', scope.kind, scope.path);
        if (key) {
          jobs.push(ipc.invoke('db-settings-set', key, JSON.stringify(payload.characters)));
        }
      }
      if (payload.lore) {
        const key = createAssistantArtifactStorageKey('lore', scope.kind, scope.path);
        if (key) {
          jobs.push(ipc.invoke('db-settings-set', key, JSON.stringify(payload.lore)));
        }
      }
      if (payload.materials) {
        const key = createAssistantArtifactStorageKey('materials', scope.kind, scope.path);
        if (key) {
          jobs.push(ipc.invoke('db-settings-set', key, JSON.stringify(payload.materials)));
        }
      }
      await Promise.all(jobs);
    },
    []
  );

  const closeTabsByPredicate = useCallback((predicate: (tab: string) => boolean) => {
    setOpenTabs((prev) => prev.filter((tab) => !predicate(tab)));
    if (activeTabRef.current && predicate(activeTabRef.current)) {
      setActiveTab(null);
    }
  }, []);

  const handleClearCharacters = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    const novelId = await getCurrentNovelId();
    const folder = folderPathRef.current;
    if (!ipc || !novelId || !folder) return;
    if (workspaceCharacters.length === 0) {
      toast.info('当前作品没有可清空的人物');
      return;
    }
    const confirmed = await dialog.confirm(
      '清空人物',
      `确定要清空当前作品的 ${workspaceCharacters.length} 个人物吗？这会同时清空人物关系图。`
    );
    if (!confirmed) return;

    try {
      await ipc.invoke('db-character-clear-by-novel', novelId);
      const prefixes = [
        createRelationStorageKey(folder),
        createGraphLayoutStorageKey(folder),
      ].filter((item): item is string => Boolean(item));
      if (prefixes.length > 0) {
        await ipc.invoke('db-settings-delete-prefixes', prefixes);
      }
      setWorkspaceCharacters([]);
      bumpWorkspaceCharactersVersion();
      closeTabsByPredicate((tab) => tab.startsWith('__workspace__:character:'));
      toast.success('人物已清空');
    } catch (error) {
      toast.error(`清空人物失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [closeTabsByPredicate, dialog, getCurrentNovelId, toast, workspaceCharacters.length]);

  const handleClearLoreEntries = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    const folder = folderPathRef.current;
    if (!ipc || !folder) return;
    if (workspaceLoreEntries.length === 0) {
      toast.info('当前作品没有可清空的设定');
      return;
    }
    const confirmed = await dialog.confirm(
      '清空设定',
      `确定要清空当前作品的 ${workspaceLoreEntries.length} 条设定吗？`
    );
    if (!confirmed) return;

    try {
      await ipc.invoke('db-world-setting-clear-by-folder', folder);
      setWorkspaceLoreEntries([]);
      bumpWorkspaceLoreVersion();
      closeTabsByPredicate((tab) => tab.startsWith('__workspace__:lore-entry:'));
      toast.success('设定已清空');
    } catch (error) {
      toast.error(`清空设定失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [closeTabsByPredicate, dialog, toast, workspaceLoreEntries.length]);

  const handleClearMaterials = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    const folder = folderPathRef.current;
    if (!ipc || !folder) return;
    const targets = [...workspaceMaterialNodes];
    if (targets.length === 0) {
      toast.info('当前作品没有可清空的资料');
      return;
    }
    const confirmed = await dialog.confirm(
      '清空资料',
      '确定要清空当前作品资料区中的所有文件与目录吗？该操作不会删除正文。'
    );
    if (!confirmed) return;

    try {
      for (const node of targets) {
        if (node.type === 'directory') {
          await ipc.invoke('delete-directory', node.path);
        } else {
          await ipc.invoke('delete-file', node.path);
        }
      }
      const settingsRows = (await ipc.invoke('db-settings-all')) as Array<{
        key: string;
        value: string;
      }>;
      const materialSettingKeys = settingsRows
        .map((row) => row.key)
        .filter(
          (key) =>
            key.startsWith(CHAPTER_MATERIALS_STORAGE_PREFIX) &&
            isPathInWorkspace(key.slice(CHAPTER_MATERIALS_STORAGE_PREFIX.length), folder)
        );
      if (materialSettingKeys.length > 0) {
        await ipc.invoke('db-settings-delete-prefixes', materialSettingKeys);
      }
      setChapterMaterialPaths([]);
      closeTabsByPredicate((tab) =>
        targets.some((node) => tab === node.path || tab.startsWith(`${node.path}/`))
      );
      await refreshCurrentFolder();
      toast.success('资料已清空');
    } catch (error) {
      toast.error(`清空资料失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [closeTabsByPredicate, dialog, refreshCurrentFolder, toast, workspaceMaterialNodes]);

  const handleGenerateCharacters = useCallback(
    async (scope: AIGenerationScope) => {
      const ipc = window.electron?.ipcRenderer;
      const folder = folderPathRef.current;
      const novelId = await getCurrentNovelId();
      if (!ipc || !folder || !novelId) return;
      if (!appSettings.ai.enabled) {
        toast.warning('请先在设置中心启用并配置 AI');
        return;
      }

      try {
        toast.info(`正在从${getAIGenerationScopeLabel(scope)}生成人物图谱...`, 1800);
        const { content, label } = await resolveAIGenerationContext(scope);
        const settingsRaw = (await ipc.invoke('db-settings-get', SETTINGS_STORAGE_KEY)) as
          | string
          | null;
        const settings = settingsRaw
          ? (JSON.parse(settingsRaw) as { ai?: { contextTokens?: number } })
          : {};
        const contextTokens = settings.ai?.contextTokens || 128000;
        const approxChunkChars = Math.max(4000, Math.min(12000, Math.floor(contextTokens * 0.08)));
        const chunks = splitTextIntoChunks(content, approxChunkChars).slice(0, 12);
        const loreEntries = await loadLoreEntriesByFolder(folder);
        const chunkResults = [];

        for (let index = 0; index < chunks.length; index += 1) {
          const response = (await ipc.invoke('ai-request', {
            prompt:
              '请从给定正文片段中抽取人物与关系。必须严格返回 JSON 对象，格式为 {"characters":[{"name":"","role":"","description":"","aliases":[]}],"relations":[{"source":"","target":"","label":"","tone":"ally|rival|family|mentor|other","note":""}],"summary":""}。没有内容也必须返回空数组，不要输出 Markdown，不要解释。',
            systemPrompt:
              '你是小说人物设计引擎。你的任务是稳定抽取人物图谱，输出必须可被 JSON.parse 直接解析。角色名要用正文里的实际称呼，关系只保留明确证据。',
            context: [
              `生成范围: ${label}`,
              loreEntries.length > 0
                ? `设定集参考:\n${loreEntries.map((item) => `${item.title}: ${item.summary}`).join('\n')}`
                : '',
              `正文片段 ${index + 1}/${chunks.length}:\n${chunks[index]}`,
            ]
              .filter(Boolean)
              .join('\n\n'),
          })) as { ok: boolean; text?: string; error?: string };
          if (!response.ok) throw new Error(response.error || 'AI 生成人物失败');
          const parsed = parseCharacterGraphAIResult(response.text || '');
          if (parsed) {
            chunkResults.push(parsed);
          }
        }

        const merged = mergeCharacterGraphResults(chunkResults);
        if (merged.characters.length === 0) {
          toast.warning('AI 没有识别出足够明确的人物');
          return;
        }

        const existingRows = (await ipc.invoke('db-character-list', novelId)) as Array<{
          id: number;
          name: string;
          role: string;
          description: string;
          attributes: string;
        }>;
        const existingByName = new Map<string, (typeof existingRows)[number]>();
        existingRows.forEach((row) => {
          existingByName.set(normalizePersonName(row.name), row);
          const attrs = parseCharacterAttributes(row.attributes);
          (attrs.aliases || []).forEach((alias) =>
            existingByName.set(normalizePersonName(alias), row)
          );
        });

        const nameToId = new Map<string, number>();
        let createdCount = 0;
        let updatedCount = 0;
        for (const character of merged.characters) {
          const normalized = normalizePersonName(character.name);
          const matched = existingByName.get(normalized);
          const nextRole = character.role?.trim() || matched?.role || '';
          const nextDescription = character.description?.trim() || matched?.description || '';
          const nextAliases = Array.from(
            new Set((character.aliases || []).map((item) => item.trim()).filter(Boolean))
          );

          if (matched) {
            const prevAttrs = parseCharacterAttributes(matched.attributes);
            await ipc.invoke('db-character-update', matched.id, {
              name: matched.name,
              role: nextRole,
              description: nextDescription,
              attributes: JSON.stringify({
                ...prevAttrs,
                aliases: Array.from(new Set([...(prevAttrs.aliases || []), ...nextAliases])),
              }),
            });
            updatedCount += 1;
            nameToId.set(normalized, matched.id);
            nextAliases.forEach((alias) => nameToId.set(normalizePersonName(alias), matched.id));
          } else {
            const created = (await ipc.invoke(
              'db-character-create',
              novelId,
              character.name.trim(),
              nextRole,
              nextDescription,
              JSON.stringify({ aliases: nextAliases })
            )) as { lastInsertRowid: number | bigint };
            const createdId = Number(created.lastInsertRowid);
            createdCount += 1;
            nameToId.set(normalized, createdId);
            nextAliases.forEach((alias) => nameToId.set(normalizePersonName(alias), createdId));
          }
        }

        const nextRelations = merged.relations
          .map((relation, index) => {
            const sourceId = nameToId.get(normalizePersonName(relation.source));
            const targetId = nameToId.get(normalizePersonName(relation.target));
            if (!sourceId || !targetId || sourceId === targetId) return null;
            return {
              id: `ai-${Date.now()}-${index}`,
              sourceId,
              targetId,
              label: relation.label?.trim() || '关系',
              tone:
                relation.tone === 'ally' ||
                relation.tone === 'rival' ||
                relation.tone === 'family' ||
                relation.tone === 'mentor'
                  ? relation.tone
                  : 'other',
              note: relation.note?.trim() || '',
            };
          })
          .filter(Boolean) as Array<{
          id: string;
          sourceId: number;
          targetId: number;
          label: string;
          tone: 'ally' | 'rival' | 'family' | 'mentor' | 'other';
          note: string;
        }>;

        const relationKey = createRelationStorageKey(folder);
        if (relationKey) {
          await ipc.invoke('db-settings-set', relationKey, JSON.stringify(nextRelations));
        }
        const refreshedRows = (await ipc.invoke('db-character-list', novelId)) as Array<{
          id: number;
          name: string;
          role: string;
          description: string;
          attributes: string;
        }>;
        setWorkspaceCharacters(mapCharacterRows(refreshedRows));
        bumpWorkspaceCharactersVersion();
        toast.success(
          `AI 已同步人物：新增 ${createdCount}，更新 ${updatedCount}，关系 ${nextRelations.length}`
        );
      } catch (error) {
        toast.error(`AI 生成人物失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [appSettings.ai.enabled, getCurrentNovelId, resolveAIGenerationContext, toast]
  );

  const handleGenerateLoreEntries = useCallback(
    async (scope: AIGenerationScope) => {
      const ipc = window.electron?.ipcRenderer;
      const folder = folderPathRef.current;
      if (!ipc || !folder) return;
      if (!appSettings.ai.enabled) {
        toast.warning('请先在设置中心启用并配置 AI');
        return;
      }

      try {
        toast.info(`正在从${getAIGenerationScopeLabel(scope)}提炼设定...`, 1800);
        const { content, label } = await resolveAIGenerationContext(scope);
        const response = (await ipc.invoke('ai-request', {
          prompt:
            '请从给定内容中提炼可长期复用的设定条目。必须严格返回 JSON 对象，格式为 {"entries":[{"category":"world|faction|system|term","title":"","summary":"","tags":[""]}]}。只保留长期有效设定，不要输出章节剧情总结，不要 Markdown。',
          systemPrompt:
            '你是小说设定编辑。你需要从正文中抽取可复用的世界观、势力、规则、术语条目，并用简洁中文概括。',
          context: `生成范围: ${label}\n\n作品内容:\n${content.slice(0, 90000)}`,
        })) as { ok: boolean; text?: string; error?: string };
        if (!response.ok) throw new Error(response.error || 'AI 生成设定失败');
        const drafts = parseLoreGenerationResult(response.text || '');
        if (drafts.length === 0) {
          toast.warning('AI 没有生成可导入的设定条目');
          return;
        }

        const existingEntries = await loadLoreEntriesByFolder(folder);
        const existingByKey = new Map(
          existingEntries.map((item) => [buildLoreDedupKey(item), item])
        );
        let createdCount = 0;
        let updatedCount = 0;

        for (const draft of drafts) {
          const matched = existingByKey.get(buildLoreDedupKey(draft));
          if (matched) {
            if (!matched.summary.trim() && draft.summary.trim()) {
              await ipc.invoke('db-world-setting-update', matched.id, {
                content: draft.summary,
                tags: JSON.stringify(draft.tags || []),
              });
              updatedCount += 1;
            }
            continue;
          }
          await ipc.invoke(
            'db-world-setting-create-by-folder',
            folder,
            draft.category,
            draft.title,
            draft.summary,
            JSON.stringify(draft.tags || [])
          );
          createdCount += 1;
        }

        const nextEntries = await loadLoreEntriesByFolder(folder);
        setWorkspaceLoreEntries(nextEntries);
        bumpWorkspaceLoreVersion();
        toast.success(`AI 已提炼设定：新增 ${createdCount}，补全 ${updatedCount}`);
      } catch (error) {
        toast.error(`AI 生成设定失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [appSettings.ai.enabled, resolveAIGenerationContext, toast]
  );

  const handleGenerateMaterials = useCallback(
    async (scope: AIGenerationScope) => {
      const ipc = window.electron?.ipcRenderer;
      const folder = folderPathRef.current;
      if (!ipc || !folder) return;
      if (!appSettings.ai.enabled) {
        toast.warning('请先在设置中心启用并配置 AI');
        return;
      }

      try {
        toast.info(`正在从${getAIGenerationScopeLabel(scope)}生成资料条目...`, 1800);
        const { content, label } = await resolveAIGenerationContext(scope);
        const response = (await ipc.invoke('ai-request', {
          prompt:
            '请根据给定作品内容，生成适合沉淀到资料库的资料条目。必须严格返回 JSON 对象，格式为 {"materials":[{"title":"","summary":"","kind":"reference|scene|character|setting|research","relatedChapter":"","keywords":[""]}]}。资料条目应是可继续扩写的研究/参考笔记，不要输出 Markdown。',
          systemPrompt:
            '你是长篇创作资料编辑。你的任务是把作品内容中值得长期保留的参考资料、场景资料、人物资料、设定资料整理成短条目。',
          context: `生成范围: ${label}\n\n作品内容:\n${content.slice(0, 90000)}`,
        })) as { ok: boolean; text?: string; error?: string };
        if (!response.ok) throw new Error(response.error || 'AI 生成资料失败');
        const drafts = parseMaterialGenerationResult(response.text || '');
        if (drafts.length === 0) {
          toast.warning('AI 没有生成可落库的资料条目');
          return;
        }

        const defaultMaterialRoot =
          filesRef.current.find(
            (node) => node.type === 'directory' && isMaterialLikeName(node.name)
          )?.path ??
          (
            (await ipc.invoke('create-directory', folder, '资料')) as {
              success: boolean;
              dirPath: string;
            }
          ).dirPath;
        const existingAiMaterialRoot = findNodeInTree(
          filesRef.current,
          `${defaultMaterialRoot.replace(/[\\/]+$/, '')}/AI资料`
        );
        const aiMaterialRoot =
          existingAiMaterialRoot?.type === 'directory'
            ? existingAiMaterialRoot.path
            : (
                (await ipc.invoke('create-directory', defaultMaterialRoot, 'AI资料')) as {
                  success: boolean;
                  dirPath: string;
                }
              ).dirPath;

        const existingNames = new Set(
          ((findNodeInTree(filesRef.current, aiMaterialRoot)?.children || []) as FileNode[])
            .filter((node): node is FileNode & { type: 'file' } => node.type === 'file')
            .map((node) => node.name)
        );

        for (const draft of drafts) {
          const fileName = buildUniqueMarkdownName(draft.title, existingNames);
          const created = (await ipc.invoke('create-file', aiMaterialRoot, fileName)) as {
            success: boolean;
            filePath: string;
          };
          const body = [
            `# ${draft.title}`,
            '',
            `类型：${draft.kind}`,
            draft.relatedChapter ? `关联章节：${draft.relatedChapter}` : '',
            draft.keywords.length > 0 ? `关键词：${draft.keywords.join('、')}` : '',
            '',
            draft.summary,
          ]
            .filter(Boolean)
            .join('\n');
          await ipc.invoke('write-file', created.filePath, body);
        }

        await refreshCurrentFolder();
        toast.success(`AI 已生成 ${drafts.length} 条资料笔记`);
      } catch (error) {
        toast.error(`AI 生成资料失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [appSettings.ai.enabled, resolveAIGenerationContext, refreshCurrentFolder, toast]
  );

  const handleGenerateScopedCharacters = useCallback(
    async (scope: AssistantScopeTarget) => {
      const ipc = window.electron?.ipcRenderer;
      const folder = folderPathRef.current;
      if (!ipc || !folder) return;
      if (!appSettings.ai.enabled) {
        toast.warning('请先在设置中心启用并配置 AI');
        return;
      }

      try {
        toast.info(`正在为${scope.label}生成人物上下文...`, 1800);
        const { content, label } = await resolveScopeTargetContext(scope);
        const settingsRaw = (await ipc.invoke('db-settings-get', SETTINGS_STORAGE_KEY)) as
          | string
          | null;
        const settings = settingsRaw
          ? (JSON.parse(settingsRaw) as { ai?: { contextTokens?: number } })
          : {};
        const contextTokens = settings.ai?.contextTokens || 128000;
        const approxChunkChars = Math.max(4000, Math.min(12000, Math.floor(contextTokens * 0.08)));
        const chunks = splitTextIntoChunks(content, approxChunkChars).slice(0, 12);
        const loreEntries = await loadLoreEntriesByFolder(folder);
        const chunkResults: CharacterGraphAIResult[] = [];

        for (let index = 0; index < chunks.length; index += 1) {
          const response = (await ipc.invoke('ai-request', {
            prompt:
              '请从给定正文片段中抽取当前作用域最重要的人物上下文。必须严格返回 JSON 对象，格式为 {"characters":[{"name":"","role":"","description":"","aliases":[]}],"relations":[{"source":"","target":"","label":"","tone":"ally|rival|family|mentor|other","note":""}],"summary":""}。没有内容也必须返回空数组，不要输出 Markdown，不要解释。',
            systemPrompt:
              '你是创作助手的人物上下文引擎。你只保留当前作用域里真正重要、可供继续写作引用的人物。',
            context: [
              `生成范围: ${label}`,
              loreEntries.length > 0
                ? `项目设定参考:\n${loreEntries.map((item) => `${item.title}: ${item.summary}`).join('\n')}`
                : '',
              `正文片段 ${index + 1}/${chunks.length}:\n${chunks[index]}`,
            ]
              .filter(Boolean)
              .join('\n\n'),
          })) as { ok: boolean; text?: string; error?: string };
          if (!response.ok) throw new Error(response.error || 'AI 生成人物上下文失败');
          const parsed = parseCharacterGraphAIResult(response.text || '');
          if (parsed) {
            chunkResults.push(parsed);
          }
        }

        const merged = mergeCharacterGraphResults(chunkResults);
        const nextCharacters = merged.characters
          .map((item) => ({
            name: item.name.trim(),
            role: item.role?.trim() || '',
            description: item.description?.trim() || '',
          }))
          .filter((item) => item.name);
        await persistScopedAssistantArtifacts(scope, { characters: nextCharacters });
        if (
          currentAssistantScope &&
          currentAssistantScope.kind === scope.kind &&
          currentAssistantScope.path === scope.path
        ) {
          setAssistantScopedCharacters(nextCharacters);
        }
        toast.success(`已为${scope.label}生成人物上下文 ${nextCharacters.length} 项`);
      } catch (error) {
        toast.error(
          `AI 生成人物上下文失败: ${error instanceof Error ? error.message : '未知错误'}`
        );
      }
    },
    [
      appSettings.ai.enabled,
      currentAssistantScope,
      persistScopedAssistantArtifacts,
      resolveScopeTargetContext,
      toast,
    ]
  );

  const handleGenerateScopedLore = useCallback(
    async (scope: AssistantScopeTarget) => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) return;
      if (!appSettings.ai.enabled) {
        toast.warning('请先在设置中心启用并配置 AI');
        return;
      }

      try {
        toast.info(`正在为${scope.label}生成设定上下文...`, 1800);
        const { content, label } = await resolveScopeTargetContext(scope);
        const response = (await ipc.invoke('ai-request', {
          prompt:
            '请从给定内容中提炼当前作用域可直接用于写作的设定上下文。必须严格返回 JSON 对象，格式为 {"entries":[{"category":"world|faction|system|term","title":"","summary":"","tags":[""]}]}。只保留对当前作用域真正有帮助的设定，不要输出 Markdown。',
          systemPrompt:
            '你是创作助手的设定编辑。你只输出当前作用域最关键的世界观、规则、势力和术语。',
          context: `生成范围: ${label}\n\n作品内容:\n${content.slice(0, 90000)}`,
        })) as { ok: boolean; text?: string; error?: string };
        if (!response.ok) throw new Error(response.error || 'AI 生成设定上下文失败');
        const nextLore = parseLoreGenerationResult(response.text || '').map((item) => ({
          category: item.category,
          title: item.title,
          summary: item.summary,
        }));
        await persistScopedAssistantArtifacts(scope, { lore: nextLore });
        if (
          currentAssistantScope &&
          currentAssistantScope.kind === scope.kind &&
          currentAssistantScope.path === scope.path
        ) {
          setAssistantScopedLoreEntries(nextLore);
        }
        toast.success(`已为${scope.label}生成设定上下文 ${nextLore.length} 项`);
      } catch (error) {
        toast.error(
          `AI 生成设定上下文失败: ${error instanceof Error ? error.message : '未知错误'}`
        );
      }
    },
    [
      appSettings.ai.enabled,
      currentAssistantScope,
      persistScopedAssistantArtifacts,
      resolveScopeTargetContext,
      toast,
    ]
  );

  const handleGenerateScopedMaterials = useCallback(
    async (scope: AssistantScopeTarget) => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) return;
      if (!appSettings.ai.enabled) {
        toast.warning('请先在设置中心启用并配置 AI');
        return;
      }

      try {
        toast.info(`正在为${scope.label}生成资料上下文...`, 1800);
        const { content, label } = await resolveScopeTargetContext(scope);
        const response = (await ipc.invoke('ai-request', {
          prompt:
            '请根据给定作品内容，生成当前作用域可直接使用的资料上下文。必须严格返回 JSON 对象，格式为 {"materials":[{"title":"","summary":"","kind":"reference|scene|character|setting|research","relatedChapter":"","keywords":[""]}]}。不要输出 Markdown。',
          systemPrompt:
            '你是创作助手的资料编辑。你只保留当前作用域最值得引用的参考资料、场景资料、人物资料和设定资料。',
          context: `生成范围: ${label}\n\n作品内容:\n${content.slice(0, 90000)}`,
        })) as { ok: boolean; text?: string; error?: string };
        if (!response.ok) throw new Error(response.error || 'AI 生成资料上下文失败');
        const nextMaterials = parseMaterialGenerationResult(response.text || '').map((item) => ({
          title: item.title,
          summary: item.summary,
          kind: item.kind,
          relatedChapter: item.relatedChapter || '',
        }));
        await persistScopedAssistantArtifacts(scope, { materials: nextMaterials });
        if (
          currentAssistantScope &&
          currentAssistantScope.kind === scope.kind &&
          currentAssistantScope.path === scope.path
        ) {
          setAssistantScopedMaterials(nextMaterials);
        }
        toast.success(`已为${scope.label}生成资料上下文 ${nextMaterials.length} 项`);
      } catch (error) {
        toast.error(
          `AI 生成资料上下文失败: ${error instanceof Error ? error.message : '未知错误'}`
        );
      }
    },
    [
      appSettings.ai.enabled,
      currentAssistantScope,
      persistScopedAssistantArtifacts,
      resolveScopeTargetContext,
      toast,
    ]
  );

  const handleSplitStoryFile = useCallback(
    async (filePath: string) => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc || !isStoryFilePath(filePath)) return;

      try {
        const raw = await readStoryDocumentText(filePath);
        const chapters = splitChapters(raw).filter(
          (chapter) =>
            chapter.title.trim() &&
            chapter.title.trim() !== '全文' &&
            (chapter.content.trim() || chapter.title.trim())
        );
        if (chapters.length < 2) {
          toast.warning('当前文件未识别出可拆分的多个章节');
          return;
        }
        const preview = chapters
          .slice(0, 8)
          .map((chapter, index) => `${index + 1}. ${chapter.title}`)
          .join('\n');
        const confirmed = await dialog.confirm(
          '按章节拆分',
          `识别到 ${chapters.length} 个章节，将在当前目录生成对应章节文件。\n\n${preview}${chapters.length > 8 ? '\n…' : ''}`
        );
        if (!confirmed) return;

        const targetDir = getParentDirectory(filePath) || folderPathRef.current;
        if (!targetDir) throw new Error('无法确定拆分目标目录');
        const siblings = findNodeInTree(filesRef.current, targetDir)?.children || filesRef.current;
        const existingNames = new Set(
          siblings
            .filter((node): node is FileNode & { type: 'file' } => node.type === 'file')
            .map((node) => node.name)
        );
        const createdPaths: string[] = [];
        for (const chapter of chapters) {
          const fileName = buildUniqueMarkdownName(chapter.title, existingNames);
          const result = (await ipc.invoke('create-file', targetDir, fileName)) as {
            success: boolean;
            filePath: string;
          };
          const nextContent = [`# ${chapter.title}`, '', chapter.content.trim()]
            .filter(Boolean)
            .join('\n');
          await ipc.invoke('write-file', result.filePath, nextContent);
          createdPaths.push(result.filePath);
        }
        await refreshCurrentFolder();
        if (createdPaths[0]) {
          openFileInTab(createdPaths[0]);
        }
        toast.success(`已拆分生成 ${createdPaths.length} 个章节文件`);
      } catch (error) {
        toast.error(`按章节拆分失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [dialog, openFileInTab, readStoryDocumentText, refreshCurrentFolder, toast]
  );

  const contextMenuItems = useMemo(() => {
    if (!contextMenu) return [];
    const menuItem = (
      label: string,
      onClick: () => void,
      options?: { danger?: boolean; disabled?: boolean; separator?: boolean }
    ) => ({
      label,
      onClick,
      danger: options?.danger,
      disabled: options?.disabled,
      separator: options?.separator,
    });

    if (contextMenu.target.kind === 'background') {
      const bgPasteDir = folderPath;
      return [
        ...(folderPath ? [menuItem('修改作品名', () => void handleRenameProject())] : []),
        menuItem('', () => {}, { separator: true }),
        menuItem('新建卷', () => void handleCreateStoryItem('volume')),
        menuItem('新建章', () => void handleCreateStoryItem('chapter')),
        menuItem('新建稿夹', () => void handleCreateStoryItem('draft-folder')),
        menuItem('新建稿', () => void handleCreateStoryItem('draft')),
        menuItem('', () => {}, { separator: true }),
        menuItem('新建人物', () => void handleCreateCharacter()),
        menuItem('新建设定', () => void handleCreateLoreEntry()),
        menuItem('', () => {}, { separator: true }),
        menuItem('新建资料目录', () => void handleCreateMaterialDirectory()),
        menuItem('导入 Word / Excel 文稿', () => void handleImportFile?.(), {
          disabled: !handleImportFile,
        }),
        menuItem('', () => {}, { separator: true }),
        menuItem('粘贴', () => bgPasteDir && handlePasteFiles(bgPasteDir), {
          disabled: !folderPath,
        }),
        menuItem('', () => {}, { separator: true }),
        menuItem('刷新', refreshCurrentFolder),
      ];
    }

    if (contextMenu.target.kind === 'object') {
      const { target } = contextMenu.target;
      switch (target.kind) {
        case 'project-root': {
          const scope = buildProjectAssistantScope();
          if (!scope) return [];
          return [
            menuItem('修改作品名', () => void handleRenameProject()),
            menuItem('', () => {}, { separator: true }),
            menuItem('AI 生成人物', () => void handleGenerateScopedCharacters(scope)),
            menuItem('AI 生成设定', () => void handleGenerateScopedLore(scope)),
            menuItem('AI 生成资料', () => void handleGenerateScopedMaterials(scope)),
          ];
        }
        case 'story-root':
          return [
            menuItem('新建卷', () => void handleCreateStoryItem('volume')),
            menuItem('新建章', () => void handleCreateStoryItem('chapter')),
            menuItem('新建稿夹', () => void handleCreateStoryItem('draft-folder')),
            menuItem('新建稿', () => void handleCreateStoryItem('draft')),
          ];
        case 'volume-item': {
          const scope = buildVolumeAssistantScope(target.volumePath);
          return [
            menuItem('查看详情', () => handleOpenVolumeNode(target.volumePath)),
            menuItem('', () => {}, { separator: true }),
            menuItem('AI 生成人物', () => void handleGenerateScopedCharacters(scope)),
            menuItem('AI 生成设定', () => void handleGenerateScopedLore(scope)),
            menuItem('AI 生成资料', () => void handleGenerateScopedMaterials(scope)),
            menuItem('', () => {}, { separator: true }),
            menuItem(
              '删除卷',
              () => void handleDeleteVolumeNode(target.volumePath, target.isSynthetic),
              {
                danger: true,
                disabled: target.isSynthetic,
              }
            ),
          ];
        }
        case 'characters-root':
          return [
            menuItem('查看详情', handleOpenCharacters),
            menuItem('', () => {}, { separator: true }),
            menuItem('新建人物', () => void handleCreateCharacter()),
            menuItem('清空人物', () => void handleClearCharacters(), { danger: true }),
          ];
        case 'lore-root':
          return [
            menuItem('查看详情', handleOpenLore),
            menuItem('', () => {}, { separator: true }),
            menuItem('新建设定', () => void handleCreateLoreEntry()),
            menuItem('清空设定', () => void handleClearLoreEntries(), { danger: true }),
          ];
        case 'materials-root':
          return [
            menuItem('新建资料目录', () => void handleCreateMaterialDirectory()),
            menuItem('导入 Word / Excel 文稿', () => void handleImportFile?.(), {
              disabled: !handleImportFile,
            }),
            menuItem('', () => {}, { separator: true }),
            menuItem('刷新资料', refreshCurrentFolder),
            menuItem('清空资料', () => void handleClearMaterials(), { danger: true }),
          ];
        case 'character-item': {
          const targetCharacter = workspaceCharacters.find(
            (item) => item.id === target.characterId
          );
          if (!targetCharacter) return [];
          return [
            menuItem('查看详情', () => handleOpenCharacterNode(target.characterId)),
            menuItem('', () => {}, { separator: true }),
            menuItem('删除人物', () => void handleDeleteCharacterNode(target.characterId), {
              danger: true,
            }),
          ];
        }
        case 'lore-item': {
          const targetEntry = workspaceLoreEntries.find((item) => item.id === target.entryId);
          if (!targetEntry) return [];
          return [
            menuItem('查看详情', () => handleOpenLoreNode(target.entryId)),
            menuItem('', () => {}, { separator: true }),
            menuItem('删除设定', () => void handleDeleteLoreNode(target.entryId), {
              danger: true,
            }),
          ];
        }
        default:
          return [];
      }
    }

    const node = contextMenu.target.node;
    const pasteTargetDir =
      node.type === 'directory' ? node.path : node.path.substring(0, node.path.lastIndexOf('/'));
    const items = [
      menuItem('复制', () => handleCopyFile(node.path)),
      menuItem('粘贴', () => handlePasteFiles(pasteTargetDir)),
      menuItem('', () => {}, { separator: true }),
      ...(node.type === 'file' && isStoryFilePath(node.path)
        ? [
            menuItem(
              'AI 生成人物',
              () => void handleGenerateScopedCharacters(buildChapterAssistantScope(node.path))
            ),
            menuItem(
              'AI 生成设定',
              () => void handleGenerateScopedLore(buildChapterAssistantScope(node.path))
            ),
            menuItem(
              'AI 生成资料',
              () => void handleGenerateScopedMaterials(buildChapterAssistantScope(node.path))
            ),
            menuItem('', () => {}, { separator: true }),
          ]
        : []),
      ...(node.type === 'file' && isStoryFilePath(node.path)
        ? [menuItem('按章节拆分', () => void handleSplitStoryFile(node.path))]
        : []),
      ...(node.type === 'file' && isStoryFilePath(node.path)
        ? [menuItem('', () => {}, { separator: true })]
        : []),
    ];
    if (node.type === 'file') {
      items.push(menuItem('删除文件', () => handleDeleteFile(node.path), { danger: true }));
    } else {
      items.push(menuItem('删除文件夹', () => handleDeleteDirectory(node.path), { danger: true }));
    }
    return items;
  }, [
    contextMenu,
    buildChapterAssistantScope,
    buildProjectAssistantScope,
    buildVolumeAssistantScope,
    folderPath,
    handleClearCharacters,
    handleClearLoreEntries,
    handleClearMaterials,
    handleCopyFile,
    handleCreateCharacter,
    handleCreateDirectory,
    handleCreateFile,
    handleCreateLoreEntry,
    handleCreateMaterialDirectory,
    handleCreateStoryItem,
    handleDeleteCharacterNode,
    handleDeleteDirectory,
    handleDeleteFile,
    handleDeleteLoreNode,
    handleDeleteVolumeNode,
    handleGenerateCharacters,
    handleGenerateLoreEntries,
    handleGenerateMaterials,
    handleGenerateScopedCharacters,
    handleGenerateScopedLore,
    handleGenerateScopedMaterials,
    handleImportFile,
    handleOpenCharacterNode,
    handleOpenCharacters,
    handleOpenLore,
    handleOpenLoreNode,
    handleOpenVolumeNode,
    handlePasteFiles,
    handleRenameProject,
    handleRename,
    handleSplitStoryFile,
    refreshCurrentFolder,
    workspaceCharacters,
    workspaceLoreEntries,
  ]);

  React.useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc || !folderPath) {
      setMaterialUsageMap({});
      return;
    }
    let cancelled = false;
    const loadMaterialUsage = async () => {
      try {
        const rows = (await ipc.invoke('db-settings-all')) as Array<{ key: string; value: string }>;
        if (cancelled) return;
        const materialUsage = new Map<string, string[]>();
        rows.forEach((row) => {
          if (
            !row ||
            typeof row.key !== 'string' ||
            !row.key.startsWith(CHAPTER_MATERIALS_STORAGE_PREFIX)
          ) {
            return;
          }
          const chapterPath = row.key.slice(CHAPTER_MATERIALS_STORAGE_PREFIX.length);
          if (!chapterPath || !isPathInWorkspace(chapterPath, folderPath)) return;
          let materialPaths: unknown;
          try {
            materialPaths = JSON.parse(row.value);
          } catch {
            return;
          }
          if (!Array.isArray(materialPaths)) return;
          const chapterName = getNodeDisplayName(chapterPath);
          materialPaths.forEach((materialPath) => {
            if (typeof materialPath !== 'string' || !isPathInWorkspace(materialPath, folderPath)) {
              return;
            }
            const next = materialUsage.get(materialPath) ?? [];
            next.push(chapterName);
            materialUsage.set(materialPath, next);
          });
        });
        setMaterialUsageMap(
          Object.fromEntries(
            Array.from(materialUsage.entries()).map(([materialPath, chapterNames]) => [
              materialPath,
              formatMaterialUsageLabel(chapterNames),
            ])
          )
        );
      } catch {
        if (!cancelled) {
          setMaterialUsageMap({});
        }
      }
    };
    const dispose = ipc.on?.('settings-updated', (_event, key?: string) => {
      if (
        typeof key === 'string' &&
        key.startsWith(CHAPTER_MATERIALS_STORAGE_PREFIX) &&
        !cancelled
      ) {
        void loadMaterialUsage();
      }
    });
    void loadMaterialUsage();
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [folderPath]);

  React.useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    const storageKey = createChapterMaterialsStorageKey(activeDocumentTab);
    if (!ipc || !storageKey || !chapterAssistantEnabled) {
      setChapterMaterialPaths([]);
      return;
    }
    let cancelled = false;
    const loadChapterMaterials = async () => {
      try {
        const raw = (await ipc.invoke('db-settings-get', storageKey)) as string | null;
        if (cancelled) return;
        const parsed = raw ? (JSON.parse(raw) as string[]) : [];
        setChapterMaterialPaths(
          Array.isArray(parsed)
            ? parsed.filter((item): item is string => typeof item === 'string')
            : []
        );
      } catch {
        if (!cancelled) setChapterMaterialPaths([]);
      }
    };
    void loadChapterMaterials();
    return () => {
      cancelled = true;
    };
  }, [activeDocumentTab, chapterAssistantEnabled]);

  React.useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc || !currentAssistantScope) {
      setAssistantScopedCharacters([]);
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
    if (!characterKey || !loreKey || !materialKey) {
      setAssistantScopedCharacters([]);
      setAssistantScopedLoreEntries([]);
      setAssistantScopedMaterials([]);
      return;
    }

    let cancelled = false;
    const loadScopedArtifacts = async () => {
      try {
        const [characterRaw, loreRaw, materialRaw] = (await Promise.all([
          ipc.invoke('db-settings-get', characterKey),
          ipc.invoke('db-settings-get', loreKey),
          ipc.invoke('db-settings-get', materialKey),
        ])) as [string | null, string | null, string | null];
        if (cancelled) return;
        setAssistantScopedCharacters(parseAssistantScopedCharacters(characterRaw));
        setAssistantScopedLoreEntries(parseAssistantScopedLore(loreRaw));
        setAssistantScopedMaterials(parseAssistantScopedMaterials(materialRaw));
      } catch {
        if (cancelled) return;
        setAssistantScopedCharacters([]);
        setAssistantScopedLoreEntries([]);
        setAssistantScopedMaterials([]);
      }
    };

    const watchedKeys = new Set([characterKey, loreKey, materialKey]);
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

  const persistChapterMaterials = useCallback(
    async (nextPaths: string[]) => {
      const ipc = window.electron?.ipcRenderer;
      const storageKey = createChapterMaterialsStorageKey(activeDocumentTab);
      if (!ipc || !storageKey) return;
      await ipc.invoke('db-settings-set', storageKey, JSON.stringify(nextPaths));
    },
    [activeDocumentTab]
  );

  const handleAddChapterMaterial = useCallback(
    (path: string) => {
      setChapterMaterialPaths((prev) => {
        if (prev.includes(path)) return prev;
        const next = [...prev, path];
        void persistChapterMaterials(next);
        return next;
      });
    },
    [persistChapterMaterials]
  );

  const handleRemoveChapterMaterial = useCallback(
    (path: string) => {
      setChapterMaterialPaths((prev) => {
        const next = prev.filter((item) => item !== path);
        void persistChapterMaterials(next);
        return next;
      });
    },
    [persistChapterMaterials]
  );

  const workspaceTabLabels = useMemo<Record<string, string>>(
    () => ({
      ...WORKSPACE_TAB_LABELS,
      ...Object.fromEntries(
        workspaceCharacters.map((item) => [createCharacterWorkspaceTab(item), item.name])
      ),
      ...Object.fromEntries(
        workspaceLoreEntries.map((item) => [createLoreWorkspaceTab(item), item.title])
      ),
      ...Object.fromEntries(
        openTabs
          .map((tab) => parseVolumeWorkspaceTab(tab))
          .filter((path): path is string => Boolean(path))
          .map((volumePath) => {
            const node = findNodeInTree(files, volumePath);
            const label =
              node?.name ||
              (rootVolumeNode && folderPath && volumePath === folderPath
                ? rootVolumeNode.name
                : '卷规划');
            return [createVolumeWorkspaceTab(volumePath), label];
          })
      ),
    }),
    [files, folderPath, openTabs, rootVolumeNode, workspaceCharacters, workspaceLoreEntries]
  );

  const specialTabContent = useMemo<Record<string, React.ReactNode>>(
    () => ({
      [WORKSPACE_TAB_CHARACTERS]: (
        <CharactersView
          key={`characters-root-${workspaceCharactersVersion}`}
          folderPath={folderPath}
          content={editorContent}
          onCharactersChange={syncWorkspaceCharacters}
        />
      ),
      [WORKSPACE_TAB_LORE]: (
        <LoreView
          key={`lore-root-${workspaceLoreVersion}`}
          folderPath={folderPath}
          content={editorContent}
          onEntriesChange={syncWorkspaceLoreEntries}
        />
      ),
      ...(selectedCharacterTabId
        ? {
            [activeWorkspaceTab as string]: (
              <CharactersView
                key={`character-${selectedCharacterTabId}-${workspaceCharactersVersion}`}
                folderPath={folderPath}
                content={editorContent}
                initialSelectedCharacterId={selectedCharacterTabId}
                onCharactersChange={syncWorkspaceCharacters}
              />
            ),
          }
        : {}),
      ...(selectedLoreEntryTabId
        ? {
            [activeWorkspaceTab as string]: (
              <LoreView
                key={`lore-${selectedLoreEntryTabId}-${workspaceLoreVersion}`}
                folderPath={folderPath}
                content={editorContent}
                initialEntryId={selectedLoreEntryTabId}
                onEntriesChange={syncWorkspaceLoreEntries}
              />
            ),
          }
        : {}),
      ...(selectedVolumePath && selectedVolumeNode?.type === 'directory'
        ? {
            [activeWorkspaceTab as string]: (
              <VolumeWorkspaceView
                volumePath={selectedVolumePath}
                volumeName={selectedVolumeNode.name}
                volumeNode={selectedVolumeNode}
                storyOrderMap={storyOrderMap}
                onOpenFile={openFileInTab}
                onCreateChapter={() => void handleCreateStoryItem('chapter')}
                onCreateDraftFolder={() => void handleCreateStoryItem('draft-folder')}
                onCreateDraft={() => void handleCreateStoryItem('draft')}
              />
            ),
          }
        : {}),
    }),
    [
      activeWorkspaceTab,
      editorContent,
      folderPath,
      openFileInTab,
      handleCreateStoryItem,
      selectedCharacterTabId,
      selectedLoreEntryTabId,
      selectedVolumeNode,
      selectedVolumePath,
      syncWorkspaceCharacters,
      syncWorkspaceLoreEntries,
      storyOrderMap,
      workspaceCharactersVersion,
      workspaceLoreVersion,
    ]
  );

  const handleCloseAllAndSave = useCallback(() => {
    // 先触发保存当前文件
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true })
    );
    // 短延迟后关闭所有标签，确保保存完成
    setTimeout(() => {
      setOpenTabs([]);
      setActiveTab(null);
    }, 200);
  }, []);

  // 监听子组件通过自定义事件打开设置中心指定标签页
  React.useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent).detail as SettingsTab;
      setSettingsCenterTab(tab);
      setShowSettingsCenter(true);
    };
    window.addEventListener('open-settings-tab', handler);
    return () => window.removeEventListener('open-settings-tab', handler);
  }, []);

  return (
    <AiConfigProvider>
      <div className={`${styles.app} ${focusMode ? styles.focusMode : ''}`}>
        {!focusMode && (
          <TitleBar
            focusMode={focusMode}
            userInitials="U"
            onToggleFocusMode={toggleFocusMode}
            onOpenSettings={() => {
              setSettingsCenterTab('general');
              setShowSettingsCenter(true);
            }}
            onAvatarClick={() => {
              setSettingsCenterTab('general');
              setShowSettingsCenter(true);
            }}
            onShowShortcuts={() => setShowShortcuts(true)}
            onOpenSampleData={handleOpenSampleData}
            onOpenAIAssistant={() => setShowAIAssistant(true)}
            onExportProject={handleExportProject}
          />
        )}

        <div className={styles.appMain} ref={appMainRef}>
          {/* 左侧文件面板 */}
          {!focusMode && (
            <div
              ref={sidebarRef}
              className={`${styles.leftPanel} ${sidebarCollapsed ? styles.leftPanelCollapsed : ''}`}
              style={sidebarCollapsed ? undefined : { width: leftPanelWidth }}
            >
              {sidebarCollapsed ? (
                <button
                  className={styles.sidebarToggle}
                  onClick={handleExpandSidebar}
                  title="展开侧边栏"
                >
                  ▶
                </button>
              ) : (
                <FilePanel
                  files={files}
                  characters={workspaceCharacters}
                  loreEntries={workspaceLoreEntries}
                  materialUsageMap={materialUsageMap}
                  projectName={workspaceProjectName}
                  selectedFile={activeDocumentTab}
                  activeWorkspaceTab={activeWorkspaceTab}
                  folderPath={folderPath}
                  showFileSizes={appSettings.general.showFileSizes}
                  quickOpenShortcut={appSettings.shortcuts.quickOpen}
                  isLoading={isLoading}
                  onFileSelect={handleFileSelect}
                  onOpenCharacterNode={handleOpenCharacterNode}
                  onOpenLoreNode={handleOpenLoreNode}
                  onDeleteCharacterNode={handleDeleteCharacterNode}
                  onDeleteLoreNode={handleDeleteLoreNode}
                  onRenameCharacterNode={handleRenameCharacterNode}
                  onRenameLoreNode={handleRenameLoreNode}
                  onRenameNode={handleRename}
                  storyOrderMap={storyOrderMap}
                  onReorderStoryNode={(sourcePath, targetPath, mode) =>
                    void handleReorderStoryNode(sourcePath, targetPath, mode)
                  }
                  onCreateVolume={() => void handleCreateStoryItem('volume')}
                  onCreateChapter={() => void handleCreateStoryItem('chapter')}
                  onCreateDraftFolder={() => void handleCreateStoryItem('draft-folder')}
                  onCreateDraft={() => void handleCreateStoryItem('draft')}
                  onCreateCharacter={() => void handleCreateCharacter()}
                  onCreateLoreEntry={() => void handleCreateLoreEntry()}
                  onCreateMaterialDirectory={() => void handleCreateMaterialDirectory()}
                  onRefresh={refreshCurrentFolder}
                  onOpenFolder={handleOpenLocal}
                  onRenameProject={() => void handleRenameProject()}
                  onImportFile={handleImportFile}
                  onCollapse={handleCollapseSidebar}
                  onContextMenu={handleFileContextMenu}
                  onObjectContextMenu={handleObjectContextMenu}
                  onBackgroundContextMenu={handleBackgroundContextMenu}
                  onCopyFile={handleCopyFile}
                  onPasteFiles={handlePasteFiles}
                  onDropFiles={handleDropFiles}
                  hasClipboard={clipboard.length > 0}
                  creatingType={creatingType}
                  createTargetPath={createTargetPath}
                  onInlineCreate={handleInlineCreate}
                  onCancelCreate={handleCancelCreate}
                />
              )}
            </div>
          )}

          {/* 左侧拖拽把手 */}
          {!focusMode && !sidebarCollapsed && (
            <PanelResizer onMouseDown={handleLeftResizerMouseDown} />
          )}

          {/* 中间内容面板 */}
          <div className={styles.centerPanel} style={{ minWidth: CENTER_MIN }}>
            {diffState ? (
              <Suspense fallback={<div className={styles.lazyFallback}>正在加载差异编辑器...</div>}>
                <DiffEditor
                  original={diffState.original}
                  modified={diffState.modified}
                  originalLabel={diffState.originalLabel}
                  modifiedLabel={diffState.modifiedLabel}
                  onClose={handleCloseDiff}
                  onAccept={pendingApplyQueue.length > 0 ? handleAcceptFix : undefined}
                />
              </Suspense>
            ) : (
              <ContentPanel
                openTabs={openTabs}
                activeTab={activeTab}
                tabLabels={workspaceTabLabels}
                specialTabContent={specialTabContent}
                focusMode={focusMode}
                reloadToken={editorReloadToken}
                encoding={encoding}
                scrollToLine={scrollToLine}
                transientHighlightLine={transientHighlightLine}
                replaceLineRequest={replaceLineRequest}
                inlineDiff={inlineDiff}
                editorViewRef={editorViewRef}
                viewportSnapshots={initialViewportSnapshots}
                onViewportSnapshotChange={handleViewportSnapshotChange}
                onTabSelect={setActiveTab}
                onTabClose={closeTab}
                onCloseOtherTabs={handleCloseOtherTabs}
                onCloseAllTabs={handleCloseAllTabs}
                onCloseAllAndSave={handleCloseAllAndSave}
                onContentChange={handleContentChange}
                onCursorChange={handleCursorChange}
                onSaveUntitled={handleSaveUntitled}
                onScrollProcessed={handleScrollProcessed}
                onTransientHighlightProcessed={handleTransientHighlightProcessed}
              />
            )}
            {focusMode && (
              <button
                className={styles.exitFocusBtn}
                onClick={toggleFocusMode}
                title="退出聚焦模式 (F11)"
              >
                退出聚焦
              </button>
            )}
          </div>

          {/* 右侧拖拽把手 + 右侧信息面板 */}
          {!focusMode && !rightPanelPoppedOut && (
            <>
              {!rightPanelCollapsed && <PanelResizer onMouseDown={handleRightResizerMouseDown} />}
              <div
                className={styles.rightPanelWrapper}
                style={
                  rightPanelCollapsed
                    ? { width: RIGHT_COLLAPSED_WIDTH }
                    : { width: rightPanelWidth }
                }
              >
                {rightPanelCollapsed ? (
                  <button
                    className={styles.rightPanelToggle}
                    onClick={handleToggleRightPanel}
                    title="展开辅助面板"
                  >
                    ◀
                  </button>
                ) : (
                  <Suspense
                    fallback={<div className={styles.lazyFallback}>正在加载辅助面板...</div>}
                  >
                    <RightPanel
                      content={activeDocumentTab ? editorContent : ''}
                      collapsed={rightPanelCollapsed}
                      enabled={Boolean(folderPath)}
                      scopeKind={currentAssistantScope?.kind}
                      scopeLabel={currentAssistantScope?.label}
                      outlineScope={currentOutlineScope}
                      materialFiles={materialFiles.map((item) => ({
                        path: item.path,
                        name: item.name,
                      }))}
                      linkedMaterialPaths={linkedMaterialFiles.map((item) => item.path)}
                      scopedCharacters={assistantScopedCharacters}
                      scopedLoreEntries={assistantScopedLoreEntries}
                      scopedMaterials={assistantScopedMaterials}
                      onToggle={handleToggleRightPanel}
                      onPopOut={handlePopOutRightPanel}
                      onOpenMaterial={openFileInTab}
                      onAddMaterial={handleAddChapterMaterial}
                      onRemoveMaterial={handleRemoveChapterMaterial}
                      onScrollToLine={handleScrollToLine}
                      onReplaceLineText={handleReplaceLineText}
                      folderPath={folderPath}
                      dbReady={dbReady}
                      currentLine={cursorPosition.line}
                    />
                  </Suspense>
                )}
              </div>
            </>
          )}
        </div>

        {/* 版本历史模态框 */}
        {showVersionHistory && (
          <Suspense
            fallback={
              <div className={styles.lazyOverlay}>
                <div className={styles.lazyModal}>正在加载版本历史...</div>
              </div>
            }
          >
            <VersionTimeline
              visible={showVersionHistory}
              onClose={() => setShowVersionHistory(false)}
              folderPath={folderPath}
              filePath={activeDocumentTab}
              onDiffRequest={handleDiffRequest}
              onRestoreFile={handleVersionRestore}
            />
          </Suspense>
        )}

        {/* 状态栏 */}
        {!focusMode && appSettings.general.showStatusBar && (
          <StatusBar
            content={editorContent}
            currentLine={cursorPosition.line}
            currentColumn={cursorPosition.column}
            filePath={activeDocumentTab}
            encoding={encoding}
            onEncodingChange={setEncoding}
            folderPath={folderPath}
            onToggleVersionHistory={() => setShowVersionHistory((p) => !p)}
          />
        )}

        {/* 右键菜单 */}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={contextMenuItems}
            onClose={handleCloseContextMenu}
          />
        )}

        {/* 快捷键帮助 */}
        <ShortcutsHelp
          visible={showShortcuts}
          onClose={() => setShowShortcuts(false)}
          onOpenSampleData={handleOpenSampleData}
        />

        <AppSettingsCenter
          visible={showSettingsCenter}
          onClose={() => setShowSettingsCenter(false)}
          initialTab={settingsCenterTab}
          onSettingsChange={setAppSettings}
          onOpenShortcuts={() => setShowShortcuts(true)}
        />

        <AIAssistantDialog
          visible={showAIAssistant}
          onClose={() => setShowAIAssistant(false)}
          folderPath={folderPath}
          content={editorContent}
          filePath={activeDocumentTab}
          onApplyFix={async (
            original: string,
            modified: string,
            targetPath?: string,
            targetLine?: number
          ) => {
            dispatchFixCommand({ type: 'FIX_APPLY_STARTED' });
            const view = editorViewRef.current;
            const ipc = window.electron?.ipcRenderer;
            const isCurrentTab = !targetPath || targetPath === activeTabRef.current;

            if (isCurrentTab && view) {
              // ── 原子事务：文档变更 + diff 装饰在同一个 CM6 transaction ──
              const doc = view.state.doc.toString();
              const matchFrom = doc.indexOf(original);
              if (matchFrom >= 0) {
                const diffEffect = setInlineDiffEffect.of({
                  from: matchFrom,
                  to: matchFrom + modified.length,
                  oldText: original,
                  newText: modified,
                });
                view.dispatch({
                  changes: { from: matchFrom, to: matchFrom + original.length, insert: modified },
                  effects: diffEffect,
                  selection: { anchor: matchFrom },
                  scrollIntoView: true,
                });
              } else {
                const result = preciseReplaceWithReport(doc, original, modified);
                if (result.content) {
                  const newFrom = result.content.indexOf(modified);
                  const effects =
                    newFrom >= 0
                      ? setInlineDiffEffect.of({
                          from: newFrom,
                          to: newFrom + modified.length,
                          oldText: original,
                          newText: modified,
                        })
                      : undefined;
                  view.dispatch({
                    changes: { from: 0, to: doc.length, insert: result.content },
                    effects: effects ? [effects] : undefined,
                    selection: newFrom >= 0 ? { anchor: newFrom } : undefined,
                    scrollIntoView: newFrom >= 0,
                  });
                }
              }
              // 同步 state + 写盘
              const newDoc = view.state.doc.toString();
              setEditorContent(newDoc);
              if (ipc && targetPath) {
                ipc.invoke('write-file', targetPath, newDoc).catch(() => {});
              }

              // React state 同步（仅用于 SQLite 持久化）
              const postDoc = view.state.doc.toString();
              const newFrom = postDoc.indexOf(modified);
              if (newFrom >= 0) {
                dispatchFixCommand({
                  type: 'FIX_PREVIEW_READY',
                  inlineDiff: {
                    from: newFrom,
                    to: newFrom + modified.length,
                    oldText: original,
                    newText: modified,
                  },
                });
              }
            } else {
              // 非当前 tab：读盘 → 替换 → 写盘 → reloadToken
              if (ipc && targetPath) {
                try {
                  const diskContent = (await ipc.invoke('read-file', targetPath)) as string;
                  const result = preciseReplaceWithReport(diskContent, original, modified);
                  if (result.content) {
                    await ipc.invoke('write-file', targetPath, result.content);
                  }
                } catch {
                  dispatchFixCommand({ type: 'FIX_APPLY_FAILED', error: '文件读写失败' });
                  return;
                }
              }
              setEditorReloadToken((prev) => prev + 1);
            }
            dispatchFixCommand({ type: 'FIX_APPLY_SUCCEEDED', keepPreview: true });
            // Scroll + highlight
            if (targetLine && targetLine > 0) {
              setScrollToLine({
                line: targetLine,
                id: fnv1a32(`fix:${targetLine}:${original}`),
              });
              setTransientHighlightLine({
                line: targetLine,
                id: fnv1a32(`fix:${targetLine}:${original}`),
              });
            }
          }}
          onOpenFile={openFileInTab}
          onPreviewDiff={(original, modified) => {
            // 在编辑器文档中定位 original 片段，设置内联 diff 装饰
            const view = editorViewRef.current;
            if (!view) return;
            const doc = view.state.doc.toString();
            let from = doc.indexOf(original);
            if (from < 0) {
              // 归一化回退查找
              const match = normalizedSearchInDoc(doc, original);
              if (!match) return;
              from = match.from;
            }
            const inlineDiffData = {
              from,
              to: from + original.length,
              oldText: original,
              newText: modified,
            };
            // ── 直接 dispatch 到 CM6，不经过 React state pipeline ──
            // 确保装饰立即生效，不受 BroadcastChannel / useEffect 时序干扰
            const line = view.state.doc.lineAt(Math.min(from, view.state.doc.length));
            view.dispatch({
              effects: setInlineDiffEffect.of(inlineDiffData),
              selection: { anchor: line.from },
              scrollIntoView: true,
            });
            // React state 同步（仅用于 SQLite 持久化）
            dispatchFixCommand({
              type: 'FIX_PREVIEW_READY',
              inlineDiff: inlineDiffData,
            });
          }}
          onOpenSettings={() => {
            setShowAIAssistant(false);
            setSettingsCenterTab('ai');
            setShowSettingsCenter(true);
          }}
        />
      </div>
    </AiConfigProvider>
  );
};

export default App;
