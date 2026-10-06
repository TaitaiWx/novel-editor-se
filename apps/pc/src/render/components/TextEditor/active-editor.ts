/**
 * 「当前编辑器」登记表：应用菜单的 保存 / 另存为 / 查找 作用于最近获得焦点的编辑器。
 *
 * 同一时间可能挂载多个 TextEditor（分卷工作区左右两栏），按焦点顺序选择目标；
 * 都没有获得过焦点时取最近挂载的一个。编辑器卸载时自动移除。
 */

export interface ActiveEditorSnapshot {
  filePath: string | null;
  content: string;
  readOnly: boolean;
}

export interface ActiveEditorHandle {
  /** 与 Cmd/Ctrl+S 相同的手动保存 */
  save: () => void;
  /** 当前文件路径与内容（另存为使用） */
  getSnapshot: () => ActiveEditorSnapshot;
  /** 打开查找面板 */
  openSearch: () => void;
}

interface Entry {
  handle: ActiveEditorHandle;
  /** 越大越新：获得焦点或挂载时递增 */
  order: number;
}

const entries = new Map<symbol, Entry>();
let counter = 0;

export interface ActiveEditorRegistration {
  /** 编辑器获得焦点时调用，使其成为菜单命令的目标 */
  activate: () => void;
  dispose: () => void;
}

export function registerActiveEditor(handle: ActiveEditorHandle): ActiveEditorRegistration {
  const key = Symbol('editor');
  entries.set(key, { handle, order: ++counter });
  return {
    activate: () => {
      const entry = entries.get(key);
      if (entry) entry.order = ++counter;
    },
    dispose: () => {
      entries.delete(key);
    },
  };
}

/** 菜单命令的目标编辑器；没有挂载任何编辑器时返回 null */
export function getActiveEditor(): ActiveEditorHandle | null {
  let best: Entry | null = null;
  for (const entry of entries.values()) {
    if (!best || entry.order > best.order) best = entry;
  }
  return best?.handle ?? null;
}
