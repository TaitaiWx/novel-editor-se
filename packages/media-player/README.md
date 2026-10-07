# @novel-editor/media-player

自绘的 React 视频播放器（不使用原生 `controls`，不依赖第三方播放器）。小说编辑器的正文 `::video`、参考窗格、场景视频检查器都用它。

- 无黑边：读到元数据后容器按视频宽高比贴合，可限制最大宽 / 高；不自动播放时停在第一帧附近作封面
- 控制条只在暂停、悬停、键盘聚焦时浮现：播放 / 暂停、可拖动进度条、时间、静音 + 悬停音量、循环（可选）、全屏、右上角额外操作插槽
- 声音友好：用户发起的播放默认有声；只有自动播放的预览静音起播，并显示明显的「开启声音」按钮；能判断出视频没有音轨时，静音按钮显示「无音轨」
- 只依赖 `react-icons`；React 18 为 peer 依赖

## 安装

```bash
pnpm add @novel-editor/media-player
```

本包以 **TypeScript 源码 + SCSS Module** 形式发布（`main` 指向 `src/index.ts`），需要使用方的构建工具处理：

- Vite：开箱即用（需安装 `sass`）
- webpack / Next.js 等：需要 TS / TSX 转译与 `*.module.scss` 支持；或按下文「发布」先构建为 JS + CSS

## 使用

```tsx
import { VideoPlayer } from '@novel-editor/media-player';

<VideoPlayer src={url} title="离港" maxWidth={640} maxHeight="60vh" showLoopToggle />;

// 自动播放的小预览：静音、循环、没有控制条，悬停出现「开启声音」
<VideoPlayer src={url} title="参考" variant="compact" />;

// 用自己的提示组件替换原生 title
<VideoPlayer
  src={url}
  title="离港"
  renderTooltip={(content, control) => <Tooltip content={content}>{control}</Tooltip>}
/>;
```

## 属性

| 属性 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `src` | `string` | — | 视频地址（URL / blob URL） |
| `title` | `string` | — | 名称：分组的 `aria-label`「视频 X」与悬停时左上角标题 |
| `variant` | `'full' \| 'compact'` | `'full'` | `compact`：静音自动循环播放、没有控制条 |
| `autoPlay` | `boolean` | `false` | 自动播放（静音起播，显示「开启声音」） |
| `defaultMuted` | `boolean` | `false` | 不自动播放时是否默认静音 |
| `defaultLoop` | `boolean` | `false` | 默认循环 |
| `defaultVolume` | `number` | `1` | 初始音量 0–1 |
| `showLoopToggle` | `boolean` | `false` | 控制条显示「循环播放」开关 |
| `showTitle` | `boolean` | `true` | 悬停时左上角显示标题 |
| `actions` | `ReactNode` | — | 右上角额外操作，与控制条一起浮现 |
| `maxWidth` | `number` | — | 最大宽度（px） |
| `maxHeight` | `number \| string` | — | 最大高度（数字为 px，字符串为 CSS 长度），宽度按比例收窄 |
| `className` | `string` | — | 根元素类名 |
| `videoClassName` / `videoTestId` | `string` | — | 内部 `<video>` 的类名 / `data-testid` |
| `renderTooltip` | `(content, control) => ReactNode` | — | 自定义控制按钮提示；不传时用原生 `title` |
| `onMetadata` | `({ width, height, duration }) => void` | — | 读到元数据 |
| `onAudioTrack` | `('present' \| 'absent') => void` | — | 判断出有没有音轨时回调一次 |
| `onLayoutChange` | `() => void` | — | 尺寸可能变化（读到元数据、进出全屏），例如让 CodeMirror 重新测量 |

另外导出纯函数：`formatTime`、`clampTime`、`frameWidth`、`ratioFromPointer`、`detectAudioTrack`、`playedSeconds`、`clampVolume` 等。

## 键盘

播放器获得焦点时（`compact` 不响应键盘）：

| 按键 | 作用 |
| --- | --- |
| `Space` / `K` | 播放 / 暂停 |
| `←` / `→` | 后退 / 前进 5 秒 |
| `↑` / `↓` | 音量 ±10% |
| `M` | 静音 / 取消静音 |
| `F` | 全屏 / 退出全屏（双击画面同样） |

进度条（`role="slider"`）聚焦时：`←` / `↓` 后退、`→` / `↑` 前进 5 秒，`Home` / `End` 跳到首尾。

## 无障碍

- 根元素 `role="group"`、`aria-label="视频 <title>"`，可 Tab 聚焦，键盘聚焦时控制条常显
- 所有按钮都有 `aria-label`（播放 / 暂停、静音 / 取消静音 / 无音轨、循环播放（`aria-pressed`）、全屏 / 退出全屏、开启声音）
- 进度条 `role="slider"`，带 `aria-valuenow` / `aria-valuemax` / `aria-valuetext`（「0:12 / 1:05」）；音量为原生 range，`aria-label="音量"`
- 根元素暴露 `data-paused` / `data-muted` / `data-audio`（`unknown | present | absent`）/ `data-aspect`，便于测试
- 尊重 `prefers-reduced-motion`

## 音轨判断

浏览器没有统一 API，按可用程度依次使用：`audioTracks`（规范）→ `mozHasAudio`（Firefox）→ `webkitAudioDecodedByteCount`（Chromium / Electron：大于 0 即有声；实际播放至少 1 秒仍为 0 才判定无声）。判断不了时一律按「有声音」处理，绝不因为猜测而禁用声音。

## 主题

可覆盖的 CSS 变量：`--media-player-accent`（进度条 / 开关高亮色）、`--media-player-focus-ring`（焦点环，默认沿用宿主的 `--ui-interaction-focus-ring`）。

## 发布

当前在 monorepo 内以源码形式使用（`"private": true`）。单独发布到 npm 时：

1. 去掉 `private`，确定包名与 `license`
2. 构建为 JS + CSS，例如用 Vite 库模式（`build.lib`，`formats: ['es']`，`external: ['react', 'react-dom', 'react/jsx-runtime', 'react-icons/vsc']`，CSS Module 会被编译为一份 `style.css`），类型用 `tsc --emitDeclarationOnly --declaration` 输出到 `dist/`
3. 把 `main` / `types` / `exports` 改为指向 `dist/`（并导出 `./style.css`），`files` 改为 `["dist", "README.md"]`
4. `pnpm publish --access public`
