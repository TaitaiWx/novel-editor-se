// @vitest-environment happy-dom
/**
 * 参考窗格：自动模式（跟随当前文档）、拖动 / 键盘排序、拖入文件、插入正文、热更新
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReferencePane from '@/render/components/ReferencePane';
import ReferenceButton from '@/render/components/ReferenceButton';
import {
  NOVEL_EDITOR_PATH_MIME,
  REFERENCE_TILE_MIME,
  requestOpenReference,
  type ReferenceAutoSource,
  type ReferenceItem,
} from '@/render/utils/referencePane';
import { notifyWorkspaceFilesChanged } from '@/render/utils/workspaceFiles';
import {
  changedPaths,
  fileSignature,
  REFERENCE_POLL_INTERVAL_MS,
} from '@/render/components/ReferencePane/useReferenceHotReload';
import { buildAutoReferenceItems } from '@/render/components/ReferencePane/useReferencePaneState';
import {
  registerActiveEditor,
  planBlockInsert,
} from '@/render/components/TextEditor/active-editor';
import {
  installElectronMock,
  uninstallElectronMock,
  type ElectronMock,
} from '../../hooks/electronMock';

const ROOT = '/p';
const WORK = '/p/novels/星河旅人';
const VIDEO = `${WORK}/资料/视频/示例/离港.mp4`;
const PORT = `${WORK}/资料/图集/设定/星港城商会/图片.webp`;
const LINZHOU = `${WORK}/资料/图集/人物/林舟/三视图.webp`;
const DOC_PATH = `${ROOT}/小说格式示例.md`;
const DOC = [
  '::image[星港城 · 码头]{src="novels/星河旅人/资料/图集/设定/星港城商会/图片.webp"}',
  '::video[离港]{src="novels/星河旅人/资料/视频/示例/离港.mp4"}',
].join('\n');

const CHARACTERS: ReferenceItem[] = [
  { path: LINZHOU, title: '林舟 · 三视图', kind: 'image', group: 'character' },
];

function source(text: string, documentPath: string | null = DOC_PATH): ReferenceAutoSource {
  return { documentPath, text, workPath: WORK, files: [] };
}

function tiles(): string[] {
  return screen
    .getAllByTestId('reference-tile')
    .map((tile) => tile.getAttribute('data-path') ?? '');
}

function dataTransfer(data: Record<string, string>) {
  return {
    types: Object.keys(data),
    getData: (type: string) => data[type] ?? '',
    setData: vi.fn(),
    dropEffect: 'none',
    effectAllowed: 'all',
  };
}

let mock: ElectronMock;
let modified: Record<string, number>;
const existing = new Set([VIDEO, PORT, LINZHOU]);

beforeEach(() => {
  modified = {};
  mock = installElectronMock((channel, filePath) => {
    const path = String(filePath);
    if (channel === 'get-file-info') {
      if (!existing.has(path)) throw new Error('不存在');
      return { size: 10, modified: new Date(modified[path] ?? 1000), isFile: true };
    }
    if (channel === 'read-file-binary') {
      return {
        base64Content: 'AAAA',
        mimeType: path.endsWith('.mp4') ? 'video/mp4' : 'image/webp',
      };
    }
    return null;
  });
  let counter = 0;
  Object.assign(URL, {
    createObjectURL: vi.fn(() => `blob:ref-${++counter}`),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  uninstallElectronMock();
  vi.useRealTimers();
});

describe('buildAutoReferenceItems', () => {
  it('本章引用（确认存在）→ 场景视频 → 人物图', async () => {
    const items = await buildAutoReferenceItems(CHARACTERS, source(DOC), async (path) =>
      existing.has(path)
    );
    expect(items.map((item) => [item.path, item.group])).toEqual([
      [PORT, 'chapter'],
      [VIDEO, 'chapter'],
      [LINZHOU, 'character'],
    ]);
  });
});

describe('参考按钮：自动模式', () => {
  it('打开时放本章 ::image / ::video 与人物图（分组小标题）；编辑指令、切换文档时跟着更新，保留作者加入的', async () => {
    const view = render(
      <>
        <ReferenceButton fallback={CHARACTERS} source={source(DOC)} />
        <ReferencePane />
      </>
    );
    fireEvent.click(screen.getByRole('button', { name: '参考' }));
    await waitFor(() => expect(tiles()).toEqual([PORT, VIDEO, LINZHOU]));
    expect(screen.getAllByTestId('reference-group').map((node) => node.textContent)).toEqual([
      '本章',
      '人物',
    ]);
    expect(screen.getByTestId('reference-pane').getAttribute('data-auto')).toBe('true');

    // 作者另外打开一张图：保留
    act(() => {
      requestOpenReference({
        items: [{ path: `${WORK}/资料/素材/场景截图.png`, title: '截图', kind: 'image' }],
      });
    });
    expect(tiles()).toContain(`${WORK}/资料/素材/场景截图.png`);

    // 删掉文档里的视频指令：自动项跟着消失
    view.rerender(
      <>
        <ReferenceButton fallback={CHARACTERS} source={source(DOC.split('\n')[0])} />
        <ReferencePane />
      </>
    );
    await waitFor(() => expect(tiles()).not.toContain(VIDEO));
    expect(tiles()).toEqual([PORT, LINZHOU, `${WORK}/资料/素材/场景截图.png`]);

    // 切换到没有媒体引用的文档：只剩人物图与作者加入的
    view.rerender(
      <>
        <ReferenceButton fallback={CHARACTERS} source={source('', `${WORK}/第一卷/001.md`)} />
        <ReferencePane />
      </>
    );
    await waitFor(() => expect(tiles()).toEqual([LINZHOU, `${WORK}/资料/素材/场景截图.png`]));
  });

  it('移除的自动项不会因为文档更新再次出现', async () => {
    const view = render(
      <>
        <ReferenceButton fallback={CHARACTERS} source={source(DOC)} />
        <ReferencePane />
      </>
    );
    fireEvent.click(screen.getByRole('button', { name: '参考' }));
    await waitFor(() => expect(tiles()).toEqual([PORT, VIDEO, LINZHOU]));
    fireEvent.click(screen.getByRole('button', { name: '从参考列表移除' }));
    expect(tiles()).toEqual([VIDEO, LINZHOU]);
    view.rerender(
      <>
        <ReferenceButton fallback={CHARACTERS} source={source(`${DOC}\n正文`)} />
        <ReferencePane />
      </>
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(tiles()).toEqual([VIDEO, LINZHOU]);
  });
});

describe('排序与拖入', () => {
  async function openThree() {
    render(
      <>
        <ReferenceButton fallback={CHARACTERS} source={source(DOC)} />
        <ReferencePane />
      </>
    );
    fireEvent.click(screen.getByRole('button', { name: '参考' }));
    await waitFor(() => expect(tiles()).toEqual([PORT, VIDEO, LINZHOU]));
  }

  it('Alt + ← / → 移动选中的参考（不切换主画面）', async () => {
    await openThree();
    const first = screen.getAllByTestId('reference-tile')[0];
    fireEvent.keyDown(first, { key: 'ArrowRight', altKey: true });
    expect(tiles()).toEqual([VIDEO, PORT, LINZHOU]);
    fireEvent.keyDown(screen.getAllByTestId('reference-tile')[1], {
      key: 'ArrowRight',
      altKey: true,
    });
    expect(tiles()).toEqual([VIDEO, LINZHOU, PORT]);
    fireEvent.keyDown(screen.getAllByTestId('reference-tile')[0], {
      key: 'ArrowLeft',
      altKey: true,
    });
    expect(tiles()).toEqual([VIDEO, LINZHOU, PORT]);
  });

  it('拖动缩略图排序；拖出时携带插入正文的指令', async () => {
    await openThree();
    const [first, , third] = screen.getAllByTestId('reference-tile');
    const start = dataTransfer({});
    fireEvent.dragStart(first, { dataTransfer: start });
    expect(start.setData).toHaveBeenCalledWith(REFERENCE_TILE_MIME, '0');
    expect(start.setData).toHaveBeenCalledWith(
      'text/plain',
      '\n::image[星港城 · 码头]{src="novels/星河旅人/资料/图集/设定/星港城商会/图片.webp"}\n'
    );
    const target = third.parentElement as HTMLElement;
    target.getBoundingClientRect = () =>
      ({ left: 0, width: 100, top: 0, height: 100, right: 100, bottom: 100 }) as DOMRect;
    const drop = dataTransfer({ [REFERENCE_TILE_MIME]: '0' });
    // 落在第三张的左半边：插到它前面（扣除移走的第一张后位于第 2 位）
    fireEvent.dragOver(target, { dataTransfer: drop, clientX: 10 });
    expect(target.className).toMatch(/dropBefore/);
    fireEvent.drop(target, { dataTransfer: drop, clientX: 10 });
    expect(tiles()).toEqual([VIDEO, PORT, LINZHOU]);
  });

  it('资料树拖来的文件插到落点；系统文件拖到窗格加到末尾；非媒体忽略', async () => {
    await openThree();
    const target = screen.getAllByTestId('reference-tile')[1].parentElement as HTMLElement;
    target.getBoundingClientRect = () =>
      ({ left: 0, width: 100, top: 0, height: 100, right: 100, bottom: 100 }) as DOMRect;
    const fromTree = dataTransfer({ [NOVEL_EDITOR_PATH_MIME]: `${WORK}/资料/素材/a.png` });
    fireEvent.drop(target, { dataTransfer: fromTree, clientX: 10 });
    expect(tiles()).toEqual([PORT, `${WORK}/资料/素材/a.png`, VIDEO, LINZHOU]);

    window.electron.getLastDroppedPaths = () => ['/outside/b.mp4', '/outside/说明.md'];
    const pane = screen.getByTestId('reference-pane');
    fireEvent.dragOver(pane, { dataTransfer: dataTransfer({ Files: '' }) });
    fireEvent.drop(pane, { dataTransfer: dataTransfer({ Files: '' }) });
    expect(tiles()).toEqual([PORT, `${WORK}/资料/素材/a.png`, VIDEO, LINZHOU, '/outside/b.mp4']);
  });

  it('「插入到正文」：在当前编辑器插入 ::image 指令（路径相对文档目录）', async () => {
    const insertBlock = vi.fn(() => true);
    const registration = registerActiveEditor({
      save: vi.fn(),
      getSnapshot: () => ({ filePath: DOC_PATH, content: '', readOnly: false }),
      openSearch: vi.fn(),
      insertBlock,
    });
    await openThree();
    fireEvent.click(screen.getByRole('button', { name: '插入到正文' }));
    expect(insertBlock).toHaveBeenCalledWith(
      '::image[星港城 · 码头]{src="novels/星河旅人/资料/图集/设定/星港城商会/图片.webp"}'
    );
    registration.dispose();
  });
});

describe('热更新', () => {
  it('fileSignature / changedPaths：第一次只记录，之后签名变化才算修改', () => {
    expect(fileSignature({ size: 3, modified: new Date(5) })).toBe('3:5');
    expect(fileSignature({ size: 3, modified: '1970-01-01T00:00:00.007Z' })).toBe('3:7');
    expect(fileSignature(null)).toBeNull();
    const known = new Map<string, string>();
    expect(changedPaths(known, [{ path: '/a', signature: '1:1' }])).toEqual([]);
    expect(changedPaths(known, [{ path: '/a', signature: '1:1' }])).toEqual([]);
    expect(
      changedPaths(known, [
        { path: '/a', signature: '2:1' },
        { path: '/b', signature: null },
      ])
    ).toEqual(['/a']);
  });

  it('显示中的文件在磁盘上被修改：约 2 秒内重新读取；资料变化通知时检查全部参考', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<ReferencePane />);
    act(() => {
      requestOpenReference({
        items: [
          { path: PORT, title: '码头', kind: 'image' },
          { path: LINZHOU, title: '林舟', kind: 'image' },
        ],
      });
    });
    const readsOf = (path: string) =>
      mock.invoke.mock.calls.filter(
        ([channel, target]) => channel === 'read-file-binary' && target === path
      ).length;
    await waitFor(() => expect(readsOf(PORT)).toBeGreaterThan(0));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFERENCE_POLL_INTERVAL_MS);
    });
    const before = readsOf(PORT);
    modified[PORT] = 5000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFERENCE_POLL_INTERVAL_MS);
    });
    await waitFor(() => expect(readsOf(PORT)).toBe(before + 1));

    // 不在主画面的文件：资料变化通知后检查
    const linzhouBefore = readsOf(LINZHOU);
    modified[LINZHOU] = 9000;
    await act(async () => {
      notifyWorkspaceFilesChanged();
      await vi.advanceTimersByTimeAsync(10);
    });
    await waitFor(() => expect(readsOf(LINZHOU)).toBe(linzhouBefore + 1));
  });
});

describe('planBlockInsert', () => {
  it('空行直接写入；非空行插到行末之后', () => {
    expect(planBlockInsert({ from: 4, to: 4, text: '' }, '::image[a]{src="a.png"}')).toEqual({
      from: 4,
      insert: '::image[a]{src="a.png"}',
    });
    expect(planBlockInsert({ from: 0, to: 3, text: '正文。' }, 'X')).toEqual({
      from: 3,
      insert: '\nX',
    });
  });
});
