/**
 * 编辑器辅助（人物悬停卡片 / 行内续写 / 续写面板）的对外接口
 *
 * TextEditor 只认识这些接口：人物数据、卡片渲染、AI 调用都由上层（App 的 useEditorAssist）提供，
 * 编辑器内核不依赖 IPC、数据库或 React 状态。
 */
import type { ContinuationDirection, ContinuationLength } from '@novel-editor/ai/prompts';
import type { SerializedAIError } from '@/shared/ai';
import type { MatchableCharacter } from './character-match';

export interface CharacterCardActions {
  /** 关闭卡片 */
  close: () => void;
  /** 在正文中临时高亮该人物的所有出现（只处理可见区域） */
  highlightAll: () => void;
}

export type ContinuationMode = 'ghost' | 'suggestion';

export interface ContinuationOptions {
  length: ContinuationLength;
  /** 预设方向或作者的一句话 */
  direction: ContinuationDirection | string;
  followOutline: boolean;
  /** 省略时由服务按「Grok 已配置则用 Grok，否则默认 AI」选择 */
  providerId?: string;
}

/** 本次续写带给模型的上下文（只有分区与 token 数，展示用） */
export interface ContinuationContextSummary {
  budget: number;
  usedTokens: number;
  providerLabel: string;
  sections: Array<{
    key: string;
    label: string;
    tokens: number;
    truncated: boolean;
    omittedItems: number;
    /** 分区内容（「查看本次上下文」展开时显示） */
    text: string;
  }>;
}

export interface ContinuationRequest {
  docText: string;
  cursor: number;
  filePath: string | null;
  options: ContinuationOptions;
}

export interface ContinuationHandlers {
  onContext: (summary: ContinuationContextSummary) => void;
  /** 当前累计的（已清理）续写文本 */
  onText: (text: string) => void;
  onDone: () => void;
  onError: (error: SerializedAIError) => void;
}

export interface ContinuationService {
  /** 发起续写，返回取消函数（取消后不再回调） */
  start: (request: ContinuationRequest, handlers: ContinuationHandlers) => () => void;
}

export interface EditorAssistConfig {
  /** 当前作品的人物（名字 + 别名），用于识别 */
  characters: readonly MatchableCharacter[];
  /** 把人物卡片渲染进 dom，返回清理函数；未提供时不启用悬停卡片 */
  renderCharacterCard?: (
    dom: HTMLElement,
    characterId: number,
    actions: CharacterCardActions
  ) => () => void;
  /** 续写服务；未提供时 ⌥\ 提示「AI 未配置」 */
  continuation?: ContinuationService | null;
  /** 打开设置中心 AI 分区（续写未配置时的入口） */
  openAiSettings?: () => void;
}

/** 编辑器当前的辅助上下文（每次读取最新值） */
export interface EditorAssistContext {
  config: EditorAssistConfig | null;
  filePath: string | null;
  readOnly: boolean;
}

export type GetAssistContext = () => EditorAssistContext;
