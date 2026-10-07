import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectStructureResult } from '../../src/shared/project-structure';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
const workspaceRoot = { value: null as string | null };
const sent: Array<{ channel: string; payload: unknown }> = [];

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
  },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
        },
      },
    ],
  },
}));
vi.mock('../../src/main/handlers/session', () => ({
  getWorkspaceRootForSender: () => workspaceRoot.value,
}));

const { registerProjectStructureHandlers } = await import(
  '../../src/main/handlers/project-structure'
);
registerProjectStructureHandlers();

async function call(channel: string, ...args: unknown[]): Promise<ProjectStructureResult> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`未注册 ${channel}`);
  return (await handler({ sender: { id: 1 } }, ...args)) as ProjectStructureResult;
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'project-structure-'));
  workspaceRoot.value = root;
  sent.length = 0;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('project-structure-get / set', () => {
  it('读取默认规则，保存后写入文件并广播', async () => {
    const got = await call('project-structure-get', root);
    expect(got.ok && got.data.stored).toBe(false);
    expect(got.ok && got.data.config).toEqual({ presets: ['zh', 'en'], custom: [] });

    const config = {
      presets: ['zh', 'en'],
      custom: [{ id: 'sep', kind: 'scene', pattern: '^=== (.+) ===$' }],
    };
    const saved = await call('project-structure-set', root, config);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.data.location).toBe('folder');
    const json = JSON.parse(await readFile(saved.data.file, 'utf-8'));
    expect(json.structure).toEqual(config);
    expect(sent).toEqual([
      { channel: 'project-structure-changed', payload: { folderPath: root, config } },
    ]);
  });

  it('拒绝无效路径、工作区以外的文件夹与工作区的子目录', async () => {
    expect((await call('project-structure-get', 'relative/path')).ok).toBe(false);
    expect((await call('project-structure-get', 42)).ok).toBe(false);
    expect((await call('project-structure-get', path.join(root, 'missing'))).ok).toBe(false);
    const other = await mkdtemp(path.join(os.tmpdir(), 'project-structure-other-'));
    try {
      const result = await call('project-structure-set', other, { presets: [], custom: [] });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/当前打开的项目/);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
    const sub = path.join(root, 'sub');
    await mkdir(sub);
    expect((await call('project-structure-set', sub, { presets: [], custom: [] })).ok).toBe(false);
    expect(sent).toEqual([]);
  });

  it('经符号链接指向工作区的路径按真实路径比较', async () => {
    const link = `${root}-link`;
    await symlink(root, link);
    try {
      expect((await call('project-structure-get', link)).ok).toBe(true);
    } finally {
      await rm(link, { force: true });
    }
  });

  it('窗口没有上报工作区时只能读，不能写', async () => {
    workspaceRoot.value = null;
    expect((await call('project-structure-get', root)).ok).toBe(true);
    const result = await call('project-structure-set', root, { presets: [], custom: [] });
    expect(result.ok).toBe(false);
  });

  it('严格校验配置：未知预设、不安全正则、错误结构、过大的载荷', async () => {
    const bad = async (config: unknown) => {
      const result = await call('project-structure-set', root, config);
      return result.ok ? '' : result.error;
    };
    expect(await bad({ presets: ['xx'], custom: [] })).toMatch(/未知的预设/);
    expect(
      await bad({ presets: [], custom: [{ id: 'a', kind: 'scene', pattern: '(a+)+' }] })
    ).toMatch(/嵌套量词/);
    expect(await bad('oops')).toMatch(/对象/);
    expect(await bad({ presets: [], custom: [], junk: 'x'.repeat(40_000) })).toMatch(/过大/);
    expect(sent).toEqual([]);
  });
});
