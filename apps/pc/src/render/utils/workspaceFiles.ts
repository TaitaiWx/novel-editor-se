/**
 * 渲染进程内的「文件变化 / 在文件面板中定位」通知。
 *
 * 场景视频等功能在后台写入 资料/ 下的文件（成片、样片、分镜表）后派发 WORKSPACE_FILES_CHANGED_EVENT，
 * 项目加载器静默刷新文件树（防抖合并），作者不用手动「刷新」就能在资料里看到结果；
 * REVEAL_IN_FILE_PANEL_EVENT 让文件面板展开侧边栏并定位、高亮到指定文件。
 */

export const WORKSPACE_FILES_CHANGED_EVENT = 'novel-editor:workspace-files-changed';
export const REVEAL_IN_FILE_PANEL_EVENT = 'novel-editor:reveal-in-file-panel';

/** 静默刷新文件树的防抖间隔 */
export const WORKSPACE_REFRESH_DEBOUNCE_MS = 400;

export function notifyWorkspaceFilesChanged(): void {
  window.dispatchEvent(new CustomEvent(WORKSPACE_FILES_CHANGED_EVENT));
}

export interface RevealInFilePanelDetail {
  path: string;
}

export function requestRevealInFilePanel(path: string): void {
  window.dispatchEvent(
    new CustomEvent<RevealInFilePanelDetail>(REVEAL_IN_FILE_PANEL_EVENT, { detail: { path } })
  );
}
