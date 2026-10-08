# 写作界面

写作界面是三栏卡片布局：左侧文件面板（作品切换、正文 / 角色 / 设定 / 资料，可折叠）、中间编辑器（多标签）、右侧「大纲」面板（可折叠或弹出为独立窗口），底部状态栏。本文概述编辑器与周边界面的行为，细节以代码为准。

相关代码（均在 `apps/pc/src/render/`）：

- 组合根 `App.tsx`（业务逻辑在 `hooks/`）、布局样式 `App.module.scss`、主题变量 `styles/global.scss`
- 编辑器 `components/TextEditor/`：`editor-extensions.ts`、`editor-runtime.ts`（语言 / 实时渲染 / AI 辅助懒加载）、`writing-decorations.ts`、`structure-rules.ts`、`live-preview/`、`focus-mode.ts`、`typewriter.ts`、`search-panel.ts`、`assist/`
- 文件栏胶囊（灵感 / 续写 / 场景视频 / 参考）：`components/InspirationButton`、`ContinuationButton`、`SceneVideoButton`、`ReferenceButton`，经 `ContentPanel` 的 `editorHeaderActions` 插槽
- 右侧面板 `components/RightPanel/`（`StorylineView` 的目录 / 章纲 / 卷纲）；文件面板 `components/FilePanel/`；标签 `components/TabBar`；状态栏 `components/StatusBar`；快捷键总览 `components/ShortcutsHelp`
- 非文本文件预览：`DocumentViewer`（docx）、`PresentationViewer`（pptx）、`SpreadsheetViewer`（xlsx）、`ResourceViewer`（图片 / PDF / 音视频等）

## 编辑器（CodeMirror 6）

- 行号、当前行高亮、撤销 / 重做、查找替换（⌘F，搜索面板已汉化）、自动换行、千字标记
- 自动保存：2 秒防抖，见 [autosave-optimization.md](autosave-optimization.md)
- 语言：Markdown、JSON、JavaScript / TypeScript（按扩展名懒加载），其余按纯文本
- 大文件：超过 500KB（`LARGE_FILE_THRESHOLD`）显示提示
- 软件内部数据（成长档案 JSON、分镜.json 等）不在编辑器打开，显示「请在 XX 中查看」并可跳转；派生摘要只读

### Markdown 实时渲染

`.md` / `.markdown` 始终类 Typora 实时渲染（没有「源码 / 预览」切换，也没有设置项）：光标所在行或所在块显示源码，其余位置就地渲染标题、强调、链接、图片、表格、代码块、`$` / `$$` 公式（KaTeX，单独分包）。`.txt` 等保持纯文本。实现与性能约束见 `TextEditor/live-preview/` 文件头；小说格式指令（场景条、`::video` / `::image` / `::audio`、`:char`）见 [novel-format.md](novel-format.md)。

### 写作装饰

`writing-decorations.ts` 只在可见范围构建装饰：

| 装饰       | 识别                                                         |
| ---------- | ------------------------------------------------------------ |
| 章 / 幕 / 场标题 | 「正文结构」规则（`classifyStructureLine`，预设中文 / 英文 + 自定义正则，见 [outline-algorithm.md](outline-algorithm.md)），规则变化立即重建 |
| 人物名称   | 人物库的名字与别名（长名优先、可设颜色、可只高亮每章首现）    |

### AI 辅助

人物悬停卡片（悬停 300ms / ⌘K）、行内续写（`Alt+\`，Tab 采纳、Esc 放弃、`Alt+]` 换一个）与续写面板，见 [roadmap-ai-creative.md](roadmap-ai-creative.md)。

## 右侧「大纲」面板

三个视图（默认目录）：

- **目录**：当前作用域的章节 / 段落目录，点击跳到对应行
- **章纲**：当前章（或卷 / 作品）的大纲；开启 AI 时「生成章纲」一次给出 3 种方案挑选，否则「从正文整理」；导入、大纲版本等收在「⋯」
- **卷纲**：零输入，从本卷章节推导 幕 → 章 → 关键节拍（`packages/basic-algorithm/src/volume-plan/`），没有幕标记时按章数套结构模板；列表 / 节奏 / 人物线 / 伏笔四种视图；「生成卷纲」一次给出 3 种结构方案

AI 用到的人物 / 设定 / 资料上下文在 AI 助手对话框顶部的「上下文」分区。灵感抽签在编辑器文件栏最左侧的「灵感」按钮（`Mod+Shift+Y`）。

## 专注模式

- 进入 / 退出：F11 或 ⌘⇧F，Esc 退出（弹层、搜索面板、输入法组字时 Esc 优先给它们）
- 隐藏标题栏、两侧面板、状态栏和参考窗格，编辑卡片居中；退出时恢复之前的面板状态
- 渐进淡化：当前段落全亮，上下各 3 段逐级变淡（`focus-mode.ts`）
- 打字机滚动：光标行始终停在视口垂直中央，滚动条隐藏（`typewriter.ts`）

## 标签与状态栏

- 多标签：⌘N 新建未命名标签、⌘W 关闭当前标签（自动激活相邻标签），未命名标签保存时询问文件名；角色 / 设定 / 成长档案 / 场景视频等以工作区标签打开
- 状态栏左侧：网络状态、版本历史（见 [version-management.md](version-management.md)）、行列、行数、字数（去掉 front-matter 与指令，与写作日志同一口径）；右侧：更新状态 / 「重启以更新」、文件名与扩展名、编码（可切换）、应用版本（点击展开检查更新面板）

## 快捷键

三层：应用菜单加速键（主进程，`src/main/shortcuts/config.ts`，菜单模板 `menuTemplate.ts`）、渲染进程 keydown（侧边栏 ⌘B、关闭标签 ⌘W、搜索文件 ⌘P、专注模式等）、CodeMirror keymap（续写、人物卡片）。快捷键总览（帮助 → 快捷键说明）由 `getAllShortcuts.ts` 汇总；「切换侧边栏 / 专注写作 / 灵感抽签」可在设置中心自定义，并同步到菜单。渲染进程也处理的按键必须 `preventDefault`，避免与菜单重复执行。

## 视觉规范

- 深色主题，颜色统一走 `global.scss` 的 CSS 变量（如 `--ui-bg-surface: #1e1e1e`、`--ui-bg-elevated: #252526`、`--ui-border-subtle: #333`、强调色 `#007acc`），组件内不写全局样式
- 卡片式三栏：窗口背景比卡片更深，卡片间距 8px、圆角 10px
- 过渡动画 0.15–0.3s；编辑器、打字机滚动、参考窗格等动效在 `prefers-reduced-motion` 下关闭或直接跳转
- 图标按钮都有 `aria-label` 与 Tooltip；下拉 / 数字 / 复选框统一用 `Select` / `NumberInput` / `Checkbox` / `Switch` 组件
