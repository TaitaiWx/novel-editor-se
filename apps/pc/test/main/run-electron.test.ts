import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

function launch() {
  const source = readFileSync(path.resolve(__dirname, '../../scripts/run-electron.cjs'), 'utf8');
  const child = Object.assign(new EventEmitter(), {
    stdout: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
    stderr: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
  });
  const spawn = vi.fn(() => child);
  const prepare = vi.fn(async () => '/modified/Electron');
  const runtime = {
    argv: ['node', 'run-electron.cjs', '.', '--inspect=9229'],
    env: {}, pid: 123,
    stdout: { write: vi.fn() }, stderr: { write: vi.fn() },
    exit: vi.fn(), kill: vi.fn(),
  };
  runInNewContext(source, {
    require: (name: string) => {
      if (name === 'node:child_process') return { spawn };
      if (name === 'node:process') return runtime;
      if (name === 'electron') return '/original/Electron';
      if (name === './dev-electron-app.cjs') return { prepareDevElectronApp: prepare };
      throw new Error(`unexpected dependency: ${name}`);
    },
    console,
  });
  return { spawn, prepare, child, runtime };
}

describe('development Electron launcher', () => {
  it('直接启动依赖提供的原始 Electron，转发参数且不复制或重签名', async () => {
    const { spawn, prepare, runtime } = launch();
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    expect(spawn).toHaveBeenCalledWith('/original/Electron', ['.', '--inspect=9229'], {
      stdio: ['inherit', 'pipe', 'pipe'], env: runtime.env,
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('传递应用失败退出码，避免把启动失败当成成功', async () => {
    const { spawn, child, runtime } = launch();
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    child.emit('exit', 7, null);
    expect(runtime.exit).toHaveBeenCalledWith(7);
  });
});
