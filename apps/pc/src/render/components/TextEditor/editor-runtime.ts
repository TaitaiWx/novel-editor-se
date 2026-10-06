/**
 * CodeMirror 运行时模块的懒加载（commands / search / 语言包）。
 * 模块级缓存保证多个编辑器实例共享同一份加载结果。
 */
import type { Extension } from '@codemirror/state';

export interface EditorRuntimeModules {
  history: typeof import('@codemirror/commands').history;
  defaultKeymap: typeof import('@codemirror/commands').defaultKeymap;
  historyKeymap: typeof import('@codemirror/commands').historyKeymap;
  searchKeymap: typeof import('@codemirror/search').searchKeymap;
  highlightSelectionMatches: typeof import('@codemirror/search').highlightSelectionMatches;
  searchExtensions: typeof import('./search-panel').searchExtensions;
}

let editorRuntimePromise: Promise<EditorRuntimeModules> | null = null;
let livePreviewPromise: Promise<typeof import('./live-preview')> | null = null;
const languageExtensionCache = new Map<string, Promise<Extension>>();

export const loadEditorRuntime = () => {
  if (!editorRuntimePromise) {
    editorRuntimePromise = Promise.all([
      import('@codemirror/commands'),
      import('@codemirror/search'),
      import('./search-panel'),
    ]).then(([commands, search, searchPanel]) => ({
      history: commands.history,
      defaultKeymap: commands.defaultKeymap,
      historyKeymap: commands.historyKeymap,
      searchKeymap: search.searchKeymap,
      highlightSelectionMatches: search.highlightSelectionMatches,
      searchExtensions: searchPanel.searchExtensions,
    }));
  }

  return editorRuntimePromise;
};

export const loadLanguageExtension = (lang: string): Promise<Extension> => {
  const cached = languageExtensionCache.get(lang);
  if (cached) return cached;

  const promise = (async () => {
    switch (lang) {
      case 'markdown': {
        // GFM（表格、任务列表、删除线）+ 数学公式语法，供高亮与实时预览共用同一棵语法树
        const [module, math] = await Promise.all([
          import('@codemirror/lang-markdown'),
          import('./live-preview/math-syntax'),
        ]);
        return module.markdown({
          base: module.markdownLanguage,
          extensions: [math.mathMarkdownSyntax],
        });
      }
      case 'json': {
        const module = await import('@codemirror/lang-json');
        return module.json();
      }
      case 'javascript':
      case 'typescript': {
        const module = await import('@codemirror/lang-javascript');
        return module.javascript({ typescript: lang === 'typescript' });
      }
      default:
        return [];
    }
  })();

  languageExtensionCache.set(lang, promise);
  return promise;
};

/** 懒加载 Markdown 实时预览模块（含 KaTeX，单独分包，只在需要时加载） */
export const loadMarkdownLivePreview = () => {
  if (!livePreviewPromise) {
    livePreviewPromise = import('./live-preview').catch((err: unknown) => {
      livePreviewPromise = null;
      throw err;
    });
  }
  return livePreviewPromise;
};
