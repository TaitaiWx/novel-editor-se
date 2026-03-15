# 媒体预览样例

这个目录提供了成对的媒体文件，专门用于验证版本快照的预览和对比能力。

推荐测试流程：

1. 打开任意主文件，例如 `scene-shot.png`、`chapter-map.pdf`、`ambient-theme.wav` 或 `binary-sample.bin`
2. 在版本历史里执行一次“保存版本”
3. 用对应的 `-alt` 文件内容替换主文件
4. 再次保存版本
5. 点击旧版本查看差异或预览

文件对照：

- `scene-board.svg` ↔ `scene-board-alt.svg`
- `scene-shot.png` ↔ `scene-shot-alt.png`
- `chapter-map.pdf` ↔ `chapter-map-alt.pdf`
- `ambient-theme.wav` ↔ `ambient-theme-alt.wav`
- `binary-sample.bin` ↔ `binary-sample-alt.bin`

说明：

- 图片样例用于验证图片并排对比
- PDF 样例用于验证 PDF 页缩略图和页面切换
- 音频样例用于验证音频播放器和元信息展示
- 二进制样例用于验证通用二进制元信息面板
