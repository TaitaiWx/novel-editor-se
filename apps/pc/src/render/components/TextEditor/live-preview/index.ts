/**
 * Markdown 实时预览（类 Typora）：光标所在行 / 块显示源码，其余位置就地渲染。
 *
 * 入口模块会被懒加载（包含 KaTeX），只在打开 .md 文件且开启「Markdown 实时渲染」时加载。
 * 依赖 markdown 语言扩展提供语法树（GFM + 数学公式，见 editor-runtime.ts）。
 */
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { LivePreviewBuildOptions } from './build-decorations';
import { createLivePreviewField, createViewportSync, refreshLivePreview } from './field';
import { resolveImageSource } from './image-loader';
import { livePreviewTheme } from './theme';

export type { LivePreviewBuildOptions } from './build-decorations';

const EXTERNAL_LINK = /^(https?:|mailto:)/i;

/** ⌘/Ctrl + 点击链接：网址交给系统浏览器，本地路径交给系统默认程序 */
export function openLivePreviewLink(href: string, filePath: string | null): boolean {
  const target = href.trim();
  if (!target || target.startsWith('#')) return false;
  const ipc = typeof window !== 'undefined' ? window.electron?.ipcRenderer : undefined;
  if (!ipc) return false;
  const request = EXTERNAL_LINK.test(target)
    ? ipc.invoke('open-external-url', target)
    : ipc.invoke('open-in-system-app', resolveImageSource(target, filePath));
  request.catch((err: unknown) => console.warn('[live-preview] 打开链接失败', err));
  return true;
}

/** 创建实时预览扩展 */
export function markdownLivePreview(options: LivePreviewBuildOptions): Extension {
  const field = createLivePreviewField(options);
  return [
    field,
    createViewportSync(field),
    livePreviewTheme,
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false;
        const target = event.target instanceof Element ? event.target : null;
        const link = target?.closest('[data-lp-href]');
        if (!link || !view.contentDOM.contains(link)) return false;
        const href = link.getAttribute('data-lp-href') ?? '';
        if (!openLivePreviewLink(href, options.filePath)) return false;
        event.preventDefault();
        return true;
      },
      compositionend(_event, view) {
        // 组字期间只映射了装饰，结束后刷新一次
        setTimeout(() => {
          if (view.dom.isConnected && view.state.field(field, false))
            view.dispatch({ effects: refreshLivePreview.of(null) });
        }, 0);
        return false;
      },
    }),
  ];
}
