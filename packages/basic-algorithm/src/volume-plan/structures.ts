import type { VolumeStructureId } from './types';

/** 结构模板中的一段 */
export interface StructureStage {
  title: string;
  /** 这一段要完成的事（无输入时直接作为卷纲提示） */
  hint: string;
  /** 在全卷中所占比例（同一模板内求和为 1） */
  weight: number;
}

export interface StructureTemplate {
  id: Exclude<VolumeStructureId, 'markers'>;
  label: string;
  stages: StructureStage[];
}

export const STRUCTURE_TEMPLATES: Record<StructureTemplate['id'], StructureTemplate> = {
  'three-act': {
    id: 'three-act',
    label: '三幕式',
    stages: [
      { title: '第一幕 · 建置', hint: '交代人物处境，抛出打破平静的事件', weight: 0.25 },
      { title: '第二幕 · 对抗', hint: '目标受阻、代价升级，中点迎来转折', weight: 0.5 },
      { title: '第三幕 · 解决', hint: '正面对决，回收伏笔，留下余波', weight: 0.25 },
    ],
  },
  kishotenketsu: {
    id: 'kishotenketsu',
    label: '起承转合',
    stages: [
      { title: '起', hint: '人物登场，交代动机与处境', weight: 0.25 },
      { title: '承', hint: '顺势推进，关系与矛盾逐步展开', weight: 0.25 },
      { title: '转', hint: '意外或反转，局势急变', weight: 0.25 },
      { title: '合', hint: '收束矛盾，给出结果与新的悬念', weight: 0.25 },
    ],
  },
  'hero-journey': {
    id: 'hero-journey',
    label: '英雄之旅',
    stages: [
      { title: '平凡世界', hint: '主角的日常与缺憾，召唤出现', weight: 0.15 },
      { title: '跨越门槛', hint: '离开舒适区，遇见导师或第一道关卡', weight: 0.15 },
      { title: '考验与盟友', hint: '结识同伴与对手，规则逐步揭示', weight: 0.3 },
      { title: '最大磨难', hint: '跌入谷底，付出代价后获得关键成长', weight: 0.25 },
      { title: '带着收获归来', hint: '带着改变回到目标，开启下一段旅程', weight: 0.15 },
    ],
  },
};

/** 「换一种结构」的轮换顺序 */
export const STRUCTURE_ORDER: VolumeStructureId[] = [
  'markers',
  'three-act',
  'kishotenketsu',
  'hero-journey',
];

export function getStructureLabel(id: VolumeStructureId): string {
  return id === 'markers' ? '按正文幕标记' : STRUCTURE_TEMPLATES[id].label;
}

/**
 * 按章数自动挑选结构模板：
 * - 1-3 章：三幕式（每段至多一章，不会出现空段）
 * - 4-8 章：起承转合
 * - 9 章以上：英雄之旅
 */
export function pickStructureByChapterCount(count: number): StructureTemplate['id'] {
  if (count <= 3) return 'three-act';
  if (count <= 8) return 'kishotenketsu';
  return 'hero-journey';
}

/**
 * 下一个可选结构（「换一种结构」）：没有幕标记时跳过 markers
 */
export function nextStructure(current: VolumeStructureId, hasMarkers: boolean): VolumeStructureId {
  const options = STRUCTURE_ORDER.filter((id) => hasMarkers || id !== 'markers');
  const index = options.indexOf(current);
  return options[(index + 1) % options.length];
}

/**
 * 把 count 章按模板比例分到各段：每段至少一章（章数不足时只保留首段、末段与中间若干段），
 * 返回与 stages 等长的章数数组（不足时部分为 0）
 */
export function allocateChapters(count: number, weights: number[]): number[] {
  const parts = weights.length;
  if (count <= 0 || parts === 0) return weights.map(() => 0);
  if (count < parts) {
    // 章数少于段数：优先保留首段与末段，再从中间段依次补足
    const result = weights.map(() => 0);
    const priority = [0, parts - 1, ...Array.from({ length: parts - 2 }, (_, i) => i + 1)];
    priority.slice(0, count).forEach((index) => {
      result[index] = 1;
    });
    return result;
  }
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const result: number[] = [];
  let cumulative = 0;
  let assigned = 0;
  for (let i = 0; i < parts; i += 1) {
    cumulative += weights[i];
    const remainingParts = parts - i - 1;
    let boundary = i === parts - 1 ? count : Math.round((cumulative / total) * count);
    // 至少一章，且给后面的段各留一章
    boundary = Math.max(boundary, assigned + 1);
    boundary = Math.min(boundary, count - remainingParts);
    result.push(boundary - assigned);
    assigned = boundary;
  }
  return result;
}
