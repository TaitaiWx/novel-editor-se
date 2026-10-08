/**
 * @novel-editor/ai —— GUI（主进程）与 CLI 共用的 AI 基础层（纯 TS，不依赖 Electron / Node 内置模块）
 *
 * - Provider 抽象与注册表：文本（complete / stream）、视频（submitTask / pollTask / fetchResult）、图片（generate）、
 *   配音（synthesize：openai-speech / minimax-speech / volcengine-speech / grok-speech / gemini-speech）
 * - 内置实现：openai-compatible、grok（xAI）；视频 minimax-video、seedance-video（火山方舟）、grok-video、
 *   gemini-video（Omni）；图片 seedream / minimax / grok / openai-image / gemini-image
 * - 基础设施：SSE 解析、超时 / 取消、指数退避重试、错误规范化
 * - 上下文组装器（按 token 预算确定性裁剪）与续写 / 分镜提示词
 */
export * from './errors';
export * from './http';
export * from './sse';
export * from './types';
export * from './registry';
export * from './providers/openai-compatible';
export * from './providers/grok';
export * from './providers/minimax-video';
export * from './providers/seedance-video';
export * from './providers/image';
export * from './providers/speech';
export * from './providers/volcengine-speech';
export * from './providers/ark';
export * from './providers/openai-image';
export * from './providers/grok-video';
export * from './providers/grok-speech';
export * from './providers/gemini';
export * from './providers/gemini-video';
export * from './context';
export * from './prompts';
export * from './motion';
