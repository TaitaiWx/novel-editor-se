# DiffEditor 使用指南与版本控制设计

## DiffEditor 组件

### 功能说明

DiffEditor 是基于 `@codemirror/merge` 的并排差异对比视图，用于：

- 查看文件修改前后的对比
- 版本回溯查看
- 审阅修改内容

### 使用方式

```tsx
import DiffEditor from './components/DiffEditor';

<DiffEditor
  original="原始文本内容"
  modified="修改后的文本内容"
  originalLabel="v1.0"
  modifiedLabel="v1.1"
  onClose={() => setShowDiff(false)}
/>;
```

### 参数说明

| 参数            | 类型         | 必填 | 说明                       |
| --------------- | ------------ | ---- | -------------------------- |
| `original`      | `string`     | 是   | 原始文本                   |
| `modified`      | `string`     | 是   | 修改后文本                 |
| `originalLabel` | `string`     | 否   | 左侧标签（默认"原始版本"） |
| `modifiedLabel` | `string`     | 否   | 右侧标签（默认"修改版本"） |
| `onClose`       | `() => void` | 否   | 关闭回调                   |

### 内部实现

- **引擎**：`@codemirror/merge` v6.12.1 的 `MergeView`
- **折叠**：相同内容自动折叠，保留上下 3 行上下文，最小折叠区 4 行
- **主题**：暗色主题，与编辑器一致
- **只读**：两侧均不可编辑
- **字体**：等宽字体 Fira Code / Monaco / Menlo

### 示例场景

#### 场景 1：查看自动保存前后的差异

```
用户编辑 → 自动保存触发前 → 对比当前内容与磁盘内容
```

#### 场景 2：版本快照对比

```
打开历史版本 A → 与当前版本 B 对比
```

## 版本控制设计方案

### 两种方案对比

#### 方案 A：编辑器内嵌（推荐初期）

在编辑区域内直接展示 DiffEditor，替换当前的文本编辑器：

```
┌─ TitleBar ────────────────────────────────┐
│                                           │
├─ FilePanel ─┬─ DiffEditor ────────┬─ Right│
│  files...   │  left  │  right    │  panel │
│             │  原始   │  修改     │        │
│             │        │           │        │
├─────────────┴────────┴───────────┴────────┤
│  StatusBar                                │
└───────────────────────────────────────────┘
```

**优点**：实现简单，利用现有 ContentPanel 区域
**缺点**：替换了编辑器，无法同时编辑和对比

#### 方案 B：底部时间线 + 弹出对比

在状态栏上方增加版本时间线条，点击版本节点弹出 DiffEditor 浮层：

```
┌─ TitleBar ────────────────────────────────┐
├─ FilePanel ─┬─ TextEditor ────────┬─ Right│
│             │  正常编辑区         │  panel │
│             │                     │        │
│             ├─ VersionTimeline ───┤        │
│             │  v1 ── v2 ── v3 ── v4       │
├─────────────┴─────────────────────┴────────┤
│  StatusBar                                │
└───────────────────────────────────────────┘
```

**优点**：不打断编辑流程，时间线直观
**缺点**：需要更多 UI 空间，实现复杂度高

### 推荐策略

**Phase 1:** 方案 A — 编辑器内嵌式。通过标签页切换实现：

- 正常编辑标签显示 TextEditor
- "对比"标签显示 DiffEditor
- 用户可以在标签间快速切换

**Phase 2:** 方案 B — 底部时间线。当版本管理（SQLite 快照）完善后，在底部添加版本时间线：

- 时间线显示文件的提交历史
- 点击任意两个版本节点，在编辑区展示 DiffEditor
- 支持拖拽选择版本范围

### 数据来源

版本数据可以来自：

1. **自动保存快照**：每次自动保存时在内存中保留最近 N 个版本
2. **SQLite 项目快照**：通过 `db-version-list` + `db-version-get-file-content` 获取历史版本
3. **手动保存点**：用户主动创建的命名版本（书签）

### 集成到现有架构

```typescript
// ContentPanel 增加 diff 模式
interface ContentPanelProps {
  // ...现有 props
  diffMode?: {
    original: string;
    modified: string;
    originalLabel: string;
    modifiedLabel: string;
  };
}

// 当 diffMode 有值时渲染 DiffEditor，否则渲染 TextEditor
```
