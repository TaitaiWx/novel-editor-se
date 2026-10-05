import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const electronState = vi.hoisted(() => ({ isPackaged: false }));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electronState.isPackaged;
    },
  },
}));

import { resolveLaunchFolder } from '../../src/main/launch-folder';

describe('resolveLaunchFolder', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'ne-launch-'));
    mkdirSync(path.join(root, 'novel-a'));
    mkdirSync(path.join(root, 'novel-b'));
    writeFileSync(path.join(root, 'file.txt'), 'x');
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    electronState.isPackaged = false;
  });

  it('开发模式跳过 electron 和 appPath 两个参数', () => {
    // appPath 本身是目录也应被跳过
    expect(resolveLaunchFolder(['electron', root], root)).toBeNull();
    expect(resolveLaunchFolder(['electron', root, 'novel-a'], root)).toBe(
      path.join(root, 'novel-a')
    );
  });

  it('打包模式只跳过可执行文件', () => {
    electronState.isPackaged = true;
    expect(resolveLaunchFolder(['/Applications/Novel Editor', 'novel-a'], root)).toBe(
      path.join(root, 'novel-a')
    );
  });

  it('多个目录时取最后一个有效目录', () => {
    electronState.isPackaged = true;
    expect(
      resolveLaunchFolder(['exe', 'novel-a', 'novel-b', 'missing-dir', 'file.txt'], root)
    ).toBe(path.join(root, 'novel-b'));
  });

  it('忽略以 - 开头的参数和空参数', () => {
    electronState.isPackaged = true;
    expect(resolveLaunchFolder(['exe', 'novel-a', '--smoke-test', ''], root)).toBe(
      path.join(root, 'novel-a')
    );
    expect(resolveLaunchFolder(['exe', '-v'], root)).toBeNull();
  });

  it('支持绝对路径', () => {
    electronState.isPackaged = true;
    const abs = path.join(root, 'novel-b');
    expect(resolveLaunchFolder(['exe', abs], '/')).toBe(abs);
  });

  it('文件和不存在的路径返回 null', () => {
    electronState.isPackaged = true;
    expect(resolveLaunchFolder(['exe', 'file.txt', 'nope'], root)).toBeNull();
    expect(resolveLaunchFolder(['exe'], root)).toBeNull();
  });

  it('默认使用 process.cwd() 作为基准目录', () => {
    electronState.isPackaged = true;
    const spy = vi.spyOn(process, 'cwd').mockReturnValue(root);
    try {
      expect(resolveLaunchFolder(['exe', 'novel-a'])).toBe(path.join(root, 'novel-a'));
    } finally {
      spy.mockRestore();
    }
  });
});
