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
src/
├── main/                    # 主进程
│   ├── index.ts            # 主进程入口
│   ├── window.ts           # 窗口管理
│   ├── ipc-handlers.ts     # IPC 通信处理
│   └── shortcuts/          # 快捷键系统
│       ├── index.ts        # 快捷键管理器
│       ├── window.ts       # 窗口相关快捷键
│       ├── devtools.ts     # 开发者工具快捷键
│       └── file.ts         # 文件操作快捷键
├── render/                  # 渲染进程
│   ├── App.tsx             # 主应用组件
│   ├── components/         # 组件
│   ├── shortcuts/          # 快捷键处理
│   │   ├── index.ts        # 快捷键管理器
│   │   └── file.ts         # 文件操作处理
│   └── utils/              # 工具函数
└── types/                   # 类型定义
```

## 技术栈

- **前端**: React + TypeScript + Vite
- **后端**: Electron
- **存储**: SQLite (`better-sqlite3`)
- **样式**: SCSS Modules
- **构建**: Vite + Electron Builder

## 许可证

MIT License
