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
  save: () => boolean | void | Promise<boolean | void>;
  /** 已确认并完成文件删除后，停止对该文件的保存并清除草稿引用。 */
  discard?: () => void;
  /** 当前文件路径与内容（另存为使用） */
  getSnapshot: () => ActiveEditorSnapshot;
  /** 打开查找面板 */
  openSearch: () => void;
  /** 在光标所在行之后插入独立的一行（例如 ::image 指令）；只读或没有编辑器时返回 false */
  insertBlock?: (text: string) => boolean;
}

/**
 * 把一段文字作为独立的一行插入：光标所在行为空时直接写在这一行，否则插在这一行末尾之后。
 * 返回插入位置与插入内容（纯函数，便于测试）。
 */
export function planBlockInsert(
  line: { from: number; to: number; text: string },
  text: string
): { from: number; insert: string } {
  if (!line.text.trim()) return { from: line.from, insert: text };
  return { from: line.to, insert: `\n${text}` };
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
    if (!entry.handle.getSnapshot().filePath) continue;
    if (!best || entry.order > best.order) best = entry;
  }
  return best?.handle ?? null;
}

/** 删除成功后同步通知所有匹配的编辑器，先停止保存，再关闭标签。 */
export function discardDeletedEditorFiles(matches: (filePath: string) => boolean): void {
  for (const { handle } of entries.values()) {
    const filePath = handle.getSnapshot().filePath;
    if (filePath && matches(filePath)) handle.discard?.();
  }
}

/** Save every mounted pane. Untitled content requires an explicit save before destructive lifecycle actions. */
export async function saveAllEditors(): Promise<boolean> {
  const handles = [...entries.values()].map(({ handle }) => handle);
  if (
    handles.some((handle) => {
      const snapshot = handle.getSnapshot();
      return snapshot.filePath?.startsWith('__untitled__:') && snapshot.content.length > 0;
    })
  )
    return false;
  for (const handle of handles) {
    const snapshot = handle.getSnapshot();
    if (!snapshot.filePath || snapshot.readOnly || snapshot.filePath.startsWith('__untitled__:'))
      continue;
    try {
      if ((await handle.save()) !== true) return false;
    } catch {
      return false;
    }
  }
  return true;
}
