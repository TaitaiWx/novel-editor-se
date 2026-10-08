# 性能

记录渲染进程的性能要点、已经做过的优化、基准测试和后续方向。新增功能时请沿用这里的约定（只处理可见范围、懒加载、ref 读取最新值）。

相关代码与基准：

- 编辑器：`apps/pc/src/render/components/TextEditor/`（`editor-runtime.ts` 懒加载、`writing-decorations.ts`、`live-preview/`、`assist/`）
- 文件树：`apps/pc/src/render/components/FileTree/index.tsx`
- 基准：`apps/pc/test/render/components/TextEditor/live-preview-view.test.ts`（10 万行 / 5MB 文档，每视口构建中位数 < 16ms）、`latex-demo.test.ts`

## 编辑器（CodeMirror 6）

| 约定                                         | 说明                                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| EditorView 只创建一次                        | 切换文件替换文档内容；配置变化用 Compartment / `appendConfig` 重配，不销毁重建           |
| 只处理可见范围                               | 写作装饰、人物高亮、人物悬停识别只扫 viewport；实时渲染只构建「可见范围 + 余量」内的顶层块 |
| 增量更新                                     | 实时渲染在文档 / 选区变化时只重建受影响的块；IME 组字期间只映射位置不重建               |
| 渲染缓存与预算                               | KaTeX 结果按源码 LRU 缓存；widget 渲染有每帧预算（`render-cache.ts` `hasRenderBudget`），超出的下一帧再渲染 |
| 懒加载                                       | 语言包、实时渲染（KaTeX 单独分包）、AI 辅助经 `editor-runtime.ts` 动态导入；DiffEditor、版本历史等用 `React.lazy`；three.js 只在 3D 预演时动态导入 |
| ref 回调                                     | 编辑器回调与 AI 辅助配置经 ref 读取最新值，避免闭包过期与重复挂载扩展                   |
| 大文件提示                                   | 超过 500KB 显示提示                                                                       |
| 人物识别缓存                                 | 悬停卡片按「文档版本 → 行」缓存识别结果；人物高亮正则按名字长度倒序一次编译，人物列表变化时才重建 |

## React

- 文件树行 `React.memo`；排序 / 过滤 / 解析结果 `useMemo`，回调 `useCallback`
- 文件信息增量获取：只对 `fileInfoMap` 里没有的新路径批量请求（`get-file-info-batch`），删除的路径从 map 清理，卸载后用 `cancelled` 标志丢弃结果
- `App.tsx` 只做组合，状态与逻辑拆到 hooks，面板状态放 ref，减少不必要的重渲染
- 动画用 CSS（transform / opacity），不用 JS 驱动

## 自动保存

2 秒防抖、内容未变不写盘、写作日志写入不阻塞保存，详见 [autosave-optimization.md](autosave-optimization.md)。

## 后续方向（目前无需）

| 方向                         | 触发条件                                 |
| ---------------------------- | ---------------------------------------- |
| 文件树 / 大纲虚拟滚动        | 单层节点超过约 500 个                    |
| 用 Context 减少文件树 prop 链 | 1000+ 文件的项目出现明显重渲染            |
| 大纲提取移到 Web Worker      | 单文件百万字级，`extractOutline` 阻塞输入 |
