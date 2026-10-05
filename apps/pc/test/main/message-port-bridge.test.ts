import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

const ports = vi.hoisted(() => ({ created: [] as Array<{ port1: object; port2: object }> }));

vi.mock('electron', () => ({
  BrowserWindow: class {},
  MessageChannelMain: class {
    port1 = { name: 'port1' };
    port2 = { name: 'port2' };
    constructor() {
      ports.created.push(this);
    }
  },
}));

import { establishPortChannel } from '../../src/main/message-port-bridge';

function fakeWindow() {
  const postMessage = vi.fn();
  return { win: { webContents: { postMessage } } as unknown as BrowserWindow, postMessage };
}

describe('establishPortChannel', () => {
  it('为两个窗口分别发送端口对的一端', () => {
    const a = fakeWindow();
    const b = fakeWindow();

    establishPortChannel(a.win, b.win, 'content-sync');

    expect(ports.created).toHaveLength(1);
    const { port1, port2 } = ports.created[0];
    expect(a.postMessage).toHaveBeenCalledWith('port-transfer', 'content-sync', [port1]);
    expect(b.postMessage).toHaveBeenCalledWith('port-transfer', 'content-sync', [port2]);
  });

  it('每次调用创建新的通道', () => {
    const a = fakeWindow();
    const b = fakeWindow();
    const before = ports.created.length;
    establishPortChannel(a.win, b.win, 'x');
    establishPortChannel(a.win, b.win, 'y');
    expect(ports.created.length).toBe(before + 2);
    expect(a.postMessage.mock.calls[0][2][0]).not.toBe(a.postMessage.mock.calls[1][2][0]);
  });
});
