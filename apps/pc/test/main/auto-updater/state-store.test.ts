import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const env = vi.hoisted(() => ({ userData: '' }));

vi.mock('electron', () => ({
  app: {
    getVersion: () => '1.1.0-beta.43',
    getPath: () => env.userData,
    isPackaged: false,
  },
}));

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('updater state-store', () => {
  beforeEach(() => {
    vi.resetModules();
    env.userData = mkdtempSync(join(tmpdir(), 'ne-updater-state-'));
  });

  afterEach(() => {
    rmSync(env.userData, { recursive: true, force: true });
  });

  it('并发持久化不会因临时文件被抢先 rename 而报 ENOENT，且不留下临时文件', async () => {
    const { loadUpdaterState, persistUpdaterState } = await import(
      '../../../src/main/auto-updater/state-store'
    );
    await loadUpdaterState();

    await expect(
      Promise.all(Array.from({ length: 20 }, () => persistUpdaterState()))
    ).resolves.toHaveLength(20);

    const files = readdirSync(env.userData);
    expect(files).toContain('updater-state.json');
    expect(files.filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(() =>
      JSON.parse(readFileSync(join(env.userData, 'updater-state.json'), 'utf8'))
    ).not.toThrow();
  });
});
