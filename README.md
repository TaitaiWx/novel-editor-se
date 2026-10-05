# 小说编辑器

一个基于 Electron 的跨平台小说编辑器。

## 功能特性

- 📁 文件夹浏览器
- 📝 文本编辑器
- 🕘 SQLite 原生版本快照
- 🎨 代码高亮
- ⌨️ 键盘快捷键
- 🔧 开发者工具

## 键盘快捷键

### 文件操作

| 快捷键                         | 描述         |
| ------------------------------ | ------------ |
| `Ctrl+N` / `Cmd+N`             | 新建文件     |
| `Ctrl+O` / `Cmd+O`             | 打开文件夹   |
| `Ctrl+S` / `Cmd+S`             | 保存当前文件 |
| `Ctrl+Shift+S` / `Cmd+Shift+S` | 另存为       |

### 窗口操作

| 快捷键             | 描述         |
| ------------------ | ------------ |
| `Ctrl+W` / `Cmd+W` | 关闭当前窗口 |
| `Ctrl+Q` / `Cmd+Q` | 退出应用     |
| `Ctrl+M` / `Cmd+M` | 最小化窗口   |
| `F11`              | 切换全屏模式 |

### 开发者工具

| 快捷键             | 描述                  |
| ------------------ | --------------------- |
| `Ctrl+Shift+I`     | 打开/关闭开发者工具   |
| `Ctrl+R` / `Cmd+R` | 刷新页面 (仅开发模式) |

## 开发

### 安装依赖

```bash
pnpm install
```

### 启动开发服务器

```bash
pnpm dev
```

### 构建

```bash
pnpm build
```

## 发布与自动更新

发布与自动更新规范见 [docs/release-process.md](docs/release-process.md)。

## 项目结构

```
apps/
  pc/        # Electron 桌面应用（main / preload / render）
  cli/       # 命令行工具 novel-editor / ne
packages/
  core/             # GUI 与 CLI 共享的核心逻辑
  store/            # SQLite 持久化与版本快照
  basic-algorithm/  # 大纲、人物、diff 等算法
  helpers/          # 通用工具
  components/       # 共享 UI 组件
```

完整的技术规范、目录约定与命令说明见 [agents.md](agents.md)。

## 技术栈

- **前端**: React 18 + TypeScript + Vite 6 + CodeMirror 6
- **桌面端**: Electron 42
- **存储**: SQLite (`better-sqlite3`)
- **样式**: SCSS Modules
- **构建**: Vite + Electron Builder

## 许可证

MIT License
