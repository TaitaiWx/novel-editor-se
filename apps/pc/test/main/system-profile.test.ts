import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CpuInfo } from 'node:os';

const osState = vi.hoisted(() => ({
  cpus: [] as Array<{ speed: number }>,
  totalmem: 0,
}));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    cpus: () => osState.cpus as unknown as CpuInfo[],
    totalmem: () => osState.totalmem,
  };
});

import { __resetSystemProfileForTesting, detectSystemProfile } from '../../src/main/system-profile';

const GB = 1024 * 1024 * 1024;

function setMachine(cores: number, speed: number, memGB: number) {
  osState.cpus = Array.from({ length: cores }, () => ({ speed }));
  osState.totalmem = memGB * GB;
}

describe('detectSystemProfile', () => {
  beforeEach(() => {
    __resetSystemProfileForTesting();
  });

  afterEach(() => {
    __resetSystemProfileForTesting();
  });

  it('高配机器不判定为低配', () => {
    setMachine(8, 3200, 16);
    const profile = detectSystemProfile();
    expect(profile).toEqual({
      isLowSpec: false,
      totalMemoryGB: 16,
      cpuCount: 8,
      cpuSpeedMHz: 3200,
      reasons: [],
    });
  });

  it('内存不足 6GB 判定为低配', () => {
    setMachine(8, 3200, 4);
    const profile = detectSystemProfile();
    expect(profile.isLowSpec).toBe(true);
    expect(profile.reasons).toEqual(['内存 4GB < 6GB']);
  });

  it('逻辑核数 <= 4 判定为低配（边界值 4）', () => {
    setMachine(4, 3200, 16);
    expect(detectSystemProfile().reasons).toEqual(['逻辑核数 4 ≤ 4']);
  });

  it('CPU 频率低于 2400MHz 判定为低配', () => {
    setMachine(8, 1800, 16);
    expect(detectSystemProfile().reasons).toEqual(['CPU 频率 1800MHz < 2400MHz']);
  });

  it('多项指标同时命中时全部列出', () => {
    setMachine(2, 1600, 3.95);
    const profile = detectSystemProfile();
    expect(profile.totalMemoryGB).toBe(4); // 保留一位小数
    expect(profile.reasons).toHaveLength(3);
  });

  it('无法获取的指标（0 值）不触发低配', () => {
    osState.cpus = [];
    osState.totalmem = 0;
    const profile = detectSystemProfile();
    expect(profile).toMatchObject({
      isLowSpec: false,
      cpuCount: 0,
      cpuSpeedMHz: 0,
      totalMemoryGB: 0,
    });
  });

  it('结果被缓存，重置后重新探测', () => {
    setMachine(8, 3200, 16);
    const first = detectSystemProfile();
    setMachine(2, 1000, 2);
    expect(detectSystemProfile()).toBe(first);
    __resetSystemProfileForTesting();
    expect(detectSystemProfile().isLowSpec).toBe(true);
  });
});
