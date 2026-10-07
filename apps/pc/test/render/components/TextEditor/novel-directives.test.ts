// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    document.body.innerHTML = '';
  });

  it('非光标行显示场景条 / 视频卡片 / 场景结束线；未知指令保留源码', () => {
    const v = mount(0);
    const scene = v.dom.querySelector('.cm-lp-scene');
    expect(scene?.textContent).toBe('场景 · 港口 · 视角 林舟');
    const video = v.dom.querySelector('.cm-lp-video');
    expect(video?.textContent).toBe('▶ 视频 · 启航');
    expect(video?.getAttribute('aria-label')).toBe('播放视频 启航');
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
    expect(v.dom.querySelector('.cm-lp-video')).toBeNull();
    expect(v.dom.querySelector('.cm-lp-scene')).not.toBeNull();
  });

  it('没有说明的视频卡片显示文件名', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    view = new EditorView({
      state: EditorState.create({
        doc: '开头\n::video{src=资料/视频/样片-1.mp4}',
        extensions: [novelDirectivePreview(null)],
      }),
      parent,
    });
    expect(view.dom.querySelector('.cm-lp-video')?.textContent).toBe('▶ 视频 · 样片-1.mp4');
  });

  it('点击视频卡片：找到存在的候选后在参考窗格打开', async () => {
    const mock = installElectronMock((channel, candidate) => {
      if (channel !== 'get-file-info') return null;
      if (candidate === '/p/novels/星河/资料/视频/镜头1-v1.mp4') return { size: 1 };
      throw new Error('不存在');
    });
    const listener = vi.fn();
    window.addEventListener(REFERENCE_OPEN_EVENT, listener);
    const v = mount(0);
    const video = v.dom.querySelector('.cm-lp-video') as HTMLElement;
    video.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    const detail = (listener.mock.calls[0][0] as CustomEvent<OpenReferenceDetail>).detail;
    expect(detail.items).toEqual([
      { path: '/p/novels/星河/资料/视频/镜头1-v1.mp4', title: '启航', kind: 'video' },
    ]);
    expect(mock.invoke).toHaveBeenCalledWith(
      'get-file-info',
      '/p/novels/星河/资料/视频/镜头1-v1.mp4'
    );
    expect(video.classList.contains('cm-lp-video-missing')).toBe(false);
    window.removeEventListener(REFERENCE_OPEN_EVENT, listener);
  });

  it('点击视频卡片：所有候选都不存在时标记为缺失', async () => {
    const mock = installElectronMock(() => {
      throw new Error('不存在');
    });
    const v = mount(0);
    const video = v.dom.querySelector('.cm-lp-video') as HTMLElement;
    video.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(video.classList.contains('cm-lp-video-missing')).toBe(true));
    // /p/novels/星河 向上逐级：4 个候选都试过
    expect(mock.invoke).toHaveBeenCalledTimes(4);
  });

  it('没有 electron 时点击直接标记缺失', async () => {
    uninstallElectronMock();
    const v = mount(0);
    const video = v.dom.querySelector('.cm-lp-video') as HTMLElement;
    video.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(video.classList.contains('cm-lp-video-missing')).toBe(true));
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
