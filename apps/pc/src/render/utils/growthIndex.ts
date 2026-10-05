/**
 * 成长档案索引：文件面板「成长档案」分区与人物详情按钮所需的轻量摘要
 *
 * 完整数据由 GrowthView（useGrowthMemory）读写；它每次拿到新快照时广播
 * GROWTH_MEMORY_CHANGED_EVENT，索引据此刷新，避免重复读取 资料/记忆/。
 */
import { latestChapterOfSheet } from '@novel-editor/core/growth';
import type { GrowthSnapshot } from '../types/growth-api';

export const GROWTH_MEMORY_CHANGED_EVENT = 'growth-memory-changed';

export interface GrowthSheetSummary {
  name: string;
  aliases: string[];
  level: number;
  exp: number;
  /** 成长记录涉及的最新章节（0 表示未记录章节） */
  latestChapter: number;
  /** 一致性检查中属于该角色的错误数 */
  errorCount: number;
  /** 一致性检查中属于该角色的警告数 */
  warningCount: number;
}

export interface GrowthIndex {
  /** 是否已创建 资料/记忆/规则.json */
  initialized: boolean;
  sheets: GrowthSheetSummary[];
}

export interface GrowthMemoryChangedDetail {
  folderPath: string;
  index: GrowthIndex;
  /** 发出广播的成长视图实例，用于忽略自己的广播 */
  source?: string;
}

export function summarizeGrowthSnapshot(snapshot: GrowthSnapshot): GrowthIndex {
  const warnings = snapshot.check?.warnings ?? [];
  return {
    initialized: snapshot.initialized,
    sheets: snapshot.sheets.map((sheet) => {
      const own = warnings.filter((warning) => warning.character === sheet.name);
      return {
        name: sheet.name,
        aliases: sheet.aliases ?? [],
        level: sheet.level,
        exp: sheet.exp,
        latestChapter: latestChapterOfSheet(sheet),
        errorCount: own.filter((warning) => warning.severity === 'error').length,
        warningCount: own.filter((warning) => warning.severity === 'warning').length,
      };
    }),
  };
}

export function emitGrowthMemoryChanged(
  folderPath: string,
  snapshot: GrowthSnapshot,
  source?: string
): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<GrowthMemoryChangedDetail>(GROWTH_MEMORY_CHANGED_EVENT, {
      detail: { folderPath, index: summarizeGrowthSnapshot(snapshot), source },
    })
  );
}

/** 按角色名或别名查找成长档案摘要 */
export function findGrowthSheetSummary(
  index: GrowthIndex | null | undefined,
  name: string,
  aliases: string[] = []
): GrowthSheetSummary | null {
  if (!index) return null;
  const keys = [name, ...aliases].map((item) => item.trim()).filter(Boolean);
  return (
    index.sheets.find((sheet) => keys.includes(sheet.name)) ??
    index.sheets.find((sheet) => sheet.aliases.some((alias) => keys.includes(alias))) ??
    null
  );
}

/** 文件面板行内的元信息，例如「经验 500 · 第 12 章」 */
export function formatGrowthSheetMeta(summary: GrowthSheetSummary): string {
  const parts = [`经验 ${summary.exp}`];
  if (summary.latestChapter > 0) parts.push(`第 ${summary.latestChapter} 章`);
  if (summary.errorCount > 0) parts.push(`${summary.errorCount} 处冲突`);
  return parts.join(' · ');
}
