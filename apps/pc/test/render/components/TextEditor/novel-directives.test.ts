// @vitest-environment happy-dom
import { clearDirectiveMediaCache } from '@/render/components/TextEditor/live-preview/media-loader';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { parseDirectiveLine } from '@novel-editor/core/novel-format';
import {
  describeSceneDirective,
  novelDirectivePreview,
  videoPathCandidates,
} from '@/render/components/TextEditor/live-preview/novel-directives';
import { REFERENCE_OPEN_EVENT, type OpenReferenceDetail } from '@/render/utils/referencePane';
import { installElectronMock, uninstallElectronMock } from '../../hooks/electronMock';

describe('videoPathCandidates', () => {
  it('空地址没有候选；绝对路径原样返回', () => {
    expect(videoPathCandidates('/p/a.md', '  ')).toEqual([]);
    expect(videoPathCandidates('/p/a.md', '/abs/v.mp4')).toEqual(['/abs/v.mp4']);
    expect(videoPathCandidates(null, 'C:\\v\\a.mp4')).toEqual(['C:\\v\\a.mp4']);
    expect(videoPathCandidates(null, '资料/v.mp4')).toEqual([]);
  });

  it('相对路径：从章节目录开始逐级向上，最多 5 个候选', () => {
    expect(
      videoPathCandidates('/p/novels/星河旅人/第一卷/001.md', '资料/视频/镜头1-v1.mp4')
    ).toEqual([
      '/p/novels/星河旅人/第一卷/资料/视频/镜头1-v1.mp4',
      '/p/novels/星河旅人/资料/视频/镜头1-v1.mp4',
      '/p/novels/资料/视频/镜头1-v1.mp4',
      '/p/资料/视频/镜头1-v1.mp4',
      '/资料/视频/镜头1-v1.mp4',
    ]);
    expect(videoPathCandidates('/a/b.md', './x//y.mp4')).toEqual(['/a/./x/y.mp4', '/./x/y.mp4']);
  });

  it('Windows 路径沿用反斜杠', () => {
    expect(videoPathCandidates('D:\\书\\卷\\001.md', '资料/v.mp4').slice(0, 2)).toEqual([
      'D:\\书\\卷\\资料\\v.mp4',
      'D:\\书\\资料\\v.mp4',
    ]);
  });
});

describe('describeSceneDirective', () => {
  const describe_ = (line: string) => {
    const directive = parseDirectiveLine(line);
    if (!directive) throw new Error(`不是指令：${line}`);
    return describeSceneDirective(directive);
  };

  it('标题 · 视角 · 地点 · 时间，缺的省略', () => {
    expect(describe_(':::scene{title=港口 pov=林舟 location=青石镇 time=黎明}')).toBe(
      '港口 · 视角 林舟 · 青石镇 · 黎明'
    );
    expect(describe_(':::scene{title="雨 夜"}')).toBe('雨 夜');
  });

  it('没有标题时依次用方括号文字、#id、「未命名场景」', () => {
    expect(describe_(':::scene[码头告别]{pov=苏晴}')).toBe('码头告别 · 视角 苏晴');
    expect(describe_(':::scene{#s1}')).toBe('s1');
    expect(describe_(':::scene')).toBe('未命名场景');
  });
});

describe('novelDirectivePreview（编辑器）', () => {
  const DOC = [
    '正文第一行',
    ':::scene{title=港口 pov=林舟}',
    '海风很大。',
    '::video[启航]{src=资料/视频/镜头1-v1.mp4}',
    ':::',
    '::note[不认识的指令]',
  ].join('\n');

  let view: EditorView | null = null;
  const mount = (cursor: number, filePath: string | null = '/p/novels/星河/001.md') => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    view = new EditorView({
      state: EditorState.create({
        doc: DOC,
        selection: { anchor: cursor },
        extensions: [novelDirectivePreview(filePath)],
      }),
      parent,
    });
    return view;
  };

  beforeEach(() => installElectronMock());
  afterEach(() => {
    view?.destroy();
    view = null;
    uninstallElectronMock();
    clearDirectiveMediaCache();
    document.body.innerHTML = '';
  });

  it('非光标行显示场景条 / 视频播放器 / 场景结束线；未知指令保留源码', () => {
    const v = mount(0);
    const scene = v.dom.querySelector('.cm-lp-scene');
    expect(scene?.textContent).toBe('场景 · 港口 · 视角 林舟');
    const video = v.dom.querySelector('.cm-lp-media.cm-lp-video');
    expect(video?.getAttribute('aria-label')).toBe('视频 启航');
    // 加载前是一条细的占位提示，没有单独的说明行
    expect(video?.querySelector('.cm-lp-media-frame')?.textContent).toContain('视频 · 启航');
    expect(video?.querySelector('.cm-lp-media-caption')).toBeNull();
    expect(v.dom.querySelector('.cm-lp-scene-end')?.textContent).toBe('场景结束');
    expect(v.dom.textContent).toContain('::note[不认识的指令]');
    expect(v.dom.textContent).not.toContain(':::scene');
  });

  it('光标所在行显示源码，移开后恢复为组件', () => {
    const v = mount(DOC.indexOf(':::scene') + 2);
    expect(v.dom.querySelector('.cm-lp-scene')).toBeNull();
    expect(v.dom.textContent).toContain(':::scene{title=港口 pov=林舟}');
    v.dispatch({ selection: EditorSelection.cursor(0) });
    expect(v.dom.querySelector('.cm-lp-scene')).not.toBeNull();
    v.dispatch({ selection: EditorSelection.cursor(DOC.indexOf('::video') + 3) });
    expect(v.dom.querySelector('.cm-lp-media')).toBeNull();
    expect(v.dom.querySelector('.cm-lp-scene')).not.toBeNull();
  });

  it('没有说明的视频显示文件名', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    view = new EditorView({
      state: EditorState.create({
        doc: '开头\n::video{src=资料/视频/样片-1.mp4}',
        extensions: [novelDirectivePreview(null)],
      }),
      parent,
    });
    expect(view.dom.querySelector('.cm-lp-media')?.getAttribute('aria-label')).toBe(
      '视频 样片-1.mp4'
    );
  });

  it('视频就地加载为播放器；「在旁边看」在参考窗格打开实际找到的文件', async () => {
    const found = '/p/novels/星河/资料/视频/镜头1-v1.mp4';
    const mock = installElectronMock((channel, candidate) => {
      if (channel === 'get-file-info') {
        if (candidate === found) return { size: 1 };
        throw new Error('不存在');
      }
      if (channel === 'read-file-binary') return { base64Content: 'AAAA', mimeType: 'video/mp4' };
      return null;
    });
    const listener = vi.fn();
    window.addEventListener(REFERENCE_OPEN_EVENT, listener);
    const v = mount(0);
    const player = await vi.waitFor(() => {
      const element = v.dom.querySelector('video.cm-lp-video-player') as HTMLVideoElement | null;
      expect(element).not.toBeNull();
      return element as HTMLVideoElement;
    });
    // 自定义播放器：不用原生控制条，分组带名称，有播放按钮与进度条
    expect(player.controls).toBe(false);
    const group = v.dom.querySelector('.cm-lp-video [role="group"]') as HTMLElement;
    expect(group.getAttribute('aria-label')).toBe('视频 启航');
    expect(group.querySelector('[role="slider"]')).not.toBeNull();
    const play = group.querySelector('button[aria-label="播放"]') as HTMLButtonElement;
    await act(async () => {
      play.click();
    });
    expect(player.paused).toBe(false);
    expect(v.dom.querySelector('.cm-lp-pending')).toBeNull();
    expect(mock.invoke).toHaveBeenCalledWith('read-file-binary', found);
    const beside = v.dom.querySelector('.cm-lp-video .cm-lp-media-beside') as HTMLElement;
    expect(beside.getAttribute('aria-label')).toBe('在旁边看 启航');
    // 编辑器里的选区不受播放器内部点击影响
    expect(v.state.selection.main.head).toBe(0);
    beside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(listener).toHaveBeenCalledTimes(1);
    const detail = (listener.mock.calls[0][0] as CustomEvent<OpenReferenceDetail>).detail;
    expect(detail.items).toEqual([{ path: found, title: '启航', kind: 'video' }]);
    window.removeEventListener(REFERENCE_OPEN_EVENT, listener);
  });

  it('所有候选都不存在时显示「找不到视频」', async () => {
    const mock = installElectronMock(() => {
      throw new Error('不存在');
    });
    const v = mount(0);
    await vi.waitFor(() =>
      expect(v.dom.querySelector('.cm-lp-media-missing')?.textContent).toContain(
        '找不到视频：资料/视频/镜头1-v1.mp4'
      )
    );
    // /p/novels/星河 向上逐级：4 个候选都试过，不读取文件
    expect(mock.invoke.mock.calls.filter(([channel]) => channel === 'get-file-info')).toHaveLength(
      4
    );
    expect(v.dom.querySelector('.cm-lp-media-beside')).toBeNull();
  });

  it('没有 electron 时直接显示找不到', async () => {
    uninstallElectronMock();
    const v = mount(0);
    await vi.waitFor(() => expect(v.dom.querySelector('.cm-lp-media-missing')).not.toBeNull());
  });

  it('::image 就地显示图片', async () => {
    installElectronMock((channel) => {
      if (channel === 'get-file-info') return { size: 1 };
      if (channel === 'read-file-binary') return { base64Content: 'AAAA', mimeType: 'image/webp' };
      return null;
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    view = new EditorView({
      state: EditorState.create({
        doc: '开头\n::image[码头]{src="资料/图集/设定/星港城/图片.webp"}',
        extensions: [novelDirectivePreview('/p/novels/星河/001.md')],
      }),
      parent,
    });
    const img = await vi.waitFor(() => {
      const element = view?.dom.querySelector('img.cm-lp-image-directive') as HTMLImageElement;
      expect(element).toBeTruthy();
      return element;
    });
    expect(img.alt).toBe('码头');
    // 图片边框贴合图片，「在旁边看」是悬停浮现的图标按钮
    expect(img.parentElement?.classList.contains('cm-lp-image-frame')).toBe(true);
    const beside = view?.dom.querySelector('.cm-lp-image .cm-lp-media-beside') as HTMLElement;
    expect(beside.getAttribute('aria-label')).toBe('在旁边看 码头');
    const listener = vi.fn();
    window.addEventListener(REFERENCE_OPEN_EVENT, listener);
    beside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(REFERENCE_OPEN_EVENT, listener);
  });

  it('视图销毁时卸载播放器；加载完成前被销毁则不再挂载', async () => {
    let resolveRead: (value: unknown) => void = () => undefined;
    installElectronMock((channel) => {
      if (channel === 'get-file-info') return { size: 1 };
      if (channel === 'read-file-binary') return new Promise((resolve) => (resolveRead = resolve));
      return null;
    });
    const v = mount(0);
    const figure = v.dom.querySelector('.cm-lp-video') as HTMLElement;
    await vi.waitFor(() => expect(resolveRead).not.toBe(undefined));
    v.destroy();
    view = null;
    await act(async () => {
      resolveRead({ base64Content: 'AAAA', mimeType: 'video/mp4' });
      await Promise.resolve();
    });
    expect(figure.querySelector('video')).toBeNull();
  });

  it('不用 Markdown 语法的章 / 幕 / 场标题行带标题样式；正文里的「第三章说过……。」不算', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    view = new EditorView({
      state: EditorState.create({
        doc: '第一章 离港\n第一幕 离乡\n第一场 清晨\n他说第三章说过的话。\n楔子',
        extensions: [novelDirectivePreview(null)],
      }),
      parent,
    });
    const lines = Array.from(view.dom.querySelectorAll('.cm-line'));
    expect(lines[0].classList.contains('cm-lp-chapter-title')).toBe(true);
    expect(lines[1].classList.contains('cm-lp-act-title')).toBe(true);
    expect(lines[2].classList.contains('cm-lp-scene-title')).toBe(true);
    expect(lines[3].className).not.toMatch(/cm-lp-(chapter|act|scene)-title/);
    expect(lines[4].classList.contains('cm-lp-chapter-title')).toBe(true);
  });

  it('行内 :char[称呼]{id=人物} 显示称呼，悬停提示人物；光标所在行显示源码', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = '第一行\n:char[阿舟]{id=林舟}把行囊甩上肩。';
    view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: 0 },
        extensions: [novelDirectivePreview(null)],
      }),
      parent,
    });
    const chip = view.dom.querySelector('.cm-lp-char') as HTMLElement;
    expect(chip.textContent).toBe('阿舟');
    expect(chip.title).toBe('人物：林舟');
    expect(view.dom.textContent).not.toContain(':char[');
    view.dispatch({ selection: EditorSelection.cursor(doc.length) });
    expect(view.dom.querySelector('.cm-lp-char')).toBeNull();
    expect(view.dom.textContent).toContain(':char[阿舟]{id=林舟}');
  });

  it('编辑文档后重新构建（新增的场景行被渲染）', () => {
    const v = mount(0);
    v.dispatch({
      changes: { from: v.state.doc.length, insert: '\n:::scene{title=新场景}\n尾' },
      selection: EditorSelection.cursor(0),
    });
    const scenes = Array.from(v.dom.querySelectorAll('.cm-lp-scene')).map((el) => el.textContent);
    expect(scenes).toEqual(['场景 · 港口 · 视角 林舟', '场景 · 新场景']);
  });
});
