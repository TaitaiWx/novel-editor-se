import { afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  quit: vi.fn(),
  exit: vi.fn(),
  on: vi.fn(),
  destroy: vi.fn(),
  execute: vi.fn(async () => {
    throw new Error('encoder unavailable');
  }),
}));
vi.mock('electron', () => ({
  app: { whenReady: async () => {}, quit: mock.quit, exit: mock.exit, on: mock.on },
  BrowserWindow: class {
    webContents = { executeJavaScript: mock.execute };
    loadFile = async () => {};
    destroy = mock.destroy;
  },
}));
const originalArgs = process.argv;
afterEach(() => {
  process.argv = originalArgs;
  vi.restoreAllMocks();
});
it('media encoder failure cleans its window then exits 1 without an earlier success quit', async () => {
  process.argv = [process.execPath, 'generate-sample-media.mjs', '--only=images'];
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await import('../../scripts/generate-sample-media.mjs');
  await vi.waitFor(() => expect(mock.exit).toHaveBeenCalledWith(1));
  expect(mock.destroy).toHaveBeenCalledOnce();
  expect(mock.quit).not.toHaveBeenCalled();
  expect(mock.on).toHaveBeenCalledWith('window-all-closed', expect.any(Function));
});
