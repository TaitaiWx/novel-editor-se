import { describe, expect, it } from 'vitest';
import {
  buildAboutLinks,
  describeOs,
  describeRollout,
  formatAboutDate,
  formatAboutDiagnostics,
  inferReleaseChannel,
  type AboutInfo,
} from '../../src/shared/about';

const info: AboutInfo = {
  appName: '小说编辑器',
  productName: 'Novel Editor',
  version: '1.1.0-beta.43',
  releaseChannel: 'beta',
  updateChannel: 'canary',
  rollout: { bucket: 7, percentage: 20, eligible: true, canaryEnrolled: true },
  deviceId: '0f8fad5b-d9cb-469f-a165-70867728950e',
  firstRunAt: '2026-01-02T03:04:00.000Z',
  runtime: {
    electron: '42.0.0',
    chrome: '140.0.0.0',
    node: '24.15.0',
    v8: '14.0',
    platform: 'darwin',
    arch: 'arm64',
    osRelease: '24.6.0',
    isPackaged: true,
  },
  directories: [],
  links: buildAboutLinks('1.1.0-beta.43'),
};

describe('shared/about', () => {
  it('inferReleaseChannel 按预发布标识推断', () => {
    expect(inferReleaseChannel('1.0.0')).toBe('stable');
    expect(inferReleaseChannel('1.1.0-beta.2')).toBe('beta');
    expect(inferReleaseChannel('1.1.0-alpha.0')).toBe('alpha');
    expect(inferReleaseChannel('1.1.0-Canary.3')).toBe('alpha');
  });

  it('describeRollout 区分全量发布与灰度命中', () => {
    expect(describeRollout({ ...info.rollout, percentage: null, eligible: null })).toBe(
      '分桶 7 · 当前为全量发布'
    );
    expect(describeRollout(info.rollout)).toBe('分桶 7 · 灰度 20% · 已命中');
    expect(describeRollout({ ...info.rollout, eligible: false })).toBe(
      '分桶 7 · 灰度 20% · 未命中'
    );
  });

  it('formatAboutDate 对缺失或非法时间返回「未知」', () => {
    expect(formatAboutDate(null)).toBe('未知');
    expect(formatAboutDate('not-a-date')).toBe('未知');
    expect(formatAboutDate(info.firstRunAt)).toMatch(/^2026-01-0[12] \d{2}:04$/);
  });

  it('describeOs 输出平台名、内核版本与架构', () => {
    expect(describeOs(info.runtime)).toBe('macOS 24.6.0 (arm64)');
    expect(describeOs({ ...info.runtime, platform: 'freebsd' })).toBe('freebsd 24.6.0 (arm64)');
  });

  it('formatAboutDiagnostics 生成纯文本诊断信息', () => {
    const text = formatAboutDiagnostics(info);
    expect(text.split('\n')[0]).toBe('小说编辑器 诊断信息');
    expect(text).toContain('版本: 1.1.0-beta.43（测试版）');
    expect(text).toContain('更新通道: canary（已加入金丝雀计划）');
    expect(text).toContain('灰度分组: 分桶 7 · 灰度 20% · 已命中');
    expect(text).toContain('设备 ID: 0f8fad5b-d9cb-469f-a165-70867728950e');
    expect(text).toContain('操作系统: macOS 24.6.0 (arm64)');
    expect(text).toContain('Electron: 42.0.0');
    expect(text).toContain('Chromium: 140.0.0.0');
    expect(text).toContain('安装方式: 安装包');
    const stable: AboutInfo = {
      ...info,
      updateChannel: 'stable',
      rollout: { ...info.rollout, canaryEnrolled: false },
    };
    expect(formatAboutDiagnostics(stable)).toContain('更新通道: stable\n');
  });
});
