# 文档索引

`docs/` 下是设计、实现说明与流程文档。每篇开头都有适用范围与「相关代码」，以代码为准；文档与代码不一致时请顺手修正文档。

## 产品功能

- [writing-ui.md](writing-ui.md)：写作界面总览（编辑器、实时渲染、右侧「大纲」面板、专注模式、标签、状态栏、快捷键）
- [autosave-optimization.md](autosave-optimization.md)：自动保存（2 秒防抖、切换文件 / 卸载时保存、写盘校验）
- [growth-guide.md](growth-guide.md)：成长档案使用说明（由应用内说明生成，勿手改）
- [character-guide.md](character-guide.md)：角色使用说明（人物设计、图集、成长档案、经历与关系；由应用内说明生成）
- [novel-format.md](novel-format.md)：小说文档格式 Novel Markdown（front-matter + 指令）的设计与实现状态
- [novel-format-research.md](novel-format-research.md)：Novel Markdown 的调研结论（背景资料）
- [outline-algorithm.md](outline-algorithm.md)：目录 / 幕场提取算法（`extractOutline` / `extractActs`）与结构规则

## 架构与存储

- [sqlite-store.md](sqlite-store.md)：SQLite 存储层 `@novel-editor/store`（表结构、作品作用域、导入导出）
- [version-management.md](version-management.md)：版本快照（SQLite 内容寻址去重）、版本历史界面与 DiffEditor
- [passkey-auth.md](passkey-auth.md)：Passkey / WebAuthn 接入现状与后端要求

## AI 与视频

- [roadmap-ai-creative.md](roadmap-ai-creative.md)：AI 创作能力（模型配置、人物悬停卡片、续写、场景视频、预演、参考窗格）的设计与实现状态

## 发布与运维

- [release-process.md](release-process.md)：发布流程、更新通道 / 灰度 / 回退、镜像源，以及每次发版的勾选清单
- [log-upload.md](log-upload.md)：日志上传接口约定（给服务端）与客户端行为

## 性能

- [performance.md](performance.md)：性能要点、已做的优化、基准测试与后续方向
