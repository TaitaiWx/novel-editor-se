export const NOVEL_EDITOR_FILE_SAVED_EVENT = 'novel-editor:file-saved';

export interface NovelEditorFileSavedDetail {
  filePath: string;
  mode: 'auto' | 'manual';
}
