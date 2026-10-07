import { describe, expect, it } from 'vitest';
import {
  checkVideoBudget,
  createCostRegistry,
  createVideoTask,
  formatMoney,
  perSecondEstimator,
  sumSpend,
  transitionVideoTask,
  type CostEstimate,
  type VideoTask,
} from '../src';

describe('cost registry', () => {
  it('未注册的服务商返回 null', () => {
    const registry = createCostRegistry();
    expect(registry.estimate({ providerId: 'x', durationSec: 5 })).toBeNull();
  });

  it('按秒计价并保留两位小数', () => {
    const registry = createCostRegistry();
    registry.register('kling', perSecondEstimator(0.35, 'CNY', '作者填写的价格'));
    expect(registry.estimate({ providerId: 'kling', durationSec: 5 })).toEqual({
      amount: 1.75,
      currency: 'CNY',
      note: '作者填写的价格',
    });
    expect(registry.estimate({ providerId: 'kling', durationSec: 3 })?.amount).toBe(1.05);
    expect(perSecondEstimator(0.1, 'USD')({ providerId: 'a', durationSec: 3 })).toEqual({
      amount: 0.3,
      currency: 'USD',
    });
  });

  it('后注册覆盖、非法时长与出错的估算函数返回 null', () => {
    const registry = createCostRegistry();
    registry.register('a', perSecondEstimator(1, 'CNY'));
    registry.register('a', perSecondEstimator(2, 'CNY'));
    expect(registry.estimate({ providerId: 'a', durationSec: 1 })?.amount).toBe(2);
    expect(registry.estimate({ providerId: 'a', durationSec: 0 })).toBeNull();
    expect(registry.estimate({ providerId: 'a', durationSec: Number.NaN })).toBeNull();
    registry.register('bad', () => {
      throw new Error('boom');
    });
    expect(registry.estimate({ providerId: 'bad', durationSec: 1 })).toBeNull();
    registry.register('neg', () => ({ amount: -1, currency: 'CNY' }));
    expect(registry.estimate({ providerId: 'neg', durationSec: 1 })).toBeNull();
    registry.register('model', (q) =>
      q.model === 'pro' && q.resolution === '1080p' ? { amount: 9, currency: 'USD' } : null
    );
    expect(
      registry.estimate({ providerId: 'model', durationSec: 1, model: 'pro', resolution: '1080p' })
    ).toEqual({ amount: 9, currency: 'USD' });
  });

  it('非法单价抛错', () => {
    expect(() => perSecondEstimator(-1, 'CNY')).toThrow('非负数');
    expect(() => perSecondEstimator(Number.POSITIVE_INFINITY, 'CNY')).toThrow();
  });

  it('formatMoney', () => {
    expect(formatMoney(1.005, 'CNY')).toBe('¥1.00');
    expect(formatMoney(2, 'USD')).toBe('$2.00');
  });
});

describe('checkVideoBudget', () => {
  const estimate: CostEstimate = { amount: 3, currency: 'CNY' };

  it('没有估算时放行', () => {
    expect(checkVideoBudget({ estimate: null, spentToday: 100, dailyLimit: 1 })).toEqual({
      ok: true,
    });
  });

  it('没有上限时放行', () => {
    expect(checkVideoBudget({ estimate, spentToday: 1000 })).toEqual({ ok: true });
  });

  it('单次上限', () => {
    const result = checkVideoBudget({ estimate, spentToday: 0, perTaskLimit: 2 });
    expect(result).toMatchObject({ ok: false, reason: 'per-task' });
    if (!result.ok) expect(result.message).toContain('¥3.00');
    expect(checkVideoBudget({ estimate, spentToday: 0, perTaskLimit: 3 }).ok).toBe(true);
  });

  it('每日上限（恰好等于上限放行）', () => {
    expect(checkVideoBudget({ estimate, spentToday: 7, dailyLimit: 10 }).ok).toBe(true);
    expect(checkVideoBudget({ estimate, spentToday: 7.01, dailyLimit: 10 })).toMatchObject({
      ok: false,
      reason: 'daily',
    });
  });

  it('币种不一致', () => {
    expect(
      checkVideoBudget({ estimate, spentToday: 0, dailyLimit: 10, currency: 'USD' })
    ).toMatchObject({ ok: false, reason: 'currency-mismatch' });
    // 没有上限时币种无关
    expect(checkVideoBudget({ estimate, spentToday: 0, currency: 'USD' }).ok).toBe(true);
  });
});

describe('sumSpend', () => {
  const make = (id: string, createdAt: number, costEstimate?: CostEstimate): VideoTask =>
    createVideoTask(
      {
        id,
        providerId: 'p',
        workPath: '/w',
        chapter: 'c',
        scene: 's',
        shotIndex: 1,
        version: 1,
        prompt: 'x',
        costEstimate,
      },
      createdAt
    );

  it('只计 since 之后、同币种、非「提交前取消」的任务', () => {
    const now = 1000;
    const queued = make('a', now, { amount: 1.1, currency: 'CNY' });
    const old = make('b', now - 1, { amount: 5, currency: 'CNY' });
    const usd = make('c', now, { amount: 7, currency: 'USD' });
    const noEstimate = make('d', now);
    const cancelledBeforeSubmit = transitionVideoTask(
      make('e', now, { amount: 9, currency: 'CNY' }),
      { type: 'cancel' },
      { now }
    );
    const submitted = transitionVideoTask(
      make('f', now, { amount: 2.2, currency: 'CNY' }),
      { type: 'submitted', remoteTaskId: 'r' },
      { now }
    );
    const cancelledAfterSubmit = transitionVideoTask(submitted, { type: 'cancel' }, { now });
    const tasks = [queued, old, usd, noEstimate, cancelledBeforeSubmit, cancelledAfterSubmit];
    expect(sumSpend(tasks, now, 'CNY')).toBe(3.3);
    expect(sumSpend(tasks, now, 'USD')).toBe(7);
    expect(sumSpend(tasks, 0, 'CNY')).toBe(8.3);
    expect(sumSpend([], 0, 'CNY')).toBe(0);
  });
});
