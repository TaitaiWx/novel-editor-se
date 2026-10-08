# 小说文档格式（Novel Markdown）

在 Markdown（CommonMark + GFM + `$` 公式）之上加 YAML front-matter 与通用指令（generic directives），扩展名仍为 `.md`。本文是格式设计稿，并标注哪些已经实现；调研背景见 [novel-format-research.md](novel-format-research.md)。

相关代码：

- 纯函数（GUI / CLI 共用）：`packages/core/src/novel-format.ts`（`parseFrontMatter`、`parseDirectiveLine` / `parseDirectiveAttributes`、`stripNovelMarkup`、`extractNovelScenes`、`lintNovelMarkup`、`imageDirectiveSource` / `videoDirectiveSource` / `audioDirectiveSource`）；结构行规则 `structure-rules.ts`
- 编辑器渲染：`apps/pc/src/render/components/TextEditor/live-preview/novel-directives.ts`、`media-loader.ts`、`media-figure.tsx`
- 大纲 / 卷纲识别场景容器：`packages/basic-algorithm/src/outline/novel-markers.ts`
- CLI：`apps/cli/src/commands/lint.ts`（`ne lint`）
- 示例：示例作品集根目录 `小说格式示例.md`、`声音示例.md`
- 测试：`apps/pc/test/render/components/TextEditor/novel-directives.test.ts`、`packages/core/test/novel-format.test.ts`

## 实现状态

| 内容 | 状态 | 说明 |
|---|---|---|
| front-matter | ✅ 解析 | 只支持本章元数据需要的最小 YAML 子集；字数统计跳过（编辑器里按普通文本显示） |
| `:::scene{#id title=… pov=…}` … `:::` | ✅ | **平铺、不嵌套**；未闭合时在下一个场景、≤2 级标题或章 / 幕结构行处结束；编辑器显示场景条；目录 / 卷纲识别为「场景」 |
| `::video` / `::image` / `::audio` | ✅ | 就地显示播放器 / 图片 / 音频播放条，可「在旁边看 / 听」（参考窗格）；`src` 相对作品目录，从文件所在目录逐级向上查找 |
| `:char[文字]{id=…}` | ✅ 显示与统计 | 显示称呼（人物色、虚下划线），字数只计方括号里的文字；指向人物卡的链接、出场统计未做 |
| 结构行（第一章 / Chapter 1 / 第一幕 / Act II …） | ✅ | 不需要 `#`，规则可配置，见 [outline-algorithm.md](outline-algorithm.md) |
| 字数口径 | ✅ | `stripNovelMarkup`：去掉 front-matter 与指令行（行数不变），状态栏、写作日志、`ne stats` 共用 |
| `ne lint [path] [--strict]` | ✅ | 未闭合场景、多余 `:::`、重复场景 id、媒体指令缺少 `src` |
| `:::act` 容器 | ❌ | 幕继续用「第X幕」结构行 |
| `::character`、`:note` / `:::note`、`:ref`、`::growth` | ❌ | 设计稿 |
| 自定义资源协议（Range 读取视频） | ❌ | 目前经 `read-file-binary` 读成 blob 地址并缓存 |
| 块索引 / 增量哈希、`ne fmt`、`ne scene list`、`ne refs` | ❌ | 设计稿 |
| 导出转换（txt / md / docx 去指令、epub / pdf） | ❌ | `core/export.ts` 尚不识别指令 |
| 编辑器内的指令错误标记 | ❌ | 目前只有 `ne lint` |

以下各节是原始设计，标注「已实现」之外的部分仍待实施。

## 0. 结论

**不发明新格式，在 Markdown（CommonMark + GFM + `$` 公式）之上加「通用指令」（generic directives）与 YAML front-matter，扩展名仍为 `.md`。**

| 方案 | 纯文本 / Git diff | 其他工具可读 | 富内容（人物卡、视频、批注） | 实现成本 | 结论 |
|---|---|---|---|---|---|
| A. Markdown + 指令 + front-matter | 好（一段一行，属性短小） | 好：GitHub / Typora / Obsidian 至少能显示原文，降级为普通段落 | 够用：行内 / 叶子块 / 容器三种指令覆盖全部需求 | 低：在现有 `@lezer/markdown` 扩展（与 `math-syntax.ts` 同一套机制）上加语法 | **推荐** |
| B. 全新文本格式（如 `.novel`） | 好 | 差：所有外部工具都要单独适配 | 好 | 高：解析器、高亮、导出、CLI 全部重写 | 不推荐 |
| C. 容器格式（zip / JSON / XML，像 `.docx`、`.scriv`） | 差：二进制或大 JSON，diff 不可读 | 差 | 好 | 中 | 不推荐（与「CLI / AI 直接读写纯文本」的定位冲突） |
| D. Fountain 等剧本格式 | 好 | 中（只有剧本工具认识） | 弱：没有人物卡、视频、批注 | 中 | 只作为导出目标 |

理由：

1. **现有作品零迁移**：今天的 `novels/<作品>/<卷>/00N-标题.md` 原样就是合法的 Novel Markdown；指令全部可选，不写就是普通 Markdown。
2. **一套语法树**：编辑器高亮、实时渲染、幕剧 / 大纲面板、CLI、导出共用 `@lezer/markdown` + 扩展（`@lezer/markdown` 是纯 JS、无 DOM 依赖，`packages/core` 可直接使用），GUI 与 CLI 结果一致。
3. **对 AI 友好**：指令是可读的纯文本，AI 生成、修改、`ne file write` 都不需要特殊 API；`ne lint` 能给出机器可读的错误。
4. **降级优雅**：不认识指令的工具看到的是 `::video{src="…"}` 一行原文，而不是乱码或丢内容。

扩展名：保持 `.md`，Git 平台、外部编辑器、操作系统的「打开方式」都不受影响。（设计曾考虑用项目配置 `documentFormat` 或 front-matter `novel: 1` 标记格式版本；**实际实现不做标记，所有 .md 都识别指令**。）

## 1. 语法

语法基于 CommonMark 通用指令提案（[remark-directive](https://github.com/remarkjs/remark-directive) 同款写法），只增加三种结构：

| 形式 | 写法 | 用途 |
|---|---|---|
| 行内指令 | `:name[文字]{属性}` | 人物引用、批注、跨章引用 |
| 叶子块指令（独占一行） | `::name[标签]{属性}` | 人物卡、图片、视频、成长事件 |
| 容器指令（成对） | `:::name{属性}` … `:::` | 幕、场、批注块 |

属性语法：`{#id .class key=value key="带 空格 的值"}`，与 Pandoc 标题属性一致；值不允许换行，保证一个指令在一行内（diff 友好）。

### 1.1 front-matter（可选）

```markdown
---
novel: 1
title: 启程
pov: 林舟
timeline: 星历 302 年 · 春
status: 初稿          # 大纲 / 初稿 / 修改中 / 定稿
target: 4000          # 本章目标字数
tags: [离乡, 伏笔-星图]
---
```

- 只放「本章元数据」，人物 / 设定仍在数据库与 `资料/`，不复制进正文
- 字数统计、写作日志都跳过 front-matter（core 统计函数需要同步排除）

### 1.2 幕 / 场：容器指令

```markdown
:::act{#act-1 title="离乡"}

:::scene{#s-1-1 title="港口" location=港口 time=黄昏 pov=林舟}
林舟背起行囊，最后看了一眼灯塔。
……
:::

:::scene{#s-1-2 title="夜航" location=货船 time=深夜}
……
:::

:::
```

- `#id` 是稳定标识：大纲面板拖动调整顺序、场景视频、AI 摘要缓存都按 id 关联，改标题不丢关联
- 与现有约定兼容：没有容器指令时，`extract-acts.ts` 继续按「第X幕 / 第X场」标题识别；`ne fmt --scenes` 可把标题约定一键转换为容器（见 §5）
- 容器嵌套只允许 `act > scene`，其他容器（`note`）可以出现在任意位置（**已实现的第一期只有平铺的 `:::scene`，没有 `:::act`**）
- **未闭合的容器**：在下一个同级容器开始、或 ≤ 2 级标题处结束，并在开始行显示错误标记（与 `$$` 在空行处结束同一思路），绝不吞掉后面整篇文档

### 1.3 人物引用（悬停卡片）

```markdown
:char[阿舟]{id=linzhou} 握紧了船舷，:char[苏晴] 没有回头。
```

- 文字部分就是正文里显示的称呼（别名、昵称都可以），`id` 指向人物卡；省略 `id` 时按人物名 / 别名匹配
- 不强制标注：未标注的人名仍由现有「人物高亮」规则识别，悬停卡片同样生效；显式标注只用于消歧义（重名、代称、「他」指代谁）和让 CLI / AI 精确统计出场
- 导出为纯文本时只保留文字：`:char[阿舟]{id=linzhou}` → `阿舟`

### 1.4 人物卡、图片

```markdown
::character{id=linzhou view=card}
::image[林舟立绘]{src="资料/素材/林舟-立绘.png" width=320 align=right}
```

- `::character` 在正文中嵌入人物卡（头像、简介、当前等级），数据实时来自数据库 / 成长档案，正文里只有一行引用
- 图片仍可用标准 `![林舟](资料/素材/林舟.png)`；`::image` 只在需要尺寸、对齐、说明文字时使用
- 路径一律相对当前文件或作品目录，资源放在 `<作品>/资料/` 下，不内嵌 base64

### 1.5 场景视频

```markdown
::video[港口离别]{src="资料/视频/s-1-1-港口.mp4" poster="资料/视频/s-1-1-港口.jpg" scene=s-1-1 start=0 end=12}
```

- 与 [roadmap-ai-creative.md](roadmap-ai-creative.md) 的「场景视频」工作区对接：生成完成后插入这一行，`scene` 指回场景 id
- 正文只存路径与元数据，视频文件不进 Git（建议 `.gitignore` 忽略 `资料/视频/*.mp4`，或用 Git LFS）

### 1.6 批注与修订

```markdown
他终于说出了那个名字:note[这里要和第 3 章的伏笔呼应]{by=作者 at=2026-10-07}。

:::note{type=todo}
这一场节奏太快，补一段船上的环境描写。
:::
```

- 批注不进入导出正文（docx 导出为 Word 批注，pdf / epub 默认丢弃，可选择保留为脚注）
- 修订标记可选支持 CriticMarkup（`{++新增++}`、`{--删除--}`、`{~~旧~>新~~}`），只用于与编辑 / 合作者往返，不是必需功能

### 1.7 跨章引用与成长事件

```markdown
正如 :ref[雾林那一夜]{to="003-迷雾森林.md#s-3-2"} 所示……

::growth{char=林舟 exp=+300 note="击败狼王"}
```

- `:ref` 渲染为可点击链接（⌘ / Ctrl + 点击跳转），`ne lint` 检查目标是否存在
- `::growth` 让正文与成长记录器（`资料/记忆/`）互相对照：一致性检查可以报告「正文写了升级、成长档案没记」或反过来；是否由指令自动写入成长档案需要作者确认，不自动执行

### 1.8 纯文本友好约定

- 一段一行（与现有正文一致），指令独占一行或嵌在段内，不跨行
- 属性按固定顺序输出（`id` 在前，其余按字母序），由 `ne fmt` 规范化，避免无意义 diff
- 生成内容（AI 摘要、渲染缓存、视频任务状态）一律放在 `.novel-editor/` 或数据库，不写回正文

## 2. 解析

### 2.1 语法层：`@lezer/markdown` 扩展

> 实际实现：第一期没有写 Lezer 扩展，指令按**行**识别（core `parseDirectiveLine` 等纯函数），编辑器在实时渲染的可见范围内逐行处理；下文是后续需要语法树时的方案。

与 `live-preview/math-syntax.ts` 相同的方式新增 `directive-syntax.ts`（不依赖 DOM / KaTeX，可随 markdown 语言包加载，core 也能用）：

- 块级：`::name` 开头的行 → `LeafDirective`；`:::name` 开始 → `ContainerDirective`（子节点继续按 Markdown 解析）；`:::` 单独一行闭合
- 行内：`:name[` → `TextDirective`，子节点 `DirectiveName` / `DirectiveLabel` / `DirectiveAttributes`
- 属性解析是独立的纯函数（`parseDirectiveAttributes(text)`），出错返回 `{ ok: false, error }`，不抛出
- 中文正文里冒号很常见（「他说：」用的是全角冒号，不受影响）；半角 `:` 后必须紧跟 ASCII 字母指令名和 `[` / `{`，否则按普通文字处理，避免误伤时间「12:30」、比分「3:2」

CodeMirror 已经通过 `@codemirror/language` 做 Lezer 增量解析（`TreeFragment` 复用未改动的子树），编辑器侧不需要另写增量解析器。

### 2.2 块索引（GUI 与 CLI 共用，`packages/core`）

面板、CLI、AI 需要的不是完整语法树，而是「顶层块列表」：

```ts
interface BlockEntry {
  from: number;
  to: number;
  kind: 'act' | 'scene' | 'heading' | 'paragraph' | 'character' | 'image' | 'video' | 'note' | 'growth' | 'math' | 'table' | 'code';
  id?: string;          // 指令的 #id
  attrs?: Record<string, string>;
  hash: string;         // 块原文的 FNV-1a 哈希
}
```

增量维护算法（借鉴 code-reader，见 §3）：

1. 文档变化时用 `ChangeSet` 映射所有块的位置（CodeMirror `RangeSet` / `mapPos`，O(块数 × log)），不重新计算未受影响块的哈希
2. 受影响区间 = 改动覆盖的块 ± 1 个相邻块，再**按容器边界扩展**：落在 `:::scene` 内的改动扩展到整个场景，改动触及 `:::` / `$$` / ``` 这类边界行时扩展到下一个同类边界（解决「删掉闭合行导致后文结构变化」）
3. 只对受影响区间重新扫描、重新算哈希；受影响行数超过阈值（如 2000 行或 25% 文档）时全量重建
4. 块列表用有序数组 + 二分查找定位，不做线性扫描
5. IME 组字期间只映射位置不重建（与实时渲染的约定一致）

哈希的用途：渲染缓存键、AI 场景摘要缓存键（摘要只在场景原文变化时失效）、版本对比时快速跳过未变化的场景。

### 2.3 健壮性

- 每个块独立 try/catch；未知指令按原文显示 +「?」标记，属性错误按原文显示 +「!」标记（沿用 `cm-lp-error-marker`）
- 资源路径在主进程校验：解析为绝对路径后必须位于项目根内，拒绝 `..` 越界与符号链接逃逸
- 不支持原始 HTML / 脚本；外链只放行 http(s)（沿用 `open-external-url` 规则）

## 3. 可复用的 code-reader 算法

调研对象：`code-reader/packages/format-parser`（markdown / latex / incremental）、`syntax-parser`（Lezer 适配、块扫描、AST 缓存）、`text-buffer`（piece table / rope / gap buffer）。

| 来源 | 算法 | 在本格式中的用法 | 注意 |
|---|---|---|---|
| `format-parser/src/incremental/incremental-edit-parser.ts` | 受影响区间 = 编辑行 ± `contextLines`；`findCodeBlockContext` 遇到代码围栏时把区间扩展到整个围栏；局部重解析后把后续 token 按「字符偏移差 + 行数差」整体平移；超过 `fullReparseThreshold` 全量重解析 | §2.2 块索引的第 2、3 步，围栏扩展推广到 `:::` 容器与 `$$` 公式块 | 原实现 `findTokenIndexByLine` 线性查找、`mergeTokens` 每次复制并平移全部后续 token（O(n)），围栏上下文从文档开头扫描。照搬会在长章节上退化，需改为二分查找 + 位置映射 |
| `format-parser/src/incremental/incremental-parser.ts` | FSM 逐字符解析，按 64KB 分块喂入，未完成的尾部留在 `pendingInput`，`parseMarkdownStream` 支持异步流 | CLI 导出 / 统计超大作品（全书合并几 MB）时流式处理，内存恒定 | 只覆盖 Markdown 子集，指令语法要补状态；GUI 侧不需要 |
| `syntax-parser/src/lezer/lezer-parser.ts` | 保存 `TreeFragment`，编辑后 `TreeFragment.applyChanges` 复用未改动子树 | daemon（`ne serve`）为常驻进程，按文件缓存 fragments，AI 连续调用 `ne scene list` / `ne refs` 时只增量解析 | 与 CodeMirror 内部机制相同，GUI 已自带 |
| `syntax-parser/src/block-scanner/latex-block-scanner.ts` | 块级扫描 + 每个节点 FNV-1a 哈希，按哈希判断节点能否复用 | 块索引的 `hash` 字段、渲染缓存与 AI 摘要缓存键 | 其 `incrementalParse` 实际仍全量重扫，只统计复用数；正则扫描处理不了嵌套，结构识别要用 Lezer 语法树 |
| `syntax-parser/src/lezer/ast-cache.ts` | 双向链表 LRU，按条目数 + 估算字节数双重上限淘汰，`hashToNodeId` 映射，`invalidateRange` 按区间失效 | 实时渲染的 widget 缓存（现有 `live-preview/lru.ts` 只按条目数限制）增加字节上限，图片 / 视频海报这类大对象按体积淘汰并 `URL.revokeObjectURL` | `estimateSize` 递归遍历对象较慢，缓存值应直接记录字节数 |
| `text-buffer`（piece table / rope / gap buffer） | 只追加缓冲区 + 片段表、平衡树 rope | 不引入：CodeMirror 的 `Text` 已是分块 B 树；CLI 批量查找替换以文件为单位，字符串足够 | 仅当 daemon 需要长期持有并反复编辑超大文件时再考虑 piece table |

## 4. 渲染（CodeMirror 6 实时预览）

沿用现有实时渲染的规则：光标所在行（行内语法）或所在块（块级结构）显示源码，其余位置渲染；只构建「可见范围 + 余量」内的块；跨行替换放在 StateField；渲染预算每帧约 8ms，超出的 widget 下一帧再渲染（`render-cache.ts` 的 `hasRenderBudget`）。

| 语法 | 光标不在时 | 光标在时 | 实现 |
|---|---|---|---|
| `:char[阿舟]{id=…}` | 只显示「阿舟」（带人物色下划线），悬停 300ms 弹出人物卡 | 显示完整源码 | `Decoration.replace` 隐藏 `:char[` 与 `]{…}`，文字保留可编辑；`hoverTooltip` 读取人物数据（按作品缓存，`growth-memory-changed` 时失效） |
| `:note[…]` | 段内显示一个小批注图标，悬停看内容 | 源码 | 行内 replace widget |
| `::character` / `::image` | 块级卡片 / 图片 | 源码 + 下方预览（同公式块编辑时的预览） | 块级 replace widget，`estimatedHeight` 给出固定高度，避免滚动跳动；图片经 `read-file-binary` 读取 |
| `::video` | 海报图 + 播放按钮 + 时长 | 源码 + 海报预览 | 默认只渲染海报，点击后才创建 `<video preload="none">`；离开视口（IntersectionObserver）时暂停并释放；视频经自定义协议（如 `ne-asset://`，支持 Range 请求）读取，不走 base64 |
| `:::scene{…}` | 开始行替换为「场景条」（标题、地点、时间、视角的小标签），内容区左侧一条细线 | 开始 / 结束行显示源码 | 开始行 replace widget，内容区只加 line decoration（正文仍是普通可编辑文本，不做成 widget） |
| `:::act{…}` | 幕分隔条 | 源码 | 同上 |
| `::growth{…}` | 一行成长事件徽标（Lv / 经验变化） | 源码 | 行内 widget，数据只来自属性，不查询成长档案 |

性能与隔离：

- 渲染结果按「指令原文哈希」LRU 缓存；人物卡、成长数据变化时按 id 精确失效
- 每个 widget 自带错误兜底（显示原文 + 标记），一个坏指令不影响其它内容
- 专注模式：块级 widget 由 `focus-mode.ts` 的 `tagBlockWidgets` 打上距离档位，跟随渐进淡化
- 大文档基准沿用 `live-preview-view.test.ts`：10 万行 / 5MB 文档、每 50 行一个指令时，每视口构建 < 16ms

## 5. 迁移

1. **零成本兼容**：现有 `.md` 正文不改动即可使用；不写指令就没有任何差别
2. **`ne fmt` 可选转换**（默认 `--dry-run` 输出 diff，确认后写入）：
   - `--scenes`：把「第X幕 / 第X场」标题包成 `:::act` / `:::scene` 容器并生成 `#id`
   - `--characters`：按人物库把歧义人名（重名、别名）标注为 `:char`，普通人名不动
   - 属性规范化（顺序、引号），保证 diff 稳定
3. **反向导出**：`ne export --format=md --plain` 去掉全部指令得到标准 Markdown（上传连载平台用）
4. **版本**：front-matter / 项目配置里的 `novel: 1` 标记格式版本；以后语法变化时由 `ne fmt` 升级，高版本文件在旧版应用中只读并提示升级（与成长档案 `schemaVersion` 的策略一致）
5. **示例作品集**：先在 `sample-data` 新增一章使用指令的示范章节（递增 `sampleVersion`），现有 6 章保持不变，E2E 依赖不受影响

## 6. 导出

| 结构 | txt | md（--plain） | docx | pdf | epub |
|---|---|---|---|---|---|
| front-matter | 丢弃 | 丢弃 | 文档属性（标题、作者） | 页眉 / 元数据 | OPF 元数据 |
| `:::act` / `:::scene` | 标题行（「第一幕 离乡」） | `##` / `###` 标题 | 「幕」「场」段落样式，场景元数据可选输出为小字 | 同 docx | 章节内 `<section>`，场景可进目录 |
| `:char[文字]` | 文字 | 文字 | 文字（可选人物样式） | 文字 | `<span class="char">`；可选生成人物表附录 |
| `::character` | 丢弃 | 丢弃 | 可选：人物卡表格 | 可选：人物卡 | 可选：人物表页面 |
| 图片 | 丢弃 | `![]()` | 内嵌图片 | 内嵌图片 | 内嵌图片 |
| `::video` | 丢弃 | 链接 | 海报图 + 说明 / 链接 | 海报图 + 链接 | EPUB 3 `<video>`（海报作后备），阅读器不支持时显示海报 |
| `:note` / `:::note` | 丢弃 | 丢弃 | Word 批注 | 默认丢弃，可选脚注 | 默认丢弃，可选脚注 |
| 公式 | 原文 | 原文 | OMML（KaTeX MathML → OMML 转换），失败时原文 | KaTeX 渲染 | MathML |

实现位置：`packages/core` 先把文档转换为与格式无关的中间结构（块索引 + 行内节点），各导出器只消费中间结构；docx 继续用现有 `docx` 依赖，pdf 走 Electron `printToPDF`（CLI 无 GUI 时退化为 html），epub 用 `jszip` 组装。

## 7. CLI 与 AI

```bash
ne scene list <作品|章节> [--json]        # 幕 / 场列表（id、标题、地点、视角、字数）
ne refs <角色> [--json]                    # 人物出场：显式 :char 与名字匹配分开统计
ne lint [path] [--json]                    # 未知指令、属性错误、资源缺失、人物 id 不存在、未闭合容器、:ref 目标不存在
ne fmt [path] [--scenes] [--characters] [--dry-run]
ne export <作品> --format=docx|pdf|epub|md|txt [--plain]
```

AI 通过 CLI 写作时直接输出指令文本（例如场景容器、`:char` 标注）；`ne lint --json` 的结果可直接回给 AI 修正。

## 8. 分期

> 已完成：第 1 期（属性解析 + `ne lint`）、第 2 期的 `:::scene` 场景条与大纲识别（`:char` 只做了显示）、第 3 期的 `::image` / `::video`（另加 `::audio`，未做自定义资源协议与 `::character`）。

1. 语法扩展 + 属性解析 + `ne lint`（只读，不改变任何渲染）
2. `:char` 悬停卡片（与 [roadmap-ai-creative.md](roadmap-ai-creative.md) 第 1 期合并）、`:::scene` 场景条、大纲面板读取场景 id
3. `::image` / `::character` / `::video` widget、自定义资源协议
4. `ne fmt` 迁移、导出器中间结构、docx / epub 导出
5. 块索引常驻 daemon、AI 场景摘要缓存

## 9. 待定问题

- 场景容器与「卷 / 章」文件结构的关系：一章多场景（推荐）还是允许场景跨章
- `:char` 在外部 Markdown 工具中显示为原文是否可接受，或者提供 Obsidian / Typora 插件
- 视频是否纳入「导出项目」与版本快照（体积大，建议默认排除）
