# 大纲提取算法

`@novel-editor/basic-algorithm` 的大纲模块从正文提取标题目录（`extractOutline`）与幕 / 场结构（`extractActs`），供右侧「大纲」面板的目录、卷纲、大纲导入与场景视频使用。章 / 幕 / 场标题行的识别规则可由作者配置（「设置 → 正文结构」）。

相关代码：

- `packages/basic-algorithm/src/outline/`：`extract-outline.ts`、`extract-acts.ts`、`novel-markers.ts`（`:::scene` 场景容器）、`types.ts`
- 结构规则：`packages/core/src/structure-rules.ts`（`classifyStructureLine` / `compileStructureRules`，预设 `zh` / `en` / `numbered` + 自定义正则）、`structure-config.ts`（读写配置）
- 卷纲推导：`packages/basic-algorithm/src/volume-plan/`（`deriveVolumeOutline` / `hasActMarkers`）
- 使用方：`apps/pc/src/render/components/RightPanel/useOutlineEntries.ts`（目录）、`outline-import.ts` / `lore-import.ts`（导入）、`VolumePlanView/`（卷纲）；渲染进程当前规则来自 `utils/structureRules.ts`
- 测试：`outline/*.test.ts`、`volume-plan/structure-classify.test.ts`、`packages/core/test/structure-rules.test.ts`

## 为什么用规则而不是 NLP

- **实时**：每次输入都可能重算，需要毫秒级；NLP 推理通常几十到几百毫秒
- **确定**：同样输入同样输出，大纲不会「闪烁」
- **体积**：不引入模型文件与推理运行时
- **够用**：小说 / 剧本的结构标记高度规范（第X章、Chapter 1、第X幕、Act I），规则准确率接近 100%，其余靠启发式兜底；作者还能用自定义正则补充

## 结构规则（classify）

两个函数都接受可选的 `classify: (line) => 'chapter' | 'act' | 'scene' | null`，通常传入 `(line) => classifyStructureLine(line, rules)`。basic-algorithm 不依赖 core，只约定签名；不传时行为与旧版一致（内置中文规则）。

| 预设       | 识别                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------- |
| `zh`       | 第N章 / 回 / 卷 / 部 / 篇 / 集 / 节、序章 / 楔子 / 尾声 / 番外 … → 章；第N幕 → 幕；第N场 → 场（≤40 字） |
| `en`       | Chapter 12 / XII / Twelve、Ch. 3、Part、Book、Prologue / Epilogue … → 章；Act 1 / Act I → 幕；Scene 1 → 场（不区分大小写，≤60 字） |
| `numbered` | `1.` / `1、` / `001` → 章（默认关闭）                                                               |

预设都要求独占一行、不以句读结尾；默认启用 `zh` + `en`。自定义规则优先于预设，保存前做安全校验（长度、能否匹配空行、嵌套量词等）。

## extractOutline：多策略标题提取

单次遍历，每行命中第一条策略即跳到下一行，O(n)。

| 顺序 | 策略             | 规则                                       | 层级                            | `source`          |
| ---- | ---------------- | ------------------------------------------ | ------------------------------- | ----------------- |
| 1    | Markdown 标题    | `^#{1,6}\s+`                               | `#` 数量                        | `markdown`        |
| 1.5  | 结构规则         | `classify(line)`                           | 章 / 幕 = 1，场 = 2             | `structure-rule`  |
| 2    | 中文章节标记     | 第[数字]+[章幕节卷部回篇集]                | 章幕卷部 = 1，回集节篇 = 2      | `chinese-section` |
| 3    | 数字编号         | `1.` / `1.2` / `1、`（排除日期行）         | 编号深度                        | `numbered`        |
| 4    | 分隔线标题       | `--- 序章 ---`                             | 1                               | `separator`       |
| 5    | 自定义正则       | `customPatterns`                           | 1                               | `heuristic`       |
| 6    | 启发式           | 2–40 字的短行且上下都是空行                | 2                               | `heuristic`       |

启发式排除：以标点开头、纯数字 / 标点、分隔线。源码正则里的汉字一律写成 `\uXXXX` 转义（仓库规范）。

```ts
interface OutlineOptions {
  classify?: StructureClassifier; // 作者配置的结构规则
  enableHeuristic?: boolean;      // 默认 true；目录视图传 false
  customPatterns?: RegExp[];      // 追加在内置规则之后
}
```

## extractActs：幕 / 场提取

1. 幕行（「第X幕」或 `classify` 判为 act）→ 新建幕
2. 场行（「第X场」、`classify` 判为 scene，或小说格式场景容器 `:::scene{title=…}`）→ 挂到当前幕；场景出现在任何幕之前时自动建「默认幕」
3. 场景下第一行非空、非指令的正文作为 `preview`（≤80 字）
4. 全文没有幕 / 场标记时，按章节标题每 10 章生成一幕（只有一幕时标题为「全篇」），每章作为一个场景

```ts
interface ActNode { title: string; line: number; scenes: SceneNode[] }
interface SceneNode { title: string; line: number; preview: string }
```

卷纲在此之上做跨章推导（幕 → 章 → 节拍，没有幕标记时按章数套三幕式 / 起承转合 / 英雄之旅模板），见 `volume-plan/derive.ts`。

## 可能的方向

- 超长文本（百万字级）把提取移到 Web Worker
- 在后台用模型标注可能遗漏的结构点，只作补充、不替代规则
