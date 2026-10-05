/**
 * 编辑器会话（打开的标签、视口快照）持久化相关工具
 */
import type { EditorViewportSnapshot } from '@/render/components/TextEditor';
import type { PersistedEditorSession } from './types';

export function buildEditorSessionStorageKey(folderPath: string | null): string | null {
  return folderPath ? `novel-editor:editor-session:${folderPath}` : null;
}

export function parseEditorSessionSnapshot(raw: string | null): PersistedEditorSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedEditorSession>;
    return {
      openTabs: Array.isArray(parsed.openTabs)
        ? parsed.openTabs.filter((item): item is string => typeof item === 'string')
        : [],
      activeTab: typeof parsed.activeTab === 'string' ? parsed.activeTab : null,
      viewportSnapshots:
        parsed.viewportSnapshots && typeof parsed.viewportSnapshots === 'object'
          ? Object.fromEntries(
              Object.entries(parsed.viewportSnapshots).filter(
                ([path, snapshot]) =>
                  typeof path === 'string' &&
                  snapshot !== null &&
                  typeof snapshot === 'object' &&
                  typeof (snapshot as EditorViewportSnapshot).anchor === 'number' &&
                  typeof (snapshot as EditorViewportSnapshot).head === 'number' &&
                  typeof (snapshot as EditorViewportSnapshot).scrollTop === 'number' &&
                  typeof (snapshot as EditorViewportSnapshot).scrollLeft === 'number'
              )
            )
          : {},
    };
  } catch {
    return null;
  }
}

export function sameViewportSnapshot(
  left: EditorViewportSnapshot | undefined,
  right: EditorViewportSnapshot
): boolean {
  return Boolean(
    left &&
      left.anchor === right.anchor &&
      left.head === right.head &&
      left.scrollTop === right.scrollTop &&
      left.scrollLeft === right.scrollLeft
  );
}
