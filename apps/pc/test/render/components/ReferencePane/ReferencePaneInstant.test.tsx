// @vitest-environment happy-dom
/**
 * 参考窗格同步打开：缓存命中时同一帧显示本章第一张；未解析的引用放占位（骨架），解析后原位替换，
 * 其他条目顺序与选中项不变
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReferencePane from '@/render/components/ReferencePane';
import ReferenceButton from '@/render/components/ReferenceButton';
import {
  PENDING_REFERENCE_PREFIX,
  type ReferenceAutoSource,
  type ReferenceItem,
} from '@/render/utils/referencePane';
import { buildAutoReferenceItemsSync } from '@/render/components/ReferencePane/useReferencePaneState';
import {
  invalidateMediaResolveCache,
  resolveMediaRefs,
} from '@/render/components/TextEditor/live-preview/media-resolve';
import {
  documentMediaRefKey,
  extractDocumentMediaRefs,
  peekDocumentMedia,
  reconcileAutoItems,
  remapPendingSelection,
} from '@/render/utils/referenceSources';
import { cancelReferenceWarmup } from '@/render/utils/referenceWarmup';
import { installElectronMock, uninstallElectronMock } from '../../hooks/electronMock';

const WORK = '/p/novels/星河旅人';
const VIDEO = `${WORK}/资料/视频/示例/离港.mp4`;
const PORT = `${WORK}/资料/图集/设定/星港城商会/图片.webp`;
const LINZHOU = `${WORK}/资料/图集/人物/林舟/三视图.webp`;
const DOC_PATH = '/p/小说格式示例.md';
const DOC = [
  '::image[星港城 · 码头]{src="novels/星河旅人/资料/图集/设定/星港城商会/图片.webp"}',
  '::video[离港]{src="novels/星河旅人/资料/视频/示例/离港.mp4"}',
].join('\n');
const CHARACTERS: ReferenceItem[] = [
  { path: LINZHOU, title: '林舟 · 三视图', kind: 'image', group: 'character' },
];
const SOURCE: ReferenceAutoSource = {
  documentPath: DOC_PATH,
  text: DOC,
  workPath: WORK,
  files: [],
};
const REFS = extractDocumentMediaRefs(DOC);
const PORT_PENDING = `${PENDING_REFERENCE_PREFIX}${documentMediaRefKey(REFS[0])}`;
const VIDEO_PENDING = `${PENDING_REFERENCE_PREFIX}${documentMediaRefKey(REFS[1])}`;

let release: (() => void) | null;
const existing = new Set([VIDEO, PORT, LINZHOU]);

function tiles(): string[] {
  return screen
    .getAllByTestId('reference-tile')
    .map((tile) => tile.getAttribute('data-path') ?? '');
}

beforeEach(() => {
  invalidateMediaResolveCache();
  release = null;
  installElectronMock(async (channel, arg) => {
    if (channel === 'get-files-exist') {
      // 可以挂起，模拟慢速探测
      if (release === null) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return (arg as string[]).map((path) => existing.has(path));
    }
    if (channel === 'get-file-info') return { size: 1, modified: new Date(1000), isFile: true };
    if (channel === 'read-file-binary') return { base64Content: 'AAAA', mimeType: 'image/webp' };
    return null;
  });
  let counter = 0;
  Object.assign(URL, {
    createObjectURL: vi.fn(() => `blob:i-${++counter}`),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  cancelReferenceWarmup();
  uninstallElectronMock();
});

/** 不挂起，直接把引用解析进缓存 */
async function warm() {
  release = () => undefined;
  await resolveMediaRefs(DOC_PATH, REFS);
}

describe('同步构建', () => {
  it('缓存命中：直接给出本章条目；未解析：同样位置放占位（标题取说明、类型按扩展名）', () => {
    const cold = buildAutoReferenceItemsSync(CHARACTERS, SOURCE);
    expect(cold.map((item) => [item.path, item.title, item.kind, item.pending ?? false])).toEqual([
      [PORT_PENDING, '星港城 · 码头', 'image', true],
      [VIDEO_PENDING, '离港', 'video', true],
      [LINZHOU, '林舟 · 三视图', 'image', false],
    ]);
    const mixed = peekDocumentMedia(REFS, DOC_PATH, (ref) =>
      ref.src.endsWith('.webp') ? PORT : undefined
    );
    expect(mixed.map((item) => item.path)).toEqual([PORT, VIDEO_PENDING]);
    // 确认找不到的跳过
    expect(peekDocumentMedia(REFS, DOC_PATH, () => null)).toEqual([]);
  });

  it('占位原位替换，选中的占位换成解析出的路径', () => {
    const current = buildAutoReferenceItemsSync(CHARACTERS, SOURCE);
    const resolved = buildAutoReferenceItemsSync(CHARACTERS, SOURCE, (ref) =>
      ref.src.endsWith('.webp') ? PORT : VIDEO
    );
    // 作者把人物图挪到最前
    const reordered = [current[2], current[0], current[1]];
    expect(reconcileAutoItems(reordered, resolved).map((item) => item.path)).toEqual([
      LINZHOU,
      PORT,
      VIDEO,
    ]);
    expect(remapPendingSelection(VIDEO_PENDING, resolved)).toBe(VIDEO);
    expect(remapPendingSelection(LINZHOU, resolved)).toBe(LINZHOU);
    expect(remapPendingSelection(null, resolved)).toBeNull();
    // 移除过的占位，解析出来也不再出现
    expect(
      reconcileAutoItems(current, resolved, new Set([PORT_PENDING])).map((item) => item.path)
    ).toEqual([VIDEO, LINZHOU]);
  });
});

describe('点「参考」', () => {
  it('缓存已预热：点击后同步出现，第一张就是本章第一个引用', async () => {
    await warm();
    render(
      <>
        <ReferenceButton fallback={CHARACTERS} source={SOURCE} />
        <ReferencePane />
      </>
    );
    fireEvent.click(screen.getByRole('button', { name: '参考' }));
    // 不等待：同一次点击里就已渲染
    expect(screen.getByTestId('reference-pane')).toBeTruthy();
    expect(tiles()).toEqual([PORT, VIDEO, LINZHOU]);
    expect(screen.getByTestId('reference-stage')).toBeTruthy();
    expect(screen.queryByTestId('reference-skeleton')).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(tiles()).toEqual([PORT, VIDEO, LINZHOU]);
  });

  it('缓存未命中：先放占位与骨架，解析后原位替换，选中项不跳', async () => {
    render(
      <>
        <ReferenceButton fallback={CHARACTERS} source={SOURCE} />
        <ReferencePane />
      </>
    );
    fireEvent.click(screen.getByRole('button', { name: '参考' }));
    expect(tiles()).toEqual([PORT_PENDING, VIDEO_PENDING, LINZHOU]);
    expect(screen.getByTestId('reference-skeleton').getAttribute('aria-label')).toContain(
      '星港城 · 码头'
    );
    // 作者在解析期间选中第二个（视频占位）
    fireEvent.click(screen.getAllByTestId('reference-tile')[1]);
    expect(screen.getAllByTestId('reference-tile')[1].getAttribute('aria-selected')).toBe('true');
    await waitFor(() => expect(release).not.toBeNull());
    await act(async () => {
      release?.();
    });
    await waitFor(() => expect(tiles()).toEqual([PORT, VIDEO, LINZHOU]));
    expect(screen.getAllByTestId('reference-tile')[1].getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByTestId('reference-skeleton')).toBeNull();
  });
});
