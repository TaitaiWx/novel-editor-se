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

1. 前端: React 18 + TypeScript 5 + SCSS Modules，编辑器内核为 CodeMirror 6，图标使用 react-icons
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

### 关于 / 日志上传

- 关于窗口（`AboutDialog`，约 380px 小窗、不滚动）与设置中心「关于」分区共用 `components/AboutContent`，只展示：图标 + 名称 + 版本（通道徽标）、「首次运行 · 本次已运行」（主进程启动时间经 `get-about-info` 返回，每分钟刷新）、设备 ID（点击复制，提示「设备 ID 已复制」）、「上传日志」按钮。运行环境、数据目录等诊断信息不在界面展示，统一写进日志包的 `diagnostics.json`
- 更新通道（正式 / 测试 / 金丝雀）、检查更新与「崩溃时自动上传日志」开关在设置中心「通用 → 更新与诊断」（`AppSettingsCenter/UpdateGroup`）
- 日志上传在主进程 `src/main/log-upload/`：白名单打包（diagnostics.json + electron-log 日志 + 小状态文件，主目录脱敏为 `~`，绝不包含作品正文与 SQLite 数据库）→ 已配置地址时上传（`NOVEL_EDITOR_LOG_UPLOAD_URL` 或 `config.ts` 常量，默认为空）→ 未配置或失败时保存到「下载」目录并定位。崩溃钩子只在配置了地址且开关开启时上传，否则只保存到 `userData/crash-reports/`（最多 5 个），10 分钟最多一次，E2E / 烟雾测试下不安装
- 服务端接口约定（请求头、请求体、响应、大小限制、隐私）见 `docs/log-upload.md`；IPC 通道 `log-upload-run` / `log-upload-get-settings` / `log-upload-set-settings`（`main/handlers/log-upload.ts`）

### 应用菜单 / 快捷键

- 菜单模板在 `src/main/shortcuts/menuTemplate.ts`（纯函数，`registerAllShortcuts.ts` 负责 `Menu.setApplicationMenu` 与重建），参照 VS Code / Typora：
  - macOS：「小说编辑器」（关于、检查更新…、设置… ⌘,、服务、隐藏 / 隐藏其他 / 全部显示、退出）/ 文件 / 编辑 / 视图 / 窗口 / 帮助
  - Windows / Linux：没有应用菜单，设置… 与 退出 在「文件」末尾，检查更新… 与 关于 在「帮助」末尾
  - 文件：新建文件 ⌘N（与按键一致：新建未命名标签）、打开文件夹… ⌘O、打开最近使用 ▸（`recent-folders` 变化时自动重建，点击走 `open-folder-request`）、保存 ⌘S、另存为… ⇧⌘S、导出项目… ⇧⌘E
  - 编辑：撤销 / 重做 / 剪切 / 复制 / 粘贴 / 全选（原生 role）、查找 ⌘F；视图：切换侧边栏、切换右侧面板、专注写作、放大 / 缩小 / 实际大小、切换全屏（macOS ⌃⌘F；Win/Linux 不设加速键，F11 留给专注模式），开发模式另有 重新加载 / 开发者工具；窗口：最小化 ⌘M、缩放、前置全部窗口；帮助：快捷键说明、更新日志、上传日志…、问题反馈（GitHub issues），打包版本另有 切换开发者工具
- 所有名称用 `APP_DISPLAY_NAME`，菜单里不得出现 `app.name`（dev 下是 `@novel-editor/pc`）；不使用英文 role 菜单（`editMenu` / `fileMenu` 等），也不再有隐藏的「快捷键」菜单——每个快捷键都对应一个可见菜单项或渲染进程 keydown
- 一致性：菜单加速键与快捷键总览共用 `shortcuts/config.ts`（`getShortcutConfigs()`），`getAllShortcuts.ts` 只额外列出纯渲染进程按键；设置中心可自定义的「切换侧边栏 / 专注写作」由渲染进程经 `menu-sync-shortcuts` 同步到菜单（`useAppMenu`，主进程按白名单校验）。新增快捷键时同时改 config / 渲染进程 keydown / 总览，`test/main/app-menu.test.ts` 会校验菜单每个加速键都在总览中
- 渲染进程也处理的按键（⌘N / ⌘S / ⌘F / ⌘Z / ⌘Q 等）必须 `preventDefault`：Electron 只把渲染进程未处理的按键交给菜单，因此不会重复执行，焦点不在编辑器时由菜单兜底
- 菜单 → 渲染进程事件：`shortcut-*`、`menu-export-project`、`menu-open-about`，以及 `src/shared/app-menu.ts` 的 `APP_MENU_EVENTS`（设置、检查更新、视图切换、查找、快捷键说明、更新日志、上传日志），渲染进程统一在 `hooks/useAppMenu.ts` 处理；保存 / 另存为 / 查找作用于最近聚焦的编辑器（`TextEditor/active-editor.ts`）
- macOS 菜单栏标题来自 bundle 的 CFBundleName：打包时 `scripts/mac-localized-app-name.mjs`（electron-builder `afterPack`）在每个 `*.lproj` 写入 `InfoPlist.strings`，显示「小说编辑器」。不要改 `productName` 或用 `mac.extendInfo` 覆盖 CFBundleName——前者改变安装路径 / 更新产物，后者会让 Electron 找不到 `<名称> Helper.app` 而启动崩溃；`app.getName()` 与 userData 由 package.json 决定，不受影响。开发模式（`pnpm dev`）菜单栏标题固定为「Electron」（来自 node_modules 中 Electron.app 的 Info.plist），属预期，不要修改 node_modules

## 代码规范

### 路径别名

1. `@/` → `apps/pc/src/`（在 `apps/pc/vite.config.ts` 和 `apps/pc/tsconfig.json` 中同时配置）

### TypeScript

- 开启 `strict`，禁止出现 `any` 类型（ESLint `@typescript-eslint/no-explicit-any` 为 error）
- 第三方类型缺失时用 `unknown` + 类型收窄，或声明最小化的局部接口，不要用 `as any` 绕过
- 提交前必须通过 `pnpm typecheck`

### 样式

- 使用 SCSS Modules (`.module.scss`)
- 每个组件独立目录，包含 `index.tsx` + `styles.module.scss`
- 引入必须是 `import styles from './styles.module.scss'`，禁止全局样式
- 唯一例外：渲染进程入口 `src/render/main.tsx` 引入的 `styles/global.scss`（CSS 变量、reset、主题 token）与 `styles/animation.scss`，组件内禁止新增全局样式

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
  - `page.ts`: `evaluate` / `waitFor` / `waitUntil`（轮询磁盘等 Node 侧条件）/ `click`（按 CSS 选择器或可见文本定位，`Input.dispatchMouseEvent` 真实点击元素中心）/ `type`（`Input.insertText`，适合中文）/ `press`（`Input.dispatchKeyEvent`）/ `screenshot`；同时收集 `console.error`、未捕获异常与 Log 错误
  - `workbench.ts`: 本应用的高层操作（展开文件树、打开章节、读编辑器内容、状态栏统计、Prompt/确认对话框、右键菜单、右侧面板视图切换）
  - `fixture.ts`: 每次运行把示例作品集 `apps/pc/sample-data` 完整拷贝到临时目录（跳过本机数据库等运行产物，可用 `exclude` 去掉某些路径）；`FIXTURE_CHAPTERS` / `FIXTURE_CHAPTER_TREE` 指向其中的「星河旅人 / 第一卷-离乡」（正文树路径为 作品 → 卷，没有 novels / 未分卷 层级）
  - `suite.ts`: `setupAppSuite()` 为一个 `*.e2e.ts` 注册启动 / 关闭、失败截图、控制台错误检查；另有 `openChapter`、`captureForReview`、成长档案选择器等通用操作
- 场景: `apps/pc/e2e/app.e2e.ts` 共用一个 Electron 实例顺序执行（启动、示例作品集开箱即用（欢迎使用、预置成长档案、种子人物 / 设定、幕剧、章纲）、编辑与自动保存、撤销重做、文件新建/重命名/删除、字数统计、右侧面板与专注模式、GUI 与 CLI 共享写作日志和会话状态、关于小窗口、资料长文件名、单实例转发）；`growth.e2e.ts` 用去掉 `资料/记忆/` 的示例验证成长档案首次使用（开始使用、新建成长卡、引导、记一笔、提醒、总览、记忆库同步、人物详情入口）；`first-launch.e2e.ts` 验证首次启动自动打开示例数据并写入种子人物；`sample-upgrade.e2e.ts` 验证本机旧版示例被备份并升级为新版
- 示例项目的作品名来自 `seed.json`（「示例作品集」），标题栏显示它而不是临时目录名
- 新增场景: 在 `app.e2e.ts` 里加一个 `it`，开头自行把界面带到需要的状态（`openChapter`、`ensureRightPanelOpen` 等），结尾还原对 fixture 的修改；优先用 `aria-label` / `title` / `role` / 可见文本定位，确需稳定选择器时再给组件加 `data-testid`；不同 Electron 实例或需要干净状态的场景放到新的 `*.e2e.ts` 文件
- 控制台: 每个用例结束时若出现非预期的控制台错误或未捕获异常会直接失败；确属可接受的错误加到 `ALLOWED_ISSUES` 并注明原因
- 调试: 失败时自动把截图（`*.png`）和主进程 stdout/stderr（`*.log`）写入 `apps/pc/e2e/.artifacts/`（已 gitignore，CI 失败时作为 artifact 上传）；设置 `NOVEL_EDITOR_E2E_VERBOSE=1` 可实时输出主进程日志；可用 `pnpm test:e2e -t "<用例名>"` 过滤；`NOVEL_EDITOR_E2E_TRACE=1` 打印每个等待的耗时（用例共享同一窗口状态，单独运行靠后的用例时可能需要连同前置用例一起跑）
- 注意: macOS 上 `Cmd+A` 等依赖原生菜单的编辑命令不会被 CDP 按键触发，输入框全选请用 `input.select()`；快捷键作用于当前焦点元素，点击过按钮后需先把焦点还给编辑器

### 示例作品集（sample-data）

`apps/pc/sample-data` 是唯一的示范项目：首次启动时拷贝到「文稿/Novel Editor/sample-data」并自动打开，GUI E2E 也直接拷贝它作为 fixture。改它就是改用户第一眼看到的内容，同时也是改测试数据。

- **版本与升级**：`.novel-editor/sample.json` 的 `sampleVersion` 标记示例版本。用户首次打开时示例被拷贝到「文稿/Novel Editor/sample-data」；之后每次启动（以及打开示例前）若内置版本更高，旧副本会整体改名备份为 `sample-data-旧版-<时间>`（保留用户改动与数据库），再拷贝新版并提示一次备份位置（core `syncSeededDirectory`）。**修改示例内容后必须递增 `sampleVersion`**，否则老用户看不到新内容
- 结构遵循 `ne init`：`.novel-editor/config.json`（作品集名「示例作品集」）、`novels/星河旅人/第一卷-离乡|第二卷-星海/00N-*.md`（6 章，正文带「第X幕 / 第X场」供幕剧演示）、`novels/剑与诗/`、`资料/`（设定笔记）、`资料/素材/`（成对的 `xxx` / `xxx-alt` 媒体，演示预览与版本对比）、`资料/文档示例/`（docx / pptx / xlsx，含一个故意损坏的 docx）、`资料/记忆/`（成长档案）、根目录 `欢迎使用.md`（功能导览，引用的路径都必须存在）
- 人物 / 设定 / 大纲存在 SQLite 中，且按项目绝对路径区分，不能随包分发数据库。改为 `.novel-editor/seed.json`（沿用全量导出的行结构，路径相对项目根）：主进程 `db-init` 后调用 store `seedProjectData`，仅当该目录还没有作品记录时写入，绝不覆盖用户数据；任何带 seed.json 的项目都适用
- `资料/记忆/` 与 `seed.json` 由 `apps/pc/scripts/generate-sample-data.mts` 通过 core 成长记录器 API 生成（固定时间戳）。修改章节或成长事件后运行 `pnpm exec tsx apps/pc/scripts/generate-sample-data.mts`，不要手改这些文件
- `apps/pc/test/main/sample-data.test.ts` 校验：配置与卷章顺序、E2E 依赖的开篇文本、生成文件逐字节一致、成长数据规范化与一致性检查无警告、事件章节正文确实提到该角色、seed.json 可导入、欢迎使用.md 中的路径都存在、没有垃圾 / 空文件 / 运行产物、总体积 < 2MB、打包过滤规则
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
- 退出码: 0 成功 / 1 通用错误 / 2 用法错误 / 3 不存在 / 4 已存在 / 5 不在项目中 / 6 不支持或未找到 GUI / 7 daemon 未运行
- 未知命令/子命令/选项会给出「你是不是想输入」提示

#### 项目目录约定（`ne init` 生成，GUI 同样识别）

```
<project>/
├── .novel-editor/config.json        # schemaVersion、name、novelsDir、chapterExtension
├── .novel-editor/writing-log.json   # 写作日志（stats today/history 数据源，CLI/daemon 写入与 GUI 保存共同记录）
├── .novel-editor/session.json       # GUI 会话（打开的文件、当前文件、未保存文件、pid、updatedAt；ne status 读取）
└── novels/<作品名>/001-标题.md       # 每部作品一个目录，子目录视为「卷」，数字前缀决定章节顺序
```

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

- GUI 正文树与 CLI 同一口径：打开带 `.novel-editor/config.json` 的文件夹时，主进程 `refresh-folder` / `open-local-folder` 附带 core `readProjectLayout`（novelsDir + 作品列表），渲染进程 `utils/storyStructure.ts` 据此展示「作品 / 卷 / 章」（不显示 novels 容器），根目录文档（欢迎使用.md、README.md）放在文件面板顶部「项目文档」分区，不计章数、不启用章节助手、不计入写作日志（core `isProjectDocumentPath`）；普通文件夹沿用按名称推断卷的规则，只把 README / 欢迎使用 这类说明文档（或子目录装着章节时根目录的非章节文档）视为项目文档。命名与排序（序号前缀、中文数字卷名）在 `packages/core/src/story-layout.ts`，GUI 通过 `@novel-editor/core/story-layout` 引入
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

#### 统计

```bash
ne stats [file|novel]           # 输出字数、行数、段落数等统计
ne stats today                  # 今日写作统计（字数、时间）
ne stats history [--days=7]     # 历史写作统计
```

- `stats today` / `stats history` 的数据源是 `<project>/.novel-editor/writing-log.json`（core `writing-log.ts`，CLI 与 GUI 共用同一实现）：
  - CLI：`file write`、`chapter create` 等写入类命令（`recordProjectWrites`）
  - GUI：主进程 `write-file` 每次成功保存正文文件后（`recordStoryFileSave`），用保存前磁盘内容与新内容的字数差（与状态栏同一口径，不计空白）记录；内容未变化不记录；只读当前文件，不扫描项目，日志写入不阻塞保存
  - 只统计正文文件（.md/.markdown/.txt），排除 `资料/` 与 `.novel-editor/`；项目根按 `.novel-editor/config.json` 向上查找，GUI 打开的文件夹未 `ne init` 时回退到该文件夹（`ne init` 后 CLI 即可读取）
  - 写作时长为估算：同一天相邻两次写入间隔不超过 10 分钟即计入（GUI 自动保存 2 秒一次，持续输入会被连续计时）
- SQLite `writing_stats` 表与 `db-stats-*` IPC 为历史遗留，GUI 未使用；跨工具的每日写作统计以 writing-log.json 为唯一数据源

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

- 数据源: `<project>/资料/记忆/` 下的 JSON 文件（带 `schemaVersion`，旧版本自动迁移，高版本拒绝读写），GUI、CLI 与 AI agent 直接读写同一份文件；Markdown 均为派生文件，每次保存时重新生成
- 纯逻辑: `packages/core/src/growth/`（不依赖 Node/Electron，渲染进程通过 `@novel-editor/core/growth` 引入）；文件读写在 `growth/storage.ts`（仅主进程与 CLI 使用）
- GUI: `RightPanel/GrowthView/` 同时用于右侧面板「成长」页签与工作区标签（`__workspace__:growth` 总览、`__workspace__:growth:<角色名>` 单个角色，宽布局）；入口还有文件面板「成长档案」分区（`FilePanel/GrowthSection`，等级徽章 + 新建）、人物详情的「成长档案」按钮、快捷键 `Mod+Shift+J`。索引与打开动作在 `hooks/useGrowthEntry.ts`，各视图写入后通过 `growth-memory-changed` 事件互相刷新（`utils/growthIndex.ts`）。主进程通道 `growth-*`（`main/handlers/growth.ts`）与 `memory-sync-snapshots`（`main/handlers/memory.ts`）
- AI 推演只产出提案：GUI 用设置中心配置的 AI 执行；CLI 不保存 AI Key，只输出 prompt 与 JSON schema，由驱动 CLI 的 AI agent 执行后再 `apply-sim`。作者确认「采用此分支」之前不会写入任何数据
- 生成资料清理逻辑（`cleanup-empty-generated-material-directories`）只处理 `资料/` 下的 AI资料/项目上下文/卷上下文/章上下文 空目录，不会删除 `资料/记忆/`

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
ne growth init [--template dnd|blank] [--force]      # 创建 资料/记忆/（--force 用模板覆盖 规则.json）
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
