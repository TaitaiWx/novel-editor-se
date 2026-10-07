// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REFERENCE_OPEN_EVENT,
  characterReferenceItems,
  isReferenceMedia,
  joinWorkPath,
  referenceItemFor,
  referenceKindOf,
  requestOpenReference,
  type OpenReferenceDetail,
} from '@/render/utils/referencePane';

describe('referencePane 纯函数', () => {
  it('按扩展名识别图片 / 视频（大小写不敏感），其他返回 null', () => {
    expect(referenceKindOf('/p/a.png')).toBe('image');
    expect(referenceKindOf('/p/a.JPEG')).toBe('image');
    expect(referenceKindOf('/p/a.svg')).toBe('image');
    expect(referenceKindOf('/p/镜头1-v1.mp4')).toBe('video');
    expect(referenceKindOf('C:\\p\\a.MOV')).toBe('video');
    expect(referenceKindOf('/p/资料/音乐/海港.m4a')).toBe('audio');
    expect(referenceKindOf('/p/音效/钟.WAV')).toBe('audio');
    expect(referenceKindOf('/p/a.mp3')).toBe('audio');
    expect(referenceKindOf('/p/a.md')).toBeNull();
    expect(referenceKindOf('/p/png')).toBeNull();
    expect(isReferenceMedia('/p/a.webm')).toBe(true);
    expect(isReferenceMedia('/p/a.txt')).toBe(false);
  });

  it('joinWorkPath：去掉末尾分隔符与空段；纯反斜杠路径保持 Windows 分隔符', () => {
    expect(joinWorkPath('/p/novels/星河旅人/', '资料/图集//a.png')).toBe(
      '/p/novels/星河旅人/资料/图集/a.png'
    );
    expect(joinWorkPath('C:\\书\\星河旅人\\', '资料/图集/a.png')).toBe(
      'C:\\书\\星河旅人\\资料\\图集\\a.png'
    );
    expect(joinWorkPath('/p', '资料\\a.png')).toBe('/p/资料/a.png');
  });

  it('referenceItemFor：标题默认取文件名，非媒体返回 null', () => {
    expect(referenceItemFor('/p/资料/地图.png')).toEqual({
      path: '/p/资料/地图.png',
      title: '地图.png',
      kind: 'image',
    });
    expect(referenceItemFor('C:\\p\\样片.mp4', '样片')).toEqual({
      path: 'C:\\p\\样片.mp4',
      title: '样片',
      kind: 'video',
    });
    expect(referenceItemFor('/p/a.md')).toBeNull();
  });
});

describe('requestOpenReference', () => {
  const listener = vi.fn();
  afterEach(() => {
    window.removeEventListener(REFERENCE_OPEN_EVENT, listener);
    listener.mockReset();
  });

  it('派发窗口事件；空列表不派发', () => {
    window.addEventListener(REFERENCE_OPEN_EVENT, listener);
    requestOpenReference({ items: [] });
    expect(listener).not.toHaveBeenCalled();
    const item = referenceItemFor('/p/a.png');
    if (!item) throw new Error('应识别为图片');
    requestOpenReference({ items: [item], index: 0 });
    expect(listener).toHaveBeenCalledTimes(1);
    const detail = (listener.mock.calls[0][0] as CustomEvent<OpenReferenceDetail>).detail;
    expect(detail).toEqual({ items: [item], index: 0 });
  });
});

describe('characterReferenceItems（「参考」按钮的默认内容）', () => {
  it('每个人物先三视图再形象图，转成作品内的绝对路径；跳过 data URL、网址与非图片', () => {
    expect(
      characterReferenceItems('/w/星河旅人', [
        {
          name: '林舟',
          avatar: '资料/图集/人物/林舟/形象图.webp',
          turnaround: '资料/图集/人物/林舟/三视图.webp',
        },
        { name: '苏晴', avatar: 'data:image/png;base64,AAAA' },
        { name: '白鸦', avatar: 'https://example.com/a.png' },
        { name: '秦伯', avatar: '资料/图集/人物/秦伯/说明.txt' },
      ])
    ).toEqual([
      {
        path: '/w/星河旅人/资料/图集/人物/林舟/三视图.webp',
        title: '林舟 · 三视图',
        kind: 'image',
        group: 'character',
      },
      {
        path: '/w/星河旅人/资料/图集/人物/林舟/形象图.webp',
        title: '林舟 · 形象图',
        kind: 'image',
        group: 'character',
      },
    ]);
  });

  it('没有作品目录时为空', () => {
    expect(characterReferenceItems(null, [{ name: '林舟', avatar: 'a.png' }])).toEqual([]);
  });
});
