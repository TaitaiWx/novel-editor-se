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

1. 前端: React 18 + TypeScript + SCSS Modules
2. 后端: Electron 28 (主进程 + preload + 渲染进程)
3. 构建: Vite 6 + electron-builder
4. 代码规范: ESLint 8 + Prettier
5. 包管理器: pnpm (v10.12.4)
6. Node 版本: v20.10.0 (.nvmrc)

### 构建架构

Electron 应用有 3 个运行环境，各自对模块格式有不同要求，因此需要分开构建：
- **主进程** (`VITE_ELECTRON_MAIN=true`) → `dist/main.mjs` (ES module)。运行在 Node.js 环境，项目使用 ESM，所以输出 `.mjs`
- **Preload 脚本** (`VITE_PRELOAD=true`) → `dist/preload.js` (CJS)。作为主进程和渲染进程的桥梁，Electron 的 contextBridge 要求 CommonJS 格式
- **渲染进程** (默认) → `dist/render.js` (浏览器 bundle)。运行在浏览器环境，标准 Web 打包

三个目标共用一个 `vite.config.ts`，通过环境变量区分，避免维护多个配置文件

## 代码规范

### 路径别名

1. `@/` → `./src/` (在 vite.config.ts 和 tsconfig.json 中同时配置)

### 样式

- 使用 SCSS Modules (`.module.scss`)
- 每个组件独立目录，包含 `index.tsx` + `styles.module.scss`
- 引入必须是 ``import styles from './styles.module.scss'``，禁止全局样式

### Lint & Format

- ESLint: `@typescript-eslint/no-explicit-any` 关闭；未使用变量为警告（前缀 `_` 可忽略）
- Prettier: 单引号、尾逗号 (es5)、100 字符宽度、2 空格缩进
- `.npmrc` 已加入 gitignore（包含本机代理配置，不应提交）
- 禁止出现 any 类型

### 开发命令

- `pnpm install`: 安装依赖
- `pnpm dev`: 开发模式。使用 concurrently 并行启动: (1) 构建 main + preload，然后 watch 渲染进程; (2) wait-on 等待 dist/main.mjs 生成后，nodemon 监听 src/main 变化自动重启 electron
- `pnpm start`: 直接启动 electron 应用（需先执行 build）
- `pnpm build:main`: 构建主进程（VITE_ELECTRON_MAIN=true）
- `pnpm build:preload`: 构建 preload 脚本（VITE_PRELOAD=true）
- `pnpm build:renderer`: 构建渲染进程
- `pnpm build`: 按顺序构建所有目标（main → preload → renderer）
- `pnpm build:prod`: 生产环境构建（NODE_ENV=production）
- `pnpm package`: 生产构建 + electron-builder 打包为可分发安装包
- `pnpm lint`: ESLint 检查
- `pnpm lint:fix`: ESLint 自动修复
- `pnpm format`: Prettier 格式化所有 js/ts/css/md/json 文件
- `pnpm clean`: 清理 dist/build/out 目录
- `pnpm release:beta`: 递增 beta 版本号并推送 tag 触发发布（如 1.1.0-beta.0 → 1.1.0-beta.1）
- `pnpm release:minor`: 创建新的 minor beta 版本并推送 tag 触发发布（如 1.0.0 → 1.1.0-beta.0）
- `pnpm release:stable`: 升级 minor 正式版本并推送 tag 触发发布（如 1.1.0-beta.3 → 1.1.0）

### CLI 命令

入口: `cli/index.ts`，可执行文件名: `novel-editor`（或简写 `ne`）

参考 VS Code CLI 和 daemon 模式设计，所有输出支持 `--json` 格式化，方便 AI agent 解析调用。

#### 项目/工作区

```bash
ne init [path]                  # 初始化新项目（创建目录结构、配置文件）
ne open <path>                  # 用 GUI 打开指定文件夹/项目
ne status                       # 输出当前项目状态（打开的文件、未保存变更等）
```

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
