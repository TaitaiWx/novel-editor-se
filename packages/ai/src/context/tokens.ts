/**
 * Token 估算与按预算截断（确定性，不依赖具体模型的分词器）
 *
 * 估算口径：中日韩字符与全角标点每个按 1 token，其余字符每 4 个按 1 token（向上取整）。
 * 对中文小说偏保守（真实分词通常更省），保证不超出模型上下文。
 */

// 含中文常用的通用标点（— … “ ” ‘ ’）
const WIDE_CHAR =
  /[\u2010-\u2027\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/u;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  let wide = 0;
  let narrow = 0;
  for (const char of text) {
    if (WIDE_CHAR.test(char) || (char.codePointAt(0) ?? 0) > 0xffff) wide += 1;
    else narrow += 1;
  }
  return wide + Math.ceil(narrow / 4);
}

const SENTENCE_END = /[。！？!?….;；\n]/u;
export const TRUNCATION_MARK = '……';

export interface TruncateResult {
  text: string;
  tokens: number;
  truncated: boolean;
}

/**
 * 截断到 maxTokens 以内。keep = 'tail' 保留结尾（前文），'head' 保留开头（章纲、设定）。
 * 截断点尽量落在句子 / 段落边界（只在保留部分的 30% 以内回退），被截断的一侧加「……」。
 */
export function truncateToTokens(
  text: string,
  maxTokens: number,
  keep: 'head' | 'tail' = 'head'
): TruncateResult {
  const full = estimateTokens(text);
  if (full <= maxTokens) return { text, tokens: full, truncated: false };
  const markTokens = estimateTokens(TRUNCATION_MARK);
  const limit = maxTokens - markTokens;
  if (limit <= 0) return { text: '', tokens: 0, truncated: true };

  const chars = Array.from(text);
  // 二分查找能放下的最多字符数
  let lo = 0;
  let hi = chars.length;
  const sliceOf = (count: number) =>
    keep === 'head' ? chars.slice(0, count).join('') : chars.slice(chars.length - count).join('');
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateTokens(sliceOf(mid)) <= limit) lo = mid;
    else hi = mid - 1;
  }
  let kept = sliceOf(lo);
  // 对齐到句子边界
  const keptChars = Array.from(kept);
  const window = Math.floor(keptChars.length * 0.3);
  if (keep === 'head') {
    for (let i = keptChars.length - 1; i >= keptChars.length - window && i > 0; i -= 1) {
      if (SENTENCE_END.test(keptChars[i])) {
        kept = keptChars.slice(0, i + 1).join('');
        break;
      }
    }
    kept = `${kept.replace(/\s+$/u, '')}${TRUNCATION_MARK}`;
  } else {
    for (let i = 0; i < window && i < keptChars.length - 1; i += 1) {
      if (SENTENCE_END.test(keptChars[i])) {
        kept = keptChars.slice(i + 1).join('');
        break;
      }
    }
    kept = `${TRUNCATION_MARK}${kept.replace(/^\s+/u, '')}`;
  }
  return { text: kept, tokens: estimateTokens(kept), truncated: true };
}
