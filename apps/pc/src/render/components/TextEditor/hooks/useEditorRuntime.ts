import { useEffect, useState } from 'react';
import { loadEditorRuntime, type EditorRuntimeModules } from '../editor-runtime';

/** 懒加载 CodeMirror 运行时模块，返回加载结果与初始化错误 */
export function useEditorRuntime() {
  const [editorRuntime, setEditorRuntime] = useState<EditorRuntimeModules | null>(null);
  const [editorInitError, setEditorInitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadEditorRuntime()
      .then((runtime) => {
        if (cancelled) return;
        setEditorRuntime(runtime);
        setEditorInitError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setEditorInitError(err instanceof Error ? err.message : '编辑器初始化失败');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { editorRuntime, editorInitError };
}
