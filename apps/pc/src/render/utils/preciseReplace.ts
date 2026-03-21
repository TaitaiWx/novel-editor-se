/**
 * 精确文本替换（可解释版）
 *
 * 策略：
 * 1) indexOf 精确匹配（O(n)）
 * 2) 归一化位置映射 + 单次扫描匹配（O(n+m)，无逐位归一化开销）
 * 3) 未命中时返回可解释诊断，指导优化提示词
 */

export interface PreciseReplaceReport {
  matched: boolean;
  strategy: 'exact' | 'normalized-window' | 'none';
  reason: string;
  diagnostics: {
    sourceLength: number;
    originalLength: number;
    normalizedOriginalLength: number;
    firstExactIndex: number;
    searchedWindowRange: [number, number] | null;
    scannedCandidates: number;
  };
  suggestions: string[];
}

export interface PreciseReplaceResult {
  content: string | null;
  report: PreciseReplaceReport;
}

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * 高性能归一化匹配：O(n + m)
 *
 * 将 source 归一化并记录字符-位置映射，然后在归一化空间用 indexOf 查找，
 * 映射回原始位置。避免旧方案逐位置重复归一化的 O(n*m*windowRange) 开销。
 */
export function normalizedSearch(
  source: string,
  target: string
): { from: number; to: number } | null {
  const normalizedTarget = normalize(target);
  if (!normalizedTarget) return null;

  const normalizedChars: string[] = [];
  const posMap: number[] = [];
  let prevWasSpace = true; // 开头视为空白后 → 自动跳过前导空格

  for (let i = 0; i < source.length; i++) {
    if (/\s/.test(source[i])) {
      if (!prevWasSpace) {
        normalizedChars.push(' ');
        posMap.push(i);
        prevWasSpace = true;
      }
    } else {
      normalizedChars.push(source[i]);
      posMap.push(i);
      prevWasSpace = false;
    }
  }
  // 移除尾部空格
  while (normalizedChars.length > 0 && normalizedChars[normalizedChars.length - 1] === ' ') {
    normalizedChars.pop();
    posMap.pop();
  }

  const normalizedSource = normalizedChars.join('');
  const idx = normalizedSource.indexOf(normalizedTarget);
  if (idx === -1) return null;

  const from = posMap[idx];
  const endIdx = idx + normalizedTarget.length - 1;
  const to = posMap[endIdx] + 1;

  return { from, to };
}

export function preciseReplaceWithReport(
  source: string,
  original: string,
  modified: string
): PreciseReplaceResult {
  const sourceLen = source.length;
  const origLen = original.length;

  // 1. 精确匹配
  const exactIdx = source.indexOf(original);
  if (exactIdx !== -1) {
    return {
      content: source.slice(0, exactIdx) + modified + source.slice(exactIdx + original.length),
      report: {
        matched: true,
        strategy: 'exact',
        reason: '已通过精确匹配命中原文片段。',
        diagnostics: {
          sourceLength: sourceLen,
          originalLength: origLen,
          normalizedOriginalLength: normalize(original).length,
          firstExactIndex: exactIdx,
          searchedWindowRange: null,
          scannedCandidates: 0,
        },
        suggestions: [],
      },
    };
  }

  // 2. 归一化位置映射匹配 O(n + m)
  const normalizedOriginal = normalize(original);
  if (!normalizedOriginal) {
    return {
      content: null,
      report: {
        matched: false,
        strategy: 'none',
        reason: 'AI 返回的 original 在归一化后为空，无法定位替换目标。',
        diagnostics: {
          sourceLength: sourceLen,
          originalLength: origLen,
          normalizedOriginalLength: 0,
          firstExactIndex: -1,
          searchedWindowRange: null,
          scannedCandidates: 0,
        },
        suggestions: [
          '在提示词中要求 original 必须是正文中的连续原文，不要只返回抽象描述。',
          '要求 AI 返回至少 1-2 句完整上下文，避免只返回短语。',
        ],
      },
    };
  }

  const match = normalizedSearch(source, original);
  if (match) {
    return {
      content: source.slice(0, match.from) + modified + source.slice(match.to),
      report: {
        matched: true,
        strategy: 'normalized-window',
        reason: '精确匹配未命中，但通过空白归一化匹配成功。',
        diagnostics: {
          sourceLength: sourceLen,
          originalLength: origLen,
          normalizedOriginalLength: normalizedOriginal.length,
          firstExactIndex: -1,
          searchedWindowRange: null,
          scannedCandidates: 1,
        },
        suggestions: ['建议在提示词中要求保留原文空白格式，减少回退匹配成本。'],
      },
    };
  }

  // 3. 未命中诊断
  return {
    content: null,
    report: {
      matched: false,
      strategy: 'none',
      reason:
        '未能在当前文件中定位到可替换片段。可能是 original 并非来自当前文件，或 AI 改写了原文。',
      diagnostics: {
        sourceLength: sourceLen,
        originalLength: origLen,
        normalizedOriginalLength: normalizedOriginal.length,
        firstExactIndex: -1,
        searchedWindowRange: null,
        scannedCandidates: 0,
      },
      suggestions: [
        '在提示词中加入：original 必须逐字摘录正文中的连续片段，禁止同义改写。',
        '要求 AI 一并返回 original 前后各 20-40 字上下文，便于定位。',
        '若正文已被编辑，请先刷新当前文件后重新生成自动修复。',
      ],
    },
  };
}

/** 兼容旧调用：仅返回替换后的文本或 null */
export function preciseReplace(source: string, original: string, modified: string): string | null {
  return preciseReplaceWithReport(source, original, modified).content;
}

export function formatPreciseReplaceReport(report: PreciseReplaceReport): string {
  const d = report.diagnostics;
  const winRange = d.searchedWindowRange
    ? `${d.searchedWindowRange[0]}-${d.searchedWindowRange[1]}`
    : 'N/A';
  const suggestions = report.suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n');
  return [
    '自动修复命中失败（可解释诊断）',
    `原因: ${report.reason}`,
    `策略: ${report.strategy}`,
    `诊断: sourceLen=${d.sourceLength}, originalLen=${d.originalLength}, normalizedLen=${d.normalizedOriginalLength}, exactIndex=${d.firstExactIndex}, windowRange=${winRange}, scanned=${d.scannedCandidates}`,
    suggestions ? `建议:\n${suggestions}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
