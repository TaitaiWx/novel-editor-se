/**
 * 拼写建议：基于编辑距离为未知命令 / 选项给出「你是不是想输入」提示
 */

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(prev[j] + 1, current[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = current;
  }
  return prev[b.length];
}

/** 返回最接近的候选（距离不超过阈值，或候选以输入为前缀） */
export function suggest(input: string, candidates: readonly string[], limit = 3): string[] {
  const lowered = input.toLowerCase();
  const threshold = Math.max(2, Math.floor(input.length / 3));
  return candidates
    .map((candidate) => ({
      candidate,
      distance: candidate.startsWith(lowered) ? 0.5 : levenshtein(lowered, candidate.toLowerCase()),
    }))
    .filter((item) => item.distance <= threshold)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map((item) => item.candidate);
}

export function didYouMean(input: string, candidates: readonly string[]): string | undefined {
  const matches = suggest(input, candidates);
  return matches.length ? `你是不是想输入: ${matches.join(', ')}` : undefined;
}
