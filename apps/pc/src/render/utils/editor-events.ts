export const NOVEL_EDITOR_FILE_SAVED_EVENT = 'novel-editor:file-saved';

export interface NovelEditorFileSavedDetail {
  filePath: string;
  mode: 'auto' | 'manual';
}

/** 编辑器未保存状态变化（GUI 会话发布用，见 useGuiSessionPublisher） */
export const NOVEL_EDITOR_DIRTY_CHANGE_EVENT = 'novel-editor:dirty-change';

export interface NovelEditorDirtyChangeDetail {
  filePath: string;
  dirty: boolean;
}

export function emitDirtyChange(filePath: string, dirty: boolean): void {
  document.dispatchEvent(
    new CustomEvent<NovelEditorDirtyChangeDetail>(NOVEL_EDITOR_DIRTY_CHANGE_EVENT, {
      detail: { filePath, dirty },
    })
  );
}
