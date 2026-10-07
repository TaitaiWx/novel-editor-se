/** 大纲节点 */
export interface OutlineNode {
  /** 标题层级 (1-6) */
  level: number;
  /** 标题文本 */
  text: string;
  /** 所在行号 (1-based) */
  line: number;
  /** 检测来源，用于调试和权重排序 */
  source:
    | 'markdown'
    | 'chinese-section'
    | 'structure-rule'
    | 'numbered'
    | 'separator'
    | 'heuristic';
}

/** 幕 */
export interface ActNode {
  /** 幕标题 */
  title: string;
  /** 所在行号 (1-based) */
  line: number;
  /** 幕下的场景列表 */
  scenes: SceneNode[];
}

/** 场景 */
export interface SceneNode {
  /** 场景标题 */
  title: string;
  /** 所在行号 (1-based) */
  line: number;
  /** 场景内容预览（首行非空文字） */
  preview: string;
}

/**
 * 结构行识别器：一行（已 trim）是 章 / 幕 / 场 还是普通正文。
 * 通常传入 `(line) => classifyStructureLine(line, rules)`（@novel-editor/core/structure-rules，
 * 作者在「设置 → 正文结构」里配置的预设与自定义规则）；本包不依赖 core，所以只约定函数签名。
 */
export type StructureClassifier = (line: string) => 'chapter' | 'act' | 'scene' | null;

/** 大纲提取配置 */
export interface OutlineOptions {
  /**
   * 结构行识别器（作者配置的规则，例如 English「Chapter 1」）；在 Markdown 标题之后、内置中文规则之前判断。
   * 章 / 幕 → 1 级，场 → 2 级
   */
  classify?: StructureClassifier;
  /** 是否启用启发式检测（基于文本模式猜测标题），默认 true */
  enableHeuristic?: boolean;
  /** 自定义章节正则列表，追加到内置规则之后 */
  customPatterns?: RegExp[];
}
