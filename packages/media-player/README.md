# @novel-editor/media-player

自绘的 React 视频 / 音频播放器（不使用原生 `controls`）。小说编辑器的正文 `::video`、参考窗格、场景视频检查器都用它；也可以直接拿到别的项目（例如视频站点）里使用。

> 暂不发布：还在开发中，目前只在 monorepo 内以源码形式使用（`"private": true`）。

- **可插拔播放引擎**：MP4 / M4V / MOV / WebM / Ogg / MKV / 纯音频原生播放；HLS（`.m3u8`）用 [hls.js](https://github.com/video-dev/hls.js)；DASH（`.mpd`）用 [dash.js](https://github.com/Dash-Industry-Forum/dash.js)；FLV / MPEG-TS 用 [mpegts.js](https://github.com/xqq/mpegts.js)（bilibili flv.js 的维护版）。三者都是**可选依赖**，只有真正播放对应格式时才动态 `import()`；没装时给出「需要安装 xxx」的错误（Safari / iOS 上 HLS 会退回原生播放）。完整列表见「格式兼容矩阵」
- **纯音频**：mp3 / aac / m4a / ogg / opus / wav / flac（或读到元数据后没有画面的任何源，例如纯音频 HLS / DASH）显示紧凑的音频界面：封面 + 波形样式进度 + 常显控制条
- **清晰度切换**：多地址清晰度（`qualities`），或 HLS / DASH 档位 +「自动」（自适应码率）；切换后保持播放位置与播放状态
- **播放速度**（0.5–2x）、**字幕**（WebVTT）、**画中画**、**循环**、**全屏**
- **截图**：当前画面 → PNG（或 JPEG / WebP）Blob
- **录制**：录下播放器里的画面与声音 → WebM（浏览器支持时 MP4），显示已录时长，可限制最长时长
- 已缓冲区间、进度条悬停时间、加载中、错误浮层（可重试）、`poster`、`startTime`
- 无黑边：读到元数据后容器按视频宽高比贴合；控制条只在暂停、悬停、键盘聚焦时浮现
- 声音友好：用户发起的播放默认有声；只有自动播放的预览静音起播，并显示「开启声音」；判断出没有音轨时显示「无音轨」
- 兼容性：所有能力按特性检测（全屏含 webkit 前缀与 iOS 视频全屏、画中画含 Safari presentation mode、`captureStream` / `mozCaptureStream`、`MediaRecorder` 格式、`requestVideoFrameCallback`），不支持的按钮自动隐藏；导入时不访问 `window` / `document`（SSR 安全）
- 全屏时提示与菜单都渲染在播放器内部（挂到 `body` 的浮层在全屏时看不见）

## 在其他项目中使用（Vite）

本包以 **TypeScript 源码 + SCSS Module** 形式提供（`main` 指向 `src/index.ts`），需要使用方的构建工具处理 TS / TSX 与 `*.module.scss`。Vite 项目：

```bash
# 依赖：React 18、react-icons；sass 用于编译样式
pnpm add react react-dom react-icons
pnpm add -D sass
# 按需：播放 HLS / DASH / FLV 时再装
pnpm add hls.js dashjs mpegts.js
# 本包（monorepo 外可用 link / workspace / git 子目录等方式引入）
pnpm add @novel-editor/media-player@link:../novel-editor-se/packages/media-player
```

```tsx
// src/App.tsx
import { useRef } from 'react';
import { VideoPlayer, type VideoPlayerHandle } from '@novel-editor/media-player';

export default function App() {
  const player = useRef<VideoPlayerHandle>(null);
  return (
    <VideoPlayer
      ref={player}
      title="第 1 集"
      src={{
        src: 'https://cdn.example.com/ep1/1080.flv',
        qualities: [
          {
            id: '1080',
            label: '1080P 高清',
            src: 'https://cdn.example.com/ep1/1080.flv',
            height: 1080,
          },
          { id: '720', label: '720P', src: 'https://cdn.example.com/ep1/720.flv', height: 720 },
          { id: '480', label: '480P', src: 'https://cdn.example.com/ep1/480.mp4', height: 480 },
        ],
        defaultQuality: '720',
      }}
      poster="https://cdn.example.com/ep1/cover.jpg"
      crossOrigin="anonymous"
      tracks={[{ src: '/subs/ep1.zh.vtt', srclang: 'zh', label: '中文', default: true }]}
      maxWidth={960}
      showLoopToggle
      onScreenshot={(blob, meta) => upload(blob, meta.fileName)}
      onError={(error) => console.warn(error.code, error.message)}
    />
  );
}
```

`vite.config.ts` 不需要特别配置。hls.js / dash.js / mpegts.js 会被打成独立的懒加载分包，页面不播放对应格式时不会下载。

构建工具会解析 `import('hls.js')` / `import('dashjs')` / `import('mpegts.js')`，所以需要能找到这些包。确实不想安装时，把它们别名到一个空模块（播放器会报「需要安装 hls.js」并退回原生 / 显示错误），并只保留原生引擎：

```ts
// vite.config.ts
export default defineConfig({
  resolve: {
    alias: {
      'hls.js': '/src/empty-module.ts', // 内容：export {};
      dashjs: '/src/empty-module.ts',
      'mpegts.js': '/src/empty-module.ts',
    },
  },
});
```

```tsx
import { nativeEngine } from '@novel-editor/media-player';
<VideoPlayer src={url} title="预告片" engines={[nativeEngine]} />;
```

用 webpack / Next.js 等时需要配置 TS / TSX 转译与 `*.module.scss`（Next.js 需把本包加入 `transpilePackages`，并在客户端组件中使用）。

## 播放源

`src` 可以是地址字符串，也可以是描述：

```ts
interface PlayerSource {
  src: string;
  type?: 'mp4' | 'webm' | 'mov' | 'ogg' | 'mkv' | 'audio' | 'hls' | 'dash' | 'flv' | 'mpegts' | 'auto'; // 默认 auto
  mimeType?: string; // 例如 application/x-mpegURL，可帮助推断
  qualities?: Array<{ id: string; label: string; src: string; height?: number; bitrate?: number; type?: ... }>;
  defaultQuality?: string;
  isLive?: boolean; // 直播（mpegts.js；ws / wss 地址默认按直播；HLS / DASH 由清单自动判断）
  audioOnly?: boolean; // 纯音频（省略时按 MIME / 扩展名判断，读到元数据后以有没有画面为准）
}
```

格式推断（`detectSourceType`，纯函数）：显式 `type` → MIME（可带 `codecs` 参数）→ 地址扩展名（忽略查询串 / 片段，不区分大小写）→ 地址里的提示（`format=m3u8` / `format=mpd` / `type=flv`）→ `ws://` / `wss://` 视为 FLV 直播 → 其余交给原生。`data:` 地址读自身的 MIME；`blob:` 地址没有扩展名，请传 `mimeType`（例如 `{ src: blobUrl, mimeType: 'audio/wav' }`），不传时交给原生，读到元数据后再判断是不是纯音频。

## 格式兼容矩阵

| 格式                 | 扩展名 / MIME                                                                 | 引擎                                 | 需要安装    | 说明                                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------- | ------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MP4 / M4V            | `.mp4` `.m4v` · `video/mp4`                                                   | 原生                                 | —           | H.264 普遍支持；H.265 / HEVC、AV1 取决于浏览器与硬件（用 `getCapabilities()` 查看）                                                                             |
| MOV                  | `.mov` · `video/quicktime`                                                    | 原生                                 | —           | Chromium 的 `canPlayType` 不认 MOV，但 H.264 / AAC 的 MOV 通常能播：按「可能」尝试原生，失败时提示转封装                                                        |
| WebM                 | `.webm` · `video/webm`                                                        | 原生                                 | —           | VP8 / VP9 / AV1 + Vorbis / Opus                                                                                                                                 |
| Ogg 视频             | `.ogv` · `video/ogg`                                                          | 原生                                 | —           | Theora（Safari 不支持）                                                                                                                                         |
| MKV                  | `.mkv` · `video/x-matroska`                                                   | 原生（尝试）                         | —           | 编码为 H.264 / VP9 / AV1 + AAC / Opus / Vorbis 时 Chromium / Electron 通常能播；HEVC / AC-3 / DTS 等会报「浏览器无法解码这个 MKV 文件…建议转封装为 MP4 / WebM」 |
| 纯音频               | `.mp3` `.aac` `.m4a` `.ogg` `.oga` `.opus` `.weba` `.wav` `.flac` · `audio/*` | 原生                                 | —           | 显示音频界面                                                                                                                                                    |
| HLS                  | `.m3u8` · `application/x-mpegURL`                                             | hls.js（Safari / iOS 无 MSE 时原生） | `hls.js`    | TS 与 fMP4 分片、直播 / 低延迟、多码率档位 +「自动」                                                                                                            |
| DASH                 | `.mpd` · `application/dash+xml`                                               | dash.js                              | `dashjs`    | 点播与直播（`type="dynamic"`）、多码率档位 +「自动」、纯音频 DASH 用音频档位；DRM 内容不支持                                                                    |
| FLV                  | `.flv` · `video/x-flv`、`ws(s)://`                                            | mpegts.js                            | `mpegts.js` | 点播、HTTP-FLV / WebSocket-FLV 直播（H.264 + AAC）                                                                                                              |
| MPEG-TS              | `.ts` `.m2ts` `.mts` · `video/mp2t`                                           | mpegts.js                            | `mpegts.js` | 单个 TS 文件 / TS 直播流                                                                                                                                        |
| RTMP / RTSP / SRT 等 | `rtmp://` `rtsp://` `srt://` …                                                | —                                    | —           | **浏览器无法直接播放**，见下文                                                                                                                                  |

流媒体引擎（hls.js / dash.js / mpegts.js）都依赖 MSE（`MediaSource`，iOS 17.1+ 为 `ManagedMediaSource`）。没有 MSE 的环境里只有 HLS 能靠原生播放。

### 不支持的协议：RTMP / RTSP

浏览器没有 RTMP / RTSP / SRT 的实现（Flash 已退役），播放器遇到这些地址会直接报 `unsupported` 并说明原因。需要在服务端用网关转换：

- **转 HLS**（延迟 3–10 秒，兼容性最好）：`ffmpeg -i rtsp://cam/stream -c:v copy -c:a aac -f hls -hls_time 2 -hls_list_size 6 -hls_flags delete_segments out.m3u8`，或用 SRS / nginx-rtmp / MediaMTX 自动生成
- **转 HTTP-FLV / WebSocket-FLV**（延迟 1–3 秒）：SRS、nginx-http-flv-module 等直接把 RTMP 输出为 `http(s)://…/live.flv` 或 `ws(s)://…`
- **转 WebRTC**（亚秒级）：MediaMTX / SRS / Janus 输出 WHEP；本包没有内置 WebRTC 引擎，可实现一个 `MediaEngineFactory` 通过 `engines` 接入（见「引擎」）

### 能力检测：`canPlay` / `getCapabilities`

```ts
import { canPlay, getCapabilities } from '@novel-editor/media-player';

canPlay('https://cdn.example.com/live/index.m3u8');
// { playable: true, engine: 'hls', type: 'hls', confidence: 'probably', audioOnly: false,
//   requires: 'hls.js', reason: '通过 MSE 播放（需要 hls.js）' }
canPlay({ src: 'https://x/a.mp4', mimeType: 'video/mp4; codecs="hvc1.1.6.L93.B0"' }); // 按 HEVC 精确探测
canPlay('rtmp://live.example.com/app/key'); // { playable: false, engine: null, reason: '浏览器无法直接播放 RTMP 地址：…' }

const caps = getCapabilities();
// { mse: true, formats: [{ type, label, extensions, engine, requires, live, playable, confidence, codecs: [{ label, mime, supported }], note }] }
```

- 只看地址 / 类型与环境能力，不发网络请求；`confidence` 为 `probably` / `maybe` / `no`（与 `canPlayType` 一致：`maybe` 表示很可能能播但要真正解码才知道，例如 MKV / 没声明类型的 `blob:`）
- 探测函数可注入，便于测试与 SSR：`canPlay(src, { probe: { canPlayType, isTypeSupported } })`、`getCapabilities(probe)`；`canPlay(src, { engines })` 时处理该格式的自定义引擎优先
- `requires` 只说明需要哪个可选依赖，是否已安装要到真正加载时才知道（没装时报 `engine-missing`）

## 纯音频

- 判断：`audioOnly` → MIME 为 `audio/*`（HLS 的 `audio/mpegurl` 除外）→ 纯音频扩展名；读到元数据后以实际有没有画面（`videoWidth` / `videoHeight`）为准，所以 `.ogg` 里有视频、或 `.mp4` 里只有声音都能显示正确的界面
- 界面：根元素 `aria-label="音频 <title>"`、`data-media="audio"`；封面（`poster`，没有时为播放 / 暂停圆标，点击切换播放）、标题、额外操作（`actions`）、波形样式的进度（按标题生成的固定图案，不解码音频；点击跳转）、「开启声音」在波形右侧；控制条常显：播放、进度、音量、时间、循环、设置（速度 / 清晰度）。截图、录制、画中画、全屏、字幕不显示（对应快捷键也不响应）
- 宽度占满父容器（不超过 `maxWidth`），高度由内容决定

## 引擎

默认顺序：hls.js → dash.js → mpegts.js → 原生；都不处理某个格式时，浏览器 `canPlayType` 声明支持就交给原生，否则报「不支持」。换片、换清晰度、重试、卸载时都会销毁旧引擎。

```ts
import {
  createDashEngine,
  createHlsEngine,
  createFlvEngine,
  nativeEngine,
  type MediaEngineFactory,
} from '@novel-editor/media-player';

const engines: MediaEngineFactory[] = [
  createHlsEngine({ config: { lowLatencyMode: true }, preferNative: false }),
  createDashEngine({ settings: { streaming: { delay: { liveDelay: 4 } } } }), // player.updateSettings
  createFlvEngine({ config: { enableWorker: true } }),
  nativeEngine,
];
```

自定义引擎（例如 WebRTC / WHEP、私有协议）实现 `MediaEngineFactory`：

```ts
const whepEngine: MediaEngineFactory = {
  kind: 'whep',
  handles: (type) => type === 'mp4', // 或者给这类源显式 type，再在 handles 里识别
  async attach(video, { url, onError }) {
    const pc = await connectWhep(url); // 自己实现：WHEP 信令
    pc.ontrack = (event) => (video.srcObject = event.streams[0]);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') onError?.(new PlayerError('network', 'WebRTC 连接失败'));
    };
    return {
      kind: 'whep',
      levels: () => [],
      currentLevel: () => 'auto',
      setLevel: () => undefined,
      destroy: () => pc.close(),
    };
  },
};
```

DASH 引擎同时兼容 dash.js v5（`getRepresentationsByType` / `setRepresentationForTypeById`）与 v4（`getBitrateInfoListFor` / `setQualityFor`）；选具体档位时关闭 ABR，选「自动」时重新打开。错误码映射：清单 / 分片 / 时间同步失败 → `network`，MSE 不可用或 DRM → `unsupported`，其余 → `media`。

## 属性

| 属性                                           | 类型                                          | 默认     | 说明                                                                                                                                  |
| ---------------------------------------------- | --------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src`                                          | `string \| PlayerSource`                      | —        | 视频地址或播放源描述（对象每次渲染重新创建也不会重新加载）                                                                            |
| `title`                                        | `string`                                      | —        | 名称：`aria-label`「视频 X」、悬停标题、截图 / 录制文件名                                                                             |
| `variant`                                      | `'full' \| 'compact'`                         | `'full'` | `compact`：静音自动循环播放、没有控制条（纯音频只显示封面与波形）                                                                     |
| `autoPlay`                                     | `boolean`                                     | `false`  | 自动播放（静音起播，显示「开启声音」）                                                                                                |
| `defaultMuted` / `defaultLoop`                 | `boolean`                                     | `false`  | 默认静音 / 循环                                                                                                                       |
| `defaultVolume`                                | `number`                                      | `1`      | 初始音量 0–1                                                                                                                          |
| `defaultPlaybackRate`                          | `number`                                      | `1`      | 初始播放速度                                                                                                                          |
| `poster`                                       | `string`                                      | —        | 封面图（不传时停在第一帧附近当封面）                                                                                                  |
| `startTime`                                    | `number`                                      | —        | 从第几秒开始                                                                                                                          |
| `crossOrigin`                                  | `'' \| 'anonymous' \| 'use-credentials'`      | —        | 跨域视频要截图 / 录制时设置（服务器需返回 CORS 头）                                                                                   |
| `tracks`                                       | `PlayerTrack[]`                               | —        | 字幕：`{ src, label, srclang?, kind?, default? }`（WebVTT）                                                                           |
| `engines`                                      | `MediaEngineFactory[]`                        | 默认引擎 | 替换 / 追加播放引擎                                                                                                                   |
| `controls`                                     | `PlayerControls`                              | 全部显示 | 隐藏控制项：`play` `progress` `volume` `time` `loop` `screenshot` `record` `pip` `settings` `quality` `speed` `captions` `fullscreen` |
| `showLoopToggle`                               | `boolean`                                     | `false`  | 显示「循环播放」开关（等同 `controls.loop`）                                                                                          |
| `showTitle`                                    | `boolean`                                     | `true`   | 悬停时左上角显示标题                                                                                                                  |
| `maxRecordingSeconds`                          | `number`                                      | `600`    | 最长录制时长，到时自动停止                                                                                                            |
| `screenshotType`                               | `'image/png' \| 'image/jpeg' \| 'image/webp'` | PNG      | 截图格式                                                                                                                              |
| `actions`                                      | `ReactNode`                                   | —        | 右上角额外操作，与控制条一起浮现                                                                                                      |
| `maxWidth` / `maxHeight`                       | `number` / `number \| string`                 | —        | 最大宽 / 高，宽度按比例收窄                                                                                                           |
| `className` / `videoClassName` / `videoTestId` | `string`                                      | —        | 根元素类名 / 内部 `<video>` 的类名与 `data-testid`                                                                                    |
| `renderTooltip`                                | `(content, control, context) => ReactNode`    | —        | 自定义提示；`context.container` 在全屏时是播放器根元素，浮层应挂到这里                                                                |
| `onScreenshot`                                 | `(blob, meta) => void \| boolean \| Promise`  | 下载     | 截图结果；返回 `false` 表示没保存（不提示「已截图」）                                                                                 |
| `onRecording`                                  | `(blob, meta) => void \| boolean \| Promise`  | 下载     | 录制结果；`meta`：`duration` `mimeType` `extension` `fileName` `hasAudio` `startTime`                                                 |
| `onError`                                      | `(error: PlayerError) => void`                | —        | `error.code`：`engine-missing` `unsupported` `network` `decode` `media` `tainted` `not-ready` `unknown`                               |
| `onMetadata`                                   | `({ width, height, duration }) => void`       | —        | 读到元数据                                                                                                                            |
| `onAudioTrack`                                 | `('present' \| 'absent') => void`             | —        | 判断出有没有音轨时回调一次                                                                                                            |
| `onTimeUpdate` / `onEnded` / `onQualityChange` | —                                             | —        | 播放进度 / 结束 / 清晰度变化                                                                                                          |
| `onLayoutChange`                               | `() => void`                                  | —        | 尺寸可能变化（读到元数据、进出全屏）                                                                                                  |

### ref

```ts
interface VideoPlayerHandle {
  readonly video: HTMLVideoElement | null;
  play(): Promise<void>;
  pause(): void;
  seek(time: number): void;
  setPlaybackRate(rate: number): void;
  setQuality(id: string): void; // HLS 档位另有 'auto'
  screenshot(): Promise<Blob>; // 只返回 Blob，不触发 onScreenshot
  startRecording(): Promise<boolean>;
  stopRecording(): Promise<Blob | null>;
  toggleFullscreen(): void;
}
```

### 截图与录制

- 截图：把当前帧画到 canvas。本地文件、`blob:` 与同源视频都能截；跨域视频必须由服务器返回 CORS 头并设置 `crossOrigin="anonymous"`，否则 canvas 被「污染」，播放器提示「无法截取跨域视频」（`code: 'tainted'`）
- 录制：`video.captureStream()`（Firefox 为 `mozCaptureStream`）+ `MediaRecorder`。格式依次尝试 `video/mp4;codecs=avc1,mp4a` → `video/mp4` → `video/webm;codecs=vp9,opus` → `vp8,opus` → `video/webm`。暂停时开始录制会先播放；视频有音轨时一起录制。跨域限制与截图相同。浏览器不支持时不显示录制按钮
- 纯函数也可单独使用：`captureFrame(video)`、`startRecordingSession(video, options)`、`nextRecordingStatus`、`pickRecorderMimeType`

## 键盘

播放器获得焦点时（`compact` 不响应键盘；带 ⌘ / Ctrl / Alt 的按键交给宿主）：

| 按键          | 作用                            |
| ------------- | ------------------------------- |
| `Space` / `K` | 播放 / 暂停                     |
| `←` / `→`     | 后退 / 前进 5 秒                |
| `↑` / `↓`     | 音量 ±10%                       |
| `M`           | 静音 / 取消静音                 |
| `F`           | 全屏 / 退出全屏（双击画面同样） |
| `S`           | 截图                            |
| `R`           | 开始 / 停止录制                 |
| `<` / `>`     | 减速 / 加速                     |
| `C`           | 字幕开 / 关                     |
| `P`           | 画中画                          |

进度条（`role="slider"`）聚焦时：`←` / `↓` 后退、`→` / `↑` 前进 5 秒，`Home` / `End` 跳到首尾。设置菜单里 `↑` / `↓` 移动、`Esc` 返回上一级 / 关闭。

## 无障碍

- 根元素 `role="group"`、`aria-label="视频 <title>"`，可 Tab 聚焦，键盘聚焦时控制条常显
- 所有按钮都有 `aria-label`（播放 / 暂停、静音 / 取消静音 / 无音轨、循环播放、截图、开始录制 / 停止录制、画中画、设置、全屏 / 退出全屏、开启声音）；开关类按钮带 `aria-pressed`
- 设置菜单 `role="menu"`，选项为 `menuitemradio`（`aria-checked`）
- 进度条 `role="slider"`，带 `aria-valuenow` / `aria-valuemax` / `aria-valuetext`；音量为原生 range，`aria-label="音量"`
- 根元素暴露 `data-paused` / `data-muted` / `data-audio` / `data-aspect` / `data-engine` / `data-media`（`video` / `audio`）/ `data-fullscreen` / `data-recording`，便于测试
- 尊重 `prefers-reduced-motion`

## 音轨判断

浏览器没有统一 API，按可用程度依次使用：`audioTracks`（规范）→ `mozHasAudio`（Firefox）→ `webkitAudioDecodedByteCount`（Chromium / Electron：大于 0 即有声；实际播放至少 1 秒仍为 0 才判定无声）。判断不了时一律按「有声音」处理。

## 主题

可覆盖的 CSS 变量：`--media-player-accent`（进度条 / 开关 / 选中项高亮色）、`--media-player-focus-ring`（焦点环，默认沿用宿主的 `--ui-interaction-focus-ring`）。播放器宽度不超过 300px 时隐藏截图 / 录制 / 画中画按钮（快捷键仍可用）。

## 开发

```bash
pnpm test:ut packages/media-player   # 单元 / 组件测试（happy-dom + 媒体 API 替身）
pnpm --filter @novel-editor/media-player typecheck
```

hls.js / dashjs / mpegts.js 作为本包的 devDependencies 安装，用于类型检查与测试；对使用方是可选的 peer 依赖（dashjs 支持 v4 / v5）。
