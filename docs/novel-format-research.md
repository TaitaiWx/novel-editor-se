# Novel Markdown 调研结论（2026-10）

Novel Markdown（小说文档格式）动手前的调研记录：外部工具兼容性、解析方案、第一期范围与风险。属于背景资料，当前格式与实现状态以 [novel-format.md](novel-format.md) 为准。

> 状态：第一期已实现（front-matter、`:::scene`、`::video` / `::image` / `::audio`、`:char` 显示、字数口径、`ne lint`）。与下文推荐不同的落地决定：指令按行识别（没有写 Lezer 扩展）；媒体经 `read-file-binary` 读成 blob 地址（没有做 Range 自定义协议）；视频 `src` 相对作品目录；场景不跨章、平铺不嵌套；`ne fmt` 与导出转换尚未实现。

## 结论

- 方向不变：仍是 `.md`，Markdown + YAML front-matter + 通用指令（remark-directive 写法）。不发明新扩展名。
- 通用指令（generic directives）至今**没有进入 CommonMark 规范**（2014 年起的提案仍在讨论），事实标准是 remark-directive / MyST / Pandoc，三者都用 `:::` 容器。
- npm 上**没有现成的 Lezer 指令扩展**，需要自己写。`@lezer/markdown` 的 composite 块是逐行判断「是否继续」的，做成对的 `:::…:::` 很别扭，且删除一个闭合行会让整篇结构重排。
  - 推荐做法：把 `:::scene{…}` 与 `:::` 解析成两种「标记行」（不做嵌套语法节点），由 core 的块索引第二遍计算场景范围。工作量与现有 `math-syntax.ts`（约 120 行）相当，未闭合的容器也不会吞掉后文。
- 字数口径要改：`packages/core/src/text-stats.ts` 现在统计全部非空白字符，front-matter 与指令语法会被算进字数；状态栏、写作日志、`ne stats` 需要共用一个「去掉标记再统计」的函数。（已实现：core `stripNovelMarkup`。）
- 视频嵌入需要新的资源通道：现在的 `read-file-binary` 把整个文件读成 base64，不适合视频；需要一个只读、校验路径在作品目录内、支持 Range 的 `protocol.handle` 自定义协议（例如 `ne-asset://`）。
- 导出层（`core/export.ts`，txt / md / docx）用正则去 Markdown 语法，不认识指令，需要同步处理；目前没有 epub。（尚未实现。）

## 语法在其他工具里的显示

| 写法 | GitHub / Typora / Obsidian |
|---|---|
| 图片 `![说明](资料/素材/x.png)` | 都能正常显示 → 图片继续用标准写法 |
| 视频 `::video[说明]{src="资料/视频/…mp4"}` | 显示原文（可读）；`![](x.mp4)` 在 GitHub / Typora 是坏图，不用 |
| 场景 `:::scene{#s-1-1 title=港口}` … `:::` | 显示原文 |
| front-matter | 都能处理（GitHub 显示为表格） |

## 推荐的第一期范围（约 3–4 人周）

1. 指令与属性解析（纯函数，core 可用）— 3 天
2. front-matter + 字数口径（排除 front-matter 与指令）+ 示例章节（递增 sampleVersion）— 3 天
3. 场景：块索引；`extractActs` 优先读 `:::scene`，没有时回退「第X场」；实时预览显示场景条 — 4 天
4. 图片 / 视频：`::video` widget（默认只显示海报，点击才创建 `<video preload=none>`）+ Range 资源协议 — 5 天
5. CLI：只读的 `ne lint --json`，`ne fmt --scenes --dry-run`（把「第X场」包成容器）— 4 天
6. 导出：txt / md / docx 去掉指令保留文字，场景导出为标题，视频导出为链接 — 2 天

`:char[…]` 人物引用、`::character`、`::growth`、批注、跨章引用与 epub 放到第二期以后。

## 风险与待决问题

- 中文正文里的半角冒号（「12:30」「3:2」）：指令名必须紧跟 ASCII 字母再接 `[` 或 `{`，需要专门的误判测试。
- 撤销 / 多端编辑时场景开始行与结束行可能失配：`ne lint` 与编辑器错误标记兜底。
- 视频体积大：Git 与版本快照默认排除。
- 字数口径变化会让写作日志历史数据出现一次跳变。
- 待决：场景能否跨章（建议不能）；场景 id 由 `ne fmt` 还是编辑器生成；「幕」以后是否也做成容器；视频 `src` 相对当前文件还是作品目录（建议作品目录）。

## 参考

- remark-directive：https://github.com/remarkjs/remark-directive
- CommonMark 通用指令讨论：https://talk.commonmark.org/t/generic-directives-plugins-syntax/444
- Pandoc divs / spans：https://pandoc.org/chunkedhtml-demo/8.18-divs-and-spans.html
- MyST：https://mystmd.org/guide/syntax-overview
- Obsidian 支持的格式：https://obsidian.md/help/file-formats
- Typora 媒体：https://support.typora.io/Media/
- iA Writer Content Blocks：https://ia.net/writer/support/library/content-blocks
