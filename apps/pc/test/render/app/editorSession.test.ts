import { describe, expect, it } from 'vitest';
import {
  buildEditorSessionStorageKey,
  parseEditorSessionSnapshot,
  sameViewportSnapshot,
} from '@/render/app/editorSession';

const snap = { anchor: 10, head: 12, scrollTop: 300, scrollLeft: 0 };

describe('buildEditorSessionStorageKey', () => {
  it('按作品目录生成键', () => {
    expect(buildEditorSessionStorageKey('/n/青云志')).toBe('novel-editor:editor-session:/n/青云志');
    expect(buildEditorSessionStorageKey(null)).toBeNull();
  });
});

describe('parseEditorSessionSnapshot', () => {
  it('空值与非法 JSON 返回 null', () => {
    expect(parseEditorSessionSnapshot(null)).toBeNull();
    expect(parseEditorSessionSnapshot('{oops')).toBeNull();
  });

  it('清洗标签与视口快照', () => {
    const parsed = parseEditorSessionSnapshot(
      JSON.stringify({
        openTabs: ['/n/第一章.md', 3, '/n/第二章.md'],
        activeTab: '/n/第一章.md',
        viewportSnapshots: {
          '/n/第一章.md': snap,
          '/n/第二章.md': { anchor: 'x', head: 1, scrollTop: 0, scrollLeft: 0 },
          '/n/第三章.md': null,
        },
      })
    );
    expect(parsed).toEqual({
      openTabs: ['/n/第一章.md', '/n/第二章.md'],
      activeTab: '/n/第一章.md',
      viewportSnapshots: { '/n/第一章.md': snap },
    });
  });

  it('字段类型错误时使用默认值', () => {
    expect(
      parseEditorSessionSnapshot(
        JSON.stringify({ openTabs: 'x', activeTab: 1, viewportSnapshots: 2 })
      )
    ).toEqual({ openTabs: [], activeTab: null, viewportSnapshots: {} });
  });
});

describe('sameViewportSnapshot', () => {
  it('逐字段比较', () => {
    expect(sameViewportSnapshot(undefined, snap)).toBe(false);
    expect(sameViewportSnapshot({ ...snap }, snap)).toBe(true);
    expect(sameViewportSnapshot({ ...snap, scrollLeft: 5 }, snap)).toBe(false);
    expect(sameViewportSnapshot({ ...snap, head: 11 }, snap)).toBe(false);
  });
});
