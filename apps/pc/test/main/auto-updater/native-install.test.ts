import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import type { AppUpdater } from 'electron-updater';
vi.mock('electron', () => ({
  app: new EventEmitter(),
  autoUpdater: Object.assign(new EventEmitter(), { checkForUpdates: vi.fn() }),
}));
import { app, autoUpdater as native } from 'electron';
import {
  handoffNativeUpdate,
  prepareNativeUpdate,
} from '../../../src/main/auto-updater/native-install';
afterEach(() => {
  app.removeAllListeners();
  native.removeAllListeners();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('native installation completion', () => {
  it('void return from quitAndInstall does not count as success', async () => {
    const updater = Object.assign(new EventEmitter(), { quitAndInstall: vi.fn() });
    const completed = vi.fn();
    const pending = handoffNativeUpdate(updater as unknown as AppUpdater).then(completed);
    await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();
    app.emit('will-quit');
    await pending;
    expect(completed).toHaveBeenCalledTimes(1);
  });
  it('asynchronous spawn failure restores ordinary quit handling without intercepting later requests', async () => {
    const ordinaryQuitBarrier = vi.fn();
    app.on('before-quit', ordinaryQuitBarrier);
    const updater = Object.assign(new EventEmitter(), { quitAndInstall: vi.fn() });
    const pending = handoffNativeUpdate(updater as unknown as AppUpdater);
    const rejection = expect(pending).rejects.toThrow('spawn EACCES');
    await Promise.resolve();
    updater.emit('error', new Error('spawn EACCES'));
    await rejection;
    expect(app.listenerCount('before-quit')).toBe(1);
    const event = { preventDefault: vi.fn() };
    app.emit('before-quit', event);
    app.emit('before-quit', event);
    expect(ordinaryQuitBarrier).toHaveBeenCalledTimes(2);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(app.listenerCount('will-quit')).toBe(0);
  });
  it('mac native preparation rejects before editor leases on signature failure', async () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' });
    const pending = prepareNativeUpdate();
    const rejection = expect(pending).rejects.toThrow('signature');
    native.emit('error', new Error('signature'));
    await rejection;
    expect(native.listenerCount('update-downloaded')).toBe(0);
  });
});
