import { describe, expect, it } from 'vitest';
import {
  describeOs,
  describeRollout,
  formatAboutDate,
  formatAboutDay,
  formatRunningSummary,
  formatUptime,
  inferReleaseChannel,
  type AboutRolloutInfo,
} from '../../src/shared/about';

const rollout: AboutRolloutInfo = {
  bucket: 7,
  percentage: 20,
  eligible: true,
  canaryEnrolled: true,
};
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe('shared/about', () => {
  it('inferReleaseChannel 按预发布标识推断', () => {
    expect(inferReleaseChannel('1.0.0')).toBe('stable');
    expect(inferReleaseChannel('1.1.0-beta.2')).toBe('beta');
    expect(inferReleaseChannel('1.1.0-alpha.0')).toBe('alpha');
    expect(inferReleaseChannel('1.1.0-Canary.3')).toBe('alpha');
  });

  it('describeRollout 区分全量发布与灰度命中', () => {
    expect(describeRollout({ ...rollout, percentage: null, eligible: null })).toBe(
      '分桶 7 · 当前为全量发布'
    );
    expect(describeRollout(rollout)).toBe('分桶 7 · 灰度 20% · 已命中');
    expect(describeRollout({ ...rollout, eligible: false })).toBe('分桶 7 · 灰度 20% · 未命中');
  });

  it('formatAboutDay / formatAboutDate 对缺失或非法时间返回「未知」', () => {
    expect(formatAboutDay(null)).toBe('未知');
    expect(formatAboutDate('not-a-date')).toBe('未知');
    const local = new Date(2026, 2, 17, 9, 5).toISOString();
    expect(formatAboutDay(local)).toBe('2026-03-17');
    expect(formatAboutDate(local)).toBe('2026-03-17 09:05');
  });

  it('formatUptime 按分钟 / 小时 / 天输出', () => {
    expect(formatUptime(-5)).toBe('不到 1 分钟');
    expect(formatUptime(59_000)).toBe('不到 1 分钟');
    expect(formatUptime(13 * MINUTE)).toBe('13 分钟');
    expect(formatUptime(2 * HOUR + 13 * MINUTE + 59_000)).toBe('2 小时 13 分');
    expect(formatUptime(5 * HOUR)).toBe('5 小时');
    expect(formatUptime(26 * HOUR + 30 * MINUTE)).toBe('1 天 2 小时');
    expect(formatUptime(48 * HOUR)).toBe('2 天');
  });

  it('formatRunningSummary 合并首次运行与本次运行时长', () => {
    const started = new Date(2026, 9, 6, 8, 0);
    const firstRun = new Date(2026, 2, 17, 10, 0).toISOString();
    expect(
      formatRunningSummary(
        firstRun,
        started.toISOString(),
        started.getTime() + 2 * HOUR + 13 * MINUTE
      )
    ).toBe('首次运行 2026-03-17 · 本次已运行 2 小时 13 分');
    expect(formatRunningSummary(null, 'bad', Date.now())).toBe('首次运行 未知 · 本次已运行 未知');
  });

  it('describeOs 输出平台名、内核版本与架构', () => {
    expect(describeOs('darwin', '24.6.0', 'arm64')).toBe('macOS 24.6.0 (arm64)');
    expect(describeOs('freebsd', '14.0', 'x64')).toBe('freebsd 14.0 (x64)');
  });
});
