// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

/**
 * App 卡片式三栏布局：只验证外层容器结构（卡片 / 折叠条 / 拖拽把手 / 专注模式），
 * 面板内部组件全部替换为占位，useAppController 替换为可配置的桩。
 */

interface LayoutFlags {
  sidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
  rightPanelPoppedOut: boolean;
  focusMode: boolean;
  showStatusBar: boolean;
}

const flags: LayoutFlags = {
  sidebarCollapsed: false,
  rightPanelCollapsed: false,
  rightPanelPoppedOut: false,
  focusMode: false,
  showStatusBar: true,
};

const layoutApi = {
  handleExpandSidebar: vi.fn(),
  handleCollapseSidebar: vi.fn(),
  handleLeftResizerMouseDown: vi.fn(),
  handleRightResizerMouseDown: vi.fn(),
  handleToggleRightPanel: vi.fn(),
};

/** 未显式提供的字段一律返回 no-op 函数，避免为整个控制器手写桩 */
function stub<T extends object>(fields: T): T {
  return new Proxy(fields, {
    get(target, key) {
      if (key in target) return (target as Record<PropertyKey, unknown>)[key];
      return () => undefined;
    },
  });
}

function buildController() {
  return {
    workspaceState: stub({
      files: [],
      folderPath: '/book',
      projectLayout: null,
      isLoading: false,
      storyOrderMap: {},
      dbReady: true,
    }),
    tabsState: stub({ openTabs: [], activeTab: null }),
    layoutState: stub({
      sidebarCollapsed: flags.sidebarCollapsed,
      rightPanelCollapsed: flags.rightPanelCollapsed,
      rightPanelPoppedOut: flags.rightPanelPoppedOut,
      focusMode: flags.focusMode,
      leftPanelWidth: 260,
      rightPanelWidth: 300,
      sidebarRef: { current: null },
      appMainRef: { current: null },
    }),
    editorState: stub({
      editorContent: '',
      cursorPosition: { line: 1, column: 1 },
      encoding: 'utf-8',
      scrollToLine: null,
      replaceLineRequest: null,
      transientHighlightLine: null,
      editorReloadToken: 0,
      initialViewportSnapshots: {},
      editorViewRef: { current: null },
    }),
    aiState: stub({
      inlineDiff: null,
      diffState: null,
      pendingApplyQueue: [],
      assistantCharacterGenerationStatus: null,
    }),
    entitiesState: stub({
      workspaceCharacters: [],
      workspaceLoreEntries: [],
      workspaceProjectName: '示例',
      materialUsageMap: {},
    }),
    settingsState: stub({
      appSettings: {
        general: {
          showStatusBar: flags.showStatusBar,
          showFileSizes: false,
          showThousandCharMarkers: false,
          thousandCharMarkerStep: 1000,
        },
        shortcuts: {
          quickOpen: 'Mod+P',
          formatChapter: 'Mod+Shift+F',
          openInspiration: 'Mod+Shift+Y',
        },
      },
    }),
    uiState: stub({
      contextMenu: null,
      clipboard: [],
      creatingType: null,
      filePanelRevealRequest: null,
      showShortcuts: false,
      showSettingsCenter: false,
      showAIAssistant: false,
      settingsCenterTab: 'general',
      showVersionHistory: false,
      showKnowledgeExportDialog: false,
      showAboutDialog: false,
      knowledgeExportOptions: {},
    }),
    derived: stub({
      activeWorkspaceTab: null,
      activeUntitledVirtualContent: null,
      activeDocumentTab: null,
      currentAssistantScope: null,
      currentOutlineScope: null,
    }),
    layout: layoutApi,
    tabs: stub({}),
    editorSession: stub({}),
    settingsActions: stub({}),
    loader: stub({}),
    creation: stub({ createTargetPath: null }),
    entityActions: stub({}),
    growthEntry: stub({ growthIndex: null }),
    workScopeApi: stub({ workScope: null, workScopeOptions: [] }),
    fileOps: stub({}),
    editor: stub({}),
    projectExport: stub({}),
    handlePopOutRightPanel: vi.fn(),
    contextMenuItems: [],
    assistantContext: { scope: null, characters: [], loreEntries: [], materials: [] },
    workspaceTabLabels: {},
    editorCharacterHighlights: [],
    specialTabContent: null,
    handleAssistantApplyFix: vi.fn(),
    handleAssistantPreviewDiff: vi.fn(),
    inspiration: {
      inspirationVisible: false,
      inspirationCardId: null,
      closeInspiration: vi.fn(),
      handleInsertInspiration: vi.fn(),
    },
  };
}

vi.mock('@/render/hooks/useAppController', () => ({
  useAppController: () => buildController(),
}));

const placeholder = (testId: string) => ({
  default: () => <div data-testid={testId} />,
});

vi.mock('@/render/components/TitleBar', () => placeholder('title-bar'));
vi.mock('@/render/components/FilePanel', () => placeholder('file-panel'));
// ContentPanel 记录收到的 props，用于校验灵感入口（文件栏胶囊 / 空编辑器主操作）的接线
const contentPanelProps: { current: Record<string, unknown> | null } = { current: null };
vi.mock('@/render/components/ContentPanel', () => ({
  default: (props: Record<string, unknown>) => {
    contentPanelProps.current = props;
    return <div data-testid="content-panel" />;
  },
}));
vi.mock('@/render/components/RightPanel', () => placeholder('right-panel'));
vi.mock('@/render/components/StatusBar', () => placeholder('status-bar'));
vi.mock('@/render/components/ContextMenu', () => placeholder('context-menu'));
vi.mock('@/render/components/ShortcutsHelp', () => placeholder('shortcuts'));
vi.mock('@/render/components/AppSettingsCenter', () => placeholder('settings'));
vi.mock('@/render/components/KnowledgeExportDialog', () => placeholder('knowledge'));
vi.mock('@/render/components/AboutDialog', () => placeholder('about'));
vi.mock('@/render/components/VersionTimeline', () => placeholder('versions'));
vi.mock('@/render/components/DiffEditor', () => placeholder('diff'));
vi.mock('@/render/components/InspirationDialog', () => placeholder('inspiration'));
vi.mock('@/render/components/InspirationButton', () => ({
  default: ({ variant = 'pill', shortcut }: { variant?: string; shortcut?: string }) => (
    <div data-testid={`inspiration-button-${variant}`} data-shortcut={shortcut} />
  ),
}));
vi.mock('@/render/components/RightPanel/AIAssistantDialog', () => ({
  AIAssistantDialog: () => null,
}));
vi.mock('@/render/components/RightPanel/useAiConfig', () => ({
  AiConfigProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const { default: App } = await import('@/render/App');

const pane = (name: string) => document.querySelector<HTMLElement>(`[data-pane="${name}"]`);
const resizers = () => screen.queryAllByRole('separator');

beforeEach(() => {
  Object.assign(flags, {
    sidebarCollapsed: false,
    rightPanelCollapsed: false,
    rightPanelPoppedOut: false,
    focusMode: false,
    showStatusBar: true,
  });
  Object.values(layoutApi).forEach((fn) => fn.mockClear());
});

afterEach(() => cleanup());

describe('App 卡片式三栏布局', () => {
  it('默认渲染左 / 中 / 右三张卡片，两个拖拽把手位于卡片间距中', async () => {
    render(<App />);
    await screen.findByTestId('right-panel');

    const left = pane('left') as HTMLElement;
    const center = pane('center') as HTMLElement;
    const right = pane('right') as HTMLElement;
    expect(left.className).toContain('leftPanel');
    expect(left.style.width).toBe('260px');
    expect(center.className).toContain('centerPanel');
    expect(right.className).toContain('rightPanelWrapper');
    expect(right.style.width).toBe('300px');

    // DOM 顺序：左卡片 → 把手 → 中卡片 → 把手 → 右卡片
    const main = center.parentElement as HTMLElement;
    expect(main.className).toContain('appMain');
    const order = Array.from(main.children).map(
      (el) => el.getAttribute('data-pane') ?? el.getAttribute('role')
    );
    expect(order).toEqual(['left', 'separator', 'center', 'separator', 'right']);
    expect(pane('left-rail')).toBeNull();
    expect(pane('right-rail')).toBeNull();
  });

  it('拖拽把手转发 mousedown 到布局 API', async () => {
    render(<App />);
    await screen.findByTestId('right-panel');
    const [leftResizer, rightResizer] = resizers();
    fireEvent.mouseDown(leftResizer);
    fireEvent.mouseDown(rightResizer);
    expect(layoutApi.handleLeftResizerMouseDown).toHaveBeenCalledTimes(1);
    expect(layoutApi.handleRightResizerMouseDown).toHaveBeenCalledTimes(1);
    expect(leftResizer.getAttribute('aria-label')).toBe('调整左侧面板宽度');
  });

  it('左侧折叠后整张卡片和把手都消失，只保留展开按钮', async () => {
    flags.sidebarCollapsed = true;
    render(<App />);
    await screen.findByTestId('right-panel');
    expect(pane('left')).toBeNull();
    expect(screen.queryByTestId('file-panel')).toBeNull();
    expect(pane('left-rail')?.className).toContain('sideRail');
    expect(resizers()).toHaveLength(1);

    fireEvent.click(screen.getByTitle('展开侧边栏'));
    expect(layoutApi.handleExpandSidebar).toHaveBeenCalledTimes(1);
  });

  it('右侧折叠后整张卡片和把手都消失，只保留展开按钮', () => {
    flags.rightPanelCollapsed = true;
    render(<App />);
    expect(pane('right')).toBeNull();
    expect(pane('right-rail')?.className).toContain('sideRailRight');
    expect(resizers()).toHaveLength(1);

    fireEvent.click(screen.getByTitle('展开辅助面板'));
    expect(layoutApi.handleToggleRightPanel).toHaveBeenCalledTimes(1);
  });

  it('右侧面板弹出为独立窗口时主窗口不渲染右卡片与右把手', () => {
    flags.rightPanelPoppedOut = true;
    render(<App />);
    expect(pane('right')).toBeNull();
    expect(pane('right-rail')).toBeNull();
    expect(resizers()).toHaveLength(1);
  });

  it('专注模式只保留中间卡片，并隐藏标题栏与状态栏', () => {
    flags.focusMode = true;
    const { container } = render(<App />);
    expect((container.firstChild as HTMLElement).className).toContain('focusMode');
    expect(pane('center')).not.toBeNull();
    expect(pane('left')).toBeNull();
    expect(pane('right')).toBeNull();
    expect(pane('left-rail')).toBeNull();
    expect(pane('right-rail')).toBeNull();
    expect(resizers()).toHaveLength(0);
    expect(screen.queryByTestId('title-bar')).toBeNull();
    expect(screen.queryByTestId('status-bar')).toBeNull();
    expect(screen.getByTitle('退出聚焦模式 (Esc / F11)')).toBeTruthy();
  });

  it('显示状态栏时三栏容器去掉底部外边距，隐藏时保留', async () => {
    const { unmount } = render(<App />);
    await screen.findByTestId('right-panel');
    expect((pane('center')?.parentElement as HTMLElement).className).toContain(
      'appMainWithStatusBar'
    );
    expect(screen.getByTestId('status-bar')).toBeTruthy();
    unmount();

    flags.showStatusBar = false;
    render(<App />);
    expect((pane('center')?.parentElement as HTMLElement).className).not.toContain(
      'appMainWithStatusBar'
    );
    expect(screen.queryByTestId('status-bar')).toBeNull();
  });

  it('灵感入口：编辑器文件栏胶囊 + 空编辑器主操作，都带当前快捷键', async () => {
    render(<App />);
    await screen.findByTestId('right-panel');
    const props = contentPanelProps.current as Record<string, React.ReactNode>;
    const { getByTestId } = render(
      <>
        {props.editorHeaderActions}
        {props.emptyStateActions}
      </>
    );
    expect(getByTestId('inspiration-button-pill').getAttribute('data-shortcut')).toBe(
      'Mod+Shift+Y'
    );
    expect(getByTestId('inspiration-button-primary').getAttribute('data-shortcut')).toBe(
      'Mod+Shift+Y'
    );
  });
});
