// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  installElectronMock,
  uninstallElectronMock,
  type ElectronMock,
} from '../../hooks/electronMock';

const aiState = { ready: false };
vi.mock('@/render/components/RightPanel/useAiConfig', () => ({
  useAiConfig: () => ({
    loaded: true,
    enabled: aiState.ready,
    hasApiKey: aiState.ready,
    hasBaseUrl: aiState.ready,
    hasModel: aiState.ready,
    ready: aiState.ready,
  }),
}));

const { VolumePlanView } = await import('@/render/components/RightPanel/VolumePlanView');
const { BEAT_ACTION_TIPS } = await import(
  '@/render/components/RightPanel/VolumePlanView/OutlineList'
);

const WORK = '/w';
const VOLUME = '/w/第一卷';
const CH1 = `${VOLUME}/001-启程.md`;
const CH2 = `${VOLUME}/002-迷雾森林.md`;
const CH3 = `${VOLUME}/003-狼王之夜.md`;
const PLAN_KEY = `novel-editor:volume-plan:${VOLUME}`;

const FILES: Record<string, string> = {
  [CH1]: [
    '# 启程',
    '林舟背起行囊，走出了小镇。',
    '第一幕 离乡',
    '第一场 清晨的青石镇',
    '石板路还湿着。林舟回头看了一眼。',
    '第二场 铁匠铺的夜',
    '秦伯把一块星图碎片交给林舟。',
  ].join('\n'),
  [CH2]: ['# 迷雾森林', '第二幕 迷雾', '第一场 入林', '雾很浓，苏晴出现了。'].join('\n'),
  [CH3]: ['# 狼王之夜', '狼嚎！林舟拔剑砍去！血！快逃！', '他摸出星图碎片。'].join('\n'),
};

interface MockOptions {
  stored?: unknown;
  legacy?: unknown;
  ai?: { ok: boolean; text?: string; error?: string };
  outlineRows?: Record<string, unknown[]>;
}

function mockIpc(options: MockOptions = {}): ElectronMock {
  return installElectronMock((channel, ...args) => {
    switch (channel) {
      case 'refresh-folder':
        return {
          files: [
            {
              name: '第一卷',
              path: VOLUME,
              type: 'directory',
              children: Object.keys(FILES)
                .reverse()
                .map((path) => ({ name: path.split('/').pop(), path, type: 'file' })),
            },
            { name: 'README.md', path: `${VOLUME}/README.md`, type: 'file' },
          ].flatMap((node) => (node.type === 'directory' ? node.children : [node])),
        };
      case 'read-file':
        return FILES[String(args[0])] ?? '# 说明';
      case 'db-outline-list-by-folder': {
        const scope = args[1] as { path: string } | undefined;
        return options.outlineRows?.[scope?.path ?? ''] ?? [];
      }
      case 'db-novel-get-by-folder':
        return { id: 1 };
      case 'db-character-list':
        return [
          { id: 1, name: '林舟', role: '主角', description: '', attributes: '{}' },
          { id: 2, name: '苏晴', role: '配角', description: '', attributes: '{}' },
          { id: 3, name: '白鸦', role: '反派', description: '', attributes: '{}' },
        ];
      case 'db-settings-get':
        if (args[0] === PLAN_KEY) return options.stored ? JSON.stringify(options.stored) : null;
        if (args[0] === `novel-editor:plot-board:${WORK}`) {
          return options.legacy ? JSON.stringify(options.legacy) : null;
        }
        return null;
      case 'ai-request':
        return options.ai ?? { ok: false, error: '未配置' };
      default:
        return { changes: 1 };
    }
  });
}

function savedPlan(mock: ElectronMock): Record<string, unknown> {
  const call = mock.invoke.mock.calls.filter((c) => c[0] === 'db-settings-set').at(-1);
  expect(call?.[1]).toBe(PLAN_KEY);
  return JSON.parse(String(call?.[2])) as Record<string, unknown>;
}

function renderView(props: Partial<React.ComponentProps<typeof VolumePlanView>> = {}) {
  return render(
    <VolumePlanView
      content={FILES[CH1]}
      folderPath={WORK}
      dbReady
      scope={{ kind: 'chapter', path: CH1 }}
      {...props}
    />
  );
}

beforeEach(() => {
  aiState.ready = false;
});

afterEach(() => {
  uninstallElectronMock();
});

describe('VolumePlanView（卷纲）', () => {
  it('零输入：从本卷章节自动推导 幕 → 章 → 节拍，跳过说明文档', async () => {
    mockIpc();
    renderView();
    expect(await screen.findByRole('region', { name: '第一幕 离乡' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '第二幕 迷雾' })).toBeTruthy();
    expect(screen.getByText('第一卷')).toBeTruthy();
    // 头部汇总：段数 · 章数 · 字数
    expect(screen.getByText(/^2 段 · 3 章 · \d+ 字$/)).toBeTruthy();
    expect(screen.getByText('第一场 清晨的青石镇')).toBeTruthy();
    expect(screen.getByText('石板路还湿着。')).toBeTruthy();
    // 没有场景标记的章节用开篇句兜底，并标出来源
    const act2 = screen.getByRole('region', { name: '第二幕 迷雾' });
    expect(within(act2).getByText('狼王之夜')).toBeTruthy();
    expect(within(act2).getByText('开篇')).toBeTruthy();
    // 每章出场人物来自人物库
    expect(screen.getAllByText('林舟').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '卷纲结构：按正文幕标记' })).toBeTruthy();
    // 总览条：每一幕一段，宽度按章数
    const overview = screen.getByRole('list', { name: '卷纲结构总览' });
    const segments = within(overview).getAllByRole('listitem');
    expect(segments.map((item) => item.getAttribute('aria-label'))).toEqual([
      '第一幕 离乡，1 章',
      '第二幕 迷雾，2 章',
    ]);
    expect((segments[1].parentElement as HTMLElement).style.flexGrow).toBe('2');
    // 章节字数（不计空白）
    const act1 = screen.getByRole('region', { name: '第一幕 离乡' });
    expect(within(act1).getByTitle(/^本章 \d+ 字$/)).toBeTruthy();
    // 没有说明的幕：说明输入只在悬停时出现（类名控制），不再每一幕都显示占位文字
    expect(
      within(act1).getByRole('button', { name: '编辑 第一幕 离乡 的说明' }).className
    ).toContain('actNoteEmpty');
    expect(screen.queryByText('README')).toBeNull();
  });

  it('结构菜单：列出全部结构（带说明），选择后切换并记住', async () => {
    const mock = mockIpc();
    renderView();
    await screen.findByRole('region', { name: '第一幕 离乡' });
    fireEvent.click(screen.getByRole('button', { name: '卷纲结构：按正文幕标记' }));
    const menu = screen.getByRole('menu', { name: '卷纲结构' });
    const options = within(menu).getAllByRole('menuitemradio');
    expect(options.map((item) => item.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
    expect(options[1].textContent).toContain('第一幕 · 建置 → 第二幕 · 对抗 → 第三幕 · 解决');
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /^三幕式/ }));
    expect(screen.queryByRole('menu', { name: '卷纲结构' })).toBeNull();
    expect(await screen.findByRole('region', { name: '第一幕 · 建置' })).toBeTruthy();
    expect(screen.getByText('交代人物处境，抛出打破平静的事件')).toBeTruthy();
    await waitFor(() => expect(savedPlan(mock).structure).toBe('three-act'), { timeout: 2000 });
    fireEvent.click(screen.getByRole('button', { name: '卷纲更多操作' }));
    fireEvent.click(screen.getByRole('button', { name: '恢复自动结构' }));
    expect(await screen.findByRole('region', { name: '第一幕 离乡' })).toBeTruthy();
  });

  it('一句话意图 + 生成卷纲（未开启 AI）：一次给出 3 种结构的方案，挑一个采用', async () => {
    const mock = mockIpc();
    renderView();
    await screen.findByRole('region', { name: '第一幕 离乡' });
    fireEvent.change(screen.getByLabelText('这一卷想写什么'), {
      target: { value: '林舟离开小镇' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成卷纲' }));
    const picker = await screen.findByTestId('plan-variants');
    const cards = within(picker).getAllByRole('listitem', { name: /^方案 / });
    // 当前结构（按正文幕标记）在前，另外两种结构补足
    expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual([
      '方案 按正文幕标记',
      '方案 三幕式',
      '方案 起承转合',
    ]);
    expect(cards[0].textContent).toContain('起点：林舟离开小镇');
    expect(screen.getByRole('status').textContent).toBe('给出 3 个方案，选一个采用');
    expect(mock.invoke).not.toHaveBeenCalledWith('ai-request', expect.anything());
    // 采用「三幕式」：结构切换，说明写入
    fireEvent.click(within(cards[1]).getByRole('button', { name: '采用这个' }));
    expect(await screen.findByRole('region', { name: '第一幕 · 建置' })).toBeTruthy();
    expect(screen.getByText(/^起点：林舟离开小镇。/)).toBeTruthy();
    expect(screen.queryByTestId('plan-variants')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('已采用「三幕式」方案');
    await waitFor(
      () =>
        expect(savedPlan(mock)).toMatchObject({
          intent: '林舟离开小镇',
          structure: 'three-act',
          generatedBy: 'template',
        }),
      { timeout: 2000 }
    );
  });

  it('开启 AI 时每个方案并行走 ai-request，解析 JSON；失败的方案回退模板；都不要可关闭', async () => {
    aiState.ready = true;
    const actKey = 'markers:0:第一幕 离乡';
    const mock = mockIpc({
      ai: {
        ok: true,
        text: JSON.stringify({
          acts: [{ key: actKey, note: '离开家乡，踏上旅程' }],
          chapters: [{ file: '003-狼王之夜.md', beats: ['狼王现身'] }],
        }),
      },
    });
    renderView();
    await screen.findByRole('region', { name: '第一幕 离乡' });
    fireEvent.click(screen.getByRole('button', { name: '生成卷纲' }));
    const picker = await screen.findByTestId('plan-variants');
    expect(mock.invoke.mock.calls.filter((call) => call[0] === 'ai-request')).toHaveLength(3);
    const request = mock.invoke.mock.calls.find((c) => c[0] === 'ai-request')?.[1] as {
      prompt: string;
      context: string;
    };
    expect(request.context).toContain('001-启程.md');
    expect(request.context).toContain('主要人物：林舟');
    const first = within(picker).getByRole('listitem', { name: '方案 按正文幕标记' });
    expect(first.textContent).toContain('AI');
    expect(first.textContent).toContain('离开家乡，踏上旅程');
    fireEvent.click(within(first).getByRole('button', { name: '采用这个' }));
    expect(await screen.findByText('离开家乡，踏上旅程')).toBeTruthy();
    expect(screen.getByText('狼王现身')).toBeTruthy();

    uninstallElectronMock();
    mockIpc({ ai: { ok: true, text: '不是 JSON' } });
    fireEvent.click(screen.getByRole('button', { name: '生成卷纲' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('部分方案按结构模板生成')
    );
    fireEvent.click(within(screen.getByTestId('plan-variants')).getByLabelText('关闭方案'));
    expect(screen.queryByTestId('plan-variants')).toBeNull();
  });

  it('切换派生视图：节奏 / 人物线 / 伏笔，不需要额外输入', async () => {
    mockIpc();
    renderView();
    await screen.findByRole('region', { name: '第一幕 离乡' });

    fireEvent.click(screen.getByRole('tab', { name: '节奏' }));
    expect(screen.getByRole('img', { name: '张力曲线' })).toBeTruthy();
    const tension = screen.getByLabelText('节奏');
    expect(within(tension).getByText('狼王之夜')).toBeTruthy();
    expect(within(tension).getByText('高潮')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: '人物线' }));
    const linzhou = screen.getByRole('row', { name: '人物线 林舟' });
    expect(within(linzhou).getByText('林舟')).toBeTruthy();
    expect(screen.getByRole('row', { name: '人物线 苏晴' })).toBeTruthy();
    // 没有出场的人物不显示泳道
    expect(screen.queryByRole('row', { name: '人物线 白鸦' })).toBeNull();
    // 行属于一张表：表头行（章节序号）+ 每个人物一行，单元格按章节对齐
    const table = screen.getByRole('table', { name: '人物出场泳道' });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(4);
    expect(within(linzhou).getByRole('rowheader').textContent).toBe('林舟');
    expect(within(linzhou).getAllByRole('cell')).toHaveLength(3);

    fireEvent.click(screen.getByRole('tab', { name: '伏笔' }));
    const foreshadow = screen.getByLabelText('伏笔');
    expect(within(foreshadow).getByText('碎片')).toBeTruthy();
    expect(within(foreshadow).getByText(/启程 → 狼王之夜/)).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: '列表' }));
    expect(screen.getByRole('region', { name: '第一幕 离乡' })).toBeTruthy();
  });

  it('点击节拍就地编辑并保存；更多 → 撤销所有改写', async () => {
    const mock = mockIpc();
    renderView();
    await screen.findByRole('region', { name: '第一幕 离乡' });
    fireEvent.click(screen.getByRole('button', { name: '编辑节拍 第一场 清晨的青石镇' }));
    const input = screen.getByRole('textbox', { name: '编辑节拍 第一场 清晨的青石镇' });
    fireEvent.change(input, { target: { value: '林舟告别小石头' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('林舟告别小石头')).toBeTruthy();
    await waitFor(
      () =>
        expect(savedPlan(mock).beatEdits).toEqual({
          '001-启程.md#scene:第一场 清晨的青石镇': '林舟告别小石头',
        }),
      { timeout: 2000 }
    );

    // 幕说明同样可以就地编辑
    fireEvent.click(screen.getByRole('button', { name: '编辑 第一幕 离乡 的说明' }));
    const note = screen.getByRole('textbox', { name: '编辑 第一幕 离乡 的说明' });
    fireEvent.change(note, { target: { value: '离开家乡' } });
    fireEvent.blur(note);
    expect(await screen.findByText('离开家乡')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '卷纲更多操作' }));
    fireEvent.click(screen.getByRole('button', { name: '撤销所有改写与排序' }));
    expect(await screen.findByText('石板路还湿着。')).toBeTruthy();
  });

  it('节拍行的图标都有悬停说明（tooltip）：拖动、加入章纲、场景视频', async () => {
    mockIpc();
    renderView();
    const act1 = await screen.findByRole('region', { name: '第一幕 离乡' });
    const insert = within(act1).getByRole('button', {
      name: '插入到章纲 第一场 清晨的青石镇',
    });
    fireEvent.mouseEnter(insert.parentElement as HTMLElement);
    expect((await screen.findByRole('tooltip')).textContent).toBe(BEAT_ACTION_TIPS.insert);
    fireEvent.mouseLeave(insert.parentElement as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());

    const video = within(act1).getByRole('button', { name: '生成场景视频 第一场 清晨的青石镇' });
    fireEvent.mouseEnter(video.parentElement as HTMLElement);
    expect((await screen.findByRole('tooltip')).textContent).toBe(BEAT_ACTION_TIPS.video);
    fireEvent.mouseLeave(video.parentElement as HTMLElement);

    const grip = act1.querySelector('[draggable="true"]') as HTMLElement;
    fireEvent.mouseEnter(grip.parentElement as HTMLElement);
    expect((await screen.findByRole('tooltip')).textContent).toBe('拖动调整顺序');
    fireEvent.mouseLeave(grip.parentElement as HTMLElement);

    // 结构与「⋯」也有说明
    fireEvent.mouseEnter(
      screen.getByRole('button', { name: '卷纲更多操作' }).parentElement as HTMLElement
    );
    expect((await screen.findByRole('tooltip')).textContent).toBe('更多操作');
  });

  it('点击总览条的某一段滚动到那一幕', async () => {
    mockIpc();
    renderView();
    const act2 = await screen.findByRole('region', { name: '第二幕 迷雾' });
    const scroll = vi.fn();
    act2.scrollIntoView = scroll;
    fireEvent.click(screen.getByRole('listitem', { name: '第二幕 迷雾，2 章' }));
    expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
  });

  it('拖拽调整同一章内节拍的顺序', async () => {
    const mock = mockIpc();
    const { container } = renderView();
    await screen.findByRole('region', { name: '第一幕 离乡' });
    const beat = (key: string) =>
      container.querySelector(`[data-beat-key="${key}"]`) as HTMLElement;
    const first = beat('001-启程.md#scene:第一场 清晨的青石镇');
    const second = beat('001-启程.md#scene:第二场 铁匠铺的夜');
    const grip = first.querySelector('[draggable="true"]') as HTMLElement;
    const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
    fireEvent.dragStart(grip, { dataTransfer });
    fireEvent.dragOver(second, { dataTransfer });
    fireEvent.drop(second, { dataTransfer });
    await waitFor(() => {
      const keys = Array.from(container.querySelectorAll('[data-beat-key^="001"]')).map((el) =>
        el.getAttribute('data-beat-key')
      );
      expect(keys).toEqual([
        '001-启程.md#scene:第二场 铁匠铺的夜',
        '001-启程.md#scene:第一场 清晨的青石镇',
      ]);
    });
    await waitFor(() => expect(savedPlan(mock).beatOrder).toBeTruthy(), { timeout: 2000 });
  });

  it('插入到章纲：追加到该章章纲末尾，已有同名条目时不重复', async () => {
    const mock = mockIpc({
      outlineRows: {
        [CH2]: [
          {
            id: 9,
            novel_id: 1,
            scope_kind: 'chapter',
            scope_path: CH2,
            title: '第一场 入林',
            content: '',
            anchor_text: '',
            line_hint: null,
            parent_id: null,
            sort_order: 0,
            created_at: '',
            updated_at: '',
          },
        ],
      },
    });
    renderView();
    await screen.findByRole('region', { name: '第一幕 离乡' });
    fireEvent.click(screen.getByRole('button', { name: '插入到章纲 第一场 清晨的青石镇' }));
    await waitFor(() =>
      expect(mock.invoke).toHaveBeenCalledWith(
        'db-outline-replace-by-folder',
        WORK,
        [
          expect.objectContaining({
            title: '第一场 清晨的青石镇',
            content: '石板路还湿着。',
            anchorText: '第一场 清晨的青石镇',
            lineHint: 4,
          }),
        ],
        { kind: 'chapter', path: CH1 }
      )
    );
    expect(screen.getByRole('status').textContent).toBe('已插入「启程」的章纲');

    fireEvent.click(screen.getByRole('button', { name: '插入到章纲 第一场 入林' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('「迷雾森林」的章纲里已有这一条')
    );
  });

  it('点击其他章节打开并定位；当前章节只滚动', async () => {
    mockIpc();
    const onOpenSourceLocation = vi.fn();
    const onScrollToLine = vi.fn();
    renderView({ onOpenSourceLocation, onScrollToLine });
    await screen.findByRole('region', { name: '第一幕 离乡' });
    fireEvent.click(screen.getByRole('button', { name: '迷雾森林' }));
    expect(onOpenSourceLocation).toHaveBeenCalledWith(CH2, 1, undefined);
    fireEvent.click(screen.getByRole('button', { name: '第一场 入林' }));
    expect(onOpenSourceLocation).toHaveBeenLastCalledWith(CH2, 3, '第一场 入林');
    fireEvent.click(screen.getByRole('button', { name: '第二场 铁匠铺的夜' }));
    expect(onScrollToLine).toHaveBeenCalledWith(6, '第二场 铁匠铺的夜');
  });

  it('首次打开时把旧版剧情板迁移为幕说明与节拍改写', async () => {
    const mock = mockIpc({
      legacy: {
        '0:3:第一幕 离乡': {
          premise: '',
          goal: '离开小镇',
          conflict: '舍不得',
          sceneBoards: [{ title: '第二场 铁匠铺的夜', objective: '拿到碎片', outcome: '' }],
        },
      },
    });
    renderView();
    expect(await screen.findByText('目标：离开小镇；冲突：舍不得')).toBeTruthy();
    expect(screen.getByText('拿到碎片')).toBeTruthy();
    await waitFor(() => expect(savedPlan(mock).actNotes).toBeTruthy(), { timeout: 2000 });
  });

  it('读取已保存的卷纲', async () => {
    mockIpc({
      stored: { intent: '旧的意图', actNotes: { 'markers:1:第二幕 迷雾': '初入险境' } },
    });
    renderView();
    expect(await screen.findByDisplayValue('旧的意图')).toBeTruthy();
    expect(await screen.findByText('初入险境')).toBeTruthy();
  });

  it('没有卷（独立窗口 / 未命名文档）时用当前文档推导；什么都没有时给出提示', async () => {
    mockIpc();
    const { unmount } = render(
      <VolumePlanView
        content={'第一幕 雨夜\n第一场 相遇\n两人相遇。'}
        folderPath={null}
        dbReady={false}
      />
    );
    expect((await screen.findAllByText('当前文档')).length).toBeGreaterThan(0);
    expect(screen.getByText('两人相遇。')).toBeTruthy();
    // 没有作品目录时不提供插入章纲
    expect(screen.queryByRole('button', { name: /插入到章纲/ })).toBeNull();
    unmount();
    render(<VolumePlanView content="" folderPath={null} dbReady={false} />);
    expect(screen.getByText('打开一章后，这里会自动整理出本卷的卷纲')).toBeTruthy();
  });

  it('其他章节保存后只重读该章', async () => {
    const mock = mockIpc();
    renderView();
    await screen.findByRole('region', { name: '第一幕 离乡' });
    FILES[CH2] = FILES[CH2].replace('雾很浓', '雾散了');
    await act(async () => {
      document.dispatchEvent(
        new CustomEvent('novel-editor:file-saved', { detail: { filePath: CH2, mode: 'auto' } })
      );
    });
    expect(await screen.findByText('雾散了，苏晴出现了。')).toBeTruthy();
    expect(mock.invoke.mock.calls.filter((c) => c[0] === 'refresh-folder')).toHaveLength(1);
    FILES[CH2] = FILES[CH2].replace('雾散了', '雾很浓');
  });
});

describe('VolumePlanView 样式', () => {
  it('人物线每行是 subgrid 盒子而不是 display: contents（无布局盒的行尺寸为 0，无法定位 / 无障碍不可靠）', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const scss = await fs.readFile(
      path.resolve(
        __dirname,
        '../../../../src/render/components/RightPanel/VolumePlanView/styles.module.scss'
      ),
      'utf8'
    );
    const block = /\.laneRow\s*\{([^}]*)\}/.exec(scss)?.[1] ?? '';
    expect(block).not.toMatch(/display:\s*contents/);
    expect(block).toMatch(/grid-template-columns:\s*subgrid/);
  });
});
