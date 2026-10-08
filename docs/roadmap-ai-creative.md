# AI 创作能力：模型配置 · 人物悬停卡片 · 续写 · 场景视频

本文记录 AI 相关功能的设计取舍与实现状态：AI 基础设施（模型列表、密钥、流式、任务队列）、人物悬停卡片、续写、场景视频（分镜 / 生成 / 样片 / 声音 / 3D 预演）与参考窗格。各期均已实现，剩余事项见文末「待做与未验证」。

相关代码：

- `packages/ai`：Provider 抽象与注册表（`types.ts`、`registry.ts`）、内置实现（`providers/`：`openai-compatible`、`grok`、`image.ts`、`minimax-video`、`seedance-video`、`speech.ts`）、`sse.ts` / `http.ts` / `errors.ts`、上下文组装（`context/`）、提示词（`prompts/`：续写、分镜、预演、动作）、`motion.ts`
- `packages/video`：分镜模型与校验、任务状态机与队列、落盘布局、费用、声音模型（`audio.ts`）、预演脚本（`previz*.ts`）、样片拼接 `./stitch`（仅渲染进程）
- 主进程：`apps/pc/src/main/ai/`（`provider-config.ts` 模型列表、`model-migration.ts` 旧版迁移、`credential-store.ts` 密钥、`service.ts` 默认模型与请求、`model-actions.ts`）、`main/video/`（`runner.ts`、`download.ts`）、`handlers/ai.ts`、`ai-providers.ts`、`video.ts`、`video-scene.ts`、`scene-audio.ts`、`character-avatar.ts`
- 协议与类型：`apps/pc/src/shared/ai.ts`、`shared/ai-models.ts`（服务商预设）、`render/types/ai-api.ts`
- 渲染进程：设置中心 `AppSettingsCenter/AiSection`；编辑器辅助 `TextEditor/assist/`、`hooks/useEditorAssist.ts`、`utils/continuationService.ts`；场景视频 `components/SceneVideoView/`；参考窗格 `components/ReferencePane/`
- CLI：`apps/cli/src/commands/ai.ts`、`video.ts`

## 1. 基础设施

### 模型列表（按能力）

- 设置中心「AI」：最上方「启用 AI 功能」总开关；文本 / 图片 / 视频 / 语音四个能力各一张**模型列表**，可添加多个模型、设默认、测试连接、编辑、停用、删除（Key 一并删除）
- 配置存 `userData/ai-providers.json`（schemaVersion 2，应用全局、不随项目）：`models[]`（`{ id, capability, vendor, label, preset?, baseUrl?, model?, enabled, temperature?, maxTokens?, contextTokens?, pricePerSecond?, voice?, … }`）+ 每个能力的默认模型 `defaults` + 视频队列设置
- `vendor` 是协议实现（openai-compatible / grok / seedream-image / minimax-image / grok-image / minimax-video / seedance-video / openai-speech / minimax-speech）；OpenAI、DeepSeek、xAI Grok、通义、Kimi、智谱、Ollama 等只是**服务商预设**（`AI_MODEL_PRESETS`，预填协议、地址、推荐模型，每个预设上方注明核对的官方文档与日期）
- 默认模型由主进程 `AIService.resolveDefaultId(capability)` 统一决定：作者选定的 > 第一个已保存 Key 且启用的 > 第一个；省略模型的请求（续写、成长推演、章纲、配音、出图等）都走它
- 「沿用已保存的 Key」：同协议 + 同地址的模型可在主进程内复制 Key
- 网络代理：设置中心「AI → 网络代理」一份全局设置（跟随系统代理 / 手动填写 http、https、socks4、socks5 地址，不含账号密码；`shared/ai-proxy.ts` 校验，存 `ai-providers.json` 的 `proxy`）；只有勾选了「通过代理访问」（`useProxy`）的模型走代理，其余直连。境外服务商预设（OpenAI、xAI Grok 及其图片 / 配音）添加时默认勾选（`suggestProxy`）。实现：主进程 `ai/proxy-fetch.ts` 用独立内存会话（`session.fromPartition`）+ `setProxy` + `session.fetch`（Chromium 网络栈，支持系统代理 / PAC 与 SOCKS，流式与取消照常），注入 Provider 配置的 `fetch`；视频成片下载也按该模型的设置。IPC `ai-proxy-get / set`。CLI 不读这份设置（直连）
- 旧版（schemaVersion 1 的内置服务 + 自定义服务）第一次读取时迁移，原文件备份为 `ai-providers.v1.json`，id / 名称 / 参数 / Key 不变

### 安全

- API Key 用 Electron `safeStorage` 按模型 id 加密存于 `userData/ai-credentials.json`（0600）；系统没有可用钥匙串时以受限权限文件保存并在设置中心提示
- 渲染进程永远拿不到明文：只能写入，读取只返回 `configured`；Key 不进设置 JSON、日志、`*.prompt.json` 或错误信息。旧设置 JSON 里的明文 Key 打开数据库时迁移进安全存储
- 主进程校验渲染进程传入的消息、模型、地址（只允许 http(s)、不含账号密码）、作品目录与镜头参数

### 流式与任务

- 文本：`ai-complete`、`ai-stream-start / cancel`，片段经 `ai-stream-event`（`webContents.send`，按 streamId，只推给发起窗口，每窗口最多 4 个并发流，窗口关闭自动取消）。没有用 MessagePort：片段小、单向推送、便于按窗口清理
- HTTP：超时 + 取消、确定性指数退避，只重试限流 / 网络 / 超时 / 5xx；视频提交不重试（避免重复扣费）；错误统一为 `AIError.kind`
- 视频任务：表 `video_tasks`（当前项目数据库）+ `main/video/runner.ts`：提交 → 轮询 → 后台下载（下载前重新获取签名地址，先写 `.part` 再改名，原样保存字节、不转码），打开数据库后恢复轮询；状态机 `queued → submitted → running → succeeded / failed / cancelled`
- 费用：不内置价格，作者在视频模型上填「每秒单价」后才做预估与上限检查

### CLI

`ne ai continue`、`ne video storyboard`、`ne video validate`。CLI 不保存密钥，Key 读环境变量 `NOVEL_EDITOR_<PROVIDER>_API_KEY`（如 `NOVEL_EDITOR_GROK_API_KEY`，可选 `_BASE_URL` / `_MODEL`）；没有 Key 或 `--prompt-only` 时只输出提示词与 JSON Schema 交给 AI agent。视频生成只在 GUI 中进行。

## 2. 人物悬停卡片

- 正文里的人物名 / 别名悬停 300ms 弹出卡片；输入中、IME 组字时不弹；Esc 关闭；⌘K / Ctrl+K 打开光标处人物
- 卡片：头像或首字圆标、别名、分类 · 阵营、一句话简介、最近 2 条状态、成长卡 Lv / 经验条、上次出场章节（从当前章往前逐章查找，找到即停）
- 操作：打开人物、记一笔（复用成长档案表单，章节默认当前章）、高亮全部（8 秒或 Esc 清除）
- 代码：`TextEditor/assist/character-hover.ts`、`components/CharacterHoverCard`、`components/EditorGrowthRecord`；人物形象图经 `character-avatar-save` 存到 `<作品>/资料/人物头像/`

## 3. 续写

- **行内续写**：`Alt+\` 请求，幽灵文字流式出现；Tab 采纳（单独一步撤销）、Esc 放弃、`Alt+]` 换一个版本（最多 3 个后轮换）；从不自动触发，移动光标或输入即取消
- **续写面板**（文件栏「续写」）：长度（一句 / 一段 / 约 500 字）、方向（顺着写 / 制造冲突 / 收束本章 / 自由输入）、遵循章纲、模型；结果以「建议」高亮插在光标处（采纳 / 放弃 / 换一个），可展开查看本次上下文与 token 数
- 与最初设计的差异：建议采纳前**不进入文档**（widget），放弃不留撤销记录，自动保存与写作日志只看到采纳后的正文
- 上下文：前文（按所选模型的上下文长度裁剪）、当前章章纲、人物卡、成长档案摘要与核心规则；`assembleWritingContext` 按预算确定性裁剪，GUI 与 CLI 同一实现

## 4. 场景视频

工作区标签 `__workspace__:scene-video:<章路径>#<场景>`。入口：编辑器文件栏「场景视频」、应用菜单「编辑 → 场景视频…」（⌥⌘V / Ctrl+Alt+V）、卷纲「场景」节拍、资料里的场景目录 `资料/视频/<章>/<场景>/`（单击即打开这一场的画布；`分镜.json` 是内部数据，不在资料树显示）。带入范围：选区 > 指定场景 > 光标所在「第X场」> 整章。

**画布取代了最初的三栏设计**：人物 → 场景 → 镜头 1…N → 样片，可平移 / 缩放 / 拖动节点，单击节点在右侧检查器编辑。尽量去掉手动步骤：

- 打开时没有分镜就自动拆分（有文本模型用 AI，否则按段落）
- 每次修改自动写 `分镜.json` 与可读的 `分镜.md`（没有「导出」）
- 「生成 N 个镜头」只提交缺成片、没有进行中任务、且有画面描述的镜头
- 全部镜头都有成片后自动合成样片（WebCodecs，保留各成片声音并混入配乐 / 对白 / 音效）
- 第一个成片出现后自动在本章章纲追加「场景视频 · <场景>」
- 写入后资料面板自动刷新，「在资料中查看」直接定位

落盘：`<作品>/资料/视频/<章>/<场景>/镜头N-vX.mp4` + 同名 `镜头N-vX.prompt.json`（每个版本一份，可复现）。镜头 id 固定为 `shot-<N>` 且只增不减，排序 / 删除后已有成片不会串号。

### 人物一致性与首帧

- 路线：先定参考图，再图生视频。人物图集有「形象图 / 三视图」，提交视频时按镜头出场人物附带参考图（三视图优先，每镜最多 4 张）；MiniMax 映射为 `subject_reference`，Seedance 为 `reference_image`
- 首帧（4 选 1）：用图片模型按画面描述 + 人物三视图 + 预演第一帧出 4 张，采用的随视频任务提交
- 商用视频接口基本不支持骨骼 / 深度图控制动作，因此「预演」只作为构图与动作参考

### 3D 预演

- 主界面是**描述**：输入镜头动作与走位，选文本模型，「生成预演」。AI 返回 `PrevizScript`（`packages/video/src/previz.ts`，第 2 版：人物 / 道具及其关键帧、姿势、AI 直接写的关节轨迹 `motion.tracks`、视线、手部目标、机位关键帧）；没有 AI 或解析失败时用确定性默认脚本
- three.js 舞台（动态导入）里的木偶是代码拼出的关节几何体，姿势是手写预设，**不使用外部模型或动作文件**；`motion.generate` 描述可交给 `MotionProvider`（目前无内置实现）或追加一次文本请求生成轨迹
- 「保存预演视频」逐帧确定性渲染并用 WebCodecs 编码，保存 `镜头N-预演.mp4` + 第一帧 `镜头N-预演.png`

### 声音

- 场景级：配音语言、背景音乐（本地文件，音量 / 淡入淡出）、环境音、对白时自动压低配乐；镜头级：对白（说话人 / 台词 / 情绪）与音效
- 配音用语音模型（OpenAI 兼容 `/audio/speech`、MiniMax `t2a_v2`），写入 `镜头N-台词-<id>.mp3|wav`
- 视频模型支持声音时（目前 Seedance 的 `generate_audio`）可开「生成声音」，提示词附上对白与音效
- 背景音乐的 AI 生成只预留了 `MusicProvider` 接口

## 5. 参考窗格（写作时看图 / 视频）

媒体是为写作服务的，放在编辑器旁边而不是「大纲」面板：

- 文件栏「参考」开关窗格，自动列出本章引用的图片 / 视频、本章场景视频的镜头与样片、当前作品人物图，按来源分组；资料 / 图集 / 场景视频 / 正文指令都可「在旁边打开」
- 可拖宽、排序、从资料树或系统拖入、拖到正文插入 `::image` / `::video` 指令、「缩成小卡片」悬浮在右下角；磁盘文件变化自动刷新
- 「大纲」面板只做结构（目录 / 章纲 / 卷纲）

## 待做与未验证

- **未用真实 Key 联调**：MiniMax / Seedance 视频、Seedream / MiniMax / Grok 图片、OpenAI / MiniMax 语音的字段映射按公开文档实现，假设写在各 `providers/*.ts` 文件头与 `*_ENDPOINTS` / `*_DEFAULTS` 常量里
- 「大纲」弹出为独立窗口后，独立窗口里还没有参考窗格（适合双屏：主屏写作、副屏看大纲 + 参考）
- 编辑器没有自定义右键菜单，「选中文字 → 场景视频」走文件栏按钮 / 菜单 / 快捷键
- `MotionProvider`、`MusicProvider` 只有接口，没有内置实现
