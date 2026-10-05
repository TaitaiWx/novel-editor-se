import { describe, expect, it } from 'vitest';
import { PortChannel } from '../../src/shared/portChannels';

describe('PortChannel', () => {
  it('通道名与主进程/渲染进程约定的字符串一致', () => {
    expect(PortChannel.ContentSync).toBe('content-sync');
    expect(PortChannel.CrdtOps).toBe('crdt-ops');
  });

  it('通道名互不重复', () => {
    const names: string[] = [PortChannel.ContentSync, PortChannel.CrdtOps];
    expect(new Set(names).size).toBe(names.length);
  });
});
