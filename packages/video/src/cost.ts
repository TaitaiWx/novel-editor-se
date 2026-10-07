/**
 * 视频生成费用估算钩子
 *
 * 本包不内置任何价格：各服务商的价格随时变化，由作者在设置中填写，
 * 调用方用 perSecondEstimator 等工厂注册到 CostRegistry。
 * 估算只用于提示与预算拦截，不代表服务商的实际账单。
 */
import type { VideoTask } from './task';

export type CostCurrency = 'CNY' | 'USD';

export interface CostEstimate {
  amount: number;
  currency: CostCurrency;
  note?: string;
}

export interface CostQuery {
  providerId: string;
  model?: string;
  durationSec: number;
  resolution?: string;
}

export type CostEstimator = (query: CostQuery) => CostEstimate | null;

export interface CostRegistry {
  register(providerId: string, estimator: CostEstimator): void;
  estimate(query: CostQuery): CostEstimate | null;
}

/** 金额保留两位小数（避免 0.1 + 0.2 这类浮点误差显示出来） */
export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function formatMoney(amount: number, currency: CostCurrency): string {
  const symbol = currency === 'CNY' ? '¥' : '$';
  return `${symbol}${roundMoney(amount).toFixed(2)}`;
}

export function createCostRegistry(): CostRegistry {
  const estimators = new Map<string, CostEstimator>();
  return {
    register(providerId, estimator) {
      estimators.set(providerId, estimator);
    },
    estimate(query) {
      if (!Number.isFinite(query.durationSec) || query.durationSec <= 0) return null;
      const estimator = estimators.get(query.providerId);
      if (!estimator) return null;
      try {
        const result = estimator(query);
        if (!result || !Number.isFinite(result.amount) || result.amount < 0) return null;
        return result;
      } catch {
        // 作者配置的估算函数出错时不阻塞生成，只是没有估算
        return null;
      }
    },
  };
}

/** 按秒计价：amount = 单价 × 时长 */
export function perSecondEstimator(
  pricePerSecond: number,
  currency: CostCurrency,
  note?: string
): CostEstimator {
  if (!Number.isFinite(pricePerSecond) || pricePerSecond < 0) {
    throw new Error(`每秒单价必须是非负数: ${pricePerSecond}`);
  }
  return (query) => {
    const estimate: CostEstimate = {
      amount: roundMoney(pricePerSecond * query.durationSec),
      currency,
    };
    if (note) estimate.note = note;
    return estimate;
  };
}

export type BudgetCheck =
  | { ok: true }
  | { ok: false; reason: 'per-task' | 'daily' | 'currency-mismatch'; message: string };

export interface BudgetCheckInput {
  estimate: CostEstimate | null;
  /** 今日已花费（与 currency 同币种） */
  spentToday: number;
  dailyLimit?: number;
  perTaskLimit?: number;
  /** 预算上限的币种；提供且与估算币种不同时拒绝（无法比较） */
  currency?: CostCurrency;
}

/** 预算检查：没有估算（未配置价格）时放行 */
export function checkVideoBudget(input: BudgetCheckInput): BudgetCheck {
  const { estimate, spentToday, dailyLimit, perTaskLimit, currency } = input;
  if (!estimate) return { ok: true };
  const hasLimit = dailyLimit !== undefined || perTaskLimit !== undefined;
  if (hasLimit && currency && currency !== estimate.currency) {
    return {
      ok: false,
      reason: 'currency-mismatch',
      message: `费用估算币种（${estimate.currency}）与预算币种（${currency}）不一致，无法比较`,
    };
  }
  if (perTaskLimit !== undefined && estimate.amount > perTaskLimit) {
    return {
      ok: false,
      reason: 'per-task',
      message: `单个镜头预计 ${formatMoney(estimate.amount, estimate.currency)}，超过单次上限 ${formatMoney(perTaskLimit, estimate.currency)}`,
    };
  }
  if (dailyLimit !== undefined && roundMoney(spentToday + estimate.amount) > dailyLimit) {
    return {
      ok: false,
      reason: 'daily',
      message: `今日已用 ${formatMoney(spentToday, estimate.currency)}，再生成预计 ${formatMoney(estimate.amount, estimate.currency)}，将超过每日上限 ${formatMoney(dailyLimit, estimate.currency)}`,
    };
  }
  return { ok: true };
}

/**
 * 统计 sinceMs 之后创建的任务的预计花费（只计同币种）。
 * 提交前就被取消（attempts 为 0）的任务没有产生费用，不计入。
 */
export function sumSpend(
  tasks: readonly VideoTask[],
  sinceMs: number,
  currency: CostCurrency
): number {
  let total = 0;
  for (const task of tasks) {
    if (task.createdAt < sinceMs) continue;
    if (!task.costEstimate || task.costEstimate.currency !== currency) continue;
    if (task.status === 'cancelled' && task.attempts === 0) continue;
    total += task.costEstimate.amount;
  }
  return roundMoney(total);
}
