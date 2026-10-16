# @novel-editor/ui

小说编辑器的共享 React UI。组件实现、交互、样式和公共 props 统一在这里维护；应用通过 props、回调和插槽接入业务数据。

## 使用

优先按组件子路径导入，避免简单按钮连带加载 CodeMirror 等重型组件：

```tsx
import Button from '@novel-editor/ui/Button';
import Select from '@novel-editor/ui/Select';
import Modal from '@novel-editor/ui/Modal';
import type { SelectOption } from '@novel-editor/ui/Select';

<Button type="button" variant="primary" onClick={save}>保存</Button>
<Select value={status} onChange={setStatus} options={options} />
<Modal open={open} title="编辑条目" onClose={close}>
  {form}
</Modal>
```

根入口也提供命名导出；业务代码和懒加载入口优先使用子路径。组件包不创建第二套 React、Toast 或 Dialog 上下文，应用只挂载一套对应 Provider。

## 组件目录

| 分类         | 组件                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| 基础控件     | Button、Input、TextArea、Checkbox、Switch、NumberInput、ColorPicker                                   |
| 选择与导航   | Select、SearchMultiSelect、Tabs、TabBar、SettingsButton                                               |
| 浮层与对话框 | OverlayPortal、Popover、Tooltip、CopyTooltip、ContextMenu、Modal、DialogProvider / useDialog          |
| 状态反馈     | ToastProvider / useToast / useOptionalToast、LoadingSpinner、EmptyState、ErrorState、GenerationStatus |
| 布局与展示   | ActionButtons、PanelHeader、PanelResizer、Avatar、WindowControls                                      |
| 编辑与对比   | InlineRenameInput、DiffTextInput、DiffText、InlineDiffView、DiffEditor                                |

控件保留原有 refs、键盘导航、输入法保护、焦点恢复和全屏浮层行为。`utils/ime` 是输入法判断的唯一实现。公共动画位于 `styles/animation.scss`。

## 样式与基础控件

沿用应用 `--ui-*` 主题变量，SCSS Modules 随组件导入。不额外注入全局 reset。Button / Input / TextArea 有默认统一外观；迁移已有页面时用 `unstyled` 保留业务布局的 className，仅应用共享基础规则。今后新界面优先使用默认外观与 Button 的 `default / primary / ghost / danger` 变体。

```tsx
// 保留现有业务卡片样式、事件及原生 button 类型语义。
<Button unstyled className={styles.card} onClick={open}>
  查看条目
</Button>
```

Button 保留 HTML 的 type 语义，表单内非提交按钮请显式写 `type="button"`。Input 支持原生输入类型；优先用 Checkbox、Switch、NumberInput、ColorPicker 表达相应交互。TextArea 统一禁止拖动改变尺寸，需要差异标记的输入用 DiffTextInput。

## 应用适配边界

- `CharacterAvatar` 留在应用，负责把作品路径加载为可显示地址，然后交给共享 Avatar。
- 应用 `WindowControls` 负责平台检测和 Electron IPC，共享 WindowControls 只接收状态和操作回调。
- 人物、图谱、章节、AI、视频工作流、编辑器内核、文件读取和数据库存储仍属于业务模块；它们的基础控件已改为调用组件包，不能让组件包反向导入这些模块。
- 自绘播放器继续由 `@novel-editor/media-player` 维护，避免搬入第二份实现。
- 应用原有通用组件路径仅保留转导出，供旧消费者兼容。不得往转导出文件里增加新实现或新样式。
- 不把人物类型、关系、工作区路径、AI 请求或数据库协议塞进通用控件。确需业务操作，通过 props / 回调 / children 注入。

## 测试与检查

```sh
pnpm --filter @novel-editor/ui typecheck
pnpm --filter @novel-editor/ui typecheck:tests
pnpm test:ui
pnpm test:ui:e2e
```

- UT 复用根目录 `vitest.config.ts`，`test:ui` 只筛选 UI 用例并限定覆盖率范围与门槛，没有单独的 UI 配置。Vitest + happy-dom + Testing Library。覆盖所有组件目录，测试键盘导航、输入法保护、焦点恢复、受控输入、异步失败和差异编辑。`coverage/ui/index.html` 为报告，`coverage/ui/coverage-summary.json` 可供 CI 读取。统计包含整个 `src`，只排除类型声明；最低要求：行 95%、语句 90%、函数 90%、分支 85%。根目录 `pnpm test:ut` 也会执行这些用例。
- E2E 统一由 `vitest.e2e.config.ts` 管理：`pc` 为完整应用，`ui` 为组件测试窗口。`pnpm test:e2e` 运行两组，`pnpm test:ui:e2e` 等价于 `pnpm test:e2e --project ui`，只运行 UI。使用 Vitest + 仓库已有的轻量 CDP 客户端（Node 24 原生 WebSocket），不使用 Playwright。测试真实 Electron Chromium 中的点击、键盘、弹层层级、模态焦点、撤销和窄窗口布局。
- E2E 将组件测试页面构建到系统临时目录，启动独立 Electron 进程，使用临时用户目录，不加载应用、数据库或工作区，也不覆盖 `apps/pc/dist`。测试结束自动清理，失败截图与日志在 `packages/ui/e2e/.artifacts/`。需先安装项目依赖和 Electron；Linux CI 使用 `xvfb-run -a pnpm test:ui:e2e`。
- 测试页面提供应用同口径的主题变量；生产方仍负责注入主题。原生 Modal 通过共享浮层容器让子下拉保持在模态范围内。

新增通用组件时同时添加目录、子路径导出、根入口导出和 props 类型，再从应用通过子路径调用。涉及懒加载时保持原有加载边界。
