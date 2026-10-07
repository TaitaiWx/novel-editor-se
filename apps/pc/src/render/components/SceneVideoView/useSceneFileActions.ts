/**
 * 场景目录里文件的动作（从 SceneVideoView/index.tsx 拆出）：在资料中定位、在编辑器旁边打开、按原格式导出
 */
import { useCallback } from 'react';
import {
  notifyWorkspaceFilesChanged,
  requestRevealInFilePanel,
} from '@/render/utils/workspaceFiles';
import { referenceItemFor, requestOpenReference } from '@/render/utils/referencePane';
import { exportMediaFile } from '@/render/utils/mediaExport';
import type { SceneMessage } from './useSceneAnimatic';

export function joinPath(dir: string, name: string): string {
  const separator = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${separator}${name}`;
}

export function useSceneFileActions(input: {
  dir: string | null;
  sceneName: string;
  onMessage: (message: SceneMessage) => void;
}) {
  const { dir, sceneName, onMessage } = input;

  const revealInMaterials = useCallback(
    (fileName?: string) => {
      if (!dir) {
        onMessage({
          tone: 'info',
          text: '这一场还没有保存任何文件，修改分镜或生成镜头后再查看',
        });
        return;
      }
      notifyWorkspaceFilesChanged();
      requestRevealInFilePanel(fileName ? joinPath(dir, fileName) : dir);
    },
    [dir, onMessage]
  );

  /** 在编辑器旁边的参考窗格里看成片 / 样片 */
  const openBeside = useCallback(
    (fileName: string) => {
      if (!dir) return;
      const reference = referenceItemFor(joinPath(dir, fileName), `${sceneName} · ${fileName}`);
      if (reference) requestOpenReference({ items: [reference] });
    },
    [dir, sceneName]
  );

  // 版本列表「导出」：成片按原格式另存（不转码）
  const exportVersion = useCallback(
    (fileName: string) => {
      if (!dir) return;
      void exportMediaFile({
        sourcePath: joinPath(dir, fileName),
        title: `${sceneName}-${fileName}`,
      }).then((result) => {
        if (result.saved) onMessage({ tone: 'success', text: `已导出到 ${result.filePath ?? ''}` });
        else if (result.error) onMessage({ tone: 'error', text: `导出失败：${result.error}` });
      });
    },
    [dir, onMessage, sceneName]
  );

  return { revealInMaterials, openBeside, exportVersion };
}
