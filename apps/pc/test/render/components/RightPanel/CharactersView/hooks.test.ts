// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import type {
  Character,
  CharacterRelation,
  CharacterTimelineItem,
} from '@/render/components/RightPanel/types';
import type { NovelCorpusFile } from '@/render/components/RightPanel/CharactersView/helpers';
import { useCharacterTimeline } from '@/render/components/RightPanel/CharactersView/useCharacterTimeline';
import { useCharacterCurrentState } from '@/render/components/RightPanel/CharactersView/useCharacterCurrentState';
import { useCharacterRelations } from '@/render/components/RightPanel/CharactersView/useCharacterRelations';
import { useCharacterStore } from '@/render/components/RightPanel/CharactersView/useCharacterStore';
import { useCharacterListEditor } from '@/render/components/RightPanel/CharactersView/useCharacterListEditor';
import { useCharacterGraphAI } from '@/render/components/RightPanel/CharactersView/useCharacterGraphAI';
import { useCharacterGraphLayout } from '@/render/components/RightPanel/CharactersView/useCharacterGraphLayout';
import { useNovelCorpus } from '@/render/components/RightPanel/CharactersView/useNovelCorpus';
import { NOVEL_EDITOR_FILE_SAVED_EVENT } from '@/render/utils/editor-events';
import { installElectronMock, uninstallElectronMock } from '../../../hooks/electronMock';

type Handler = (...args: unknown[]) => unknown;

function setup(routes: Record<string, Handler> = {}) {
  const settings = new Map<string, string>();
  const table: Record<string, Handler> = {
    'db-settings-get': (key) => settings.get(key as string) ?? null,
    'db-settings-set': (key, value) => {
      settings.set(key as string, value as string);
    },
    ...routes,
  };
  const mock = installElectronMock((channel, ...args) => table[channel]?.(...args));
  const calls = (channel: string) =>
    mock.invoke.mock.calls.filter((call) => call[0] === channel).map((call) => call.slice(1));
  return { mock, settings, calls };
}

function character(overrides: Partial<Character> & { id: number }): Character {
  return {
    name: `角色${overrides.id}`,
    role: '',
    category: 'major',
    description: '',
    currentState: [],
    aliases: [],
    ...overrides,
  };
}

function row(id: number, name: string, attributes: Record<string, unknown> = {}, role = '') {
  return { id, name, role, description: `${name}描述`, attributes: JSON.stringify(attributes) };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function dragEvent<T extends Element>() {
  const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() };
  const target = document.createElement('div');
  return {
    preventDefault: vi.fn(),
    dataTransfer,
    currentTarget: target,
  } as unknown as React.DragEvent<T> & { preventDefault: ReturnType<typeof vi.fn> };
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

afterEach(() => {
  uninstallElectronMock();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// useCharacterTimeline
// ═══════════════════════════════════════════════════════════════════════════
describe('useCharacterTimeline', () => {
  const LIN = character({ id: 1, name: '林冲', aliases: ['豹子头'] });
  const CORPUS: NovelCorpusFile[] = [
    {
      path: '/novel/卷一.md',
      label: '卷一.md',
      content: '第一章 出走\n林冲在雪夜出走，林冲很冷。\n\n第二章 上山\n豹子头上了梁山。',
    },
  ];
  const ITEMS_KEY = 'novel-editor:character-timeline:5:1';
  const ORDER_KEY = 'novel-editor:character-timeline-order:5:1';

  type Props = Parameters<typeof useCharacterTimeline>[0];
  const baseProps: Props = {
    novelId: 5,
    selectedCharacterId: 1,
    selectedCharacter: LIN,
    debouncedContent: '',
    novelCorpusFiles: CORPUS,
    novelCorpusError: '',
  };

  async function renderTimeline(overrides: Partial<Props> = {}) {
    const hook = renderHook((props: Props) => useCharacterTimeline(props), {
      initialProps: { ...baseProps, ...overrides },
    });
    await flush();
    return hook;
  }

  it('从语料自动抽取经历（含别名）', async () => {
    setup();
    const { result } = await renderTimeline();
    const items = result.current.focusedTimeline;
    expect(items.map((i) => i.title)).toEqual(['出走', '上山']);
    expect(items[0]).toMatchObject({
      source: 'auto',
      sourcePath: '/novel/卷一.md',
      sourceLabel: '卷一.md',
      chapterLabel: '第一章',
      startLine: 1,
      mentionCount: 2,
    });
    expect(items[0].id).toBe(items[0].autoKey);
  });

  it('没有选中人物时为空；语料加载失败时回退到当前正文', async () => {
    setup();
    const none = await renderTimeline({ selectedCharacter: null, selectedCharacterId: null });
    expect(none.result.current.focusedTimeline).toEqual([]);
    const fallback = await renderTimeline({
      novelCorpusFiles: [],
      novelCorpusError: '读取失败',
      debouncedContent: '第一章 出走\n林冲出走。',
    });
    expect(fallback.result.current.focusedTimeline[0]).toMatchObject({
      sourcePath: '__current__',
      sourceLabel: '当前正文',
    });
    const empty = await renderTimeline({ novelCorpusFiles: [], novelCorpusError: '' });
    expect(empty.result.current.focusedTimeline).toEqual([]);
  });

  it('加载已保存的修订与排序', async () => {
    const { settings } = setup();
    const { result: probe } = await renderTimeline();
    const [first, second] = probe.current.focusedTimeline;
    settings.set(
      ITEMS_KEY,
      JSON.stringify([
        {
          id: first.id,
          autoKey: first.autoKey,
          title: '改写标题',
          summary: '改写摘要',
          source: 'auto',
        },
        { id: 'manual-1', title: '手工', summary: '手工摘要', source: 'manual' },
      ])
    );
    settings.set(ORDER_KEY, JSON.stringify(['manual-1', second.autoKey, first.autoKey]));
    const { result } = await renderTimeline();
    expect(result.current.focusedTimeline.map((i) => i.title)).toEqual([
      '手工',
      '上山',
      '改写标题',
    ]);
    expect(result.current.hasTimelineOverride(result.current.focusedTimeline[2])).toBe(true);
    expect(result.current.hasTimelineOverride(result.current.focusedTimeline[1])).toBe(false);
  });

  it('读取设置失败或 novelId 为空时为空', async () => {
    setup({
      'db-settings-get': () => {
        throw new Error('db');
      },
    });
    const { result } = await renderTimeline();
    expect(result.current.focusedTimeline).toHaveLength(2);
    const noNovel = await renderTimeline({ novelId: null });
    expect(noNovel.result.current.focusedTimeline).toHaveLength(2);
  });

  it('编辑自动条目后保存为覆盖项', async () => {
    const { settings } = setup();
    const { result } = await renderTimeline();
    const target = result.current.focusedTimeline[0];
    act(() => result.current.handleStartEditTimelineItem(target));
    expect(result.current.timelineEditor).toMatchObject({ itemId: target.id, mode: 'edit' });
    expect(result.current.timelineDraftTitle).toBe('出走');
    expect(result.current.timelineDraftChapterLabel).toBe('第一章');
    act(() => {
      result.current.setTimelineDraftTitle('  雪夜出走  ');
      result.current.setTimelineDraftSummary('林冲离开草料场');
    });
    await act(async () => {
      await result.current.handleSaveTimelineItem();
    });
    const saved = JSON.parse(settings.get(ITEMS_KEY) as string) as CharacterTimelineItem[];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      id: target.id,
      autoKey: target.autoKey,
      title: '雪夜出走',
      summary: '林冲离开草料场',
      mentionCount: 2,
      chapterLabel: '第一章',
    });
    expect(result.current.timelineEditor).toBeNull();
    expect(result.current.focusedTimeline[0].title).toBe('雪夜出走');
    expect(result.current.timelineSaving).toBe(false);

    // 再次编辑同一条：替换而不是追加
    act(() => result.current.handleStartEditTimelineItem(result.current.focusedTimeline[0]));
    act(() => result.current.setTimelineDraftTitle('再改'));
    await act(async () => {
      await result.current.handleSaveTimelineItem();
    });
    expect(JSON.parse(settings.get(ITEMS_KEY) as string)).toHaveLength(1);
  });

  it('标题或摘要为空时不保存；无编辑器时不保存', async () => {
    const { calls } = setup();
    const { result } = await renderTimeline();
    await act(async () => {
      await result.current.handleSaveTimelineItem();
    });
    act(() => result.current.handleStartCreateManualTimelineItem());
    act(() => result.current.setTimelineDraftTitle('只有标题'));
    await act(async () => {
      await result.current.handleSaveTimelineItem();
    });
    expect(calls('db-settings-set')).toHaveLength(0);
  });

  it('新建手工条目追加到排序末尾，并可删除', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(123);
    const { settings } = setup();
    const { result } = await renderTimeline();
    act(() => result.current.handleStartCreateManualTimelineItem());
    expect(result.current.timelineEditor).toMatchObject({
      itemId: 'manual-123',
      mode: 'create-manual',
      sourceLabel: '手工整理',
    });
    act(() => {
      result.current.setTimelineDraftChapterLabel('第三章');
      result.current.setTimelineDraftTitle('夜奔');
      result.current.setTimelineDraftSummary('林冲夜奔梁山');
    });
    await act(async () => {
      await result.current.handleSaveTimelineItem();
    });
    const order = JSON.parse(settings.get(ORDER_KEY) as string) as string[];
    expect(order).toHaveLength(3);
    expect(order[2]).toBe('manual-123');
    expect(result.current.focusedTimeline.map((i) => i.title)).toEqual(['出走', '上山', '夜奔']);
    expect(result.current.focusedTimeline[2].mentionCount).toBeUndefined();

    // 删除时若正在编辑该条目则重置编辑器
    act(() => result.current.handleStartEditTimelineItem(result.current.focusedTimeline[2]));
    await act(async () => {
      await result.current.handleDeleteManualTimelineItem('manual-123');
    });
    expect(result.current.timelineEditor).toBeNull();
    expect(JSON.parse(settings.get(ITEMS_KEY) as string)).toEqual([]);
    expect(JSON.parse(settings.get(ORDER_KEY) as string)).not.toContain('manual-123');
    expect(result.current.focusedTimeline).toHaveLength(2);
  });

  it('恢复自动条目会移除覆盖并重置编辑器', async () => {
    const { settings } = setup();
    const { result } = await renderTimeline();
    const target = result.current.focusedTimeline[1];
    act(() => result.current.handleStartEditTimelineItem(target));
    act(() => result.current.setTimelineDraftTitle('改'));
    await act(async () => {
      await result.current.handleSaveTimelineItem();
    });
    act(() => result.current.handleStartEditTimelineItem(result.current.focusedTimeline[1]));
    await act(async () => {
      await result.current.handleRestoreAutoTimelineItem(result.current.focusedTimeline[1]);
    });
    expect(JSON.parse(settings.get(ITEMS_KEY) as string)).toEqual([]);
    expect(result.current.focusedTimeline[1].title).toBe('上山');
    expect(result.current.timelineEditor).toBeNull();
    // 没有 autoKey 的条目不处理
    await act(async () => {
      await result.current.handleRestoreAutoTimelineItem({
        id: 'm',
        title: 't',
        summary: 's',
        source: 'manual',
      });
    });
  });

  it('拖拽排序并持久化顺序；编辑中禁止拖拽', async () => {
    const { settings, calls } = setup();
    const { result } = await renderTimeline();
    const [first, second] = result.current.focusedTimeline;
    const start = dragEvent<HTMLButtonElement>();
    act(() => result.current.handleTimelineDragStart(start, 0));
    expect(result.current.timelineDragIndex).toBe(0);
    expect(start.dataTransfer.setData).toHaveBeenCalledWith('text/plain', '0');

    const overSame = dragEvent<HTMLDivElement>();
    act(() => result.current.handleTimelineDragOver(overSame, 0));
    expect(result.current.timelineDropIndex).toBeNull();
    act(() => result.current.handleTimelineDragOver(dragEvent<HTMLDivElement>(), 1));
    expect(result.current.timelineDropIndex).toBe(1);

    await act(async () => {
      await result.current.handleTimelineDrop(dragEvent<HTMLDivElement>(), 1);
    });
    expect(JSON.parse(settings.get(ORDER_KEY) as string)).toEqual([second.autoKey, first.autoKey]);
    expect(result.current.focusedTimeline[0].title).toBe('上山');
    expect(result.current.timelineDragIndex).toBeNull();

    // 无拖拽源时 drop 仅复位
    await act(async () => {
      await result.current.handleTimelineDrop(dragEvent<HTMLDivElement>(), 0);
    });
    expect(calls('db-settings-set')).toHaveLength(1);

    act(() => result.current.handleTimelineDragStart(dragEvent<HTMLButtonElement>(), 1));
    act(() => result.current.handleTimelineDragEnd());
    expect(result.current.timelineDragIndex).toBeNull();

    act(() => result.current.handleStartEditTimelineItem(first));
    const blocked = dragEvent<HTMLButtonElement>();
    act(() => result.current.handleTimelineDragStart(blocked, 0));
    expect(blocked.preventDefault).toHaveBeenCalled();
    expect(result.current.timelineDragIndex).toBeNull();
    act(() => result.current.resetTimelineEditor());
    expect(result.current.timelineEditor).toBeNull();
  });

  it('切换人物时重置编辑状态；非当前人物的持久化不影响本地状态', async () => {
    setup();
    const { result, rerender } = await renderTimeline();
    act(() => result.current.handleStartCreateManualTimelineItem());
    rerender({
      ...baseProps,
      selectedCharacterId: 2,
      selectedCharacter: character({ id: 2, name: '鲁智深' }),
    });
    await flush();
    expect(result.current.timelineEditor).toBeNull();
    expect(result.current.focusedTimeline).toEqual([]);
  });

  it('打开来源位置', async () => {
    setup();
    const onOpen = vi.fn();
    const { result } = await renderTimeline({ onOpenSourceLocation: onOpen });
    const item = result.current.focusedTimeline[0];
    act(() => result.current.handleOpenTimelineSource(item));
    expect(onOpen).toHaveBeenCalledWith('/novel/卷一.md', 1, item.autoKey);
    act(() =>
      result.current.handleOpenTimelineSource({
        ...item,
        sourcePath: '__current__',
        autoKey: undefined,
      })
    );
    expect(onOpen).toHaveBeenLastCalledWith('__current__', 1, item.id);
    act(() => result.current.handleOpenTimelineSource({ ...item, startLine: undefined }));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('切换人物后旧请求的结果被忽略', async () => {
    const slow = deferred<string | null>();
    let n = 0;
    setup({
      'db-settings-get': () => {
        n += 1;
        return n <= 2 ? slow.promise : null;
      },
    });
    const { result, rerender } = await renderTimeline();
    rerender({
      ...baseProps,
      selectedCharacterId: 2,
      selectedCharacter: character({ id: 2, name: '林冲' }),
    });
    await flush();
    await act(async () => {
      slow.resolve(
        JSON.stringify([{ id: 'x', title: '旧人物手工', summary: 's', source: 'manual' }])
      );
    });
    expect(result.current.focusedTimeline.map((i) => i.title)).not.toContain('旧人物手工');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// useCharacterCurrentState
// ═══════════════════════════════════════════════════════════════════════════
describe('useCharacterCurrentState', () => {
  const TIMELINE: CharacterTimelineItem[] = [
    { id: 'a', title: '上山', summary: '落草梁山', source: 'auto', chapterLabel: '第二章' },
  ];
  type Props = Parameters<typeof useCharacterCurrentState>[0];

  function renderState(overrides: Partial<Props> = {}) {
    const update = vi.fn(async () => {});
    const hook = renderHook((props: Props) => useCharacterCurrentState(props), {
      initialProps: {
        selectedCharacterId: 1,
        selectedCharacter: character({ id: 1, role: ' 主角 ' }),
        focusedTimeline: TIMELINE,
        handleUpdateCharacterAttributes: update,
        ...overrides,
      },
    });
    return { ...hook, update };
  }

  it('没有保存状态时由最近经历推导', () => {
    const { result } = renderState();
    expect(result.current.displayCurrentStateItems.map((i) => [i.label, i.value])).toEqual([
      ['当前章节', '第二章'],
      ['当前进展', '上山'],
      ['当前状态', '落草梁山'],
      ['角色定位', '主角'],
    ]);
  });

  it('优先展示已保存状态', () => {
    const saved = [{ id: 's1', label: '伤势', value: '重伤' }];
    const { result } = renderState({
      selectedCharacter: character({ id: 1, currentState: saved }),
    });
    expect(result.current.displayCurrentStateItems).toEqual(saved);
    expect(result.current.currentStateDraftItems).toEqual(saved);
  });

  it('编辑：基于推导项；增删改后保存（过滤空项并 trim）', async () => {
    const { result, update } = renderState();
    act(() => result.current.handleStartEditCurrentState());
    expect(result.current.currentStateEditing).toBe(true);
    expect(result.current.currentStateDraftItems).toHaveLength(4);
    const firstId = result.current.currentStateDraftItems[0].id;
    act(() => result.current.handleCurrentStateDraftChange(firstId, 'value', '  第三章 '));
    act(() => result.current.handleAddCurrentStateItem());
    expect(result.current.currentStateDraftItems).toHaveLength(5);
    act(() =>
      result.current.handleRemoveCurrentStateItem(result.current.currentStateDraftItems[1].id)
    );
    await act(async () => {
      await result.current.handleSaveCurrentState();
    });
    expect(update).toHaveBeenCalledWith(1, {
      currentState: [
        { id: firstId, label: '当前章节', value: '第三章' },
        expect.objectContaining({ label: '当前状态' }),
        expect.objectContaining({ label: '角色定位', value: '主角' }),
      ],
    });
    expect(result.current.currentStateEditing).toBe(false);
    expect(result.current.currentStateSaving).toBe(false);
  });

  it('无推导项时使用默认标签；取消编辑恢复原状态', () => {
    const { result } = renderState({
      focusedTimeline: [],
      selectedCharacter: character({ id: 1 }),
    });
    act(() => result.current.handleStartEditCurrentState());
    expect(result.current.currentStateDraftItems.map((i) => i.label)).toEqual([
      '当前进展',
      '当前危机',
      '当前目标',
      '关键能力',
      '关键资源',
    ]);
    act(() => result.current.handleCancelEditCurrentState());
    expect(result.current.currentStateEditing).toBe(false);
    expect(result.current.currentStateDraftItems).toEqual([]);
  });

  it('切换人物退出编辑；未选中人物时保存无操作；保存失败时 saving 复位', async () => {
    const { result, rerender, update } = renderState();
    act(() => result.current.handleStartEditCurrentState());
    rerender({
      selectedCharacterId: 2,
      selectedCharacter: null,
      focusedTimeline: [],
      handleUpdateCharacterAttributes: update,
    });
    expect(result.current.currentStateEditing).toBe(false);
    expect(result.current.displayCurrentStateItems).toEqual([]);
    await act(async () => {
      await result.current.handleSaveCurrentState();
    });
    expect(update).not.toHaveBeenCalled();

    const failing = vi.fn(async () => {
      throw new Error('fail');
    });
    const r2 = renderState({ handleUpdateCharacterAttributes: failing });
    act(() => r2.result.current.handleStartEditCurrentState());
    await act(async () => {
      await expect(r2.result.current.handleSaveCurrentState()).rejects.toThrow('fail');
    });
    expect(r2.result.current.currentStateSaving).toBe(false);
    expect(r2.result.current.currentStateEditing).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// useCharacterRelations
// ═══════════════════════════════════════════════════════════════════════════
describe('useCharacterRelations', () => {
  const FOLDER = '/novel';
  const KEY = `novel-editor:character-relations:${FOLDER}`;
  const CHARS = [character({ id: 1, name: '林冲' }), character({ id: 2, name: '鲁智深' })];

  it('无保存关系时由人物生成默认连线；加载保存的关系', async () => {
    const { settings } = setup();
    const empty = renderHook(() =>
      useCharacterRelations({ folderPath: FOLDER, characters: CHARS })
    );
    await flush();
    expect(empty.result.current.relations).toEqual([]);
    for (const link of empty.result.current.links) {
      expect(link.id.startsWith('generated-')).toBe(true);
      expect(link.tone).toBe('other');
    }
    const saved: CharacterRelation[] = [
      { id: 'r1', sourceId: 1, targetId: 2, label: '结义', tone: 'ally', note: '' },
    ];
    settings.set(KEY, JSON.stringify(saved));
    const { result } = renderHook(() =>
      useCharacterRelations({ folderPath: FOLDER, characters: CHARS })
    );
    await flush();
    expect(result.current.relations).toEqual(saved);
    expect(result.current.links).toEqual(saved);
  });

  it('加载失败（非法 JSON）或无项目时为空', async () => {
    const { settings } = setup();
    settings.set(KEY, '{bad');
    const { result } = renderHook(() =>
      useCharacterRelations({ folderPath: FOLDER, characters: [] })
    );
    await flush();
    expect(result.current.relations).toEqual([]);
    const none = renderHook(() => useCharacterRelations({ folderPath: null, characters: [] }));
    await flush();
    expect(none.result.current.relations).toEqual([]);
    await act(async () => {
      await none.result.current.persistRelations([]);
    });
  });

  it('新增 / 编辑 / 删除关系并持久化', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(42);
    const { settings } = setup();
    const { result } = renderHook(() =>
      useCharacterRelations({ folderPath: FOLDER, characters: CHARS })
    );
    await flush();

    // 非法：缺少或相同的人物
    await act(async () => {
      await result.current.handleAddRelation();
    });
    act(() => {
      result.current.setRelationSourceId(1);
      result.current.setRelationTargetId(1);
    });
    await act(async () => {
      await result.current.handleAddRelation();
    });
    expect(settings.has(KEY)).toBe(false);

    act(() => {
      result.current.setRelationTargetId(2);
      result.current.setRelationTone('rival');
      result.current.setRelationNote('  旧怨  ');
    });
    await act(async () => {
      await result.current.handleAddRelation();
    });
    expect(result.current.relations).toEqual([
      { id: '42', sourceId: 1, targetId: 2, label: '对立', tone: 'rival', note: '旧怨' },
    ]);
    expect(JSON.parse(settings.get(KEY) as string)).toHaveLength(1);
    expect(result.current.relationNote).toBe('');

    act(() => result.current.startEditRelation(result.current.relations[0]));
    expect(result.current.editingRelationId).toBe('42');
    expect(result.current.relationTone).toBe('rival');
    act(() => {
      result.current.setRelationLabel(' 兄弟 ');
      result.current.setRelationTone('ally');
    });
    await act(async () => {
      await result.current.handleUpdateRelation();
    });
    expect(result.current.relations[0]).toMatchObject({ label: '兄弟', tone: 'ally' });
    expect(result.current.editingRelationId).toBeNull();
    // 未在编辑中时 update 无操作
    await act(async () => {
      await result.current.handleUpdateRelation();
    });

    act(() => result.current.startEditRelation(result.current.relations[0]));
    act(() => {
      result.current.setRelationTargetId(1);
    });
    await act(async () => {
      await result.current.handleUpdateRelation();
    });
    expect(result.current.editingRelationId).toBe('42');

    await act(async () => {
      await result.current.handleDeleteRelation('42');
    });
    expect(result.current.relations).toEqual([]);
    expect(JSON.parse(settings.get(KEY) as string)).toEqual([]);
  });

  // BUG: useCharacterRelations.ts 的加载 effect 没有取消标记（对比 useCharacterTimeline 的
  // `cancelled`）。快速切换项目时，若旧项目的 db-settings-get 比新项目晚返回，
  // 会用旧项目的关系覆盖新项目的关系（useCharacterGraphLayout 存在同样问题）。
  it('BUG: 切换项目后旧项目的关系不应覆盖新项目', async () => {
    const slow = deferred<string | null>();
    setup({
      'db-settings-get': (key) =>
        key === 'novel-editor:character-relations:/old'
          ? slow.promise
          : JSON.stringify([
              { id: 'new', sourceId: 1, targetId: 2, label: '新', tone: 'ally', note: '' },
            ]),
    });
    const { result, rerender } = renderHook(
      ({ folderPath }) => useCharacterRelations({ folderPath, characters: CHARS }),
      { initialProps: { folderPath: '/old' } }
    );
    rerender({ folderPath: '/new' });
    await flush();
    await act(async () => {
      slow.resolve(
        JSON.stringify([
          { id: 'old', sourceId: 1, targetId: 2, label: '旧', tone: 'ally', note: '' },
        ])
      );
    });
    expect(result.current.relations.map((r) => r.id)).toEqual(['new']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// useCharacterStore
// ═══════════════════════════════════════════════════════════════════════════
describe('useCharacterStore', () => {
  it('按目录加载人物并通知变更', async () => {
    const { calls } = setup({
      'db-novel-get-by-folder': () => ({ id: 9 }),
      'db-character-list': () => [
        row(1, '林冲', { aliases: ['豹子头'], category: 'secondary' }, '教头'),
      ],
    });
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useCharacterStore({ folderPath: '/novel', onCharactersChange: onChange })
    );
    await waitFor(() => expect(result.current.characters).toHaveLength(1));
    expect(result.current.novelId).toBe(9);
    expect(result.current.characters[0]).toMatchObject({
      name: '林冲',
      role: '教头',
      category: 'secondary',
      aliases: ['豹子头'],
    });
    expect(onChange).toHaveBeenLastCalledWith(result.current.characters);
    expect(calls('db-character-list')[0]).toEqual([9]);
  });

  it('无项目时清空；无 novel 记录时不加载人物', async () => {
    const { calls } = setup({ 'db-novel-get-by-folder': () => null });
    const none = renderHook(() => useCharacterStore({ folderPath: null }));
    expect(none.result.current.characters).toEqual([]);
    const { result } = renderHook(() => useCharacterStore({ folderPath: '/x' }));
    await flush();
    expect(result.current.novelId).toBeNull();
    expect(calls('db-character-list')).toHaveLength(0);
  });

  it('删除与更新属性后重新加载', async () => {
    let rows = [row(1, '林冲', { highlightColor: '#112233' }, '主角'), row(2, '鲁智深')];
    const { calls } = setup({
      'db-novel-get-by-folder': () => ({ id: 9 }),
      'db-character-list': () => rows,
      'db-character-delete': (id) => {
        rows = rows.filter((r) => r.id !== id);
      },
    });
    const { result } = renderHook(() => useCharacterStore({ folderPath: '/novel' }));
    await waitFor(() => expect(result.current.characters).toHaveLength(2));

    await act(async () => {
      await result.current.handleUpdateCharacterAttributes(1, {
        currentState: [{ id: 's', label: '伤势', value: '轻伤' }],
        highlightFirstMentionOnly: true,
      });
    });
    const [id, payload] = calls('db-character-update')[0];
    expect(id).toBe(1);
    expect(payload).toEqual({
      attributePatch: {
        currentState: [{ id: 's', label: '伤势', value: '轻伤' }],
        highlightFirstMentionOnly: true,
      },
    });

    // 不存在的人物不更新
    await act(async () => {
      await expect(
        result.current.handleUpdateCharacterAttributes(99, { category: 'major' })
      ).rejects.toThrow('人物已切换');
    });
    expect(calls('db-character-update')).toHaveLength(1);

    await act(async () => {
      await result.current.handleDelete(1);
    });
    expect(calls('db-character-delete')[0]).toEqual([2]);
    expect(result.current.characters.map((c) => c.name)).toEqual(['林冲']);
    await act(async () => {
      await result.current.handleDelete(5);
    });
    expect(calls('db-character-delete')).toHaveLength(1);
  });

  it('头像与分类更新只发送实际修改的属性，不携带旧人物设计和图集', async () => {
    const { calls } = setup({
      'db-novel-get-by-folder': () => ({ id: 9 }),
      'db-character-list': () => [
        row(1, '人物', {
          design: { outfit: '旧衣服' },
          avatar: 'old.png',
          media: [{ id: 'old-media' }],
        }),
      ],
    });
    const { result } = renderHook(() => useCharacterStore({ folderPath: '/novel' }));
    await waitFor(() => expect(result.current.characters).toHaveLength(1));
    await act(async () => {
      await result.current.handleUpdateCharacterAttributes(1, { avatar: 'new.png' });
    });
    await act(async () => {
      await result.current.handleUpdateCharacterAttributes(1, { category: 'major' });
    });
    expect(calls('db-character-update')).toEqual([
      [1, { attributePatch: { avatar: 'new.png' } }],
      [1, { attributePatch: { category: 'major' } }],
    ]);
  });

  it('切换目录时忽略旧目录的加载结果', async () => {
    const slow = deferred<{ id: number } | null>();
    setup({
      'db-novel-get-by-folder': (folder) => (folder === '/old' ? slow.promise : { id: 2 }),
      'db-character-list': (novelId) => [row(novelId as number, `作品${String(novelId)}的人物`)],
    });
    const { result, rerender } = renderHook(({ folderPath }) => useCharacterStore({ folderPath }), {
      initialProps: { folderPath: '/old' },
    });
    rerender({ folderPath: '/new' });
    await waitFor(() => expect(result.current.novelId).toBe(2));
    await act(async () => {
      slow.resolve({ id: 1 });
    });
    expect(result.current.novelId).toBe(2);
    expect(result.current.characters.map((c) => c.name)).toEqual(['作品2的人物']);
  });

  it('切换作品后忽略旧人物列表响应，包括复用相同数据库 id 的作品', async () => {
    const slow = deferred<ReturnType<typeof row>[]>();
    let listCalls = 0;
    setup({
      'db-novel-get-by-folder': () => ({ id: 1 }),
      'db-character-list': () => (++listCalls === 1 ? slow.promise : [row(2, '新作品人物')]),
    });
    const { result, rerender } = renderHook(({ folderPath }) => useCharacterStore({ folderPath }), {
      initialProps: { folderPath: '/old' },
    });
    await waitFor(() => expect(listCalls).toBe(1));
    rerender({ folderPath: '/new' });
    await waitFor(() =>
      expect(result.current.characters.map((c) => c.name)).toEqual(['新作品人物'])
    );
    await act(async () => {
      slow.resolve([row(1, '旧作品人物')]);
    });
    expect(result.current.characters.map((c) => c.name)).toEqual(['新作品人物']);
  });

  // BUG: useCharacterStore.ts 加载 effect 在 `!novel` 时直接 return，既不清空 characters 也不重置
  // novelId。从一个有人物的项目切换到没有 novel 记录的项目后，仍然展示旧项目的人物，
  // 并且后续 handleDelete / handleUpdateCharacterAttributes 会作用到旧项目的 novelId。
  it('BUG: 切换到无 novel 记录的目录后应清空旧人物', async () => {
    setup({
      'db-novel-get-by-folder': (folder) => (folder === '/a' ? { id: 1 } : null),
      'db-character-list': () => [row(1, '林冲')],
    });
    const { result, rerender } = renderHook(({ folderPath }) => useCharacterStore({ folderPath }), {
      initialProps: { folderPath: '/a' },
    });
    await waitFor(() => expect(result.current.characters).toHaveLength(1));
    rerender({ folderPath: '/b' });
    await flush();
    expect(result.current.characters).toEqual([]);
    expect(result.current.novelId).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// useCharacterListEditor
// ═══════════════════════════════════════════════════════════════════════════
describe('useCharacterListEditor', () => {
  const CHARS = [
    character({ id: 1, name: '林冲', role: '教头', category: 'major', aliases: ['豹子头'] }),
    character({ id: 2, name: '鲁智深', category: 'secondary', description: '花和尚' }),
    character({ id: 3, name: '武松', category: 'major' }),
  ];

  function renderEditor(novelId: number | null = 9) {
    const loadCharactersFromDb = vi.fn(async () => CHARS);
    let state = CHARS;
    const setCharacters = vi.fn((action: React.SetStateAction<Character[]>) => {
      state = typeof action === 'function' ? action(state) : action;
    });
    const hook = renderHook(() =>
      useCharacterListEditor({ characters: CHARS, setCharacters, novelId, loadCharactersFromDb })
    );
    return { ...hook, loadCharactersFromDb, setCharacters, getState: () => state };
  }

  it('新增人物：写库、重载并重置表单', async () => {
    const { calls } = setup();
    const { result, loadCharactersFromDb } = renderEditor();
    act(() => result.current.toggleAdding());
    expect(result.current.adding).toBe(true);
    act(() => {
      result.current.setNewName('  宋江 ');
      result.current.setNewRole(' 首领 ');
      result.current.setNewDesc(' 及时雨 ');
      result.current.setNewCategory('secondary');
      result.current.setNewHighlightColor('#aabbcc');
      result.current.setNewHighlightFirstMentionOnly(true);
    });
    await act(async () => {
      await result.current.handleAdd();
    });
    const [novelId, name, role, desc, attributes] = calls('db-character-create')[0] as [
      number,
      string,
      string,
      string,
      string,
    ];
    expect([novelId, name, role, desc]).toEqual([9, '宋江', '首领', '及时雨']);
    expect(JSON.parse(attributes)).toMatchObject({
      category: 'secondary',
      highlightColor: '#aabbcc',
      highlightFirstMentionOnly: true,
    });
    expect(loadCharactersFromDb).toHaveBeenCalledWith(9);
    expect(result.current.newName).toBe('');
    expect(result.current.adding).toBe(false);
  });

  it('名字为空或无作品时不新增；Enter 提交、Shift+Enter / 输入法组合中不提交', async () => {
    const { calls } = setup();
    const noNovel = renderEditor(null);
    act(() => noNovel.result.current.setNewName('x'));
    await act(async () => {
      await noNovel.result.current.handleAdd();
    });
    const { result } = renderEditor();
    await act(async () => {
      await result.current.handleAdd();
    });
    expect(calls('db-character-create')).toHaveLength(0);

    act(() => result.current.setNewName('宋江'));
    const key = (init: Partial<React.KeyboardEvent<HTMLInputElement>>) =>
      ({
        key: 'Enter',
        shiftKey: false,
        preventDefault: vi.fn(),
        nativeEvent: { isComposing: false, keyCode: 13 },
        ...init,
      }) as unknown as React.KeyboardEvent<HTMLInputElement>;
    await act(async () => {
      result.current.handleKeyDown(key({ shiftKey: true }));
      result.current.handleKeyDown(key({ key: 'a' }));
      result.current.handleKeyDown(
        key({ nativeEvent: { isComposing: true, keyCode: 229 } } as unknown as Partial<
          React.KeyboardEvent<HTMLInputElement>
        >)
      );
    });
    expect(calls('db-character-create')).toHaveLength(0);
    await act(async () => {
      result.current.handleKeyDown(key({}));
      await Promise.resolve();
    });
    expect(calls('db-character-create')).toHaveLength(1);
  });

  it('按分类与关键字（含别名、描述）筛选并分组', () => {
    setup();
    const { result } = renderEditor();
    expect(result.current.categorizedCharacterEntries.major.map((e) => e.index)).toEqual([0, 2]);
    expect(result.current.categorizedCharacterEntries.secondary.map((e) => e.index)).toEqual([1]);
    act(() => result.current.setCharacterSearch(' 豹子 '));
    expect(result.current.filteredCharacters.map((c) => c.name)).toEqual(['林冲']);
    act(() => result.current.setCharacterSearch('花和尚'));
    expect(result.current.filteredCharacters.map((c) => c.name)).toEqual(['鲁智深']);
    act(() => {
      result.current.setCharacterSearch('');
      result.current.setCategoryFilter('major');
    });
    expect(result.current.filteredCharacters.map((c) => c.name)).toEqual(['林冲', '武松']);
  });

  it('批量设置分类只作用于筛选结果', async () => {
    const { calls } = setup();
    const { result, loadCharactersFromDb } = renderEditor();
    act(() => result.current.setCategoryFilter('major'));
    await act(async () => {
      await result.current.handleBulkApplyCategory('secondary');
    });
    const updates = calls('db-character-update');
    expect(updates.map((u) => u[0])).toEqual([1, 3]);
    expect(updates[0][1]).toEqual({ attributePatch: { category: 'secondary' } });
    expect(loadCharactersFromDb).toHaveBeenCalledWith(9);
    expect(result.current.bulkUpdatingCategory).toBeNull();

    act(() => result.current.setCharacterSearch('不存在'));
    await act(async () => {
      await result.current.handleBulkApplyCategory('major');
    });
    expect(calls('db-character-update')).toHaveLength(2);
  });

  it('批量更新失败时复位 bulkUpdatingCategory', async () => {
    setup({
      'db-character-update': () => {
        throw new Error('db');
      },
    });
    const { result } = renderEditor();
    await act(async () => {
      await expect(result.current.handleBulkApplyCategory('major')).rejects.toThrow('db');
    });
    expect(result.current.bulkUpdatingCategory).toBeNull();
  });

  it('拖拽排序：更新本地顺序并持久化', async () => {
    vi.useFakeTimers();
    const { calls } = setup();
    const { result, getState } = renderEditor();
    const start = dragEvent<HTMLDivElement>();
    act(() => result.current.handleDragStart(start, 0));
    expect(result.current.dragIndex).toBe(0);
    act(() => {
      vi.advanceTimersByTime(20);
    });
    act(() => result.current.handleDragEnter(dragEvent<HTMLDivElement>(), 2));
    expect(result.current.dropIndex).toBe(2);
    act(() => result.current.handleDragLeave());
    expect(result.current.dropIndex).toBeNull();
    act(() => result.current.handleDragOver(dragEvent<HTMLDivElement>(), 0));
    expect(result.current.dropIndex).toBeNull();
    act(() => result.current.handleDragOver(dragEvent<HTMLDivElement>(), 2));
    expect(result.current.dropIndex).toBe(2);
    await act(async () => {
      await result.current.handleDrop(dragEvent<HTMLDivElement>(), 2);
    });
    expect(getState().map((c) => c.id)).toEqual([2, 3, 1]);
    expect(calls('db-character-reorder')[0]).toEqual([[2, 3, 1]]);
    expect(result.current.dragIndex).toBeNull();

    // 无拖拽源时 drop 只复位
    await act(async () => {
      await result.current.handleDrop(dragEvent<HTMLDivElement>(), 1);
    });
    expect(calls('db-character-reorder')).toHaveLength(1);

    act(() => result.current.handleDragStart(dragEvent<HTMLDivElement>(), 1));
    const end = dragEvent<HTMLDivElement>();
    act(() => result.current.handleDragEnd(end));
    expect((end.currentTarget as HTMLElement).style.opacity).toBe('1');
    expect(result.current.dragIndex).toBeNull();
  });

  it('选择头像文件后读取为 data URL', async () => {
    setup();
    const { result } = renderEditor();
    const file = new File(['abc'], 'a.png', { type: 'image/png' });
    act(() =>
      result.current.handleAvatarSelect({
        target: { files: [file] },
      } as unknown as React.ChangeEvent<HTMLInputElement>)
    );
    await waitFor(() => expect(result.current.newAvatar.startsWith('data:')).toBe(true));
    act(() =>
      result.current.handleAvatarSelect({
        target: { files: [] },
      } as unknown as React.ChangeEvent<HTMLInputElement>)
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// useCharacterGraphAI
// ═══════════════════════════════════════════════════════════════════════════
describe('useCharacterGraphAI', () => {
  type Props = Parameters<typeof useCharacterGraphAI>[0];
  function renderGraphAI(overrides: Partial<Props> = {}) {
    const props = {
      content: '林冲与鲁智深结义。',
      folderPath: '/novel',
      novelId: 9,
      loadCharactersFromDb: vi.fn(async () => [] as Character[]),
      setRelations: vi.fn(),
      persistRelations: vi.fn(async () => {}),
      setSelectedCharacterId: vi.fn(),
      ...overrides,
    };
    const hook = renderHook(() => useCharacterGraphAI(props));
    return { ...hook, props };
  }

  const AI_JSON = JSON.stringify({
    characters: [
      { name: '林冲', role: '主角', description: '教头', aliases: ['林教头'] },
      { name: '鲁智深', role: '', description: '', aliases: [] },
    ],
    relations: [
      { source: '林教头', target: '鲁智深', label: '', tone: 'ally', note: ' 结拜 ' },
      { source: '林冲', target: '林冲', label: '自己', tone: 'other', note: '' },
      { source: '林冲', target: '路人', label: 'x', tone: 'other', note: '' },
    ],
    summary: '梁山好汉',
  });

  it('前置条件：正文为空 / 无作品', async () => {
    const { calls } = setup();
    const empty = renderGraphAI({ content: '  ' });
    await act(async () => {
      await empty.result.current.handleGenerateCharacterGraph();
    });
    expect(empty.result.current.aiStatus).toBe('正文为空，无法生成角色图谱');
    const noNovel = renderGraphAI({ novelId: null });
    await act(async () => {
      await noNovel.result.current.handleGenerateCharacterGraph();
    });
    expect(calls('ai-request')).toHaveLength(0);
  });

  it('抽取人物：更新已有人物、新建人物、映射别名关系并持久化', async () => {
    const { calls } = setup({
      'db-settings-get': () => JSON.stringify({ ai: { contextTokens: 1000 } }),
      'db-world-setting-list-by-folder': () => [
        {
          id: 1,
          category: 'world',
          title: '梁山',
          content: '水泊',
          tags: '[]',
          created_at: '',
          updated_at: '',
        },
      ],
      'ai-request': () => ({ ok: true, text: '```json\n' + AI_JSON + '\n```' }),
      'db-character-list': () => [row(1, '鲁智深', { aliases: ['花和尚'] }, '僧人')],
      'db-character-create': () => ({ lastInsertRowid: 10 }),
    });
    const { result, props } = renderGraphAI();
    await act(async () => {
      await result.current.handleGenerateCharacterGraph();
    });
    const [request] = calls('ai-request')[0] as [{ context: string }];
    expect(request.context).toContain('设定集参考:\n梁山: 水泊');
    expect(request.context).toContain('正文片段 1/1');

    const [createdNovel, createdName, createdRole] = calls('db-character-create')[0] as [
      number,
      string,
      string,
    ];
    expect([createdNovel, createdName, createdRole]).toEqual([9, '林冲', '主角']);
    const [updatedId, updated] = calls('db-character-update')[0] as [
      number,
      { role: string; description?: string; appendAliases: string[] },
    ];
    expect(updatedId).toBe(1);
    expect(updated).not.toHaveProperty('role');
    expect(updated).not.toHaveProperty('description');
    expect(updated.appendAliases).toEqual([]);
    expect(updated).not.toHaveProperty('attributes');

    expect(props.loadCharactersFromDb).toHaveBeenCalledWith(9);
    const relations = props.setRelations.mock.calls[0][0] as CharacterRelation[];
    expect(relations).toHaveLength(1);
    expect(relations[0]).toMatchObject({
      sourceId: 10,
      targetId: 1,
      tone: 'ally',
      label: '盟友',
      note: '结拜',
    });
    expect(props.persistRelations).toHaveBeenCalledWith(relations);
    expect(props.setSelectedCharacterId).toHaveBeenCalledWith(10);
    expect(result.current.aiStatus).toBe('已同步 2 个人物、1 条关系，梁山好汉');
    expect(result.current.aiGenerating).toBe(false);
  });

  it('未识别出人物时提示；AI 失败时展示错误', async () => {
    let response: unknown = { ok: true, text: '{"characters":[],"relations":[]}' };
    setup({ 'ai-request': () => response, 'db-world-setting-list-by-folder': () => [] });
    const { result } = renderGraphAI();
    await act(async () => {
      await result.current.handleGenerateCharacterGraph();
    });
    expect(result.current.aiStatus).toBe('未识别出足够明确的人物，建议补更多正文后再试');
    response = { ok: false, error: '额度不足' };
    await act(async () => {
      await result.current.handleGenerateCharacterGraph();
    });
    expect(result.current.aiStatus).toBe('额度不足');
    response = { ok: false };
    await act(async () => {
      await result.current.handleGenerateCharacterGraph();
    });
    expect(result.current.aiStatus).toBe('片段 1 解析失败');
    response = { ok: true, text: '不是 JSON' };
    await act(async () => {
      await result.current.handleGenerateCharacterGraph();
    });
    expect(result.current.aiStatus).toContain('未识别出');
  });

  it('设置读取抛出非 Error 时使用默认文案', async () => {
    setup({
      'db-settings-get': () => {
        throw 'x';
      },
    });
    const { result } = renderGraphAI();
    await act(async () => {
      await result.current.handleGenerateCharacterGraph();
    });
    expect(result.current.aiStatus).toBe('人物图谱生成失败');
    expect(result.current.aiGenerating).toBe(false);
  });

  // BUG: useCharacterGraphAI.ts 只把「AI 本次返回的别名」写入 nameToId，已存在人物在数据库中的旧别名
  // 只存在于 existingByName 中。当 AI 用旧别名（如「豹子头」）描述关系、而人物列表里只给出正名时，
  // 关系因 nameToId 查不到 sourceId 被静默丢弃。
  it('BUG: 关系使用数据库中已有的别名时也应被保留', async () => {
    setup({
      'ai-request': () => ({
        ok: true,
        text: JSON.stringify({
          characters: [
            { name: '林冲', aliases: [] },
            { name: '高俅', aliases: [] },
          ],
          relations: [{ source: '豹子头', target: '高俅', label: '仇敌', tone: 'rival' }],
        }),
      }),
      'db-character-list': () => [row(1, '林冲', { aliases: ['豹子头'] }), row(2, '高俅')],
    });
    const { result, props } = renderGraphAI();
    await act(async () => {
      await result.current.handleGenerateCharacterGraph();
    });
    const relations = props.setRelations.mock.calls[0][0] as CharacterRelation[];
    expect(relations).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// useCharacterGraphLayout
// ═══════════════════════════════════════════════════════════════════════════
describe('useCharacterGraphLayout', () => {
  const FOLDER = '/novel';
  const KEY = `novel-editor:graph-layout:${FOLDER}`;
  const CHARS = [character({ id: 1 }), character({ id: 2 })];

  it('默认环形布局；加载已保存坐标覆盖默认值', async () => {
    const { settings } = setup();
    const def = renderHook(() =>
      useCharacterGraphLayout({ folderPath: FOLDER, characters: CHARS })
    );
    await flush();
    const [p1, p2] = def.result.current.characterPositions;
    expect(p1.x).toBeCloseTo(180);
    expect(p1.y).toBeCloseTo(40);
    expect(p2.x).toBeCloseTo(180);
    expect(p2.y).toBeCloseTo(196);

    settings.set(KEY, JSON.stringify({ 2: { x: 50, y: 60 } }));
    const { result } = renderHook(() =>
      useCharacterGraphLayout({ folderPath: FOLDER, characters: CHARS })
    );
    await flush();
    expect(result.current.characterPositions[1]).toMatchObject({ x: 50, y: 60 });
  });

  it('非法 JSON 或无项目时回退为默认布局', async () => {
    const { settings } = setup();
    settings.set(KEY, '{bad');
    const { result } = renderHook(() =>
      useCharacterGraphLayout({ folderPath: FOLDER, characters: CHARS })
    );
    await flush();
    expect(result.current.characterPositions[0].y).toBeCloseTo(40);
    const none = renderHook(() => useCharacterGraphLayout({ folderPath: null, characters: [] }));
    await flush();
    expect(none.result.current.characterPositions).toEqual([]);
  });

  it('拖拽节点：限制在容器内，松开后持久化', async () => {
    const { settings } = setup();
    const { result } = renderHook(() =>
      useCharacterGraphLayout({ folderPath: FOLDER, characters: CHARS })
    );
    await flush();
    const parent = document.createElement('div');
    const button = document.createElement('button');
    parent.appendChild(button);
    vi.spyOn(parent, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 360,
      height: 240,
    } as DOMRect);
    act(() =>
      result.current.handleGraphNodeMouseDown(
        {
          currentTarget: button,
          clientX: 180,
          clientY: 40,
        } as unknown as React.MouseEvent<HTMLButtonElement>,
        1
      )
    );
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 120 }));
    });
    expect(result.current.characterPositions[0]).toMatchObject({ x: 100, y: 120 });
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 9999, clientY: -50 }));
    });
    expect(result.current.characterPositions[0]).toMatchObject({ x: 332, y: 24 });
    await act(async () => {
      window.dispatchEvent(new MouseEvent('mouseup'));
      await Promise.resolve();
    });
    expect(JSON.parse(settings.get(KEY) as string)).toEqual({ 1: { x: 332, y: 24 } });
    // 松开后不再响应移动
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10 }));
    });
    expect(result.current.characterPositions[0]).toMatchObject({ x: 332, y: 24 });
  });

  it('无父元素或未知人物时忽略按下', async () => {
    setup();
    const { result } = renderHook(() =>
      useCharacterGraphLayout({ folderPath: FOLDER, characters: CHARS })
    );
    await flush();
    const add = vi.spyOn(window, 'addEventListener');
    const orphan = document.createElement('button');
    act(() =>
      result.current.handleGraphNodeMouseDown(
        {
          currentTarget: orphan,
          clientX: 0,
          clientY: 0,
        } as unknown as React.MouseEvent<HTMLButtonElement>,
        1
      )
    );
    const parent = document.createElement('div');
    const button = document.createElement('button');
    parent.appendChild(button);
    act(() =>
      result.current.handleGraphNodeMouseDown(
        {
          currentTarget: button,
          clientX: 0,
          clientY: 0,
        } as unknown as React.MouseEvent<HTMLButtonElement>,
        99
      )
    );
    expect(add.mock.calls.filter((c) => c[0] === 'mousemove')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// useNovelCorpus
// ═══════════════════════════════════════════════════════════════════════════
describe('useNovelCorpus', () => {
  const FOLDER = '/novel';
  const TREE = {
    files: [
      { name: 'b.md', path: '/novel/b.md', type: 'file' },
      {
        name: 'dir',
        path: '/novel/dir',
        type: 'directory',
        children: [{ name: 'a.txt', path: '/novel/dir/a.txt', type: 'file' }],
      },
      { name: 'img.png', path: '/novel/img.png', type: 'file' },
      { name: 'empty.md', path: '/novel/empty.md', type: 'file' },
    ],
  };
  const INITIAL_FILES: Record<string, string> = {
    '/novel/b.md': ' 正文B ',
    '/novel/dir/a.txt': '正文A',
    '/novel/empty.md': '   ',
  };
  let FILES: Record<string, string> = { ...INITIAL_FILES };

  function setupCorpus(overrides: Record<string, Handler> = {}) {
    FILES = { ...INITIAL_FILES };
    return setup({
      'refresh-folder': () => TREE,
      'read-file': (path) => FILES[path as string] ?? '',
      ...overrides,
    });
  }

  const save = (filePath: string) =>
    act(async () => {
      document.dispatchEvent(
        new CustomEvent(NOVEL_EDITOR_FILE_SAVED_EVENT, { detail: { filePath } })
      );
      await Promise.resolve();
      await Promise.resolve();
    });

  it('加载目录下的文本文件（递归、排序、忽略空文件与非文本）', async () => {
    setupCorpus();
    const { result } = renderHook(() => useNovelCorpus(FOLDER));
    expect(result.current.novelCorpusLoading).toBe(true);
    await waitFor(() => expect(result.current.novelCorpusLoading).toBe(false));
    expect(result.current.novelCorpusFiles).toEqual([
      { path: '/novel/b.md', label: 'b.md', content: '正文B' },
      { path: '/novel/dir/a.txt', label: 'dir/a.txt', content: '正文A' },
    ]);
  });

  it('无项目时为空；加载失败时记录错误', async () => {
    setupCorpus({
      'refresh-folder': () => {
        throw new Error('无权限');
      },
    });
    const none = renderHook(() => useNovelCorpus(null));
    expect(none.result.current.novelCorpusFiles).toEqual([]);
    const { result } = renderHook(() => useNovelCorpus(FOLDER));
    await waitFor(() => expect(result.current.novelCorpusError).toBe('无权限'));
    expect(result.current.novelCorpusLoading).toBe(false);
  });

  it('非 Error 失败使用默认文案', async () => {
    setupCorpus({
      'refresh-folder': () => {
        throw 'x';
      },
    });
    const { result } = renderHook(() => useNovelCorpus(FOLDER));
    await waitFor(() => expect(result.current.novelCorpusError).toBe('作品语料加载失败'));
  });

  it('文件保存事件增量更新缓存；空内容移除；无关文件忽略', async () => {
    const { calls } = setupCorpus();
    const { result } = renderHook(() => useNovelCorpus(FOLDER));
    await waitFor(() => expect(result.current.novelCorpusFiles).toHaveLength(2));
    const readsBefore = calls('read-file').length;

    await save('/other/x.md');
    await save('/novel/pic.png');
    expect(calls('read-file').length).toBe(readsBefore);

    FILES['/novel/0.md'] = '新章节';
    await save('/novel/0.md');
    expect(result.current.novelCorpusFiles.map((f) => f.path)).toEqual([
      '/novel/0.md',
      '/novel/b.md',
      '/novel/dir/a.txt',
    ]);

    FILES['/novel/b.md'] = '  ';
    await save('/novel/b.md');
    expect(result.current.novelCorpusFiles.map((f) => f.path)).toEqual([
      '/novel/0.md',
      '/novel/dir/a.txt',
    ]);
    expect(calls('refresh-folder')).toHaveLength(1);
  });

  it('增量读取失败时整体重新加载', async () => {
    let failRead = false;
    const { calls } = setupCorpus({
      'read-file': (path) => {
        if (failRead) {
          failRead = false;
          throw new Error('locked');
        }
        return FILES[path as string] ?? '';
      },
    });
    const { result } = renderHook(() => useNovelCorpus(FOLDER));
    await waitFor(() => expect(result.current.novelCorpusFiles).toHaveLength(2));
    failRead = true;
    await save('/novel/b.md');
    await waitFor(() => expect(calls('refresh-folder')).toHaveLength(2));
  });

  it('缓存未就绪时收到保存事件触发重新加载；再次进入同一目录使用缓存', async () => {
    const slow = deferred<typeof TREE>();
    let first = true;
    const { calls } = setupCorpus({
      'refresh-folder': () => {
        if (first) {
          first = false;
          return slow.promise;
        }
        return TREE;
      },
    });
    const { result, rerender } = renderHook(({ folder }) => useNovelCorpus(folder), {
      initialProps: { folder: FOLDER as string | null },
    });
    await save('/novel/b.md');
    await waitFor(() => expect(calls('refresh-folder')).toHaveLength(2));
    await waitFor(() => expect(result.current.novelCorpusFiles).toHaveLength(2));
    await act(async () => {
      slow.resolve(TREE);
    });

    rerender({ folder: null });
    expect(result.current.novelCorpusFiles).toEqual([]);
    rerender({ folder: FOLDER });
    expect(result.current.novelCorpusFiles).toHaveLength(2);
    expect(calls('refresh-folder')).toHaveLength(2);
  });
});
