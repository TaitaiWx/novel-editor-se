import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ userData: '' }));

vi.mock('electron', () => ({
  app: { getPath: () => state.userData },
}));

type DeviceIdModule = typeof import('../../src/main/device-id');

async function loadModule(): Promise<DeviceIdModule> {
  vi.resetModules();
  return import('../../src/main/device-id');
}

describe('getDeviceId', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ne-device-'));
    // 指向尚不存在的子目录，验证会递归创建
    state.userData = join(root, 'nested', 'userData');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('首次调用生成 UUID 并写入文件', async () => {
    const { getDeviceId } = await loadModule();
    const id = getDeviceId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(readFileSync(join(state.userData, 'device-id'), 'utf-8')).toBe(id);
  });

  it('同一进程内缓存结果', async () => {
    const { getDeviceId } = await loadModule();
    const id = getDeviceId();
    rmSync(join(state.userData, 'device-id'));
    expect(getDeviceId()).toBe(id);
    expect(existsSync(join(state.userData, 'device-id'))).toBe(false);
  });

  it('读取已有文件并去除空白', async () => {
    const dir = state.userData;
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'device-id'), '  existing-id\n');
    const { getDeviceId } = await loadModule();
    expect(getDeviceId()).toBe('existing-id');
  });

  it('文件为空时重新生成', async () => {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(state.userData, { recursive: true });
    writeFileSync(join(state.userData, 'device-id'), '   ');
    const { getDeviceId } = await loadModule();
    const id = getDeviceId();
    expect(id.length).toBe(36);
    expect(readFileSync(join(state.userData, 'device-id'), 'utf-8')).toBe(id);
  });

  it('跨"进程重启"保持稳定', async () => {
    const first = (await loadModule()).getDeviceId();
    const second = (await loadModule()).getDeviceId();
    expect(second).toBe(first);
  });
});
