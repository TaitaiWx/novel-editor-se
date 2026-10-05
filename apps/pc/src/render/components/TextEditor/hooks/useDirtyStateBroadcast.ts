import { useEffect } from 'react';
import { emitDirtyChange } from '@/render/utils/editor-events';

/**
 * 把编辑器的未保存状态广播到 document 事件，供 GUI 会话发布（ne status 显示未保存文件）。
 * 切换文件或卸载时，旧文件会被立即保存，因此在清理阶段把旧文件标记为已保存。
 */
export function useDirtyStateBroadcast(filePath: string | null, hasChanges: boolean): void {
  useEffect(() => {
    if (!filePath) return;
    emitDirtyChange(filePath, hasChanges);
    if (!hasChanges) return;
    return () => emitDirtyChange(filePath, false);
  }, [filePath, hasChanges]);
}
