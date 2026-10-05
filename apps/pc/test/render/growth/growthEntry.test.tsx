// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import {
  WORKSPACE_TAB_GROWTH,
  createGrowthWorkspaceTab,
  getWorkspaceTabLabel,
  isGrowthWorkspaceTab,
  isWorkspaceTab,
  parseGrowthWorkspaceTab,
} from '@/render/utils/workspace';
import {
  GROWTH_MEMORY_CHANGED_EVENT,
  emitGrowthMemoryChanged,
  findGrowthSheetSummary,
  formatGrowthSheetMeta,
  summarizeGrowthSnapshot,
  type GrowthSheetSummary,
} from '@/render/utils/growthIndex';
import { useGrowthEntry, type UseGrowthEntryContext } from '@/render/hooks/useGrowthEntry';
import GrowthSection from '@/render/components/FilePanel/GrowthSection';
import { filterGrowthSheets, shouldShowGrowthSection } from '@/render/components/FilePanel/utils';
import { CharacterGrowthButton } from '@/render/components/RightPanel/CharactersView/CharacterGrowthButton';
import { GrowthView } from '@/render/components/RightPanel/GrowthView';
import type { GrowthSnapshot } from '@/render/types/growth-api';
import { installElectronMock, uninstallElectronMock } from '../hooks/electronMock';
import { makeDialog, makeToast } from '../hooks/hookCtx';
import { FOLDER, buildSnapshot } from './fixtures';

afterEach(() => {
  uninstallElectronMock();
});

function ok<T>(data: T) {
  return { ok: true as const, data };
}

const SUMMARY: GrowthSheetSummary = {
  name: '阿尔',
  aliases: ['小阿'],
  level: 2,
  exp: 400,
  latestChapter: 3,
  errorCount: 0,
  warningCount: 0,
};

describe('成长档案工作区标签', () => {
  it('创建 / 解析总览与角色标签，并识别为工作区标签', () => {
    expect(createGrowthWorkspaceTab()).toBe(WORKSPACE_TAB_GROWTH);
    expect(createGrowthWorkspaceTab('  ')).toBe(WORKSPACE_TAB_GROWTH);
    const tab = createGrowthWorkspaceTab(' 林舟 ');
    expect(tab).toBe('__workspace__:growth:林舟');
    expect(parseGrowthWorkspaceTab(tab)).toBe('林舟');
    expect(parseGrowthWorkspaceTab(WORKSPACE_TAB_GROWTH)).toBeNull();
    expect(parseGrowthWorkspaceTab('/n/a.md')).toBeNull();
    expect(isGrowthWorkspaceTab(WORKSPACE_TAB_GROWTH)).toBe(true);
    expect(isGrowthWorkspaceTab(tab)).toBe(true);
    expect(isGrowthWorkspaceTab('__workspace__:characters')).toBe(false);
    expect(isWorkspaceTab(WORKSPACE_TAB_GROWTH)).toBe(true);
    expect(isWorkspaceTab(tab)).toBe(true);
    expect(getWorkspaceTabLabel(WORKSPACE_TAB_GROWTH)).toBe('成长档案');
  });
});

describe('growthIndex', () => {
  it('从快照生成摘要，并按名字或别名查找', () => {
    const index = summarizeGrowthSnapshot(buildSnapshot());
    expect(index.initialized).toBe(true);
    expect(index.sheets).toEqual([
      expect.objectContaining({ name: '阿尔', level: 2, exp: 400, latestChapter: 3 }),
    ]);
    expect(findGrowthSheetSummary(index, '阿尔')?.level).toBe(2);
    expect(findGrowthSheetSummary(null, '阿尔')).toBeNull();
    expect(findGrowthSheetSummary(index, '不存在')).toBeNull();
    expect(
      findGrowthSheetSummary({ initialized: true, sheets: [SUMMARY] }, '阿尔德', ['小阿'])?.name
    ).toBe('阿尔');
  });

  it('格式化文件面板行内信息', () => {
    expect(formatGrowthSheetMeta(SUMMARY)).toBe('经验 400 · 第 3 章');
    expect(formatGrowthSheetMeta({ ...SUMMARY, latestChapter: 0, errorCount: 2 })).toBe(
      '经验 400 · 2 处冲突'
    );
  });

  it('按名字与别名筛选，搜索「成长」时保留分区', () => {
    expect(filterGrowthSheets([SUMMARY], '')).toEqual([SUMMARY]);
    expect(filterGrowthSheets([SUMMARY], '小阿')).toEqual([SUMMARY]);
    expect(filterGrowthSheets([SUMMARY], '林')).toEqual([]);
    expect(shouldShowGrowthSection('', 0)).toBe(true);
    expect(shouldShowGrowthSection('成长', 0)).toBe(true);
    expect(shouldShowGrowthSection('林', 0)).toBe(false);
  });
});

describe('useGrowthEntry', () => {
  function setup(prompts: Array<string | null> = []) {
    const openFileInTab = vi.fn();
    const dialog = makeDialog({ prompts });
    const toast = makeToast();
    const ctx = {
      folderPath: FOLDER,
      dialog,
      toast,
      openFileInTab,
    } as unknown as UseGrowthEntryContext;
    return { ctx, openFileInTab, dialog, toast };
  }

  it('加载成长卡索引，并响应成长视图的写入广播', async () => {
    installElectronMock((channel) => (channel === 'growth-load' ? ok(buildSnapshot()) : null));
    const { ctx } = setup();
    const { result } = renderHook(() => useGrowthEntry(ctx));
    await waitFor(() => expect(result.current.growthIndex?.sheets).toHaveLength(1));

    const next: GrowthSnapshot = buildSnapshot({ sheets: [] });
    act(() => emitGrowthMemoryChanged(FOLDER, next, 'other'));
    expect(result.current.growthIndex?.sheets).toEqual([]);

    // 其他项目的广播被忽略
    act(() => emitGrowthMemoryChanged('/other', buildSnapshot()));
    expect(result.current.growthIndex?.sheets).toEqual([]);
  });

  it('打开总览 / 角色标签；新建时询问角色名', async () => {
    installElectronMock(() => ok(buildSnapshot()));
    const { ctx, openFileInTab, toast } = setup(['  白芷 ', '', 'x'.repeat(101)]);
    const { result } = renderHook(() => useGrowthEntry(ctx));

    act(() => result.current.handleOpenGrowth(null));
    expect(openFileInTab).toHaveBeenLastCalledWith(WORKSPACE_TAB_GROWTH);

    await act(() => result.current.handleCreateGrowthSheet());
    expect(openFileInTab).toHaveBeenLastCalledWith('__workspace__:growth:白芷');

    openFileInTab.mockClear();
    await act(() => result.current.handleCreateGrowthSheet());
    await act(() => result.current.handleCreateGrowthSheet());
    expect(openFileInTab).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});

describe('GrowthSection', () => {
  function renderSection(overrides: Partial<React.ComponentProps<typeof GrowthSection>> = {}) {
    const props: React.ComponentProps<typeof GrowthSection> = {
      sheets: [SUMMARY],
      initialized: true,
      filtering: false,
      collapsed: false,
      activeWorkspaceTab: null,
      onToggle: vi.fn(),
      onOpen: vi.fn(),
      onCreate: vi.fn(),
      onContextMenu: vi.fn(),
      ...overrides,
    };
    render(<GrowthSection {...props} />);
    return props;
  }

  it('列出成长卡（等级徽章），点击打开、总览与新建', () => {
    const props = renderSection();
    expect(screen.getByText('成长档案')).toBeTruthy();
    expect(screen.getByText('Lv.2')).toBeTruthy();
    expect(screen.getByText('经验 400 · 第 3 章')).toBeTruthy();
    fireEvent.click(screen.getByText('阿尔'));
    expect(props.onOpen).toHaveBeenCalledWith('阿尔');
    fireEvent.click(screen.getByLabelText('打开成长档案总览'));
    expect(props.onOpen).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByLabelText('新建成长档案'));
    expect(props.onCreate).toHaveBeenCalledTimes(1);
    fireEvent.contextMenu(screen.getByText('阿尔'));
    expect(props.onContextMenu).toHaveBeenCalledWith(expect.anything(), {
      kind: 'growth-item',
      characterName: '阿尔',
    });
  });

  it('没有成长卡时显示用途说明与新建按钮；筛选时显示简短提示', () => {
    const props = renderSection({ sheets: [], initialized: false });
    expect(screen.getByRole('note').textContent).toContain('战力崩溃');
    expect(screen.getByRole('note').textContent).toContain('首次使用会先创建记忆库');
    fireEvent.click(screen.getByText('新建成长档案'));
    expect(props.onCreate).toHaveBeenCalledTimes(1);
  });

  it('筛选无结果与折叠', () => {
    const { unmount } = render(
      <GrowthSection
        sheets={[]}
        initialized
        filtering
        collapsed={false}
        onToggle={vi.fn()}
        onOpen={vi.fn()}
        onCreate={vi.fn()}
        onContextMenu={vi.fn()}
      />
    );
    expect(screen.getByText('当前筛选条件下没有成长档案')).toBeTruthy();
    unmount();
    renderSection({ collapsed: true });
    expect(screen.queryByText('阿尔')).toBeNull();
  });
});

describe('CharacterGrowthButton', () => {
  it('未建档显示「新建」，已建档显示等级，点击回传人物名', () => {
    const onOpen = vi.fn();
    const { rerender } = render(
      <CharacterGrowthButton characterName="莉娜" level={null} onOpen={onOpen} />
    );
    fireEvent.click(screen.getByLabelText('为 莉娜 新建成长档案'));
    expect(onOpen).toHaveBeenCalledWith('莉娜');
    rerender(<CharacterGrowthButton characterName="莉娜" level={3} onOpen={onOpen} />);
    expect(screen.getByLabelText('打开 莉娜 的成长档案').textContent).toContain('Lv.3');
  });
});

describe('GrowthView 工作区布局', () => {
  it('指定角色时自动建卡，标题区显示角色与等级；写入后广播索引', async () => {
    let snapshot: GrowthSnapshot = buildSnapshot();
    const electron = installElectronMock((channel, ...args) => {
      if (channel === 'growth-load') return ok(snapshot);
      if (channel === 'growth-ensure-sheet') {
        const base = buildSnapshot();
        snapshot = buildSnapshot({
          sheets: [...base.sheets, { ...base.sheets[0], name: String(args[1]), level: 1, exp: 0 }],
        });
        return ok(snapshot);
      }
      return null;
    });
    const changed = vi.fn();
    window.addEventListener(GROWTH_MEMORY_CHANGED_EVENT, changed);
    try {
      render(
        <GrowthView
          folderPath={FOLDER}
          dbReady={false}
          layout="workspace"
          initialCharacter="白芷"
        />
      );
      const hero = await screen.findByRole('region', { name: '成长档案概览' });
      await waitFor(() => expect(hero.querySelector('h2')?.textContent).toBe('白芷'));
      expect(hero.textContent).toContain('Lv.1');
      expect(hero.textContent).toContain('战力崩溃');
      expect(electron.invoke).toHaveBeenCalledWith('growth-ensure-sheet', FOLDER, '白芷', []);
      expect(changed).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(GROWTH_MEMORY_CHANGED_EVENT, changed);
    }
  });

  it('固定角色的标签中切换角色时交给外部导航', async () => {
    installElectronMock((channel) => (channel === 'growth-load' ? ok(buildSnapshot()) : null));
    const onNavigate = vi.fn();
    render(
      <GrowthView
        folderPath={FOLDER}
        dbReady={false}
        layout="workspace"
        initialCharacter="阿尔"
        onNavigateCharacter={onNavigate}
      />
    );
    await screen.findByRole('region', { name: '成长档案概览' });
    const input = screen.getByLabelText('新角色名') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '林舟' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(onNavigate).toHaveBeenCalledWith('林舟');
  });

  it('记忆库未创建时提示创建后自动为该角色建卡', async () => {
    installElectronMock((channel) =>
      channel === 'growth-load' ? ok(buildSnapshot({ initialized: false, sheets: [] })) : null
    );
    render(
      <GrowthView folderPath={FOLDER} dbReady={false} layout="workspace" initialCharacter="白芷" />
    );
    expect(await screen.findByText('创建记忆库后会自动为「白芷」建立成长卡。')).toBeTruthy();
  });
});
