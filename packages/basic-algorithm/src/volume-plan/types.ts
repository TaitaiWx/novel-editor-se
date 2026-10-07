/**
 * 卷纲（卷规划）的数据结构：全部由一卷的章节正文自动推导，作者输入只作为覆盖层
 */

/** 推导输入：一章 */
export interface VolumeChapterSource {
  /** 章节文件路径（作为章节的唯一标识） */
  path: string;
  /** 显示标题（通常是文件名去掉序号前缀与扩展名） */
  title: string;
  /** 正文 */
  content: string;
  /** 已入库的章纲条目标题（可选，按顺序） */
  outline?: string[];
}

/** 推导输入：人物（来自人物库） */
export interface VolumeCharacterRef {
  name: string;
  aliases?: string[];
}

/** 结构模板 id；markers 表示按正文里的「第X幕」标记分幕 */
export type VolumeStructureId = 'markers' | 'three-act' | 'kishotenketsu' | 'hero-journey';

/** 节拍来源 */
export type VolumeBeatSource = 'scene' | 'outline' | 'heading' | 'opening' | 'suggestion';

/** 关键节拍（一行） */
export interface VolumeBeat {
  /** 稳定 key：`<章节文件名>#<来源>:<标识>`，用于保存作者的就地修改与排序 */
  key: string;
  /** 标题（场景标记 / 章纲标题 / 小标题；开篇句与建议为空） */
  title: string;
  /** 节拍内容（场景首句、章纲标题或建议） */
  text: string;
  source: VolumeBeatSource;
  /** 在章节正文中的行号（1-based），可跳转 */
  line?: number;
}

/** 卷纲中的一章（同一章被幕标记切开时会出现在两幕中，continued 为 true） */
export interface VolumeChapterPlan {
  path: string;
  title: string;
  /** 在卷内的序号（0-based） */
  index: number;
  continued: boolean;
  beats: VolumeBeat[];
}

/** 卷纲中的一幕 / 一段 */
export interface VolumeActPlan {
  /** 稳定 key：`<结构>:<序号>:<标题>` */
  key: string;
  title: string;
  /** 这一段该做什么（模板提示；按正文标记分幕时为空） */
  hint: string;
  /** 在首章中的行号（来自幕标记） */
  line?: number;
  chapters: VolumeChapterPlan[];
}

export interface VolumeOutline {
  structure: VolumeStructureId;
  structureLabel: string;
  /** 正文里是否有「第X幕」标记（决定「按正文标记」是否可选） */
  hasMarkers: boolean;
  acts: VolumeActPlan[];
  chapterCount: number;
}

/** 每章张力（节奏视图） */
export interface ChapterTension {
  path: string;
  title: string;
  /** 1-5，卷内相对值 */
  level: number;
  /** 原始分数（每千字） */
  score: number;
  /** 主要信号说明，如「冲突词 12 · 感叹 3」 */
  signals: string[];
}

/** 人物泳道 */
export interface CharacterLane {
  name: string;
  /** 与章节一一对应的出场次数 */
  counts: number[];
  total: number;
  /** 首次 / 最后出场的章节序号（0-based），未出场为 -1 */
  first: number;
  last: number;
}

/** 可能的伏笔 */
export interface ForeshadowItem {
  key: string;
  chapterPath: string;
  chapterTitle: string;
  line: number;
  text: string;
  /** 触发的关键词 */
  keyword: string;
  /** 后文是否疑似呼应（共享较长片段） */
  echoed: boolean;
  /** 呼应所在章节标题 */
  echoedIn?: string;
}
