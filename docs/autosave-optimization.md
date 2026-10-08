# 自动保存

编辑器在内容变化 2 秒后自动保存，切换文件和编辑器卸载时也会把未保存的内容写回原文件。本文说明保存时机、为什么全部基于 ref，以及主进程写盘时做的事。

相关代码：

- `apps/pc/src/render/components/TextEditor/hooks/useEditorSave.ts`：`AUTO_SAVE_DELAY = 2000`、`autoSaveFile` / `scheduleAutoSave` / `handleManualSave`
- `TextEditor/hooks/useEditorFileLoader.ts`：切换文件前保存上一个文件
- `TextEditor/index.tsx`：`flushEditorOnUnmount`（卸载时保存）
- `TextEditor/editor-paths.ts`：`isPersistablePath`（排除未命名标签与更新日志）、`emitFileSaved`（`NOVEL_EDITOR_FILE_SAVED_EVENT`）
- 主进程 `write-file`：`apps/pc/src/main/handlers/file-system.ts`
- 测试：`apps/pc/test/render/components/TextEditor/hooks.test.tsx`，E2E `apps/pc/e2e/app.e2e.ts`（编辑与自动保存）

## 保存时机

| 时机                       | 行为                                                                 |
| -------------------------- | -------------------------------------------------------------------- |
| 内容变化                   | 2 秒防抖后保存；再次输入会重置计时                                   |
| ⌘ / Ctrl + S               | 立即保存；内容未变时提示「文件已是最新状态」；未命名标签弹出另存为   |
| 切换到另一个文件           | 加载新文件前先把上一个文件的改动写回**上一个文件的路径**             |
| 编辑器卸载（关标签、退出） | 清理定时器，有改动则写回                                             |

都只在「路径可持久化（不是未命名标签 / 更新日志）、非只读、内容与磁盘原文不同」时写盘。保存成功后派发 `NOVEL_EDITOR_FILE_SAVED_EVENT`（`mode: 'auto' | 'manual'`），文件栏显示保存状态与上次保存时间。

## 为什么用 ref

早期实现在 `useEffect` 清理函数里按 state 里的 `filePath` 保存，切换文件时 `filePath` 已经是新文件，导致把 A 的内容写进 B。现在当前文件的路径、内容、磁盘原文都放在 ref（`currentFilePathRef` / `currentContentRef` / `currentOriginalContentRef`）里：

- 定时器触发时读取 ref 的最新值，保存的永远是「当时正在编辑的文件 + 它的内容」
- 只有保存的仍是当前文件时才更新「已保存」状态，避免异步完成时把新文件标成已保存
- 卸载时在调用那一刻读取 ref（而不是挂载时的快照）

## 主进程写盘

`write-file` 在写入前后还会：

- 拒绝写入软件内部数据与派生文件（`assertWritableByRenderer`，判定在 core `internal-data.ts`），这些文件只经专用 IPC 写入
- 正文文件保存成功后按保存前后的字数差记入写作日志 `.novel-editor/writing-log.json`（`recordStoryFileSave`，内容未变不记，不阻塞保存）
