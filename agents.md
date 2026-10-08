# 小说编辑器 (Novel Editor SE)

基于 Electron 的跨平台小说编辑器，面向作者和编剧。

## 需求

1. 布局。左侧是可以折叠起来的文件浏览器，右侧是文本编辑器
2. 文件浏览器可以展示文件夹结构，支持新建、删除、重命名文件和文件夹。文本编辑器支持基本的文本编辑功能，包括自动保存、撤销/重做、行号显示等
3. 切换浏览形式。文本编辑器右侧就是幕剧的卡片、大纲卡片、人物的卡片等，可以有提示

### 剧本

1. 幕剧可视化流。要支持剧本的创作。在写的时候，可以分出幕剧，同时要很好的可视化的展示出来。比如说，第一幕，第二幕，第三幕，每一幕下面有几个场景，每个场景下面有一些内容。可以很清晰的看到这个结构。对于剧本创作来说，这个功能是非常重要的。因为剧本创作需要有一个清晰的结构，才能更好的进行创作
2. 大纲总览。支持大纲对应的文章的内容，可以调整流

### 建议

1. 比如我想写DND，然后设定资料库就是那些规则之书。角色属性啊，升级成长啊，也有一个记录，当成一个游戏人物属性，点开来，人物技能升级需要的经验，一目了然。很多作者需要这个功能，几百章过去，自己写的什么技能，原先设定全部忘记了。可以拆开来，单独做成一个记录器一样，加入相应地图记录，队友记录(曾经组过的队伍)，很多时候，大家喜欢某个配角，但是作者写着就忘记了。很多作者设定二选一三选一的能力技能，然后作者把握不好这个设定，他可以把设定好的选择扔进去，看看AI把这个角色自动成长后一段时间，有什么结果。不单单局限于选择，主要是添加一条作者设定的核心规则，让作者控制他成长或者自由成长，给作者写书提供支持。这个功能，辅助那些喜欢搞人物环境描写，也有专业知识，但是对于动不动战力崩溃的人
2. 记忆资料单独放个文件夹

## 功能

- 文件夹浏览器: 打开、浏览本地文件夹，支持文件树展示
- 文本编辑器: 文件读取、编辑、自动保存（2秒延迟）
- 快捷键系统: 文件操作、窗口操作、开发者工具快捷键
- 自定义标题栏: macOS/Windows/Linux 跨端统一样式
- IPC 通信: 主进程与渲染进程安全通信（白名单机制）
- 单实例锁: 防止多个应用实例同时运行
- 自动更新:
  - 实现自动静默更新。用户开启后自动下载，下载完成后右下角有提醒重启更新最新版本
  - 提供版本指针和高可用回退。为了保证高可用，提供 2 个版本。如果新版本报错，就自动回退到旧版本
  - 提供金丝雀更新/灰度测试
    - 允许用户选择加入金丝雀更新计划，优先体验新版本，帮助我们发现问题
    - 提供比例，进行金丝雀更新（例如 10% 的用户自动加入金丝雀更新，90% 的用户正常更新）
- CLI 功能:
  - 提供命令行工具，支持批量文件操作、项目初始化等所有功能
  - CLI 功能可以独立于 GUI 使用（即使不启动 Electron 应用，也能使用 CLI 工具进行文件操作等功能）
  - CLI 工具提供友好的命令行界面，支持参数提示、错误提示等功能，提升用户体验
  - CLI 工具与 Electron 应用共享核心逻辑，避免代码重复，确保功能一致性
  - 参考 vs code 的 CLI 实现，提供类似的用户体验和功能覆盖
  - 提供的命令行未来要更好支持 AI 通过 CLI 来调用我们的功能

## 设计风格

1. 必须是简洁、现代的设计风格，符合当代软件的审美标准
2. 颜色搭配要柔和，避免过于鲜艳的颜色，提供舒适的视觉体验
3. UI 元素要清晰、易于识别，使用一致的设计语言，确保用户能够快速理解和使用界面
4. 颜色必须统一，不能出现不协调的颜色搭配
5. 设计要注重细节，确保界面元素的对齐、间距和层次关系合理，提升整体的美观度和可用性
6. 设计要考虑跨平台的一致性，确保在 Windows、macOS 和 Linux 上都有良好的用户体验

## 技术栈

1. 前端: React 18 + TypeScript 5 + SCSS Modules，编辑器内核为 CodeMirror 6，图标使用 react-icons；场景视频的 3D 预演用 three.js（动态导入）
2. 桌面端: Electron 42（主进程 + preload + 渲染进程），开启 `contextIsolation`、关闭 `nodeIntegration`
3. 存储: SQLite（better-sqlite3，原生模块，由 `electron-rebuild` 针对 Electron ABI 重建；本地补丁见 `patches/`）
4. 文档处理: docx / pptxgenjs / exceljs / mammoth / pdfjs-dist / marked / jszip
5. 构建: Vite 6 + electron-builder 26（配置见 `apps/pc/electron-builder.yml`），自动更新基于 electron-updater
6. 测试: Vitest 4（单测 `vitest.config.ts`、E2E `vitest.e2e.config.ts`，共享 `vitest.shared.ts`），组件测试用 happy-dom + Testing Library
7. 代码规范: ESLint 8 + @typescript-eslint 8 + Prettier 3
8. 包管理器: pnpm 10.12.4（monorepo，`pnpm-workspace.yaml`）
9. Node 版本: 以 `.nvmrc` 为准（当前 v24.15.0），CI 与发布流程都读取 `.nvmrc`

### 目录结构

```
apps/
  pc/                     # Electron 桌面应用 (@novel-editor/pc)
    src/main/             # 主进程：窗口、IPC handlers、快捷键、自动更新、导入导出、WebAuthn
    src/main/preload.ts   # preload 脚本（IPC 通道白名单）
    src/render/           # 渲染进程：React 组件、hooks、utils
    src/shared/           # 主进程与渲染进程共享的类型/协议（MessagePort、CRDT ops）
    test/                 # Vitest 测试（main / render）
    e2e/                  # GUI 端到端测试（Vitest + 极简 CDP 驱动，pnpm test:e2e）
    scripts/              # 启动、发布预检、公证等脚本
  cli/                    # 命令行工具 (@novel-editor/cli)
packages/
  core/                   # GUI 与 CLI 共享的纯 Node 核心逻辑（文件、作品、章节、统计、导出）
  store/                  # SQLite 持久化与版本快照
  basic-algorithm/        # 大纲、人物、分块、diff 等算法
  helpers/                # 通用工具函数
  components/             # 共享 UI 组件
  media-player/           # 自绘 React 视频播放器 (@novel-editor/media-player)，可单独发布，不依赖应用
  ai/                     # AI Provider 抽象（文本流式 / 异步视频任务）、上下文组装器、续写与分镜提示词（纯 TS）
  video/                  # 分镜模型、视频任务状态机与队列、落盘布局、费用钩子；./stitch 为渲染进程样片拼接（WebCodecs，保留素材声音）
docs/                     # 设计与流程文档（发布、自动更新、SQLite、性能等）
```

- 与 Electron/DOM 无关的业务逻辑优先放在 `packages/` 中，保证 GUI 与 CLI 共用同一实现
- 各 package 以源码形式导出（`main: ./src/index.ts`），由使用方的构建工具打包

### 构建架构

Electron 应用有 3 个运行环境，各自对模块格式有不同要求，因此需要分开构建（产物位于 `apps/pc/dist/`）：

- **主进程** (`VITE_ELECTRON_MAIN=true`) → `dist/main.mjs` (ES module)。运行在 Node.js 环境，项目使用 ESM，所以输出 `.mjs`；`electron`、`better-sqlite3` 等原生依赖保持 external
- **Preload 脚本** (`VITE_PRELOAD=true`) → `dist/preload.js` (CJS)。作为主进程和渲染进程的桥梁，Electron 的 contextBridge 要求 CommonJS 格式
- **渲染进程** (默认) → 浏览器 bundle。运行在浏览器环境，标准 Web 打包

三个目标共用 `apps/pc/vite.config.ts`，通过环境变量区分，避免维护多个配置文件

### Electron 约定

- 新增 IPC 通道必须同时加入 `preload.ts` 白名单，并在 `src/render/types/electron-api.ts` 中补充类型
- 拖拽文件路径使用 `webUtils.getPathForFile()` 获取（Electron 32+ 已移除 `File.path`）
- 主进程不得直接信任渲染进程传入的路径/参数，需在 handler 内校验

### 内部数据（不对用户展示）

- 规则：软件自己维护的数据（JSON 等）**不对用户展示、不允许手动编辑**，只通过可视化界面处理；CLI / AI agent 不受影响，仍直接读写这些文件
- 唯一判定在 core `internal-data.ts`（纯函数，`@novel-editor/core/internal-data`）：`classifyWorkspaceEntry(相对路径)` → `user` / `internal` / `derived`（+ 归属界面 owner），文件夹名来自共享常量（`MEMORY_DIR_SEGMENTS`、`ENTITY_MEDIA_ROOT`）或 `\u` 转义常量，与 `@novel-editor/video` / `project.ts` 的一致性由 `test/render/utils/internalData.test.tsx` 校验
  - internal：`资料/记忆/**/*.json`（规则 / 队伍 / 地图 / 角色成长卡）→ 成长档案；`资料/视频/<章>/<场景>/分镜.json` 与 `资料/视频/**/*.prompt.json` → 场景视频；`资料/图集/**/*.prompt.json` → 图集；`.novel-editor/**` → 设置中心
  - derived（显示但只读，每次保存重新生成）：`资料/记忆/README.md`、`资料/记忆/{角色,角色卡,设定}/*.md`、`资料/视频/<章>/<场景>/分镜.md`
  - 作者自己放在资料里的 `.json`、成片 / 样片 / 首帧 / 动作库等媒体照常显示
- GUI：主进程 `refresh-folder`（`readWorkspaceTree`）与渲染进程 `applyFolderTree` 都用 `filterInternalDataTree` 去掉内部数据并给场景目录打 `sceneVideo` 标记，因此资料树、搜索、参考窗格、章节资料关联都看不到；文件面板搜索与 `workspace-search-content` 再兜底过滤；会话恢复丢弃内部数据标签（`useEditorSession`）；万一从别处按路径打开，编辑器位置显示 `InternalDataNotice`（「这是软件内部数据，请在 XX 中查看」+ 跳转按钮），派生摘要以只读打开（`ContentPanel` `readOnlyFile`）；`handleFileSelect` 把内部数据转到对应界面（场景视频画布 / 成长档案 / 只提示）
- 主进程通用 `write-file` 拒绝写入 internal / derived 路径（`assertWritableByRenderer`，纵深防御）；这些文件只经专用 IPC（`growth-*`、`video-scene-*`、`media-save-generated`、`memory-sync-snapshots`、`project-structure-set` 等，直接用 fs 写）写入
- 界面上的原始提示词 / JSON / AI 原始返回只在开发者调试模式（环境变量 `NOVEL_EDITOR_DEBUG=1`，preload 暴露为 `window.electron.debug`，`utils/debugMode.ts`）显示：规则之书的「编辑规则 JSON」、无法解析的 AI 返回、续写错误里的原始响应；作者用的是可视化编辑器（规则之书见「成长记录器 / 记忆库」）。设置中心不展示 `.novel-editor/` 下的文件名

### Markdown 实时渲染（编辑器）

- 类 Typora：.md / .markdown 文件**始终**实时渲染，光标所在行（行内语法）或所在块（表格、公式块、代码块）显示源码，其余位置就地渲染；没有「源码 / 实时预览」切换，也没有设置项（旧设置里的 `general.markdownLivePreview` 读取时丢弃）。.txt 等其他格式保持纯文本，不做任何渲染
- 代码在 `TextEditor/live-preview/`，入口模块经 `editor-runtime.ts` 的 `loadMarkdownLivePreview()` 懒加载（KaTeX 单独分包）；语法树来自 markdown 语言扩展（GFM + `math-syntax.ts` 的 `$...$` / `$$...$$`）
- 装饰放在 StateField（跨行替换会影响行高，只能直接提供），只构建「可见范围 + 余量」内的顶层块；文档 / 选区变化时只重建受影响的块，IME 组字期间只映射不重建
- 健壮性：每个块独立 try/catch，公式 / 表格 widget 自带错误兜底（显示原文 + 「!」错误标记）；未闭合的 `$$` 在空行处结束（公式块内不能有空行）。KaTeX 输出 MathML（无全局 CSS / 字体），结果按源码 LRU 缓存；比正文宽的展示公式与表格在自身内部横向滚动，不撑破版面。KaTeX 核心不支持 `multline` 与 mhchem 的 `\ce`（用 `aligned` / `\mathrm` 代替）
- 复杂公式示例：示例作品集根目录 `公式示例.md`（对齐、矩阵、分段、求和积分极限、中文 `\text`、嵌套上下标、`\mathbb` / `\mathcal`、化学式、超宽公式，外加一条故意写错的公式）；`test/render/components/TextEditor/latex-demo.test.ts` 用编辑器同一套语法逐条渲染，除那条坏公式外必须全部成功
- 自定义小说格式（Markdown + 指令）设计见 `docs/novel-format.md`、调研见 `docs/novel-format-research.md`。**第一期已实现**（纯函数在 core `novel-format.ts`，GUI / CLI 共用）：front-matter、场景容器 `:::scene{#id title=… pov=…}` … `:::`（平铺不嵌套，未闭合时在下一个场景、≤2 级标题或章 / 幕标题行处结束）、视频 `::video[说明]{src="资料/视频/…"}`、图片 `::image[说明]{src=…}`、纯音频 `::audio[说明]{src=… loop volume=0.6}`（core `audioDirectiveSource`；就地显示为播放器的音频界面，loop / volume 作为初始值，「在旁边听」在参考窗格打开，参考窗格 / 资料右键支持音频并按原格式导出；`ne lint` 提示缺少 src 的媒体指令）、行内 `:char[文字]{id=…}`；不用 `#` 的结构行（「第一章 离港」「楔子」「第一幕 …」「第一场 …」「Chapter 1: The Harbor」「Act II」，core `classifyStructureLine(line, rules?)`，规则见下方「正文结构规则」）；指令名必须 ASCII 字母开头（「12:30」不会误判）。字数统计去掉 front-matter 与指令行（`stripNovelMarkup`，行数不变）；目录 / 卷纲把场景容器识别为「场景」（basic-algorithm `outline/novel-markers.ts`）；编辑器（所有 .md）里章 / 幕 / 场结构行带标题样式；非光标行的场景显示为场景条、`::video` 就地显示播放器、`::image` 就地显示图片（都有「在旁边看」打开参考窗格）、`:char` 显示称呼（`TextEditor/live-preview/novel-directives.ts` + `media-loader.ts`：src 相对作品目录，从文件所在目录逐级向上找，读取为 blob 地址并缓存；找不到时显示「找不到视频 / 图片」）；`ne lint [path] [--strict]` 检查未闭合场景 / 多余 `:::` / 重复 id。示例：根目录 `小说格式示例.md`（一篇真实章节：章标题、两场、:char、示例图片与视频）。`:char` 的人物链接、导出转换等在后续分期
- ⌘/Ctrl + 点击链接：网址经 `open-external-url`（主进程只放行 http(s) / mailto），本地路径经 `open-in-system-app`；图片按当前文件目录解析，经 `read-file-binary` 读取
- 性能基准见 `test/render/components/TextEditor/live-preview-view.test.ts`（10 万行 / 5MB 文档每视口构建远低于 16ms）

### 正文结构规则（章 / 幕 / 场的识别）

- 纯函数在 core `structure-rules.ts`（渲染进程经 `@novel-editor/core/structure-rules` 引入）：预设 `zh`（第N章/回/卷/部/篇/集/节、序章/楔子/尾声/番外…、第N幕、第N场；≤40 字）、`en`（不区分大小写：Chapter 12 / XII / Twelve、Ch. 3、Part 2、Book 1、Prologue / Epilogue / Interlude / Foreword / Afterword → 章，Act 1 / Act I → 幕，Scene 1 → 场；`:` / `-` / 破折号 / 空格后可带标题，只用空格分隔时标题不能以小写字母开头；≤60 字）、`numbered`（`1.` / `1、` / `001` → 章，默认关闭）；预设都要求独占一行、不以句读结尾。默认 `DEFAULT_STRUCTURE_CONFIG = { presets: ['zh','en'], custom: [] }`；`classifyStructureLine(line)` 旧签名不变
- 自定义规则 `{ id, kind: 'chapter'|'act'|'scene', pattern, flags?: 'i' }`：优先于预设；`validateCustomStructureRule` 拒绝 >200 字符、语法错误、能匹配空行、嵌套量词（`(a+)+` 一类，`hasNestedQuantifier` 启发式）的正则；只对 ≤120 字的行生效。`compileStructureRules(config)` → `StructureRuleSet`（带 `signature`），`matchStructureLine` 返回命中的规则 id
- 存储（core `structure-config.ts`，GUI 主进程与 CLI 共用）：`ne init` 项目写 `.novel-editor/config.json` 的 `structure` 字段（保留其他字段，`ProjectConfig.structure`）；普通文件夹写 `.novel-editor/structure.json`（`{ schemaVersion, structure }`，不写 config.json，否则文件夹会变成 `ne init` 项目）；都没有时用默认规则。读取时宽松（无效项丢弃并给出 warnings），写入时严格（`assertValidStructureConfig`，任何无效项都拒绝）
- 使用方：编辑器（`TextEditor/structure-rules.ts` 的 StateField + 订阅，实时预览 `novel-directives.ts` 与 `writing-decorations.ts` 共用，规则变化立即重建，不用重新打开文件）、`extractNovelScenes` / `lintNovelMarkup(text, rules?)`、basic-algorithm（`extractOutline` / `extractActs` / `deriveVolumeOutline` / `hasActMarkers` 的可选 `classify`，不传时行为不变）、目录 / 卷纲 / 章纲导入、场景视频 `sceneSource`（`classify`）。渲染进程的当前规则在 `utils/structureRules.ts`（`useStructureRules` / `useStructureClassifier` / `getStructureClassifier`），由 `hooks/useProjectStructureRules.ts` 在打开文件夹时读取并监听广播
- 设置中心「正文结构」（`AppSettingsCenter/StructureSection/`）：三个预设开关（带示例）、自定义规则列表（类型 Select、正则、忽略大小写 Checkbox、删除）、「试一试」测试框（即时显示每行识别为 章 / 幕 / 场 / 正文）、保存 / 还原；没有打开项目时只显示提示。IPC `project-structure-get / set`（`main/handlers/project-structure.ts`，协议 `shared/project-structure.ts`）：folderPath 必须是存在的绝对目录且等于该窗口已上报的工作区（写入时必须已上报），配置严格校验、≤32KB；保存后广播 `project-structure-changed`
- 测试：`packages/core/test/structure-rules.test.ts`、`structure-config.test.ts`、`packages/basic-algorithm/src/volume-plan/structure-classify.test.ts`、`apps/pc/test/render/components/TextEditor/structure-rules.test.ts`、`AppSettingsCenter/StructureSection.test.tsx`、`test/main/project-structure.test.ts`、`apps/cli/test/structure.test.ts`；E2E `apps/pc/e2e/structure-rules.e2e.ts`

### 专注模式（编辑器）

- 渐进淡化在 `TextEditor/focus-mode.ts`（当前段落全亮，上下各 3 段逐级变淡，不模糊）；打字机滚动与隐藏滚动条在 `TextEditor/typewriter.ts`，只在专注模式启用
- 滚动条完全隐藏（`cm-hide-scrollbar`：`scrollbar-width: none` + `::-webkit-scrollbar` 隐藏），滚轮 / 键盘照常滚动
- 光标所在行始终停在视口垂直中央：`.cm-content` 上下留白 =（视口高度 − 行高）/ 2（measure 后写入 CSS 变量 `--cm-typewriter-pad`，未测量前回退 50vh），首行 / 末行也能居中；进入专注模式、窗口尺寸变化、光标不在已渲染范围时用 `EditorView.scrollIntoView(head, { y: 'center' })`，其余（键入、方向键、翻页、点击）在下一帧测量光标与中线的距离，容差（约 1/3 行高）内不滚动，超出则平滑滚动（`prefers-reduced-motion` 时直接跳转）；拖选期间不居中，松开鼠标约 220ms 后再居中（不干扰双击）

### 右侧「大纲」面板 / AI 上下文 / 灵感

- 右侧面板（`RightPanel`，标题「大纲」）只有 目录 / 章纲 / 卷纲 三个视图（`StorylineView` 的 `STORYLINE_MODES`，默认目录），可弹出为独立窗口或折叠（`collapseRightPanelOnStartup`）
- 卷纲（`RightPanel/VolumePlanView/`）零输入：读取当前章所在卷（选中卷时为该卷，作品级为整部作品）的全部章节，按「第X幕 / 第X场」标记推导 幕 → 章 → 关键节拍（无场景标记时依次用 章纲 → 小标题 → 开篇句），没有幕标记时按章数自动套结构模板（≤3 章三幕式 / 4–8 章起承转合 / ≥9 章英雄之旅；列表视图的「结构」下拉直接列出全部结构及各段说明，`VolumePlanView/PlanToolbar.tsx`）。列表视图顶部有总览条（每幕一段、宽度按章数、点击滚动到该幕，`VolumeOverview.tsx`），头部汇总「N 段 · N 章 · 字数」，每章显示字数；没有说明的幕只在悬停时出现「＋ 一句话说明」；节拍内容最多两行；清除 / 撤销 / 恢复自动结构收在「⋯」；所有图标都有 Tooltip。唯一输入是可选的「这一卷想写什么？」+「生成卷纲」：一次给出 3 种结构的方案（当前结构 + 另外两种，`useVolumePlanGenerate` `pickVariantStructures`），并排显示在 `RightPanel/PlanVariants`（「给得少、选得多」），作者点「采用这个」才写入结构、幕说明与建议节拍；开启 AI 时每个方案并行走 `ai-request`，失败 / 无法解析的方案按模板确定性生成。同一份数据派生 列表 / 节奏（张力启发式）/ 人物线（人物库名字 + 别名出场）/ 伏笔；点击节拍就地改写、拖拽排序、「插入到章纲」追加到该章章纲。纯算法在 `packages/basic-algorithm/src/volume-plan/`；作者覆盖层存 settings `novel-editor:volume-plan:<卷目录>`，首次打开时从旧版剧情板 `novel-editor:plot-board:<作品>` 迁移（旧键不删）
- 章纲（`RightPanel/OutlineView`）只有一个主按钮（`OutlineView/OutlineToolbar`）：开启 AI 时「生成章纲」一次并行生成 均衡 / 悬疑钩子 / 电影感 三种方案（`useOutlineEntries.generateAiOutlineVariants`，不写库），在 `PlanVariants` 里挑一个后 `applyOutlineTree` 写入并保存为大纲版本；未开启 AI 时为「从正文整理」。导入大纲文件、生成设置（粒度 / 层数）、保存为大纲版本、清空章纲收在「⋯」。工具栏与列表之间有分割线
- 章纲 / 卷纲顶部各有一句话说明 +「怎么用」（`RightPanel/PlanGuide`：`OUTLINE_GUIDE` / `VOLUME_GUIDE` 三步说明弹层），降低学习负担；卷纲总览条的幕标签可折行（幕很多时换行显示，每段最小宽度 72px）
- 当前作用域（作品 / 卷 / 章）的 AI 人物 / 设定 / 资料上下文在 AI 助手对话框顶部的「上下文」分区（`RightPanel/AssistantContextSection`，默认折叠只显示计数；数据与动作由 `hooks/useAssistantContext.ts` 组装，复用 `useScopedAssistantGeneration` / `useChapterMaterials`）；资料文件右键菜单也可「关联到当前章 / 从当前章移除」
- 灵感抽签（`components/InspirationDialog`）：入口：编辑器文件栏最左侧的「💡 灵感」胶囊按钮（`InspirationButton` 图标 + 文字，经 `ContentPanel` 的 `editorHeaderActions` 插槽）、未打开文件时编辑器空状态的主操作「灵感抽签」（`variant="primary"`，经 `emptyStateActions` → `TextEditor` → `EmptyState.actions`）、应用菜单「编辑 → 灵感抽签…」（`APP_MENU_EVENTS.openInspiration`）、`Mod+Shift+Y`（设置中心可改，经 `menu-sync-shortcuts` 同步到菜单加速键）；弹窗按钮层级：未抽时整行主按钮「抽一签」，抽出后左侧文字按钮「全部重抽」、右侧 复制 / 交给 AI 扩写（次要）+「插入到光标处」（主操作），三张签等高、词条均衡换行（`text-wrap: balance`），窄窗口单列；「抽一签」零输入抽出 人物 / 地点 / 冲突，可单张换签、插入到光标处、复制、交给 AI 扩写；词源 / 我的词池 / 历史收在「更多选项」。纯函数在 `inspiration.ts`；存储复用三签卡（词池 `novel-editor:story-idea-term-pool:<作品>`，历史为 story_idea_card 行，题眼签存人物、变形签存地点、冲突签存冲突），大纲版本的「回到灵感」按卡片 id 回填

### 编辑器 AI 辅助（人物悬停卡片 / 续写）

- 代码：CodeMirror 部分在 `TextEditor/assist/`（经 `editor-runtime.ts` 的 `loadEditorAssist()` 懒加载，`useEditorAssistExtension` 以 `appendConfig` 追加，配置经 ref 读取最新值）；上层数据在 `hooks/useEditorAssist.ts`，经 `ContentPanel` 的 `editorAssist` → `TextEditor` 的 `assist` 传入。编辑器内核不直接访问 IPC
- 人物悬停卡片：人物名 / 别名（识别口径同人物高亮，长名优先、不重叠，按「文档版本 → 行」缓存，只扫可见范围）悬停 300ms 弹出；输入中 / IME 组字不弹；Esc 关闭；`Mod+K` 打开光标处人物。卡片（`components/CharacterHoverCard`，数据纯函数在 `model.ts`）：头像或首字圆标、别名、分类 · 阵营、一句话简介、最近 2 条当前状态、当前作品成长卡的 Lv / 经验条、上次出场章节（从当前章往前逐章读取，找到即停）；操作「打开人物」「记一笔」（`components/EditorGrowthRecord`，复用 `GrowthRecordForm`，章节默认当前章）「高亮全部」（可见区域，8 秒后或 Esc 清除）
- 人物形象图：人物详情左侧显示竖版大图（3:4，`CharactersView/CharacterPortrait`，没有图时显示首字 +「添加形象图」占位），点击选图；同一张图在引用人物的地方（悬停卡片、人物关系列表、场景视频画布）裁成小圆头像（`components/CharacterAvatar`）。主进程 `character-avatar-save`（`main/handlers/character-avatar.ts`）校验作品目录在工作区内、按文件头只收 PNG / JPEG / GIF / WebP（≤5MB），保存为 `<作品>/资料/人物头像/<人物名>-<哈希>.<扩展名>` 并清理该人物旧头像；`attributes.avatar` 存相对作品目录的路径（旧的 data URL 仍可用），渲染进程经 `read-file-binary` 读取（`utils/characterAvatar.ts`）
- 行内续写：`Alt+\` 在光标处请求，幽灵文字流式出现（widget，采纳前不进入文档，因此放弃不留痕、自动保存与写作日志只看到采纳后的正文）；`Tab` 采纳（`isolateHistory`，单独一步撤销）、`Esc` 放弃、`Alt+]` 换一个版本（最多 3 个，之后轮换）；从不自动触发；在别处输入或移动光标即取消并中止流。状态机是纯函数（`assist/continuation-state.ts`）
- 续写面板：编辑器文件栏「续写」胶囊（`components/ContinuationButton`，在「灵感」之后）：长度（一句 / 一段 / 约 500 字）、方向（顺着写 / 制造冲突 / 收束本章，或自由输入）、遵循章纲、模型（下拉列出已配置的文本模型，默认选中默认文本模型）；结果以「建议」高亮插在光标处（采纳 / 放弃 / 换一个），可展开「查看本次上下文」（各分区与 token 数）
- 续写服务 `utils/continuationService.ts`：资料（`utils/writingSources.ts`：当前章章纲、人物卡、成长档案摘要与核心规则，摘要与 CLI 共用 core `summarizeSheetForContext`）→ `@novel-editor/ai` 的 `assembleWritingContext` + `buildContinuationPrompt` → `ai-stream-start`；片段经 `utils/aiStreamRouter.ts` 按 streamId 分发（streamId 返回前到达的片段会暂存）。错误按类型给出提示（未配置 / Key 无效 → 去设置，额度 / 内容安全 / 网络 → 重试，`assist/ai-error.ts`）

### 关于 / 日志上传

- 关于窗口（`AboutDialog`，约 380px 小窗、不滚动）与设置中心「关于」分区共用 `components/AboutContent`，只展示：图标 + 名称 + 版本（通道徽标）、「首次运行 · 本次已运行」（主进程启动时间经 `get-about-info` 返回，每分钟刷新）、设备 ID（点击复制，提示「设备 ID 已复制」）、「上传日志」按钮。运行环境、数据目录等诊断信息不在界面展示，统一写进日志包的 `diagnostics.json`
- 更新通道、金丝雀 / 灰度分组、崩溃日志上传**由我们决定，不对用户展示也不可选择**（设置中心没有「更新与诊断」分组）：通道按安装包版本号推断（`-alpha.` / `-canary.` → canary、`-beta.` → beta、其余 stable，`main/auto-updater/channel.ts` `resolveUpdateChannel`），灰度只看服务端元数据 `stagingPercentage`；旧版持久化在 `updater-state.json` 里的用户通道选择启动时被覆盖。内部测试可用环境变量 `NOVEL_EDITOR_UPDATE_CHANNEL=stable|beta|canary` 强制通道（详见 `docs/release-process.md`）。「检查更新」在应用菜单与设置中心「关于」分区
- 崩溃日志上传始终开启（shared `shouldUploadCrashReport`：只在配置了上传地址时上传，否则只保存到 `userData/crash-reports/`）；旧版开关文件 `userData/log-upload-settings.json` 被忽略并在注册 IPC 时删除
- 日志上传在主进程 `src/main/log-upload/`：白名单打包（diagnostics.json + electron-log 日志 + 小状态文件，主目录脱敏为 `~`，绝不包含作品正文与 SQLite 数据库）→ 已配置地址时上传（`NOVEL_EDITOR_LOG_UPLOAD_URL` 或 `config.ts` 常量，默认为空）→ 未配置或失败时保存到「下载」目录并定位。崩溃钩子只在配置了地址且开关开启时上传，否则只保存到 `userData/crash-reports/`（最多 5 个），10 分钟最多一次，E2E / 烟雾测试下不安装
- 服务端接口约定（请求头、请求体、响应、大小限制、隐私）见 `docs/log-upload.md`；IPC 通道 `log-upload-run`（`main/handlers/log-upload.ts`）

### AI 服务 / 场景视频基础设施

设计见 `docs/roadmap-ai-creative.md`（第一期基础设施已完成，功能界面在后续分期）。

- **`@novel-editor/ai`**（纯 TS，不依赖 Electron / Node 内置模块；GUI 主进程与 CLI 共用）
  - Provider 抽象（`types.ts`）：`TextProvider { complete, stream(AsyncIterable), testConnection }`、`VideoProvider { submitTask, pollTask, fetchResult, cancelTask?, testConnection }`，均支持 `AbortSignal`；注册表 `createDefaultRegistry()`（`registry.ts`）
  - 内置实现：`openai-compatible`（原 `handlers/ai.ts` 的 `/chat/completions` 逻辑，请求体 / 默认值 / 错误文案不变）、`grok`（xAI，`https://api.x.ai/v1`，复用 OpenAI 兼容协议，默认模型 `grok-4` 可配置）、`minimax-video`、`seedance-video`（火山方舟）。各厂商接口地址、字段映射与「文档未写明的假设」集中在 `providers/*.ts` 文件头与 `*_ENDPOINTS` / `*_DEFAULTS` 常量里
  - 视频声音：`VideoGenerationRequest.withAudio?`（缺省不发送，沿用厂商默认）只映射到公开文档支持的厂商——Seedance 请求体 `generate_audio`（文档写明 1.5 pro 起支持，其他模型未写明；文本命令格式不发送）；MiniMax 文档没有声音参数，忽略。假设写在各 Provider 文件头
  - 基础设施：`sse.ts`（分片 / CRLF / 多字节安全的 SSE 解析、空闲超时、取消）、`http.ts`（超时 + 取消合并、确定性指数退避重试，只重试 限流 / 网络 / 超时 / 5xx；视频提交不重试，避免重复扣费）、`errors.ts`（`AIError.kind`：auth / quota / rate-limit / content-safety / network / timeout / server / bad-request / invalid-response / not-configured / aborted / unknown，MiniMax `base_resp.status_code`、方舟 `error.code` 都映射到这里）
  - 动作生成扩展点（`@novel-editor/ai/motion`，`src/motion.ts`）：`MotionProvider { id, kind: 'motion', generateMotion({ description, durationSec, joints }) → PrevizMotionTracks }`，输出与预演脚本的 `motion.tracks` 同一格式（关节轨迹，不是 BVH），**目前没有内置实现**，由调用方（预演弹窗的 `motionProvider` 属性；将来经主进程 IPC 持有 Key）传入。`resolvePrevizMotionRequests(script, { provider, complete })` 收集脚本里只有 `motion.generate`（没有 tracks）的关键帧，相同描述只生成一次（时长取到下一关键帧）：有 provider 交给它，否则经 `complete` 用同一个文本模型追加一次请求（`prompts/previz-motion.ts` `buildMotionPrompt` / `parseMotionResponse`，系统提示词标记 `PREVIZ_MOTION_PROMPT_TAG`；GUI 走 `ai-complete`）；结果经 video `validateMotionTracks` 校验 / 夹值后写回 tracks（描述保留，有 tracks 后不再生成，随 分镜.json 缓存）；失败时保留 `generate`（引擎回退到 pose）并提示。测试用假服务 + mock 追加请求（`packages/ai/test/previz-motion.test.ts`）
  - `@novel-editor/ai/context`：`assembleWritingContext({ chapterText, cursor, outline, characters, growth, rules, lore, budget })`，按 token 预算确定性裁剪（规则 > 章纲 > 人物 > 成长 > 设定 > 后文各有上限，前文保留结尾并拿剩余预算，用不完再回填）；`@novel-editor/ai/prompts`：续写（`buildContinuationPrompt` / `cleanContinuationOutput`）与分镜（`buildStoryboardPrompt` / `parseStoryboardResponse`，校验用 video 包的 schema）
- **`@novel-editor/video`**：分镜 `Storyboard / Shot` 与 `validateStoryboard`（容忍 AI 字段别名）、`STORYBOARD_JSON_SCHEMA`、Markdown 分镜表；视频任务状态机 `queued → submitted → running → succeeded / failed / cancelled`（`transitionVideoTask`，可重试错误按退避重新排队，手动 `retry`）；纯调度 `planVideoQueue` / 重启恢复 `resumeVideoTasks`；落盘布局 `videoOutputLayout`（`<作品>/资料/视频/<章>/<场景>/镜头N-vX.mp4` + `镜头N-vX.prompt.json`，`file` 是相对作品目录的完整路径）；费用钩子 `createCostRegistry` / `checkVideoBudget`（不内置价格，单价由作者在设置中心填写）。`@novel-editor/video/stitch`（改编自 video-maker 的 video-core）在渲染进程把镜头图片 / 视频拼成样片（Canvas2D + WebCodecs + mp4-muxer / webm-muxer），**主进程不得引入 `./stitch`**。样片保留声音：各成片字节经 WebAudio `decodeAudioData` 解码（`audio-mix.ts` `decodeAudioTrack`，没有音轨 / 解码失败 = 静音），按与画面相同的片段起点 / 时长规划（纯函数 `audio-plan.ts` `planAudioTimeline`：从入点播放、不超过片段与声音本身长度、首尾 10ms 防爆音、紧接下一片段时淡出与转场一致），`OfflineAudioContext` 混成 48kHz 双声道，再用 `AudioEncoder` 编码随画面进度交错写入同一文件（`audio-encode.ts`）；编码选择 `audio-codecs.ts` `chooseAudioEncoding`：MP4 用 AAC `mp4a.40.2`，AAC 不可用时改用 WebM（VP9 > VP8 > AV1）+ Opus，都不可用才只导出画面并返回 `audioDropped`（场景视频画布提示「当前环境无法编码声音」）；音频编码出错时导出失败，不悄悄丢声音。`EncodeResult.hasAudio` 标明是否带音轨
- **主进程**（`src/main/ai/`、`src/main/video/`）
  - 密钥：`CredentialStore`（`ai/credential-store.ts`）用 Electron `safeStorage` 按**模型 id** 加密保存到 `userData/ai-credentials.json`（0600，应用全局、不随项目）；系统没有可用钥匙串（或 Linux `basic_text`）时以受限权限文件保存并在设置中心提示
  - **模型列表**（`userData/ai-providers.json` schemaVersion 2，`ai/provider-config.ts`）：每个能力（text / image / video / speech）一张列表，条目 `{ id, capability, vendor, label, preset?, baseUrl?, model?, enabled, temperature?, maxTokens?, contextTokens?, pricePerSecond?, currency?, voice?, createdAt }`；`vendor` 是注册表里的协议实现（openai-compatible / grok / seedream-image / minimax-image / grok-image / minimax-video / seedance-video / openai-speech / minimax-speech），`preset` 只用于显示「服务商」。Grok、DeepSeek、通义、Kimi、智谱、Ollama 等都只是**服务商预设**（`shared/ai-models.ts` `AI_MODEL_PRESETS`：预填协议、地址、推荐模型；「OpenAI 兼容图片」预设沿用 grok-image 协议）。新模型 id 为 `<能力>-<n>`（按能力只增不减），旧版内置服务 / 自定义服务迁移后保持原 id（`openai-compatible`、`grok`、`custom-text-<n>`…）。同时保存每个能力的默认模型 `defaults` 与视频队列设置。校验：能力与协议一致、预设属于该能力与协议、地址 http(s) 且无账号密码（OpenAI 兼容协议必填）、显示名称 1–80 字、模型 ≤200 字、id 格式、每个能力最多 50 个
  - 默认模型：`AIService.resolveDefaultId(capability)` 是主进程唯一口径（选定的 > 第一个已保存 Key 且启用的 > 第一个）；省略模型的 `ai-complete` / `ai-stream-start` / `ai-request`（成长推演、灵感、章纲等）、配音、图片都走它；默认文本模型受「启用 AI 功能」总开关（设置中心 JSON）约束。`db-settings-get` 注入派生字段 `ai.hasApiKey / defaultTextProviderId / defaultTextLabel / defaultTextReady / contextTokens`（默认文本模型），渲染进程 `getAIConfigStatus` 据此判断 AI 是否可用。渲染进程选择模型统一用 `render/utils/textProviders.ts`（`usableModels` 默认在前、`pickDefaultModel`、`resolveModelChoice`、`providerIdForRequest` 选中的是默认时省略 id）
  - 每个模型按自己的协议实例化（`registry.create*(entry.vendor, { apiKey, baseUrl, model, … })`），文本模型的生成参数（温度 / 上下文长度 / 单次回复长度）在条目里；请求没有指定温度 / 回复长度时用模型的值，「单次回复长度」是 max_tokens 上限（`AIService.textRequest`）；续写的上下文预算按所选模型的上下文长度（`continuationBudget`）
  - 沿用 Key：`ai-models-add { reuseKeyFrom }` 只允许同一协议 + 同一接口地址、已保存 Key 的模型，Key 在主进程内复制（`ai/model-actions.ts`），渲染进程拿不到
  - 旧版迁移（不丢数据，`ai/model-migration.ts`，第一次读取时执行，原文件备份为 `ai-providers.v1.json`）：配置过（有 Key 或改过配置）的内置服务、全部 `customText` / `customMedia` 变成模型（id / 名称 / 参数 / Key 不变），从没配置过的不出现；选过的默认写作 AI 保持，没选过时为内置 openai-compatible（存在时）。内置 openai-compatible 的地址 / 模型 / 参数原在设置中心 JSON：数据库打开后导入一次（`ai/legacy-settings.ts`，只补空字段、按旧预设生成名称如「DeepSeek · deepseek-chat」）；安全存储里有它的 Key 但没有条目时补建并设为默认。兜底：旧内置 id 只有 Key 没有条目时访问即补建
  - 迁移：每次打开数据库（`db-init` / `db-init-default` → `ai/runtime.ts` `handleDatabaseOpened`）把设置 JSON 中的明文 `apiKey` 移入安全存储并删除明文（安全存储已有不同 Key 时以安全存储为准）；`db-settings-get` 返回前去掉 Key 并注入 `ai.hasApiKey`，`db-settings-set` 写入前把 Key 转存（`ai/settings-secrets.ts`）
  - `invokeConfiguredAI`（`handlers/ai.ts`，成长推演、`ai-request` 等使用）改由 `ai/service.ts` 实现，签名、默认值与错误文案不变
  - 视频任务：表 `video_tasks`（store `videoTaskOps`，在当前项目数据库）+ `video/runner.ts`（提交 → 轮询 → 后台下载，数据库打开后恢复轮询；下载前重新获取签名地址；先写 `.part` 再改名）；落盘路径经 `video/download.ts` `resolveInsideWork` 校验（拒绝 `..` / 绝对路径 / 经符号链接逃出作品目录），提交时作品目录必须存在且位于该窗口已上报的工作区内；下载只按原始字节流式写盘（不转码、不重新封装），成片自带的音轨原样保留
- **IPC**（白名单在 `preload.ts`，类型在 `render/types/ai-api.ts`，协议在 `shared/ai.ts` / `shared/ai-models.ts`）：`ai-providers-list / get`（模型列表，`AIProviderInfo` 含 `capability / vendor / label / providerLabel / model / configured / isDefault`，绝无 Key）、`ai-models-add`（`AIModelInput`）/ `ai-models-update`（`AIProviderUpdate`，Key 只写、`clearKey`）/ `ai-models-remove`（Key 一并删除）/ `ai-models-set-default(capability, id | null)` / `ai-models-test`；旧通道 `ai-providers-set / test` 保留为兼容（= update / test；内置服务 id 还没有模型时以该 id 新建，E2E 用它通过 IPC 配置）；增删改成功后广播 `settings-updated`；`ai-complete`、`ai-stream-start / cancel`（片段经 `ai-stream-event` 只推给发起的窗口，窗口关闭自动取消，每窗口最多 4 个并发流）、`video-task-submit / list / cancel / retry`、`video-settings-get / set`、`ai-image-generate`；任务变化广播 `video-task-updated`
- **安全规则**：渲染进程永远拿不到 API Key 明文——只能写入（`ai-providers-set`），读取只返回 `configured`；不得把 Key 写进设置 JSON、日志、prompt.json 或错误信息；主进程对渲染进程传入的消息、模型、地址（只允许 http(s)、不含账号密码）、作品目录与镜头参数做白名单校验
- **设置中心「AI」**（`AppSettingsCenter/AiSection`）：最上方独立一行「启用 AI 功能」总开关；下面每个能力（文本 / 图片 / 视频 / 语音）**一张模型列表**（没有内置服务面板，空列表显示说明）。每行（`ModelRow`）：显示名称、服务商 · 模型、状态（已配置 / 已配置 · 已停用 / 未配置）、「默认」或「设为默认」、测试连接、编辑（铅笔图标，就地展开 `ModelEditForm`：显示名称、接口地址、模型（推荐 + Select `custom` 手填；名称还是默认的「服务商 · 模型」时换模型会同步改名）、只写 Key（`ApiKeyField`）、文本的生成参数 / 视频的每秒单价 / 语音的默认声音）、删除（图标，确认后 Key 一起删除）、启用开关；图标按钮都有 Tooltip。每个分区底部「添加模型」（`AddModelForm`）：服务商（文本：OpenAI / DeepSeek / xAI Grok / 通义千问 / Kimi / 智谱 GLM / Ollama（本地）/ 自定义（OpenAI 兼容）；图片：Seedream（火山方舟）/ MiniMax / xAI Grok / OpenAI 兼容图片；视频：MiniMax 海螺 / Seedance；语音：OpenAI 兼容 / MiniMax）预填地址与推荐模型 → 接口地址 → 模型 → 显示名称（留空为「服务商 · 模型」）→ API Key；同一服务商 + 地址已有 Key 时出现并默认勾选「沿用已保存的 Key」。「配音默认语言」在语音分区。列表数据在 `useAiModels`（收到 `settings-updated` 防抖重读）。「清除 AI 设置 / 全部清空」删除全部模型（连同 Key）
- **CLI**：`ne ai continue` / `ne video storyboard` / `ne video validate`（见下方 CLI 命令）。CLI 没有 safeStorage，Key 读取环境变量 `NOVEL_EDITOR_<PROVIDER>_API_KEY`（连字符转下划线，例如 `NOVEL_EDITOR_GROK_API_KEY`），可选 `NOVEL_EDITOR_<PROVIDER>_BASE_URL` / `_MODEL`；没有 Key 时只输出提示词与 JSON Schema 交给 AI agent
- 测试：Provider 映射与错误用 mock fetch（`packages/ai/test`），CLI 用本地 mock HTTP 服务（`apps/cli/test/ai-video.test.ts`）；单测 `test/main/ai/ai-models.test.ts`（各种旧版形态迁移与备份、内置默认 AI 从设置 JSON 导入、增删改、校验与上限、每个能力的默认解析、沿用 Key 的限制、按协议实例化、总开关、列表不含 Key）、`service.test.ts`、`ai-ipc.test.ts`（`ai-models-*` IPC 校验）、`test/render/components/AppSettingsCenter/AiSection.test.tsx`（列表与空状态、添加模型预设预填、沿用 Key、设为默认、编辑参数、删除）、`test/render/utils/textProviders.test.ts`、场景视频 `Toolbar.test.tsx`（单一视频模型下拉）；E2E `apps/pc/e2e/ai-providers.e2e.ts`（Grok 预设 + DeepSeek 预设两个文本模型指向 mock → 测试连接 → 设为第二个默认 → `ai-request` 用它；沿用 Key 添加第三个；温度持久化；Seedance 预设视频模型出现在场景视频的「视频模型」下拉）与 `ai-models-migration.e2e.ts`（启动前用 `setupAppSuite({ prepareUserData })` 写入旧版 ai-providers.json + 凭据，验证迁移结果与默认模型）

### 场景视频（工作区标签）

- 入口：编辑器文件栏「场景视频」胶囊（`components/SceneVideoButton`，经 `editorHeaderActions`，按下不抢焦点以保留选区）、应用菜单「编辑 → 场景视频…」/ `Mod+Alt+V`（固定加速键，`shortcuts/config.ts`；渲染进程按物理键位 `KeyV` 处理并 `preventDefault`）、卷纲列表视图里「场景」节拍的摄像机按钮。发起方只派发窗口事件（`SceneVideoView/events.ts` `requestOpenSceneVideo`，菜单事件经 `useAppMenu` 转发），由 `hooks/useSceneVideoEntry.ts` 统一解析：选区 > 指定场景名 > 光标所在的「第X场」> 整章（`sceneSource.ts` `resolveSceneSource`），打开标签 `__workspace__:scene-video:<章路径>#<场景>`（`utils/workspace.ts`，场景名里的 `#` 换成全角），带入的正文作为「种子」暂存在内存
- 画布（`components/SceneVideoView/`，不依赖第三方画布库）：节点从左到右 人物（形象图小圆头像，虚线连到场景）→ 场景 → 镜头 1…N（每行 4 个）→ 样片（在最后一个镜头右侧）。布局纯函数在 `canvasLayout.ts`（`layoutSceneCanvas` / `edgePath` / `fitViewport` / `zoomAround`），视口与手势在 `SceneCanvas/`：拖空白处或滚轮平移、⌘ / Ctrl + 滚轮或右下角按钮缩放、「适应画布」（不放大超过 100%、不小于 72%，放不下时从左上角开始）；拖动节点保存到 `分镜.json` 的 `canvas.positions`；单击节点在右侧检查器（`Inspector/`）编辑，Esc / 点空白取消。顶部工具栏（`Toolbar/`）：标题 + 保存状态｜费用预估 + 添加镜头 + 在资料中查看 +「生成 N 个镜头」；第二行风格 / 比例 / 每镜时长 / 视频模型（一个下拉列出设置中心的视频模型，默认模型在前；「生成声音」按所选模型的协议 `supportsAudio`）/ 形象图作首帧。所有图标按钮都有 Tooltip
  - 场景检查器：场景正文、地点（设定 datalist）、出场人物、自定义风格；带入的选段与保存的不同时提示「用选中的文字替换」
  - 镜头节点 / 检查器：节点显示景别 · 时长、成片缩略视频（悬停播放）或进度 / 失败原因、画面描述，节点上直接「生成 / 重新生成」；检查器改景别 / 时长 / 画面 / 运镜 / 台词、前后移、删除，版本（预览、选用）与生成记录（重试 / 取消，内容安全失败给改写建议）
  - 样片节点 / 检查器：播放最新样片；「现在合成样片」（没有成片的镜头用占位卡）
- 尽量自动、少手动：打开时没有分镜就自动拆分（有文本服务用 AI，否则 `splitSceneIntoShots` 按段落）；每次修改自动写 `分镜.json` 与可读的 `分镜.md`（没有「导出」按钮）；「生成 N 个镜头」只提交没有成片、没有进行中任务、且有画面描述的镜头（`shotsNeedingGeneration`）；全部镜头都有成片且没有进行中任务时自动合成样片（`shouldAutoStitch`，版本组合与上次相同不重复合成，签名存 `animaticSignature`）；第一个成片出现后自动在本章章纲追加「场景视频 · <场景>」条目一次（`outlineLinked`）
- 结果都在资料里：写入新文件后派发 `utils/workspaceFiles.ts` 的 `WORKSPACE_FILES_CHANGED_EVENT`，`useProjectLoader` 防抖 400ms 静默刷新文件树（不显示加载状态）；「在资料中查看」派发 `REVEAL_IN_FILE_PANEL_EVENT`（`useEditorInteractions` 展开侧边栏、退出专注模式并定位，资料路径会展开「资料」分区）；资料树里不显示 `分镜.json`（内部数据），场景目录 `资料/视频/<章>/<场景>/` 带「场景视频」标记，单击 / Enter / 右键「打开场景视频」直接打开这一场的画布（箭头展开看成片；`useWorkspaceEntityActions.handleFileSelect` 读取分镜状态）
- 落盘：`<作品>/资料/视频/<章>/<场景>/`（`@novel-editor/video` `videoSceneLayout`，与成片同目录）。工作区状态保存为 `分镜.json`（`sceneVideoState.ts`，作者修改后防抖 800ms 写回，只打开不修改不写文件；重新打开时恢复，带入的选段与保存的正文不同时只提示「用选中的文字替换」）。镜头 id 固定为 `shot-<N>` 且 N 只增不减（`nextShotNumber`），成片 `镜头N-vX.mp4` 用的就是 N，排序 / 删除 / 重新生成分镜后已有成片不会串号
- 生成声音：工具栏「生成声音」开关（`Toolbar`，`分镜.json` 的 `withAudio`，默认开启）。只有描述里 `supportsAudio` 的视频服务（目前 Seedance，映射为 `generate_audio`）可用，其他服务开关置灰且请求不带声音参数；主进程 `sanitizeSubmitPayload` 只接受布尔值，经任务参数传给 runner
- 人物一致性：画布人物节点显示三视图（没有时提示「缺三视图」），其余文字（外貌 / 服装等人物设计）自动读取；提交视频时按镜头出场人物附带参考图（三视图优先，其次主要形象图，core `characterReferencePaths`，每镜最多 4 张，`useSceneVideoTasks.referencePathsFor`）。任务只存相对路径（`referencePaths` / `firstFramePath`），主进程提交时经 `main/media-files.ts` `loadReferenceImages` 读取（realpath 校验在作品目录内、只收图片、≤10MB，跳过的不占名额）；MiniMax 映射为 `subject_reference`、Seedance 为 `role: reference_image`（尾帧 `last_frame`）
- 首帧（镜头检查器「首帧」区，`Inspector/KeyframeSection.tsx` + `useSceneKeyframes.ts`）：可选「3D 预演」（动作预演 / previz，`SceneVideoView/Previz/`）。**主界面是描述而不是手动摆拍**：右侧只有「镜头动作与走位」输入框（预填画面描述 + 出场人物 + 运镜）、模型下拉（`usePrevizModels`：已配置 Key 且启用的文本服务及其模型，默认同「AI 生成分镜」的 `pickTextProvider`）与「生成预演」；可折叠的「微调」只保留 拖人物平移整段走位 / 拖空白处环绕机位 / 重置机位 / 还原走位 / 时段。AI 经 `ai-complete` 返回 **PrevizScript**（契约，`packages/video/src/previz.ts` 类型 + `PREVIZ_JSON_SCHEMA`，`previz-validate.ts` `validatePrevizScript` 容忍字段别名、夹值：时长 ≤10 秒、站位 ±8 米、焦距 18–135、关节 ±170 度，未知姿势回退 stand；提示词 / 解析在 `packages/ai/src/prompts/previz.ts` `buildPrevizPrompt` / `parsePrevizResponse`，系统提示词以 `[previz-script/v1]`（`PREVIZ_PROMPT_TAG`）开头）：时长、人物（名字 / 颜色 / 关键帧 {t, x, z, facing, pose（`PREVIZ_POSES` 英文 id）, 可选 joints 微调}）、机位关键帧 {t, shotSize（英文 id，与分镜景别按顺序对应）, lens, angle, yaw, pitch, height, 可选 focus}、道具、时段。没有 AI / AI 失败 / 无法解析时用确定性默认脚本（`defaultPrevizScript`：人物站成一排面向镜头 + 从宽一级景别缓慢推近），不解析中文关键词。引擎：`previz-sample.ts` `samplePrevizScript(script, t)` 纯函数插值（位置匀速、朝向最短弧、姿势按 mix 混合、景别高度对数插值、walk / run 移动时按走过的距离给步态相位），three.js 舞台（`stage.ts`，动态导入单独分包，`setSample` / `capture` / `beginExport` / `renderExportFrame` / `endExport`）按采样渲染：木偶是代码拼出的关节几何体（`mannequin.ts` `applyPoseSample`），姿势是 `poses.ts` 手写的关节角度预设 + `gaitJoints` 步态周期，不需要外部模型文件。播放条：播放 / 暂停（空格）、进度条、循环、三分线 / 安全框（DOM 叠加层，不进画面）。拖动人物按人物深度把像素换算为米（`drag.ts`，修复旧版用鼠标射线与地面求交：平视机位下射线几乎贴地，一两个像素交点跳几十米，人物飞出画面；回归测试 `test/render/components/SceneVideoView/Previz/drag.test.ts`），拖动前把自动对焦的机位固定在当时的人物中心（`pinCameraFocus`）。「保存预演视频」逐帧确定性渲染（画幅比例长边 1280、24fps，不是实时录屏）→ WebCodecs 编码（`@novel-editor/video/stitch` `encodeFrameSequence`，H.264 MP4 优先，否则 WebM；编码器可注入），同时截第一帧 PNG：IPC `video-scene-write-media`（`kind: 'previz-video'`，按文件头校验 MP4 `ftyp` / WebM EBML、≤60MB、同样的场景目录规则，先删除再独占写入，不经符号链接写穿；换格式时删除另一种）保存 `镜头N-预演.mp4`，`video-scene-write-image` 保存 `镜头N-预演.png`。`分镜.json` 记录 `previz`（第一帧，生成首帧时作为构图参考图）、`previzVideo`（预演视频，检查器用 VideoPlayer 播放，`video-scene-read-file` 允许读取 `镜头N-预演.mp4|webm`）、`previzScripts`（脚本，重新打开时恢复，读取时重新校验）。弹窗 `data-stage=loading|ready|error`，舞台创建失败重试 3 次后提示没有 WebGL；**每个舞台用弹窗新建的 canvas**（StrictMode 卸载后立即重建，两个渲染器共用一个 WebGL 上下文会互相改写视口，强制丢失上下文则新渲染器不可用）。「生成首帧（4 选 1）」用图片服务按画面描述 + 人物三视图 + 预演第一帧出 4 张（`keyframe.ts`），采用的存为 `镜头N-首帧-<时间>.png`；生成视频时首帧随任务提交（图生视频模型从首帧锁定构图与人物外观），预演视频是作者的动作参考，也留给将来支持视频参考的服务
- 3D 预演 · AI 控制的内容（PrevizScript 第 2 版，`PREVIZ_SCRIPT_VERSION = 2`；第 1 版脚本由 `validatePrevizScript` 自动迁移，结构不变）：**有哪些人物 / 物体**（figures；props 的 kind + 可选 name / size [宽, 高, 深] 米 / color / y 离地高度，不在列表里的物体用通用几何体 `box / cylinder / sphere` + size 表示，有名字或尺寸但类型不认识时也回退为 box）、**物体怎么动**（props.keys：{t, x, z, y, facing, ease}，`samplePropItem`）、**人物怎么动**（关键帧位置 / 朝向路径 + `ease`（linear / ease-in / ease-out / ease-in-out，作用于到下一帧的移动，默认位置匀速）、每段动作 = `pose` + 可选 `motion`（AI 直接写的关节轨迹 `{ tracks, rootBob?, lean?, loop?, weight? }`，或 `{ generate: '描述' }` 另行生成，见下一条）、`lookAt`（`{ figure: 名字 }` 或点 {x, y, z}，名字在校验时换成人物 id，按胸 / 颈 / 头分配转角并限幅）、可选 `hands.left/right` 手部目标（世界坐标，`Previz/ik.ts` 两段臂 CCD，按权重过渡））、**机位**（原有景别 / 焦距 / 角度 / 环绕 + `follow` 跟随某个人物（没写时沿用上一机位）、`position` + `target` 绝对机位（按权重与景别推算的机位过渡，`camera.ts` `placementFromSample`）、`ease`）。提示词（`buildPrevizPrompt`）列出全部可用 pose id、木偶关节表（各轴范围）、轴约定与一个紧凑的挥手示例。校验辅助拆在 `previz-validate-utils.ts` / `previz-validate-extras.ts`，采样辅助在 `previz-sample-motion.ts`
- 3D 预演 · AI 实时生成的动作（不使用任何动作文件，没有动作库 / BVH 导入）：契约在 `packages/video/src/previz-motion.ts`——人物关键帧的 `motion.tracks` 是 `关节名 → [t, rx, ry, rz][]`（t 为相对这一段起点的秒数；角度为度、three.js XYZ 欧拉，表示相对「自然站立、手臂下垂」的绝对局部旋转，约定与 `poses.ts` 一致：肢体绕 x 为负 = 向前抬，左侧绕 z 为正 / 右侧为负 = 外展，躯干绕 y 为正 = 向左转），关节名即木偶关节 `PREVIZ_JOINTS`，各轴范围 `PREVIZ_JOINT_RANGES`；可选 `rootBob`（[t, 米] 髋部起伏）/ `lean`（[t, 度] 整体前倾）/ `loop`（按最长轨迹循环）/ `weight`（0–1 叠加权重）/ `generate`（描述，交给 MotionProvider 或追加请求生成，见「AI 服务」）。校验 `previz-motion-validate.ts`：关节名大小写 / 连字符不敏感，关键帧接受数组或 `{ t, x, y, z }`，含 NaN / 非数字的关键帧丢弃，时间夹到 0–10 秒并排序，角度夹到关节范围；上限每个动作 ≤ 24 个关节、每个关节 ≤ 120 个关键帧、合计 ≤ 600，整个脚本 ≤ 3000；旧版脚本的动作片段引用（`motion.clip` / 字符串）静默丢弃、回退到 pose（读取 分镜.json 时同样经过 `validatePrevizScript`）。采样 `motion/tracks.ts`：每个分量三次 Hermite（Catmull-Rom 切线，非循环时首尾切线为 0，循环时跨周期），结果再夹到关节范围，转成四元数；`previz-sample-motion.ts` `sampleFigureMotion` 让关键帧的动作从该帧开始播放，到下一关键帧前最后 0.35 秒（不超过区间一半）交叉淡化到下一段的动作或 pose；移动中（walk / run 步态保留程序生成）腿与髋部起伏让给步态（边走边挥手）。木偶：`applyPoseSample` 在姿势之上按权重球面插值到轨迹旋转，lean 作用于髋部、rootBob 叠加到髋高，再叠加关节微调（视线 / AI 微调）。测试：`packages/video/test/previz-motion.test.ts`（上限 / 夹值 / NaN / 旧引用迁移 / 平滑 / 混合）、`apps/pc/test/render/components/SceneVideoView/Previz/motion-rig.test.ts`（木偶举手挥手、前倾）、`PrevizMotion.test.tsx`（假舞台：生成后挥手 / 追加生成的点头在播放，保存的脚本带轨迹）
- 主进程 `handlers/video-scene.ts`：`video-scene-load / save / read-file / write-animatic / write-image`（`write-image` 只收图片文件头、≤15MB，同名先删除再独占写入，不会经符号链接写到作品目录外）。作品目录同样经 `assertWorkPath`（存在的绝对路径、位于窗口工作区内）；章 / 场景名清洗为单个路径段；读文件只允许 `镜头N-vX.<ext>` / `样片-*.mp4|webm`，经符号链接逃出作品目录的拒绝；预览用读出的字节生成 blob 地址
- 测试：`test/render/components/SceneVideoView/`（提取、兜底拆分、状态持久化、费用、路径、画布布局 / 自动化纯函数、画布 RTL）、`test/render/hooks/workspaceFileEvents.test.ts`、`test/render/hooks/useSceneVideoEntry.test.tsx`、`test/main/video/video-scene-handlers.test.ts`；E2E `apps/pc/e2e/scene-video.e2e.ts` 用本地 mock 服务（Grok 形状的文本服务 + MiniMax 形状的视频服务，成片是测试内用 `support/mp4-fixture.ts` 生成的 16×16 H.264 MP4）走完 选中一场 → 场景视频 → 自动 AI 拆分镜 → 节点上生成镜头 1 → 落盘（含自动写入的分镜.md、自动回链章纲）→ 资料自动刷新并可定位 → 节点 / 检查器预览

### 人物图集 / 人物总览 / 参考窗格

- 图集（`components/EntityGallery`，人物详情与设定详情的「图集」分页）：只有两类——人物「形象图 / 三视图」、设定「图片」（core `CHARACTER_MEDIA_KINDS` / `LORE_MEDIA_KINDS`，旧的服装 / 表情 / 其他等读取时归入形象图，`normalizeMediaKind`）。空图集整块可点击上传，也可以把图片拖进图集（只收图片），上传后一律是形象图；**右键图片**：设为主要形象图（人物）/ 封面（设定）、设为形象图 / 三视图（`setMediaKind`）、在编辑器旁边打开、查看大图、删除。AI 出图只在人物有两类时显示类型选择
- 人物总览（角色工作区根标签，`RightPanel/CharactersView/CharacterOverview`）是人物维度：分页「人物」（每人一张卡：主要形象图、Lv、设计完成度、图片数，缺人物设计 / 缺三视图 / 没有成长档案的提示，`summarizeCharacter`）/「成长」（嵌入成长总览）/「关系」（原人物编辑列表 + 关系网络）。文件面板「角色」头部的按钮是「打开人物总览」（`onOpenCharacters`）
- 视频播放器：自己实现（不用第三方播放器），独立包 `packages/media-player`（`@novel-editor/media-player`，0.1.0，源码导出、SCSS Module 由使用方 Vite 处理，React 为 peer，只依赖 react-icons；README 说明属性 / 键盘 / 无障碍 / 发布方式；测试在 `packages/media-player/test/`）。应用内 `components/VideoPlayer` 只是薄封装（注入应用的 Tooltip，经 `renderTooltip`；`VideoPlayer/format.ts` 仅为旧路径兼容），正文 `::video`（经 `live-preview/media-figure.tsx` 用 createRoot 挂进 CodeMirror widget）、参考窗格、场景视频检查器共用。按视频比例无黑边、首帧作封面、悬停才出控制条（播放 / 进度 / 时间 / 静音 + 悬停音量 / 循环 / 全屏，Space/K、←/→、↑/↓ 音量、M、F），右上角可放「在旁边看」等动作；不使用原生 `<video controls>`。声音：用户发起的播放默认有声；只有自动播放的预览（compact / `autoPlay`，如参考窗格）静音起播，并显示「开启声音」按钮（用户主动播放时也会恢复声音）；音轨探测为纯函数（`audio.ts` `detectAudioTrack`：`audioTracks` → `mozHasAudio` → Chromium `webkitAudioDecodedByteCount`，实际播放 ≥1 秒仍为 0 才判定无音轨），确定无音轨时静音按钮显示「无音轨」，判断不了时一律按有声处理
- 参考窗格（`components/ReferencePane`，挂在 `ContentPanel` 编辑器右侧）：编辑时并排看图片 / 视频。媒体贴顶按宽度显示（图片单击在适应宽度 / 原始大小间切换并可拖动），下方信息行（类型、文件名、尺寸 / 时长；用系统应用打开、在资料中定位、移出列表）与缩略图网格（`ReferenceStage` / `ReferenceInfo` / `ReferenceGrid`）。任何地方派发 `utils/referencePane.ts` 的 `requestOpenReference({ items, index })` 即可打开（最多保留 30 项，去重）；停靠模式可拖宽（240–720px）、前后切换、缩略图条，可「缩成小卡片」悬浮在右下角；专注模式下隐藏。入口：编辑器文件栏「参考」胶囊（`components/ReferenceButton`，开 / 关窗格，以**自动模式**打开：本章引用（当前文档的 `::image` / `::video` 指令与 Markdown 图片，core `imageDirectiveSource` / `videoDirectiveSource` 解析、路径解析与 `media-loader.ts` 一致）→ 本章场景视频（`<作品>/资料/视频/<章>/` 下每个镜头最新版本 + 最新样片，从已加载的文件树查找）→ 当前作品人物三视图 / 形象图，网格按来源加小标题（本章 / 场景视频 / 人物 / 添加的）；纯函数在 `utils/referenceSources.ts`；什么都没有时显示用法说明）、资料里图片 / 视频右键「在编辑器旁边打开」、图集右键、场景视频检查器「在旁边看」、正文 `::image` / `::video` 的「在旁边看」。文件栏变窄（< 760px，`container: editor-header`）时各胶囊只显示图标。媒体经 `read-file-binary` 读取为 blob 地址
  - 自动模式与热更新（`ReferencePane/useReferencePaneState.ts`）：`ReferenceButton` 每次文档 / 作品 / 文件树变化都广播 `REFERENCE_AUTO_SOURCE_EVENT`，自动模式下防抖 300ms 重算并与当前列表合并（`reconcileAutoItems`：作者加入的 `origin: 'user'` 与排好的顺序保留，移除过的自动项不再出现）；打开时文档有媒体引用则先解析（≤400ms）再显示，避免主画面跳动。选中项按路径记录。显示中的文件每 2 秒查 `get-file-info`（大小 + 修改时间），资料变化通知（`WORKSPACE_FILES_CHANGED_EVENT`，图集保存 / 删除后也会派发）时检查全部参考，有变化就提升版本重新读取（`useReferenceHotReload.ts`，`useReferenceMedia(item, version)`）
  - 拖放：拖动缩略图排序（落点指示前 / 后，`dropTargetIndex`；键盘 Alt + ← / → 移动）；资料树文件行可拖出（`FileTree` 设 `application/x-novel-editor-path` = 绝对路径，不设 text/plain），系统文件经 preload `getLastDroppedPaths()`（`webUtils.getPathForFile`），拖到缩略图上插到前 / 后，拖到窗格空白处加到末尾（`ReferencePane/dropPaths.ts`）；缩略图拖到正文时 text/plain 携带 `::image[标题]{src="…"}` / `::video[…]`（CodeMirror 默认在落点插入；路径相对作品目录，文档不在作品内时相对文档目录，`buildMediaDirective`）；信息行「插入到正文」经 `active-editor.ts` 的 `insertBlock` 插在光标行之后
  - 「在资料中定位」：`useEditorInteractions` 先 `selectWorkForPath`（`useWorkScope`，文件属于其他作品时切过去、不影响当前标签的自动切换）、退出专注模式、展开侧边栏；`FilePanel` 按文件树判断是否属于资料（不按目录名匹配），把请求交给资料 `FileTree` 的 `revealRequest`：展开全部祖先目录 → `scrollIntoView({ block: 'center' })` → 聚焦并高亮 2.4 秒（`data-revealed="true"`）；树里暂时没有时调用 `onRevealMissing`（静默刷新文件树）后继续，最多等 8 秒
- 单个媒体导出：主进程 `media-export`（`main/handlers/media-export.ts`）：`{ sourcePath, defaultName?, format?, data? }` → 另存为对话框（按格式过滤，默认「下载」目录）→ 无 data 时原样复制（视频 mp4 / webm / mov / m4v 永不转码；同格式图片），有 data 时写入渲染进程转换好的 PNG / JPEG / WebP（按文件头校验格式，≤50MB）；源文件必须是存在的绝对路径普通文件、扩展名在白名单内、解析符号链接后位于窗口工作区内（未上报工作区时拒绝）；取消不写文件；返回 `{ saved, filePath?, error? }`。E2E 可用 `NOVEL_EDITOR_E2E_SAVE_PATH`（仅 `NOVEL_EDITOR_E2E=1` 时生效；不带扩展名时按格式补上）跳过对话框。渲染进程 `utils/mediaExport.ts`（`planMediaExport` 决定复制 / 转换，canvas `toBlob` 转换，JPEG 铺白底；`exportMediaWithToast` 提示保存位置）。入口：参考窗格信息行「导出」（图片弹出 PNG / JPEG / WebP 菜单，视频直接导出原格式）、图集右键「导出为 PNG / JPEG / WebP…」、资料右键（媒体文件）、场景视频镜头检查器版本列表「导出」

### 场景视频 · 声音

- **模型**（`packages/video/src/audio.ts`，纯函数、宽松解析，旧 `分镜.json` 直接可读）：场景级 `state.audio: SceneAudio = { language（BCP-47，新场景默认取设置中心「AI → 语音 → 配音默认语言」= `video-settings` 的 `voiceLanguage`，缺省 zh-CN）, bgm?: { source: 'file' | 'none' | 'generate', path?（相对作品目录，资料/音乐/…）, prompt?, volume 0..1, fadeInSec, fadeOutSec }, ambience?: { prompt?, path?, volume }, ducking（默认开）, speechProviderId? }`；镜头级 `shot.dialogue: DialogueLine[]`（`{ id（[A-Za-z0-9_-]）, speaker: 人物名 | 'narrator', text, emotion?, startSec?, audioFile?, audioDurationSec? }`）与 `shot.sfx: SfxCue[]`（`{ id, prompt?, path?, atSec, volume }`）；旧版自由文本 `dialogue` 字符串由 `validateStoryboard` 迁移为对白（「名字：台词」拆出说话人，否则为旁白）。人物声音 `CharacterVoice { providerVoiceId?, gender?, age?, timbre? }` 存在人物 `attributes.voice`（`character-attributes.ts`），人物详情「人物设计」分页底部的「声音」表单（`CharactersView/CharacterVoiceForm`），可选
- **用在哪里**：
  - 视频提示词：`buildShotVideoPrompt(shot, state, { withAudio })` 只有视频服务 `supportsAudio` 且这一场开了「生成声音」时才附上 `shotAudioPromptHints`（对白语言 + 「说话人（情绪）：「台词」」+ 音效 + 环境声），否则只描述画面
  - AI 分镜：`buildStoryboardPrompt({ language })` 要求从正文提取 `dialogue`（speaker / text / emotion，旁白写 narrator，不编造台词）与可选 `sfx`；schema 与 `parseDialogue` / `parseSfx` 容忍别名（character / line / 台词 / 情绪 …）。没有 AI 时 `splitSceneIntoShots` 把引号里的话记为一句对白（只有一个人物出场时算他说的，否则旁白）
  - 配音（TTS）：`@novel-editor/ai` 的 `SpeechProvider.synthesize({ text, language, voice, emotion, format })`，内置 `openai-speech`（`POST {base}/audio/speech`，gpt-4o 系列带朗读指令）与 `minimax-speech`（`POST {base}/v1/t2a_v2`，hex 音频），注册为 kind `'speech'`，在设置中心「AI → 语音」里配置（只写 Key，可添加多个 `custom-speech-<n>`）；未联调的字段假设写在 `providers/speech.ts` 文件头。主进程 `ai-speech-synthesize`（`main/handlers/scene-audio.ts`）校验参数、确认返回的是 MP3 / WAV，写入场景目录 `镜头N-台词-<id>.mp3|wav`（覆盖同一句，换格式删旧文件），只返回文件名 / 时长；检查器「生成配音」（单句 / 全部未配音的句子）后把 `audioFile` 记进 `分镜.json`，改台词 / 说话人 / 情绪后旧配音作废
  - 背景音乐 / 环境音 / 音效文件：`scene-audio-import`（主进程弹「打开」对话框，渲染进程不能指定源路径；按文件头只收 MP3 / WAV / OGG / FLAC / M4A / AAC / WebM，≤ 50MB；配乐与环境音复制到 `<作品>/资料/音乐/`，音效到 `资料/音效/`，同名加序号、独占创建）；`scene-audio-read` 只读这两个目录（拒绝符号链接逃逸）。`bgm.source = 'generate'` 只是预留：`MusicProvider` 接口在 `packages/ai/src/types.ts`，尚无实现。E2E 用 `NOVEL_EDITOR_E2E_OPEN_PATH`（仅 `NOVEL_EDITOR_E2E=1` 生效）替代对话框
  - 样片混音：`@novel-editor/video/stitch` 的 `planSceneAudioMix`（纯函数）规划成片原声、对白（镜头起点 + startSec，未写时紧接上一句，间隔 200ms）、音效（atSec）、配乐（循环铺满、淡入淡出，开启压低时对白区间 -12dB，前后 150 / 350ms 渐变，`bgmGainEnvelope` = 音量 × 淡入淡出 × 压低）、环境音（循环）；`mixScenePlan` 用 OfflineAudioContext 按增益折线混音。读不到 / 解码失败的声音跳过。有声音素材时样片签名带上声音（`audioSignatureFor`），改配乐 / 配音会自动重新合成
- **界面**：场景检查器「声音」（`SceneVideoView/AudioSection/SceneAudioSection`：配音语言 / 配音服务 / 背景音乐（无、本地文件，试听、音量、淡入淡出）/ 环境音 / 「对白时自动压低配乐」开关）；镜头检查器「对白」「音效」（`ShotAudioSection`：说话人下拉 = 出场人物 + 旁白、台词、情绪、开始时间、生成配音与试听；音效描述 / 文件 / 时间点 / 音量）；数据与动作在 `useSceneAudio.ts` / `useSceneAudioPanels.tsx`。画布镜头节点显示「台词 N」「音效 N」「配乐」标记，场景节点显示「配乐」
- 测试：`packages/video/test/audio.test.ts`、`audio-scene-plan.test.ts`、`packages/ai/test/providers-speech.test.ts`、`apps/pc/test/main/video/scene-audio-handlers.test.ts`、`apps/pc/test/render/components/SceneVideoView/{AudioSection.test.tsx, sceneVideoAudio.test.ts}`；E2E `apps/pc/e2e/scene-audio.e2e.ts`（mock Grok 分镜带对白 + mock `/v1/audio/speech` 返回 WAV：选语言、选本地配乐、生成配音 → `镜头1-台词-l1.wav` 落盘并记录到 `分镜.json`）

### 应用菜单 / 快捷键

- 菜单模板在 `src/main/shortcuts/menuTemplate.ts`（纯函数，`registerAllShortcuts.ts` 负责 `Menu.setApplicationMenu` 与重建），参照 VS Code / Typora：
  - macOS：「小说编辑器」（关于、检查更新…、设置… ⌘,、服务、隐藏 / 隐藏其他 / 全部显示、退出）/ 文件 / 编辑 / 视图 / 窗口 / 帮助
  - Windows / Linux：没有应用菜单，设置… 与 退出 在「文件」末尾，检查更新… 与 关于 在「帮助」末尾
  - 文件：新建文件 ⌘N（与按键一致：新建未命名标签）、打开文件夹… ⌘O、打开最近使用 ▸（`recent-folders` 变化时自动重建，点击走 `open-folder-request`）、保存 ⌘S、另存为… ⇧⌘S、导出项目… ⇧⌘E
  - 编辑：撤销 / 重做 / 剪切 / 复制 / 粘贴 / 全选（原生 role）、查找 ⌘F、灵感抽签… ⇧⌘Y（加速键随设置中心同步）、场景视频… ⌥⌘V；视图：切换侧边栏、切换右侧面板、专注写作、放大 / 缩小 / 实际大小、切换全屏（macOS ⌃⌘F；Win/Linux 不设加速键，F11 留给专注模式），开发模式另有 重新加载 / 开发者工具；窗口：最小化 ⌘M、缩放、前置全部窗口；帮助：快捷键说明、更新日志、上传日志…、问题反馈（GitHub issues），打包版本另有 切换开发者工具
- 所有名称用 `APP_DISPLAY_NAME`，菜单里不得出现 `app.name`（dev 下是 `@novel-editor/pc`）；不使用英文 role 菜单（`editMenu` / `fileMenu` 等），也不再有隐藏的「快捷键」菜单——每个快捷键都对应一个可见菜单项或渲染进程 keydown
- 一致性：菜单加速键与快捷键总览共用 `shortcuts/config.ts`（`getShortcutConfigs()`），`getAllShortcuts.ts` 只额外列出纯渲染进程按键；设置中心可自定义的「切换侧边栏 / 专注写作 / 灵感抽签」由渲染进程经 `menu-sync-shortcuts` 同步到菜单（`useAppMenu`，主进程按白名单校验）。新增快捷键时同时改 config / 渲染进程 keydown / 总览，`test/main/app-menu.test.ts` 会校验菜单每个加速键都在总览中
- 渲染进程也处理的按键（⌘N / ⌘S / ⌘F / ⌘Z / ⌘Q 等）必须 `preventDefault`：Electron 只把渲染进程未处理的按键交给菜单，因此不会重复执行，焦点不在编辑器时由菜单兜底
- 菜单 → 渲染进程事件：`shortcut-*`、`menu-export-project`、`menu-open-about`，以及 `src/shared/app-menu.ts` 的 `APP_MENU_EVENTS`（设置、检查更新、视图切换、查找、灵感抽签、场景视频、快捷键说明、更新日志、上传日志），渲染进程统一在 `hooks/useAppMenu.ts` 处理；保存 / 另存为 / 查找作用于最近聚焦的编辑器（`TextEditor/active-editor.ts`）
- macOS 菜单栏标题来自 bundle 的 CFBundleName：打包时 `scripts/mac-localized-app-name.mjs`（electron-builder `afterPack`）在每个 `*.lproj` 写入 `InfoPlist.strings`，显示「小说编辑器」。不要改 `productName` 或用 `mac.extendInfo` 覆盖 CFBundleName——前者改变安装路径 / 更新产物，后者会让 Electron 找不到 `<名称> Helper.app` 而启动崩溃；`app.getName()` 与 userData 由 package.json 决定，不受影响。开发模式（`pnpm dev`）菜单栏标题固定为「Electron」（来自 node_modules 中 Electron.app 的 Info.plist），属预期，不要修改 node_modules

## 代码规范

### 路径别名

1. `@/` → `apps/pc/src/`（在 `apps/pc/vite.config.ts` 和 `apps/pc/tsconfig.json` 中同时配置）

### TypeScript

- 开启 `strict`，禁止出现 `any` 类型（ESLint `@typescript-eslint/no-explicit-any` 为 error）
- 禁止按汉字做判断：源码（不含测试）的正则字面量与 `RegExp(...)` 参数里不得直接写汉字 / 全角等非 ASCII 字符，确需按字符分段时写成 `\uXXXX` 转义并在注释里说明对应的字（ESLint `no-restricted-syntax` + `packages/core/test/no-cjk-regex.test.ts` 检查）；拼进正则的字符串常量同样转义
- 第三方类型缺失时用 `unknown` + 类型收窄，或声明最小化的局部接口，不要用 `as any` 绕过
- 提交前必须通过 `pnpm typecheck`

### 样式

- 使用 SCSS Modules (`.module.scss`)
- 每个组件独立目录，包含 `index.tsx` + `styles.module.scss`
- 引入必须是 `import styles from './styles.module.scss'`，禁止全局样式
- 唯一例外：渲染进程入口 `src/render/main.tsx` 引入的 `styles/global.scss`（CSS 变量、reset、主题 token）与 `styles/animation.scss`，组件内禁止新增全局样式
- 多行输入框一律不显示右下角拖拽手柄（`global.scss` 的 `textarea { resize: none }`；需要变高用 `field-sizing: content` / `min-height`），`test/render/styles/textarea-resize.test.ts` 检查没有组件重新打开 resize
- 表单控件：下拉一律用 `components/Select`（自绘 combobox + listbox，支持键盘、首字跳转、分组），数字一律用 `components/NumberInput`（role="spinbutton" + − / + 步进、失焦夹取），禁止原生 `<select>` 与 `<input type="number">`；`className` 只管布局，外观由组件统一提供。测试用 `test/render/helpers/select.ts` 的 `chooseOption`，E2E 用 `e2e/support/select.ts` 的 `chooseSelectOption`
- 复选框一律用 `components/Checkbox`（视觉隐藏的真实 checkbox + 自绘方框，支持 indeterminate、说明文字），「开 / 关」类设置用 `components/Switch`（role="switch" + aria-checked）；禁止在组件里直接写原生 `<input type="checkbox">`，`test/render/styles/no-native-checkbox.test.ts` 会扫描检查。单测照常用 `getByRole('checkbox' | 'switch', { name })`；E2E 的定位器只认可见元素，真实 input 是透明的，点击自绘方框（`input + span`）或标签文字，状态读 input 的 `checked` / `aria-checked`（见 `e2e/settings-controls.e2e.ts`）

### 组件与文件体量

- 单个文件建议不超过 ~600 行；超过时按职责拆分为子组件、`useXxx` hooks 和纯函数工具
- `App.tsx` 只作为组合根，业务逻辑放到 hooks / utils 中

### Lint & Format

- ESLint: `@typescript-eslint/no-explicit-any` 为 error；未使用变量为警告（前缀 `_` 可忽略）
- Prettier: 单引号、尾逗号 (es5)、100 字符宽度、2 空格缩进
- 注释使用中文
- `.npmrc` 已加入 gitignore（包含本机代理配置，不应提交）

### 开发命令

在仓库根目录执行（根脚本通过 `pnpm --filter` 转发到对应 app）：

- `pnpm install`: 安装依赖（`apps/pc` 的 postinstall 会对 better-sqlite3 执行 electron-rebuild）
- `pnpm dev`: 开发模式。concurrently 并行启动: (1) Vite 开发服务器 `127.0.0.1:5173` 提供渲染进程; (2) wait-on 等待 5173 端口就绪后，nodemon 监听 `src/main` 变化，重新构建 main + preload 并重启 electron
- `pnpm start`: 直接启动 electron 应用（需先执行 build）
- `pnpm build`: 按顺序构建所有目标（main → preload → renderer）
- `pnpm package`: 生产构建 + electron-builder 打包为可分发安装包
- `pnpm lint` / `pnpm lint:fix`: ESLint 检查 / 自动修复
- `pnpm format`: Prettier 格式化 apps 与 packages 下的 ts/tsx/css/scss
- `pnpm typecheck`: 对所有 workspace 包执行 `tsc --noEmit`
- 测试只有三个入口，全部由 Vitest 直接运行，不用 shell 串联命令：
  - `pnpm test:ut`: 全部单元 / 组件测试，**默认输出覆盖率**（终端摘要 + `coverage/` HTML 报告）
  - `pnpm test:e2e`: GUI 端到端测试 + 打包产物烟雾测试（见下文「E2E 测试」），应用构建在 Vitest globalSetup 中通过 Vite API 完成
  - `pnpm test:pc-updater`: 只跑自动更新状态机测试（发布预检使用）
  - 过滤 / 调试直接透传 Vitest 参数，例如 `pnpm test:ut apps/pc/test/main`、`pnpm test:e2e -t "成长"`；监听模式用 `pnpm exec vitest`
- 测试产物自动清理：每次运行前 globalSetup 清空上次的测试临时目录（`<系统临时目录>/novel-editor-tests/{ut,e2e}`，用例里的 `os.tmpdir()` 已自动指向这里，Electron 子进程同样继承）与 `apps/pc/e2e/.artifacts/`；覆盖率报告由 `coverage.clean` 自动清空。新增测试的临时文件直接用 `os.tmpdir()` 即可，不要写到其他位置
- `pnpm clean`: 清理各包构建产物与 node_modules
- `pnpm preflight:release`: 发布前预检（自动更新状态机测试 + 打包检查）
- `pnpm release:canary` / `release:canary:minor`: 发布 alpha 金丝雀版本（如 1.1.0-alpha.0）
- `pnpm release:beta`: 递增 beta 版本号并推送 tag 触发发布（如 1.1.0-beta.0 → 1.1.0-beta.1）
- `pnpm release:minor`: 创建新的 minor beta 版本并推送 tag 触发发布（如 1.0.0 → 1.1.0-beta.0）
- `pnpm release:stable`: 升级 minor 正式版本并推送 tag 触发发布（如 1.1.0-beta.3 → 1.1.0）

`apps/pc` 内的细分命令：`build:main` / `build:preload` / `build:renderer` / `build:prod` / `rebuild:native`

### E2E 测试

轻量 GUI 端到端测试，不依赖 Playwright / WebdriverIO，零新增依赖：

- 运行器: Vitest，独立配置 `vitest.e2e.config.ts`（node 环境、串行、较长超时），只收集 `apps/pc/e2e/**/*.e2e.ts`；`pnpm test:ut` 不会执行这些用例
- 运行 E2E 前请先停止 `pnpm dev`：它的 nodemon 会重建 `apps/pc/dist` 并重启 Electron，与 E2E 争用构建产物和 CPU，导致偶发超时（globalSetup 检测到 5173 端口被占用时会打印警告）
- 构建: `vitest.e2e.global-setup.ts` 通过 Vite `build()` API 依次构建 main / preload / renderer；`apps/pc/dist` 比所有源码都新时自动跳过；`NOVEL_EDITOR_E2E_SKIP_BUILD=1` 强制跳过（发布流程已用生产配置构建过 dist 时使用）
- 打包产物烟雾测试: `apps/pc/e2e/packaged-smoke.e2e.ts` 带 `--smoke-test` 启动 `apps/pc/build` 中的可执行文件，存活 5 秒或正常退出即通过；没有打包产物时自动跳过。发布流程与 `preflight:release` 用 `pnpm test:e2e apps/pc/e2e/packaged-smoke.e2e.ts` 单独运行
- 驱动: `apps/pc/e2e/support/` 下的极简 CDP 客户端（Node 24 内置 `WebSocket` + `fetch`）
  - `app.ts`: 用 `apps/pc/node_modules` 中的 electron 启动 `dist/main.mjs`，附加 `--remote-debugging-port=<空闲端口>`，最后一个参数是临时 fixture 项目目录（由 `launch-folder.ts` 打开）；环境变量 `NOVEL_EDITOR_E2E=1`（复用烟雾测试的 userData 隔离 `NOVEL_EDITOR_SMOKE_TEST_USER_DATA_DIR`，但就绪后不自动退出）、`NOVEL_EDITOR_DISABLE_AUTO_UPDATER=1`；附加 `--disable-renderer-backgrounding` 等参数并关闭窗口 `backgroundThrottling`（窗口被遮挡时 Chromium 会节流定时器、暂停 rAF，曾导致用例偶发变慢 / 超时）；结束时整组杀进程并删除临时目录
  - `page.ts`: `evaluate` / `waitFor` / `waitUntil`（轮询磁盘等 Node 侧条件）/ `click`（按 CSS 选择器或可见文本定位，`Input.dispatchMouseEvent` 真实点击元素中心）/ `doubleClick`（clickCount 1 → 2，触发 dblclick）/ `type`（`Input.insertText`，适合中文）/ `press`（`Input.dispatchKeyEvent`）/ `screenshot`；同时收集 `console.error`、未捕获异常与 Log 错误
  - `workbench.ts`: 本应用的高层操作（作品切换 `selectWork` / `currentWork`、打开「⋯」项目菜单 `openProjectMenu` / 菜单「刷新」`refreshWorkspace`、打开「项目说明」列表 `openProjectDocs`、行内重命名 `renameByDoubleClick` / `commitInlineRename`、顶部按钮顺序 `workspaceHeaderButtons`、展开文件树、打开章节、读编辑器内容、状态栏统计、Prompt/确认对话框、右键菜单、右侧面板视图切换）
  - `fixture.ts`: 每次运行把示例作品集 `apps/pc/sample-data` 完整拷贝到临时目录（跳过本机数据库等运行产物，可用 `exclude` 去掉某些路径）；`FIXTURE_CHAPTERS` / `FIXTURE_CHAPTER_TREE` 指向其中的「星河旅人 / 第一卷-离乡」（先用 `selectWork` 在作品切换器选中 `FIXTURE_WORK`，正文树只有当前作品的 卷 → 章，没有 novels / 作品 / 未分卷 层级）；`FIXTURE_MATERIAL_DIR` / `FIXTURE_MEMORY_DIR` 是星河旅人自己的 `资料/`、`资料/记忆/`
  - `suite.ts`: `setupAppSuite()` 为一个 `*.e2e.ts` 注册启动 / 关闭、失败截图、控制台错误检查；另有 `openChapter`、`captureForReview`、成长档案选择器等通用操作
- 场景: `apps/pc/e2e/app.e2e.ts` 共用一个 Electron 实例顺序执行（启动、示例作品集开箱即用（欢迎使用、预置成长档案、种子人物 / 设定、幕剧、章纲）、编辑与自动保存、撤销重做、文件新建/重命名/删除、字数统计、右侧「大纲」面板与专注模式（渐进淡化、隐藏滚动条、点击 / 方向键后光标行居中）、灵感抽签（文件栏「灵感」胶囊可见且在最左 → 抽一签 → 插入）、卷纲（零输入推导星河旅人第一卷的 幕 / 场、总览条与汇总、节拍图标 Tooltip、结构菜单、生成卷纲给出 3 种方案，人物线显示林舟）、设定（多级目录、标签、图集）、GUI 与 CLI 共享写作日志和会话状态、关于小窗口、资料长文件名、Markdown 实时渲染（排版示例.md：公式 / 表格渲染、坏公式隔离、光标处显示源码、文件头没有「源码 / 实时预览」切换）、复杂公式（公式示例.md：大量公式渲染、恰好一个错误标记、超宽公式横向滚动）、小说格式示例.md（场景条、视频卡片、示例路径找不到时的标记）、资料图片右键「在编辑器旁边打开」参考窗格、章纲「怎么用」、人物总览卡片与「关系」分页、正文搜索、单实例转发）；`sample-showcase.e2e.ts` 走一遍示例展示（声音示例.md 的音频播放条真正播放、在旁边听；从资料打开预先做好的场景视频：镜头 / 声音标记 / 首帧 / 成片 / 预演 / 样片 / 检查器；Starbound 英文章 / 幕 / 场标题；人物声音）；`growth.e2e.ts` 用去掉 `novels/星河旅人/资料/记忆/` 的示例验证成长档案首次使用（开始使用、新建成长卡、引导、记一笔、提醒、总览、记忆库同步、人物详情：竖版形象图、人物设计保存、图集、在「成长档案」分页里建卡）；`first-launch.e2e.ts` 验证首次启动自动打开示例数据并写入种子人物；`sample-upgrade.e2e.ts` 验证本机旧版示例被备份并升级为新版；`editor-ai.e2e.ts` 用本地 mock 的 OpenAI 兼容 SSE 服务（配置为 Grok）验证人物悬停卡片（林舟 Lv.4）、`Alt+\` 行内续写（流式 → Tab 采纳 → 保存并计入写作日志 → 一次撤销回退）、续写面板（生成建议 → 查看上下文 → 放弃后正文不变）；`reference-pane.e2e.ts` 验证参考窗格（小说格式示例.md 上「参考」含 离港 视频与图片并按来源分组、拖动排序、资料树拖入、「在资料中定位」滚动并高亮、覆盖磁盘图片后自动刷新、经 `NOVEL_EDITOR_E2E_SAVE_PATH` 导出 MP4 / PNG / JPEG）；`scene-video.e2e.ts` 用本地 mock 文本 / 视频服务验证场景视频画布（选中一场 → 自动拆分镜 → 生成镜头 → 落盘到资料 → 预览），以及人物节点「缺三视图」、成片「在旁边看」（参考窗格 / 小卡片）、3D 预演（mock 文本服务识别预演提示词返回 PrevizScript → 生成 → 自动播放 → 保存预演视频，落盘 `镜头1-预演.mp4` + `镜头1-预演.png`，检查器播放；mock 预演脚本里林舟的关键帧带 AI 写的关节轨迹（右手挥手 `motion.tracks`），断言提示词列出木偶关节与轨迹格式、`分镜.json` 的 previzScripts 带这段轨迹；没有 WebGL / 编码器的环境只验证提示）
- 示例项目的作品名来自 `seed.json`（「示例作品集」），标题栏显示它而不是临时目录名
- 新增场景: 在 `app.e2e.ts` 里加一个 `it`，开头自行把界面带到需要的状态（`openChapter`、`ensureRightPanelOpen` 等），结尾还原对 fixture 的修改；优先用 `aria-label` / `title` / `role` / 可见文本定位，确需稳定选择器时再给组件加 `data-testid`；不同 Electron 实例或需要干净状态的场景放到新的 `*.e2e.ts` 文件
- 控制台: 每个用例结束时若出现非预期的控制台错误或未捕获异常会直接失败；确属可接受的错误加到 `ALLOWED_ISSUES` 并注明原因
- 调试: 失败时自动把截图（`*.png`）和主进程 stdout/stderr（`*.log`）写入 `apps/pc/e2e/.artifacts/`（已 gitignore，CI 失败时作为 artifact 上传）；设置 `NOVEL_EDITOR_E2E_VERBOSE=1` 可实时输出主进程日志；可用 `pnpm test:e2e -t "<用例名>"` 过滤；`NOVEL_EDITOR_E2E_TRACE=1` 打印每个等待的耗时（用例共享同一窗口状态，单独运行靠后的用例时可能需要连同前置用例一起跑）
- 注意: macOS 上 `Cmd+A` 等依赖原生菜单的编辑命令不会被 CDP 按键触发，输入框全选请用 `input.select()`；快捷键作用于当前焦点元素，点击过按钮后需先把焦点还给编辑器

### 示例作品集（sample-data）

`apps/pc/sample-data` 是唯一的示范项目：首次启动时拷贝到「文稿/Novel Editor/sample-data」并自动打开，GUI E2E 也直接拷贝它作为 fixture。改它就是改用户第一眼看到的内容，同时也是改测试数据。

- **版本与升级**：`.novel-editor/sample.json` 的 `sampleVersion` 标记示例版本。用户首次打开时示例被拷贝到「文稿/Novel Editor/sample-data」；之后每次启动（以及打开示例前）若内置版本更高，旧副本会整体改名备份为 `sample-data-旧版-<时间>`（保留用户改动与数据库），再拷贝新版并提示一次备份位置（core `syncSeededDirectory`）。**修改示例内容后必须递增 `sampleVersion`**，否则老用户看不到新内容
- **内容指纹**：`sample.json` 还记录 `contentHash`（对除 sample.json 与本机运行产物（core `isSeedRuntimeArtifact`）外的全部文件，按相对路径排序后对「路径 + 字节」做 sha256，文本文件按 LF 计算）。`sample-data.test.ts` 重新计算，不一致时失败并提示「示例内容已变更，请递增 sampleVersion 并更新 contentHash」。改完示例（包括运行 generate-sample-data.mts 之后）执行 `pnpm exec tsx apps/pc/scripts/sample-content-hash.mts --bump`（递增版本并刷新指纹；`--write` 只刷新指纹，不带参数只检查）。core `readSeedVersion` / `syncSeededDirectory` 只读 `sampleVersion`，忽略 `contentHash`
- 结构遵循 `ne init`，资料跟随作品（v3）：`.novel-editor/config.json`（作品集名「示例作品集」）、`novels/星河旅人/第一卷-离乡|第二卷-星海/00N-*.md`（6 章，正文带「第X幕 / 第X场」供幕剧演示）、`novels/星河旅人/资料/`（设定笔记）、`novels/星河旅人/资料/素材/`（成对的 `xxx` / `xxx-alt` 媒体，演示预览与版本对比）、`novels/星河旅人/资料/文档示例/`（docx / pptx / xlsx，含一个故意损坏的 docx）、`novels/星河旅人/资料/记忆/`（成长档案：林舟 / 苏晴）、`novels/剑与诗/`（2 章）与它自己的 `novels/剑与诗/资料/`（江湖风物.md）和 `资料/记忆/`（小规则之书 + 沈砚）；项目根没有 `资料/`、根目录 `欢迎使用.md`（功能导览，引用的路径都必须存在）、根目录 `排版示例.md`（Markdown 实时渲染演示，含一个故意写错的公式，E2E 依赖）、根目录 `公式示例.md`（复杂 LaTeX 演示，含一条故意写错的公式，E2E 与 `latex-demo.test.ts` 依赖）
- 人物 / 设定 / 大纲存在 SQLite 中，且按作品目录的绝对路径区分，不能随包分发数据库。改为 `.novel-editor/seed.json`（沿用全量导出的行结构，路径相对项目根）：`novels` 每部作品一条，`folder_path` 指向作品目录（如 `novels/星河旅人`，省略表示项目根 = 旧版单作品格式），内容行用 `novel_id` 归属作品（只有一部作品时可省略）。主进程 `db-init` 后调用 store `seedProjectData`，按作品判断：某作品目录还没有作品记录时才写入，绝不覆盖用户数据；任何带 seed.json 的项目都适用
- 示例图片与视频（《星河旅人》5 个人物的 `资料/图集/人物/<名>/形象图.webp`、`三视图.webp`，设定 星辉灯塔 / 星港城商会 的配图，`资料/视频/示例/离港.mp4`）由 `apps/pc/scripts/generate-sample-media.mjs` 程序化绘制（`scripts/sample-media/art.js` Canvas 插画 + WebCodecs H.264 + mp4-muxer；人物外观参数与人物设计文字在 `sample-media/characters.mjs`），运行 `pnpm exec electron scripts/generate-sample-media.mjs`（在 apps/pc 下）；seed.json 里人物的 `design` / `media` / `avatar` 与设定的 `cover` / `media` 由 generate-sample-data.mts 按同一份参数写入
- 各作品的 `资料/记忆/` 与 `seed.json` 由 `apps/pc/scripts/generate-sample-data.mts` 通过 core 成长记录器 API 生成（固定时间戳）。修改章节或成长事件后运行 `pnpm exec tsx apps/pc/scripts/generate-sample-data.mts`，不要手改这些文件
- 声音与场景视频示例（v9）：根目录 `声音示例.md`（`::audio` 播放 配乐 / 环境音 / 音效 / 对白占位音，`:::scene` + `:char` 的一场戏，场景视频里每种声音在哪里改）；`novels/星河旅人/资料/音乐/`、`资料/音效/`（程序合成的 AAC M4A）；预先做好的一场场景视频 `novels/星河旅人/资料/视频/001-启程/第一场 清晨的青石镇/`（5 个镜头、对白 / 音效 / 配乐 / 环境音、镜头 1 的预演脚本与预演、首帧、镜头 1 / 2 成片（带这一段的配乐 / 环境音 / 音效 / 对白混音）、配音占位音、带声音的样片，视频统一 1280×720 / 24 帧，H.264 用固定 QP 编码（`sample-media/scene-media.mjs` 的 `SHOT_QP`），预演视频是动作参考、不带声音；`分镜.json` 的 chapterPath 写相对作品目录的路径，GUI 按作品目录解析）；《星河旅人》人物带 `attributes.voice`；第三部作品 `novels/Starbound/`（英文 2 章，演示英文结构规则）。媒体由 `pnpm exec electron apps/pc/scripts/generate-sample-media.mjs [--only=images,video,audio,scene]`（在 apps/pc 下运行；镜头与文件名在 `scripts/sample-media/scene.mjs`，macOS 的 AAC 编码器 44.1kHz 单声道低于 48kbps 会卡死）生成，`分镜.json` / `分镜.md` 由 generate-sample-data.mts（`sample-data-scene.mts`，用 `@novel-editor/video` 的校验与命名函数）生成；`test/main/sample-scene.test.ts` 校验（含成片 / 样片的分辨率与 AAC 音轨，用极简 MP4 box 读取器）。场景视频相关 E2E（scene-video / scene-audio）用 fixture `exclude` 去掉这场，从零走流程
- `apps/pc/test/main/sample-data.test.ts` 校验：配置与卷章顺序、E2E 依赖的开篇文本、生成文件逐字节一致、成长数据规范化与一致性检查无警告、事件章节正文确实提到该角色、seed.json 可导入、资料 / 成长档案 / 人物与设定按作品隔离、欢迎使用.md 中的路径都存在、没有垃圾 / 空文件 / 运行产物、总体积 < 3MB（含场景视频与声音示例）、打包过滤规则
- 运行产物不进仓库也不进安装包：`.gitignore` 忽略 `sample-data/.novel-editor/*.db*`、`session.json`、`writing-log.json`；electron-builder `extraResources` 过滤同样排除它们和 `.DS_Store`；core `ensureSeededDirectory` 拷贝时也会跳过（`isSeedRuntimeArtifact`）。大文件性能测试请在测试中临时生成，不要放进示例

### CI

- `.github/workflows/ci.yml`: push / PR 时执行 lint → typecheck → test:ut（含覆盖率）→ build；通过后 `e2e` job 在 ubuntu 上用 `xvfb-run -a pnpm test:e2e` 跑 GUI 端到端测试（Linux CI 自动加 `--no-sandbox`），失败时上传 `apps/pc/e2e/.artifacts/`
- `.github/workflows/release.yml`: 推送 tag 后多平台（Windows/macOS/Linux × x64/arm64）打包，用 `pnpm test:e2e apps/pc/e2e/packaged-smoke.e2e.ts` 对打包产物做烟雾测试，再发布到 GitHub Release
- 发布与自动更新细节见 `docs/release-process.md`、`docs/version-management.md`

### CLI 命令

入口: `apps/cli/src/index.ts`，可执行文件名: `novel-editor`（或简写 `ne`）

参考 VS Code CLI 和 daemon 模式设计，所有输出支持 `--json` 格式化，方便 AI agent 解析调用。

- 实现: 命令层在 `apps/cli/src`（`parser.ts` 参数解析、`commands/*` 子命令、`daemon.ts` 守护进程），业务逻辑在 `packages/core`，不依赖 Electron
- 构建: `pnpm build:cli`（或 `pnpm --filter @novel-editor/cli build`）→ `apps/cli/dist/index.mjs`，`bin` 注册为 `novel-editor` 与 `ne`；源码调试用 `pnpm cli <args>`
- JSON 输出格式: 成功 `{ "ok": true, "data": ... }`，失败 `{ "ok": false, "error": { "code", "message", "hint?" } }`
- 退出码: 0 成功 / 1 通用错误（含 AI 服务错误 `AI_ERROR`，`message` 前缀为错误类别，如 `[auth]`）/ 2 用法错误 / 3 不存在 / 4 已存在 / 5 不在项目中 / 6 不支持或未找到 GUI / 7 daemon 未运行
- 未知命令/子命令/选项会给出「你是不是想输入」提示

#### 项目目录约定（`ne init` 生成，GUI 同样识别）

```
<project>/
├── .novel-editor/config.json        # schemaVersion、name、novelsDir、chapterExtension
├── .novel-editor/writing-log.json   # 写作日志（stats today/history 数据源，CLI/daemon 写入与 GUI 保存共同记录）
├── .novel-editor/session.json       # GUI 会话（打开的文件、当前文件、未保存文件、pid、updatedAt；ne status 读取）
├── .novel-editor/novel-editor.db     # GUI 数据库（一个项目一个库，每部作品一条 novels 记录）
├── novels/<作品名>/001-标题.md       # 每部作品一个目录，子目录视为「卷」，数字前缀决定章节顺序
├── novels/<作品名>/资料/             # 作品自己的资料（设定笔记、素材、AI 资料），不是卷
└── novels/<作品名>/资料/记忆/        # 作品的记忆库 / 成长档案
```

资料、成长档案、人物 / 设定 / 大纲 / 创意卡都**跟随作品**（core `work-scope.ts`，GUI 与 CLI 同一规则）：

- 作用域根：`ne init` 项目中是作品目录；普通文件夹（没有 config.json）整个文件夹就是一部作品（`<folder>/资料/`，与旧行为一致）
- 数据库：每部作品一条 novels 记录（`folder_path` = 作品目录），`*-by-folder` IPC 传作品路径即按作品读写；项目根的记录只承载版本快照与写作统计
- 旧版迁移（打开项目时，幂等）：项目根 `资料/` 在**只有一部作品且该作品还没有 `资料/`** 时整体移入该作品（core `migrateLegacyProjectMaterials`，GUI `refresh-folder` / CLI `ne growth` 都会执行）；项目根记录下的人物 / 设定 / 大纲等在**只有一部作品且该作品还没有内容**时整体改挂到该作品（store `migrateProjectContentToWork`，主进程 `db-init`）。其他情况（多部作品、作品已有内容）不做任何改动，旧数据作为「未归属」作用域（根目录 = 项目根）继续可见，GUI 作品切换器里可选，CLI 用 `--novel 未归属`

#### daemon

- `ne serve` 仅监听 `127.0.0.1`，使用 Bearer token 鉴权；状态文件（pid/port/token，权限 0600）位于 `<tmpdir>/novel-editor-cli/daemon.json`，可用 `NE_DAEMON_DIR` 覆盖
- 接口: `GET /ping`、`GET /commands`、`POST /rpc { argv, cwd?, stdin? }`、`POST /shutdown`；`serve` / `shutdown` / `open` 不允许通过 RPC 调用
- `ne open <path>`: 拉起已安装的 GUI（可用 `NOVEL_EDITOR_APP` 指定路径）；GUI 已运行时通过单实例锁把目录转发给现有窗口

#### 项目/工作区

```bash
ne init [path]                  # 初始化新项目（创建目录结构、配置文件）
ne open <path>                  # 用 GUI 打开指定文件夹/项目
ne status                       # 输出当前项目状态（作品/字数、今日写作、GUI 打开的文件与未保存变更、daemon）
```

- GUI 正文树与 CLI 同一口径：打开带 `.novel-editor/config.json` 的文件夹时，主进程 `refresh-folder` / `open-local-folder` 附带 core `readProjectLayout`（novelsDir + 作品列表），渲染进程 `utils/storyStructure.ts` 据此展示「作品 / 卷 / 章」（不显示 novels 容器），根目录文档（欢迎使用.md、README.md）在文件面板顶部「搜索」左侧的「项目说明」图标里（`FilePanel/ProjectDocsButton`：悬停像公告一样列出文档名，有没看过的文档时带提示点（按项目记住已看过的列表，localStorage），点击弹出列表，没有根目录文档时不显示），不计章数、不启用章节助手、不计入写作日志（core `isProjectDocumentPath`）；普通文件夹沿用按名称推断卷的规则，只把 README / 欢迎使用 这类说明文档（或子目录装着章节时根目录的非章节文档）视为项目文档。命名与排序（序号前缀、中文数字卷名）在 `packages/core/src/story-layout.ts`，GUI 通过 `@novel-editor/core/story-layout` 引入
- `ne status` 读取 `<project>/.novel-editor/session.json`（core `readGuiSession`）：GUI 渲染进程经 `gui-session-publish` IPC 防抖（500ms）上报打开的标签、当前文件、未保存文件，并每 60 秒心跳刷新；主进程补全 pid/版本/时间后写入。窗口销毁、切换文件夹时标记 `closed`
- `--json` 下 `data.gui = { status, reason?, pid, appVersion, updatedAt, activeFile, openFiles, unsavedFiles }`；`status`: `active`（GUI 正在使用）/ `closed`（已关闭）/ `stale`（`reason`: `pid-not-alive` 进程已退出，或 `outdated` 超过 5 分钟未刷新）/ `none`（从未打开）。路径相对项目根，未命名标签为 `__untitled__:<名称>`
- 未 `ne init` 的文件夹被 GUI 打开时，会话文件位于该文件夹的 `.novel-editor/`，在该目录执行 `ne status` 同样能看到

#### 文件操作

```bash
ne file list <path>             # 列出目录下的文件树
ne file read <file>             # 读取文件内容输出到 stdout
ne file write <file> [--stdin]  # 写入文件（从参数或 stdin）
ne file create <file>           # 创建新文件
ne file delete <file>           # 删除文件
ne file search <pattern> [path] # 在文件中搜索内容（支持 glob/regex）
ne file rename <old> <new>      # 重命名/移动文件
```

#### 批量操作

```bash
ne batch export <path> --format=txt|md|docx  # 批量导出指定格式
ne batch convert <path> --from=md --to=txt   # 批量格式转换
ne batch find-replace <pattern> <replacement> [path]  # 批量查找替换
```

#### 作品管理

```bash
ne novel list                   # 列出所有作品
ne novel info <name>            # 查看作品详情（章节数、总字数等）
ne novel create <name>          # 创建新作品
ne novel export <name> --format=txt|md|docx  # 导出整部作品
```

#### 章节管理

```bash
ne chapter list <novel>         # 列出作品的所有章节
ne chapter create <novel> <title>  # 新建章节
ne chapter reorder <novel>      # 调整章节顺序
ne chapter merge <novel> <from> <to>  # 合并章节
```

#### 正文结构规则

```bash
ne structure list                               # 预设开关与自定义规则（配置文件位置）
ne structure test <line…> [--stdin]             # 每行识别为 章 / 幕 / 场 / 正文（及命中的规则）
ne structure add --kind chapter|act|scene --pattern "<regex>" [-i] [--id x]   # 添加自定义规则（安全校验同 GUI）
ne structure remove <id>                        # 删除自定义规则
ne structure preset --enable en --disable numbered   # 开关预设（zh / en / numbered）
```

- 与 GUI「设置 → 正文结构」读写同一份配置（项目根的 config.json；不在项目中时为向上找到的 `.novel-editor/structure.json`，否则当前目录）；`ne lint` 与 `ne stats`（`data.structure = { chapters, acts, scenes }`）按这份规则识别结构行

#### 统计

```bash
ne stats [file|novel]           # 输出字数、行数、段落数等统计
ne stats today                  # 今日写作统计（字数、时间）
ne stats history [--days=7]     # 历史写作统计
```

- `stats today` / `stats history` 的数据源是 `<project>/.novel-editor/writing-log.json`（core `writing-log.ts`，CLI 与 GUI 共用同一实现）：
  - CLI：`file write`、`chapter create` 等写入类命令（`recordProjectWrites`）
  - GUI：主进程 `write-file` 每次成功保存正文文件后（`recordStoryFileSave`），用保存前磁盘内容与新内容的字数差（与状态栏同一口径，不计空白）记录；内容未变化不记录；只读当前文件，不扫描项目，日志写入不阻塞保存
  - 只统计正文文件（.md/.markdown/.txt），排除 `资料/`（项目根与各作品的 `<作品>/资料/`）与 `.novel-editor/`；项目根按 `.novel-editor/config.json` 向上查找，GUI 打开的文件夹未 `ne init` 时回退到该文件夹（`ne init` 后 CLI 即可读取）
  - 写作时长为估算：同一天相邻两次写入间隔不超过 10 分钟即计入（GUI 自动保存 2 秒一次，持续输入会被连续计时）
- SQLite `writing_stats` 表与 `db-stats-*` IPC 为历史遗留，GUI 未使用；跨工具的每日写作统计以 writing-log.json 为唯一数据源

#### AI 续写 / 场景分镜

```bash
ne ai continue <file> [--provider grok] [--chars N] [--length sentence|paragraph|long]
               [--direction continue|conflict|wrap-up|<文字>] [--cursor N] [--outline <file>]
               [--budget N] [--no-memory] [--prompt-only]   # 流式输出续写（不写回文件）
ne video storyboard <file|--stdin> [--ratio 16:9] [--style 水墨] [--characters a:外貌,b]
               [--min-shots 3 --max-shots 6] [--out board.json] [--prompt-only]
                                                      # 场景 → 分镜（Markdown 分镜表 / --json）
ne video validate <file|--stdin> [--ratio] [--out]    # 校验 AI 返回的分镜 JSON
```

- Key 来自环境变量 `NOVEL_EDITOR_<PROVIDER>_API_KEY`（CLI 不保存密钥）；没有 Key 或 `--prompt-only` 时输出 systemPrompt / prompt（分镜另有 schema），供 AI agent 执行
- `ai continue` 的上下文与 GUI 同一实现（`@novel-editor/ai`）：前文 + 可选章纲文件 + 文件所属作品记忆库的核心规则与成长档案；人类可读模式边生成边输出，`--json` 返回清理后的 `data.text`；Ctrl+C 取消
- 视频生成需要异步任务队列与落盘，只在 GUI 中进行

#### 应用控制（daemon 模式）

```bash
ne serve                        # 启动 headless daemon（不开 GUI），暴露 IPC/HTTP 接口供 AI 调用
ne ping                         # 检查 daemon 是否在运行
ne shutdown                     # 关闭 daemon
ne version                      # 输出版本信息
ne update [--check|--install]   # 检查/安装更新
```

#### 全局选项

```bash
--json                          # 所有输出以 JSON 格式返回（AI 友好）
--verbose / -v                  # 详细输出
--quiet / -q                    # 静默模式，只输出结果
--config <path>                 # 指定配置文件路径
--cwd <path>                    # 指定工作目录
```

## 成长记录器 / 记忆库

对应「建议 1」（角色属性、升级成长、技能经验、地图与队友记录、二选一/三选一的 AI 推演、作者核心规则）与「建议 2」（记忆资料单独放一个文件夹）。

- 数据源: 作品的 `<作品>/资料/记忆/` 下的 JSON 文件（记忆库跟随作品；普通文件夹为 `<folder>/资料/记忆/`，作用域规则见「项目目录约定」）（带 `schemaVersion`，旧版本自动迁移，高版本拒绝读写），GUI、CLI 与 AI agent 直接读写同一份文件；Markdown 均为派生文件，每次保存时重新生成
- 纯逻辑: `packages/core/src/growth/`（不依赖 Node/Electron，渲染进程通过 `@novel-editor/core/growth` 引入）；文件读写在 `growth/storage.ts`（仅主进程与 CLI 使用）
- GUI: `RightPanel/GrowthView/` 只用于工作区标签（`__workspace__:growth` 总览、`__workspace__:growth:<角色名>` 单个角色，宽布局；右侧面板不再有「成长」视图）；**成长档案属于人物**：文件面板没有单独的「成长档案」分区，「角色」分区（`FilePanel/CharacterSection`）每个人物行带封面头像与等级徽章，单击打开人物详情（「成长档案」分页嵌入该人物的成长卡）；只有成长卡、没有人物卡的条目列在「只有成长档案」里；分区头部有使用说明、人物总览（人物 / 成长 / 关系分页）、新建人物。入口还有快捷键 `Mod+Shift+J`。索引与打开动作在 `hooks/useGrowthEntry.ts`，各视图写入后通过 `growth-memory-changed` 事件互相刷新（`utils/growthIndex.ts`）。主进程通道 `growth-*`（`main/handlers/growth.ts`）与 `memory-sync-snapshots`（`main/handlers/memory.ts`）
- 规则之书（成长卡「世界 → 规则」，`GrowthView/GrowthRulesPanel/`）是完整的可视化编辑器，按分区可折叠：规则名称 / 说明、核心规则（文字 + 可选自动校验 `max-level` / `max-attribute` / `max-skill-level` / `forbid-skill` / `require-choice-by-level`，参数用 Select / NumberInput，可限定角色）、属性（名称、键名、初始 / 最小 / 最大、每级成长、每级上限、说明，上移 / 下移）、等级曲线（经验表逐级编辑 / 公式 基础经验 × 倍率 + 前 10 级实时预览，最高等级）、技能（名称、说明、最高等级决定每级升级经验格数、前置条件：角色等级 / 前置技能及最低等级 / 属性下限、互斥组：选已有或「新建互斥组…」）、能力抉择（名称、选几项、建议等级、选项名称 / 说明 / 奖励：属性加成行 + 获得技能）、战力限制。新条目 id 一律按序号生成（`attr-N` / `skill-N` / `choice-N` / `option-N` / `rule-N`，不从名称推导）；已保存的属性键名只读（成长卡按键名记数值）。改动先进草稿（`useRulesDraft`），字段旁实时显示 core `validateRuleset` 的错误 / 提醒（分区标题带错误数），顶部「有未保存的更改」条：撤销更改 / 保存（有错误时禁用），保存经 `growth-save-ruleset`（主进程 `normalizeRuleset` 拒绝更高 schemaVersion，再 `validateRuleset` 有 error 时拒绝写入）后广播 `growth-memory-changed`。删除属性 / 技能 / 抉择 / 选项时若有成长卡或规则内部引用（core `findRulesetUsage`），先就地确认，删除后用 `removeFromRuleset` 清理前置条件 / 奖励 / 自动校验。规则为空时显示「从 DND 模板开始」/「从空白开始」。纯函数在 core `growth/ruleset-edit.ts`（id、曲线预览、奖励行映射、引用检查）与 `growth/ruleset-validate.ts`；原始 JSON 编辑仍只在 `NOVEL_EDITOR_DEBUG=1` 下显示。测试：`packages/core/test/growth-ruleset-edit.test.ts`、`apps/pc/test/render/growth/GrowthRulesPanel*.test.tsx`、`test/main/growth-handlers.test.ts`、E2E `apps/pc/e2e/growth-rules.e2e.ts`
- AI 推演只产出提案：GUI 用设置中心配置的 AI 执行；CLI 不保存 AI Key，只输出 prompt 与 JSON schema，由驱动 CLI 的 AI agent 执行后再 `apply-sim`。作者确认「采用此分支」之前不会写入任何数据
- 生成资料清理逻辑（`cleanup-empty-generated-material-directories`，core `cleanupEmptyWorkMaterialDirectories`）只处理项目根与各作品 `资料/` 下的 AI资料/项目上下文/卷上下文/章上下文 空目录，不会删除 `资料/记忆/`

```
资料/记忆/
├── 规则.json            # 属性定义（范围/每级成长/每级上限）、等级经验曲线（表或公式）、技能（消耗/前置/互斥组）、
│                        # 能力抉择（二选一/三选一及奖励）、核心规则（文字 + 可选自动校验）、战力限制
├── 角色/<角色名>.json   # 成长卡：等级、累计经验、属性、技能（等级+技能经验）、抉择、事件日志、状态备注
├── 角色/<角色名>.md     # 成长卡可读摘要（派生）
├── 队伍.json            # 曾经组过的队伍（成员、起止章节）+ 配角最近出场章节（重点配角标记）
├── 地图.json            # 地点（区域/上级/描述/首次出现）与角色到访记录
├── 角色卡/*.md          # 编辑器数据库人物卡快照（只读，「同步到记忆文件夹」生成）
├── 设定/*.md            # 编辑器数据库设定快照（只读）
└── README.md            # 总览 + 一致性提醒 + 被遗忘的配角（派生）
```

一致性检查（`ne growth check` / GUI 警告列表）覆盖：等级超上限或与经验不符、属性越界或超过「初始值 + 每级上限 × (等级-1) + 抉择奖励」、技能超过最高等级/前置未满足/互斥技能同时掌握、抉择超过可选数量、同一章内等级/属性/技能暴涨、可自动校验的核心规则（`max-level` / `max-attribute` / `max-skill-level` / `forbid-skill` / `require-choice-by-level`），以及超过 `forgottenAfterChapters` 章未出场的配角。

#### 成长记录器（growth）

```bash
ne growth init [--template dnd|blank] [--force]      # 创建 <作品>/资料/记忆/（--force 用模板覆盖 规则.json）
ne growth list                                        # 所有角色的等级、经验、距下一级
ne growth show <角色>                                 # 成长卡 + 一致性警告
ne growth exp <角色> <经验> [--chapter N] [--note]     # 记录经验，自动升级（角色卡不存在时自动创建）
ne growth level <角色> <±N>                           # 直接调整等级（传承、降级诅咒等）
ne growth attr <角色> <属性> <±N>                      # 调整属性（key 或名称）
ne growth skill <角色> <技能> [--levels N | --exp N]   # 学习/升级技能，或累积技能经验
ne growth choose <角色> <选择组> <选项>               # 记录二选一/三选一并发放奖励
ne growth note <角色> <文本> [--status]               # 成长备注（--status 同时写入状态备注）
ne growth rules [--add <文本>] [--remove <id>]        # 查看规则之书、增删核心规则
ne growth party list|add|end|seen|remove ...          # 队伍历史与配角出场（add <队名> --members a,b --from N）
ne growth map list|add|visit|remove ...               # 地点与足迹（visit <地点> <角色> --chapter N）
ne growth check [--chapter N] [--after N] [--strict]  # 战力一致性 + 被遗忘的配角（--strict 有错误时退出码 2）
ne growth simulate <角色> --choices a,b[,c] [--mode controlled|free] [--horizon N] [--rule "a;b"]
                                                      # 输出推演 prompt + 期望 JSON schema（交给 AI 执行）
ne growth apply-sim <角色> <file|--stdin> [--branch <id>] [--dry-run]
                                                      # 校验 AI 返回并试算各分支；指定 --branch 才写入
```

违反规则的写入默认被拒绝（退出码 2），加 `--force` 由作者负责强制写入，警告会保留在一致性检查中。

所有 `ne growth` 子命令都接受 `--novel <作品>`（`-n`）：记忆库跟随作品。省略时在作品目录中执行即为该作品，否则为项目中唯一的作品；项目有多部作品时报错（退出码 2）并提示 `--novel`；项目还没有作品时提示先 `ne novel create`；`--novel 未归属` 指项目根的旧版资料。普通文件夹（没有 `ne init`）整体是一部作品，不能使用 `--novel`（退出码 5）。

GUI 文件面板（`FilePanel`）顶部是作品切换器（`FilePanel/WorkSwitcher`：当前作品 + 下拉列表（章数）+「新建作品」），下面的正文（当前作品的卷 / 章）、角色（含成长档案）、设定、资料都只显示当前作品；头部「搜索」（`Mod+P`）输入关键词后用跨作品的分组结果列表替换整棵树（`FilePanel/SearchResults`，纯函数在 `FilePanel/search.ts`）：项目说明 / 正文 / 人物 / 设定 / 资料按名称匹配，「内容」为正文全文搜索（IPC `workspace-search-content`，`main/handlers/workspace-search.ts` 复用 core `searchContent`，只搜 .md / .txt、跳过隐藏目录，搜索根须在窗口工作区内），关键词高亮，↑ / ↓ / Enter 选择打开，Esc 关闭；关键词为空时照常显示完整面板；右侧面板、工作区标签（角色 / 设定 / 成长档案）、知识导出、AI 助手同样作用于当前作品。人物 / 设定列表与它所属的作品目录一起保存（`workspaceEntitiesPath`）：切换作品时列表异步重载，期间形象图 / 封面仍按旧作品目录解析，不会拿旧路径去新作品里读图。当前作品状态在 `useWorkspaceState`（`workScope` / `workScopePath`，纯函数在 `utils/workScope.ts`），切换与新建在 `hooks/useWorkScope.ts`：按项目记住上次选择（localStorage），打开另一部作品的章节时自动切换。根目录说明文档在顶部的「项目说明」图标（`FilePanel/ProjectDocsButton`）。设定分区（`FilePanel/LoreSection`）按设定的分类目录（`attributes.folder`，例如「地理/北境」，core `buildLoreFolderTree`）显示为可折叠的树，行内显示封面缩略图与 #标签；设定详情（`RightPanel/LoreEntryDetail`）：封面 + 标题 / 分类 / 目录（datalist 候选）/ 标签即时保存，分页 内容 / 图集 / 相关设定（同目录 > 共享标签 > 同分类）。设定扩展字段存 `world_settings.attributes`（JSON，store 迁移自动补列）。

文件面板顶部（`FilePanel/WorkspaceHeader`）：项目名（双击或 F2 行内重命名）｜项目说明、搜索、新建、⋯ 更多｜分隔线 + 折叠侧边栏（双左箭头，固定在最右端；右侧「大纲」面板的折叠按钮对称使用双右箭头、同样的尺寸 / 悬停样式与分隔线）。「⋯ 更多」（`FilePanel/ProjectMenu`）：在访达中显示（Windows「在资源管理器中显示」、Linux「在文件管理器中显示」，IPC `show-item-in-folder`，主进程只接受已存在的绝对路径）、重命名项目｜打开其他文件夹…、打开最近使用（展开列出 `get-recent-folders`，排除当前文件夹，点击走 `useProjectLoader.handleOpenFolderPath`，与应用菜单 / `open-folder-request` 共用）、刷新。键盘：触发器 Enter / Space / ↓ 打开并聚焦首项、↑ 聚焦末项；菜单内 ↑ / ↓ / Home / End 移动、→ 展开最近使用、← 收起、Esc 关闭并还焦点、Tab 关闭。项目说明不在菜单里，是「搜索」左侧的独立图标。重命名不再使用铅笔按钮：项目名、正文树（`StoryTreeNode`）、角色 / 设定（`ObjectItemRow`）、资料（`FileTree`）一律**双击名称**或选中行按 **F2** 进入行内编辑（共用 `components/InlineRenameInput`：Enter 提交、Esc 取消并把焦点还给行、失焦提交，空名称或未变化视为取消，输入框内的按键 / 点击不冒泡到行），单击仍是打开；右键菜单「重命名」保留（对话框）。渲染进程的重命名处理（`handleRename` / `handleRenameProject` / `handleRenameCharacterNode` / `handleRenameLoreNode`）传入新名称时直接提交，不传时弹出输入框。成长档案行没有重命名（core 尚无对应 API）
