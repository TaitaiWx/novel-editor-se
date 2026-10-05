/** 灰度（金丝雀）分桶与资格判断的纯函数 */
import { createHash } from 'crypto';

/** 由稳定种子（userData 路径）计算 0~99 的灰度分桶 */
export function computeRolloutBucket(seed: string): number {
  const hash = createHash('sha256').update(seed).digest('hex');
  return Number.parseInt(hash.slice(0, 8), 16) % 100;
}

/**
 * 判断当前分桶是否命中灰度比例。
 * 没有 stagingPercentage（即全量发布）时返回 null，表示"不适用"。
 */
export function isRolloutEligible(
  bucket: number,
  stagingPercentage: number | null | undefined
): boolean | null {
  return typeof stagingPercentage === 'number' ? bucket < stagingPercentage : null;
}
