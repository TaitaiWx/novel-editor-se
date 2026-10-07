/**
 * 打开文件夹时读取该项目的正文结构规则，并在「设置 → 正文结构」保存后（主进程广播
 * project-structure-changed）更新渲染进程的规则（utils/structureRules），打开的编辑器随即刷新。
 */
import { useEffect } from 'react';
import {
  PROJECT_STRUCTURE_CHANGED,
  type ProjectStructureChangedEvent,
} from '../../shared/project-structure';
import { setStructureConfig } from '../utils/structureRules';

function samePath(a: string, b: string): boolean {
  const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalize(a) === normalize(b);
}

export function useProjectStructureRules(folderPath: string | null): void {
  useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!folderPath || !ipc) {
      setStructureConfig(null);
      return;
    }
    let cancelled = false;
    ipc
      .invoke('project-structure-get', folderPath)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setStructureConfig(result.data.config);
        else console.warn('[structure] 读取正文结构规则失败', result.error);
      })
      .catch((error: unknown) => console.warn('[structure] 读取正文结构规则失败', error));
    const dispose = ipc.on<[unknown, ProjectStructureChangedEvent]>(
      PROJECT_STRUCTURE_CHANGED,
      (_event, payload) => {
        if (payload && samePath(payload.folderPath, folderPath)) setStructureConfig(payload.config);
      }
    );
    return () => {
      cancelled = true;
      if (typeof dispose === 'function') dispose();
    };
  }, [folderPath]);
}
