// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  consumeGrowthSheetCreation,
  emitGrowthMemoryChanged,
  findGrowthSheetSummary,
  findMentionedNames,
  formatGrowthSheetMeta,
  inferChapterNumber,
  parseChineseNumber,
  requestGrowthSheetCreation,
  requestOpenGrowth,
  resetGrowthSheetCreationRequests,
  summarizeGrowthSnapshot,
  type GrowthSheetSummary,
} from '@/render/utils/growthIndex';
import { useGrowthEntry, type UseGrowthEntryContext } from '@/render/hooks/useGrowthEntry';
import CharacterSection, {
  splitGrowthSheets,
} from '@/render/components/FilePanel/CharacterSection';
import type { Character } from '@/render/components/RightPanel/types';
import { filterGrowthSheets, shouldShowGrowthSection } from '@/render/components/FilePanel/utils';
import { CharacterGrowthButton } from '@/render/components/RightPanel/CharactersView/CharacterGrowthButton';
import { GrowthView } from '@/render/components/RightPanel/GrowthView';
import { GROWTH_TOUR_STORAGE_KEY } from '@/render/components/RightPanel/GrowthView/growthGuide';
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

  it('新建前可先执行 beforeOpen（例如创建记忆库），失败时不打开标签', async () => {
    installElectronMock(() => ok(buildSnapshot()));
    const { ctx, openFileInTab, toast } = setup(['白芷', '林舟']);
    const { result } = renderHook(() => useGrowthEntry(ctx));
    const beforeOpen = vi.fn(async (name: string) => (name === '林舟' ? '记忆库创建失败' : null));
    await act(() => result.current.handleCreateGrowthSheet({ beforeOpen }));
    expect(beforeOpen).toHaveBeenCalledWith('白芷');
    expect(openFileInTab).toHaveBeenLastCalledWith('__workspace__:growth:白芷');
    openFileInTab.mockClear();
    await act(() => result.current.handleCreateGrowthSheet({ beforeOpen }));
    expect(openFileInTab).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('记忆库创建失败');
  });

  it('切换作品后立即隐藏上一部作品的成长卡，新作品的索引加载完成后再显示', async () => {
    const pending: Array<(value: unknown) => void> = [];
    installElectronMock((channel, ...args) => {
      if (channel !== 'growth-load') return null;
      if (args[0] === FOLDER) return ok(buildSnapshot());
      // 另一部作品的索引延迟返回，模拟磁盘读取
      return new Promise((resolve) => pending.push(resolve));
    });
    const { ctx } = setup();
    const { result, rerender } = renderHook(
      (props: { work: string }) => useGrowthEntry({ ...ctx, workScopePath: props.work }),
      { initialProps: { work: FOLDER } }
    );
    await waitFor(() => expect(result.current.growthIndex?.sheets).toHaveLength(1));

    rerender({ work: '/other-work' });
    expect(result.current.growthIndex).toBeNull();

    await act(async () => {
      pending.forEach((resolve) => resolve(ok(buildSnapshot({ sheets: [] }))));
    });
    await waitFor(() => expect(result.current.growthIndex?.sheets).toEqual([]));
  });

  it('记住最近打开的正文章节号，切到成长标签后仍沿用；响应打开请求事件', async () => {
    installElectronMock(() => ok(buildSnapshot()));
    const { ctx, openFileInTab } = setup();
    const { result, rerender } = renderHook(
      (props: { tab: string | null }) => useGrowthEntry({ ...ctx, activeDocumentTab: props.tab }),
      { initialProps: { tab: `${FOLDER}/正文/第十二章 风起.md` } }
    );
    expect(result.current.growthChapter).toBe(12);
    rerender({ tab: '__workspace__:growth:阿尔' });
    expect(result.current.growthChapter).toBe(12);
    rerender({ tab: `${FOLDER}/正文/003-雾林.md` });
    expect(result.current.growthChapter).toBe(3);

    act(() => requestOpenGrowth('阿尔'));
    expect(openFileInTab).toHaveBeenLastCalledWith('__workspace__:growth:阿尔');
    act(() => requestOpenGrowth());
    expect(openFileInTab).toHaveBeenLastCalledWith(WORKSPACE_TAB_GROWTH);
  });
});

describe('章节号推断与本章角色', () => {
  it('从文件名推断章节号', () => {
    expect(inferChapterNumber('/n/正文/001-启程.md')).toBe(1);
    expect(inferChapterNumber('C:\\n\\第12章 风起.md')).toBe(12);
    expect(inferChapterNumber('/n/第三十章.md')).toBe(30);
    expect(inferChapterNumber('/n/第一百零五回.txt')).toBe(105);
    expect(inferChapterNumber('/n/序章.md')).toBeNull();
    expect(inferChapterNumber(null)).toBeNull();
    expect(parseChineseNumber('两千零八')).toBe(2008);
    expect(parseChineseNumber('十五')).toBe(15);
    expect(parseChineseNumber('abc')).toBeNull();
  });

  it('按名字或别名找出正文中提到的角色', () => {
    const sheets = [
      { name: '林舟', aliases: ['舟'] },
      { name: '苏晴', aliases: ['晴儿'] },
      { name: '老周', aliases: [] },
    ];
    expect(findMentionedNames('晴儿笑了，林舟没说话。', sheets)).toEqual(['林舟', '苏晴']);
    // 单字别名不参与匹配，避免误报
    expect(findMentionedNames('一叶扁舟', sheets)).toEqual([]);
    expect(findMentionedNames('', sheets)).toEqual([]);
  });
});

describe('CharacterSection（角色与成长档案合一）', () => {
  const linZhou = {
    id: 1,
    name: '林舟',
    role: '主角',
    category: 'major',
    description: '',
    currentState: [],
    aliases: ['阿舟'],
  } as Character;

  function renderSection(overrides: Partial<React.ComponentProps<typeof CharacterSection>> = {}) {
    const props: React.ComponentProps<typeof CharacterSection> = {
      groups: [{ key: 'major', label: '主要角色', items: [linZhou] }],
      characters: [linZhou],
      growthSheets: [SUMMARY],
      workPath: '/w',
      filtering: false,
      collapsed: false,
      activeWorkspaceTab: null,
      onToggle: vi.fn(),
      onOpenCharacter: vi.fn(),
      onRenameCharacter: vi.fn(),
      onDeleteCharacter: vi.fn(),
      onCreateCharacter: vi.fn(),
      onOpenGrowth: vi.fn(),
      onContextMenu: vi.fn(),
      ...overrides,
    };
    render(<CharacterSection {...props} />);
    return props;
  }

  it('成长卡按人物名 / 别名匹配到人物，匹配不到的单独列出', () => {
    const sheets = [
      { ...SUMMARY, name: '阿舟' },
      { ...SUMMARY, name: '路人甲' },
    ];
    const { byCharacter, orphans } = splitGrowthSheets([linZhou], sheets);
    expect(byCharacter.get('林舟')?.name).toBe('阿舟');
    expect(orphans.map((sheet) => sheet.name)).toEqual(['路人甲']);
  });

  it('人物行带等级徽章；只有成长卡的条目点击打开成长卡；头部总览 / 新建人物', () => {
    const props = renderSection({ growthSheets: [{ ...SUMMARY, name: '林舟' }, SUMMARY] });
    // 林舟（人物）与阿尔（只有成长卡）都显示等级徽章
    expect(screen.getAllByText('Lv.2')).toHaveLength(2);
    fireEvent.click(screen.getByText('林舟'));
    expect(props.onOpenCharacter).toHaveBeenCalledWith(1);
    expect(screen.getByText('只有成长档案')).toBeTruthy();
    expect(screen.getByText('经验 400 · 第 3 章')).toBeTruthy();
    fireEvent.click(screen.getByText('阿尔'));
    expect(props.onOpenGrowth).toHaveBeenCalledWith('阿尔');
    fireEvent.click(screen.getByLabelText('打开人物总览'));
    expect(props.onOpenGrowth).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByLabelText('新建人物'));
    expect(props.onCreateCharacter).toHaveBeenCalledTimes(1);
    fireEvent.contextMenu(screen.getByText('阿尔'));
    expect(props.onContextMenu).toHaveBeenCalledWith(expect.anything(), {
      kind: 'growth-item',
      characterName: '阿尔',
    });
  });

  it('没有人物时显示用途说明与新建人物；头部与空状态都能打开使用说明', () => {
    const props = renderSection({ groups: [], characters: [], growthSheets: [] });
    expect(screen.getByRole('note').textContent).toContain('成长档案');
    fireEvent.click(screen.getAllByText('新建人物').at(-1) as HTMLElement);
    expect(props.onCreateCharacter).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('角色与成长档案使用说明'));
    expect(screen.getByRole('dialog', { name: '成长档案使用说明' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('关闭使用说明'));
    fireEvent.click(screen.getByText('怎么用？'));
    expect(screen.getByRole('dialog', { name: '成长档案使用说明' })).toBeTruthy();
  });

  it('筛选无结果与折叠', () => {
    const { unmount } = render(
      <CharacterSection
        groups={[]}
        characters={[]}
        growthSheets={[]}
        workPath={null}
        filtering
        collapsed={false}
        onToggle={vi.fn()}
        onOpenCharacter={vi.fn()}
        onRenameCharacter={vi.fn()}
        onDeleteCharacter={vi.fn()}
        onCreateCharacter={vi.fn()}
        onContextMenu={vi.fn()}
      />
    );
    expect(screen.getByText('当前筛选条件下没有人物')).toBeTruthy();
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
  beforeEach(() => {
    window.localStorage.setItem(GROWTH_TOUR_STORAGE_KEY, '1');
  });

  it('没有明确建卡请求时（例如切换作品后标签重新加载）不自动建卡，提示并可手动新建', async () => {
    resetGrowthSheetCreationRequests();
    const electron = installElectronMock((channel) =>
      channel === 'growth-load' ? ok(buildSnapshot()) : null
    );
    render(<GrowthView folderPath={FOLDER} dbReady={false} initialCharacter="林舟" />);
    expect(await screen.findByText('当前作品还没有「林舟」的成长卡')).toBeTruthy();
    expect(electron.invoke).not.toHaveBeenCalledWith(
      'growth-ensure-sheet',
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    fireEvent.click(screen.getByRole('button', { name: '为「林舟」新建成长卡' }));
    await waitFor(() =>
      expect(electron.invoke).toHaveBeenCalledWith('growth-ensure-sheet', FOLDER, '林舟', [])
    );
  });

  it('建卡请求按作品登记：在另一部作品里不会被消费', () => {
    resetGrowthSheetCreationRequests();
    requestGrowthSheetCreation('/works/星河旅人', '林舟');
    expect(consumeGrowthSheetCreation('/works/剑与诗', '林舟')).toBe(false);
    expect(consumeGrowthSheetCreation('/works/星河旅人', '林舟')).toBe(true);
    expect(consumeGrowthSheetCreation('/works/星河旅人', '林舟')).toBe(false);
  });

  it('明确打开指定角色时自动建卡，标题区显示角色与等级；写入后广播索引', async () => {
    resetGrowthSheetCreationRequests();
    requestGrowthSheetCreation(FOLDER, '白芷');
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
      render(<GrowthView folderPath={FOLDER} dbReady={false} initialCharacter="白芷" />);
      const heading = await screen.findByRole('heading', { level: 1, name: '白芷' });
      expect(heading).toBeTruthy();
      expect(screen.getByLabelText('等级 1')).toBeTruthy();
      // 页面里不再有角色选择器与新建输入框（通过左侧列表切换）
      expect(screen.queryByLabelText('选择角色')).toBeNull();
      expect(screen.queryByLabelText('新角色名')).toBeNull();
      expect(electron.invoke).toHaveBeenCalledWith('growth-ensure-sheet', FOLDER, '白芷', []);
      expect(changed).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(GROWTH_MEMORY_CHANGED_EVENT, changed);
    }
  });

  it('总览卡片点击后交给外部导航', async () => {
    installElectronMock((channel) => (channel === 'growth-load' ? ok(buildSnapshot()) : null));
    const onNavigate = vi.fn();
    render(<GrowthView folderPath={FOLDER} dbReady={false} onNavigateCharacter={onNavigate} />);
    fireEvent.click(await screen.findByLabelText('打开 阿尔 的成长卡'));
    expect(onNavigate).toHaveBeenCalledWith('阿尔');
  });

  it('记忆库未创建时提示创建后自动为该角色建卡', async () => {
    installElectronMock((channel) =>
      channel === 'growth-load' ? ok(buildSnapshot({ initialized: false, sheets: [] })) : null
    );
    render(<GrowthView folderPath={FOLDER} dbReady={false} initialCharacter="白芷" />);
    expect(await screen.findByText('开始后会自动为「白芷」建立成长卡。')).toBeTruthy();
  });
});
