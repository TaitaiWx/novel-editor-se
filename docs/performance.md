# 性能优化审计报告

## 审计结论

项目整体性能达到业界良好水平，核心组件均遵循了 React + CodeMirror 6 的最佳实践。以下是各模块的详细评估和已实施的优化。

## 各组件性能评级

| 组件             | 评级           | 说明                                                  |
| ---------------- | -------------- | ----------------------------------------------------- |
| TextEditor (CM6) | 优秀           | Compartment 动态重配、Ref 回调避免重建、viewport 装饰 |
| RightPanel       | 优秀           | 所有解析结果 useMemo、所有回调 useCallback            |
| LoadingSpinner   | 完美           | 纯 CSS 动画 + GPU 加速 transform，零 JS 开销          |
| ContentPanel     | 良好           | 干净的透传组件，无额外计算                            |
| FileTree         | 良好（已优化） | React.memo + useMemo 排序，增量文件信息获取           |
| FilePanel        | 良好           | 新增文件搜索使用 useMemo 过滤                         |
| App.tsx          | 良好           | useCallback 覆盖所有回调，useRef 存储最新值           |

## 已实施的优化

### 1. 写作装饰正则缓存 (`writing-decorations.ts`)

**优化前**：每次击键触发 `buildDecorations`，每次都重新编译人物名称正则 `new RegExp(...)`。

**优化后**：正则在扩展创建时预编译一次（`buildCharRegex`），ViewPlugin 实例整个生命周期内复用。仅当通过 Compartment 重配置更换扩展时才重建正则。

### 2. FileTree 增量文件信息获取 (`FileTree/index.tsx`)

**优化前**：`files` prop 任何变化都重新获取所有文件的 FileInfo（100 个文件 = 100 次 IPC 调用）。

**优化后**：

- 仅获取 `fileInfoMap` 中尚不存在的新增路径
- 已有路径的 FileInfo 直接复用
- 不再存在的路径从 map 中清理
- 添加 `cancelled` 标志防止组件卸载后 setState

### 3. 专注模式居中 (`App.module.scss`)

编辑区内容最大宽度限制为 800px 并居中显示，减少大屏幕下的阅读宽度，符合排版最佳实践。

## 架构级性能分析

### CodeMirror 6 集成 — 业界最佳实践

| 实践                                     | 状态 |
| ---------------------------------------- | ---- |
| 单次 EditorView 创建 + useEffect cleanup | ✅   |
| Compartment 动态重配置（避免销毁重建）   | ✅   |
| ViewPlugin 仅在 viewport 范围内构建装饰  | ✅   |
| Ref 回调替代 state 传递（避免闭包过期）  | ✅   |
| 大文件阈值警告（500KB）                  | ✅   |
| 懒加载语言支持                           | ✅   |

### React 性能模式

| 实践                                | 状态 |
| ----------------------------------- | ---- |
| 树形组件 React.memo（FileTreeItem） | ✅   |
| useMemo 缓存排序/过滤/解析结果      | ✅   |
| useCallback 稳定化回调              | ✅   |
| useRef 存储面板状态避免闭包重渲染   | ✅   |
| CSS 动画替代 JS 动画                | ✅   |

### 自动保存策略

- 2 秒防抖延迟，避免频繁写盘
- 卸载时同步保存未持久化内容
- 仅在内容实际变化时触发（对比原始内容）

## 潜在优化方向（未来）

### 1. Context API 替代 prop drilling

当前 App.tsx → FilePanel → FileTree → FileTreeItem 的 prop 链路较深。对于 1000+ 文件的项目，可考虑 Context API 减少中间组件的重渲染。

**影响**：中等（主要影响文件树操作后的渲染帧数）
**优先级**：低（当前 React.memo 已缓解大部分问题）

### 2. 虚拟滚动

当文件树或大纲面板节点超过 500 个时，可引入 `react-window` 进行虚拟化。

**影响**：仅影响超大项目，当前小说项目通常不超过 200 个文件
**优先级**：低

### 3. Web Worker 大纲提取

对于超长文本（100 万字+），大纲提取可移至 Web Worker 中异步执行，避免阻塞主线程。

**影响**：仅影响极大文件
**优先级**：低（当前 O(n) 算法足够快）
