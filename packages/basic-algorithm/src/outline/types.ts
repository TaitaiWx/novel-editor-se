/** 大纲节点 */
export interface OutlineNode {
  /** 标题层级 (1-6) */
  level: number;
  /** 标题文本 */
  text: string;
  /** 所在行号 (1-based) */
  line: number;
  /** 检测来源，用于调试和权重排序 */
  source: 'markdown' | 'chinese-section' | 'numbered' | 'separator' | 'heuristic';
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

/** 大纲提取配置 */
export interface OutlineOptions {
  /** 是否启用启发式检测（基于文本模式猜测标题），默认 true */
  enableHeuristic?: boolean;
  /** 自定义章节正则列表，追加到内置规则之后 */
  customPatterns?: RegExp[];
}
