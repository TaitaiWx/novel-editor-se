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

// ─── 打开成长档案请求（右侧面板等没有导航回调的位置使用） ─────────────────────

export const GROWTH_OPEN_EVENT = 'growth-open-request';

export interface GrowthOpenRequestDetail {
  /** 角色名；为空时打开总览 */
  name: string | null;
}

/** 请求主窗口打开成长档案标签（由 useGrowthEntry 响应） */
export function requestOpenGrowth(name: string | null = null): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<GrowthOpenRequestDetail>(GROWTH_OPEN_EVENT, { detail: { name } })
  );
}

// ─── 章节号推断 ───────────────────────────────────────────────────────────────

const CN_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
const CN_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };

/** 中文数字（一百二十三、十五、两千零八）转阿拉伯数字，无法识别时返回 null */
export function parseChineseNumber(text: string): number | null {
  if (!text) return null;
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const char of text) {
    if (char in CN_DIGITS) {
      digit = CN_DIGITS[char];
    } else if (char in CN_UNITS) {
      const unit = CN_UNITS[char];
      if (unit === 10000) {
        total += (section + digit) * unit;
        section = 0;
      } else {
        // 「十五」开头省略「一」
        section += (digit || 1) * unit;
      }
      digit = 0;
    } else {
      return null;
    }
  }
  return total + section + digit;
}

/**
 * 从章节文件路径推断章节号：`001-启程.md` → 1，`第12章 风起.md` → 12，`第三十章.md` → 30。
 * 无法推断时返回 null（调用方回退到最近记录的章节）
 */
export function inferChapterNumber(filePath: string | null | undefined): number | null {
  if (!filePath) return null;
  const base = filePath
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.[^.]+$/, '')
    .trim();
  if (!base) return null;
  const leading = /^(\d+)(?:[-_.\s]|$)/.exec(base);
  if (leading) return Number(leading[1]);
  const marked = /第\s*([0-9]+|[零〇一二两三四五六七八九十百千万]+)\s*[章回节]/.exec(base);
  if (!marked) return null;
  const value = /^\d+$/.test(marked[1]) ? Number(marked[1]) : parseChineseNumber(marked[1]);
  return value !== null && Number.isFinite(value) ? value : null;
}

/** 文本中提到的角色（按名字或长度 ≥ 2 的别名匹配），保持 sheets 原有顺序 */
export function findMentionedNames(
  text: string,
  sheets: Array<{ name: string; aliases: string[] }>
): string[] {
  if (!text) return [];
  return sheets
    .filter((sheet) =>
      [sheet.name, ...sheet.aliases.filter((alias) => alias.trim().length >= 2)]
        .map((key) => key.trim())
        .some((key) => key && text.includes(key))
    )
    .map((sheet) => sheet.name);
}
