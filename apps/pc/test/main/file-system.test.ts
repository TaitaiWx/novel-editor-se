import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import dirTree from 'directory-tree';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── electron mock：捕获 ipcMain.handle 注册，dialog/app/shell/clipboard 可控 ───

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  showOpenDialog: vi.fn(),
  openPath: vi.fn(),
  openExternal: vi.fn(),
  showItemInFolder: vi.fn(),
  getPath: vi.fn(),
  getAppPath: vi.fn(),
  send: vi.fn(),
  clipboardRead: vi.fn(),
  availableFormats: vi.fn(),
  readText: vi.fn(),
  addRecentFolder: vi.fn(),
  app: { isPackaged: false } as { isPackaged: boolean },
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    },
  },
  dialog: { showOpenDialog: mocks.showOpenDialog },
  shell: {
    openPath: mocks.openPath,
    openExternal: mocks.openExternal,
    showItemInFolder: mocks.showItemInFolder,
  },
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: mocks.send } }],
  },
  app: {
    get isPackaged() {
      return mocks.app.isPackaged;
    },
    getPath: mocks.getPath,
    getAppPath: mocks.getAppPath,
  },
  clipboard: {
    read: mocks.clipboardRead,
    availableFormats: mocks.availableFormats,
    readText: mocks.readText,
  },
}));

vi.mock('../../src/main/recent-folders', () => ({ addRecentFolder: mocks.addRecentFolder }));

import { registerFileSystemHandlers } from '../../src/main/handlers/file-system';

function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const handler: Handler | undefined = mocks.handlers.get(channel);
  if (!handler) throw new Error(`未注册的通道: ${channel}`);
  return Promise.resolve(handler({}, ...args)) as Promise<T>;
}

let dir: string;

async function touch(rel: string, content: string | Buffer = ''): Promise<string> {
  const full = path.join(dir, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content);
  return full;
}

async function exists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false
  );
}

beforeAll(() => {
  registerFileSystemHandlers();
});

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'ne-pc-fs-'));
  vi.clearAllMocks();
  mocks.app.isPackaged = false;
  return async () => {
    await rm(dir, { recursive: true, force: true });
  };
});

afterAll(() => {
  mocks.handlers.clear();
});

describe('通道注册', () => {
  it('注册的 IPC 通道名与重构前完全一致', () => {
    expect([...mocks.handlers.keys()].sort()).toEqual(
      [
        'open-local-folder',
        'read-file',
        'read-file-binary',
        'write-file',
        'get-file-info',
        'get-file-info-batch',
        'open-in-system-app',
        'show-item-in-folder',
        'open-external-url',
        'watch-file',
        'unwatch-file',
        'create-file',
        'create-directory',
        'refresh-folder',
        'cleanup-empty-generated-material-directories',
        'delete-file',
        'delete-directory',
        'rename-file',
        'paste-files',
        'read-clipboard-file-paths',
        'get-default-data-path',
        'open-sample-data',
        'sample-data-take-upgrade-notice',
        'export-project',
      ].sort()
    );
  });
});

// 重构前的 directory-tree 转换逻辑，用作对照
interface LegacyNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: LegacyNode[];
}
const LEGACY_EXCLUDE = /node_modules|\.git|\.novel-editor|\.vscode|\.DS_Store|dist|build|out/;
function convertLegacy(node: dirTree.DirectoryTree): LegacyNode {
  return {
    name: node.name,
    path: node.path,
    type: node.type === 'directory' ? 'directory' : 'file',
    ...(node.children && { children: node.children.map(convertLegacy) }),
  };
}

/** 新实现默认隐藏 dotfile 与系统文件：从旧实现输出中剔除这些条目再对照 */
function withoutHidden(nodes: LegacyNode[]): LegacyNode[] {
  return nodes
    .filter((node) => !node.name.startsWith('.') && node.name !== 'Thumbs.db')
    .map((node) => (node.children ? { ...node, children: withoutHidden(node.children) } : node));
}

describe('文件树：open-local-folder / refresh-folder', () => {
  it('refresh-folder 与旧 directory-tree 实现输出一致（除默认隐藏的 dotfile / 系统文件）', async () => {
    await touch('正文/第一卷/第一章.md', '内容');
    await touch('正文/第一卷/第二章.md');
    await mkdir(path.join(dir, '正文', '空卷'));
    await touch('设定/人物.md');
    await touch('.novelrc');
    await touch('.git/HEAD');
    await touch('node_modules/x/index.js');
    await touch('.DS_Store');
    await touch('.gitignore');
    await touch('设定/.hidden-note.md');
    await touch('Thumbs.db');
    await touch('封面.png', Buffer.from([1, 2, 3]));

    const legacyTree = dirTree(dir, { exclude: LEGACY_EXCLUDE, attributes: ['type'] });
    const legacy = {
      path: dir,
      files: withoutHidden(legacyTree?.children ? legacyTree.children.map(convertLegacy) : []),
      // 没有 .novel-editor/config.json：普通文件夹，不附带项目结构
      project: null,
    };
    const result = await invoke<{ files: LegacyNode[] }>('refresh-folder', dir);
    expect(result).toEqual(legacy);
    const rootNames = result.files.map((node) => node.name);
    for (const hidden of ['.novelrc', '.gitignore', '.git', '.DS_Store', 'Thumbs.db']) {
      expect(rootNames).not.toContain(hidden);
    }
  });

  it('不再误隐藏 outline.md 等名称中含排除关键词的条目', async () => {
    await touch('outline.md');
    await touch('build/a.js');
    const result = await invoke<{ files: LegacyNode[] }>('refresh-folder', dir);
    expect(result.files.map((node) => node.name)).toEqual(['outline.md']);
  });

  it('目录不存在时返回空列表', async () => {
    const missing = path.join(dir, 'missing');
    expect(await invoke('refresh-folder', missing)).toEqual({
      path: missing,
      files: [],
      project: null,
    });
  });

  it('refresh-folder 把旧版项目根 资料/ 移入唯一的作品；多部作品时保留为未归属', async () => {
    await touch(
      '.novel-editor/config.json',
      JSON.stringify({ name: '旧项目', novelsDir: 'novels' })
    );
    await touch('novels/星河/001-启程.md');
    await touch('资料/世界观.md', '# 世界观');
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const result = await invoke<{ project: { hasProjectMaterials: boolean } }>(
      'refresh-folder',
      dir
    );
    info.mockRestore();
    expect(result.project.hasProjectMaterials).toBe(false);
    expect(await readFile(path.join(dir, 'novels', '星河', '资料', '世界观.md'), 'utf-8')).toBe(
      '# 世界观'
    );

    await touch('novels/剑与诗/001-少年.md');
    await touch('资料/旧笔记.md', '旧');
    const again = await invoke<{ project: { hasProjectMaterials: boolean } }>(
      'refresh-folder',
      dir
    );
    expect(again.project.hasProjectMaterials).toBe(true);
  });

  it('ne init 项目附带作品结构（与 ne novel list 同一口径），配置损坏时按普通文件夹处理', async () => {
    await touch(
      '.novel-editor/config.json',
      JSON.stringify({ name: '作品集', novelsDir: 'novels' })
    );
    await touch('欢迎使用.md');
    await touch('novels/乙/001-开端.md');
    await touch('novels/甲/第一卷/001-a.md');
    const result = await invoke<{ project: unknown }>('refresh-folder', dir);
    expect(result.project).toEqual({
      name: '作品集',
      novelsDir: 'novels',
      novelsPath: path.join(dir, 'novels'),
      novels: ['乙', '甲'].sort(new Intl.Collator('zh-Hans-CN', { numeric: true }).compare),
      hasProjectMaterials: false,
    });

    await touch('.novel-editor/config.json', '{oops');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await invoke<{ project: unknown }>('refresh-folder', dir)).project).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('open-local-folder：选择后记录最近文件夹并返回树；取消返回 null', async () => {
    await touch('a.md');
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [dir] });
    expect(await invoke('open-local-folder')).toEqual({
      path: dir,
      files: [{ name: 'a.md', path: path.join(dir, 'a.md'), type: 'file' }],
      project: null,
    });
    expect(mocks.addRecentFolder).toHaveBeenCalledWith(dir);

    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await invoke('open-local-folder')).toBeNull();
  });
});

describe('读写', () => {
  it('read-file 默认 UTF-8，支持指定编码；失败时错误信息不变', async () => {
    const file = await touch('a.md', '你好');
    expect(await invoke('read-file', file)).toBe('你好');
    const gbk = await touch('gbk.txt', Buffer.from([0xc4, 0xe3, 0xba, 0xc3]));
    expect(await invoke('read-file', gbk, 'GBK')).toBe('你好');
    const missing = path.join(dir, 'none.md');
    await expect(invoke('read-file', missing)).rejects.toThrow(`Failed to read file: ${missing}`);
  });

  it('read-file-binary 返回 base64Content / byteSize / mimeType', async () => {
    const file = await touch('img.jpg', Buffer.from([0xff, 0xd8, 0xff]));
    expect(await invoke('read-file-binary', file)).toEqual({
      base64Content: Buffer.from([0xff, 0xd8, 0xff]).toString('base64'),
      byteSize: 3,
      mimeType: 'image/jpeg',
    });
    await expect(invoke('read-file-binary', path.join(dir, 'x.png'))).rejects.toThrow(
      'Failed to read binary file:'
    );
  });

  it('write-file 返回 { success: true }，父目录不存在时失败', async () => {
    const file = await touch('a.md', 'old');
    expect(await invoke('write-file', file, '新')).toEqual({ success: true });
    expect(await readFile(file, 'utf-8')).toBe('新');
    const bad = path.join(dir, 'nodir', 'a.md');
    await expect(invoke('write-file', bad, 'x')).rejects.toThrow(`Failed to write file: ${bad}`);
  });
});

describe('文件信息', () => {
  it('get-file-info 返回五个字段', async () => {
    const file = await touch('a.md', 'abc');
    const info = await invoke<Record<string, unknown>>('get-file-info', file);
    expect(Object.keys(info).sort()).toEqual(
      ['created', 'isDirectory', 'isFile', 'modified', 'size'].sort()
    );
    expect(info).toMatchObject({ size: 3, isFile: true, isDirectory: false });
    await expect(invoke('get-file-info', path.join(dir, 'x'))).rejects.toThrow(
      'Failed to get file info:'
    );
  });

  it('get-file-info-batch 跳过失败项', async () => {
    const a = await touch('a.md', 'a');
    const result = await invoke<Array<{ path: string; info: { size: number } }>>(
      'get-file-info-batch',
      [a, path.join(dir, 'missing')]
    );
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe(a);
    expect(result[0].info.size).toBe(1);
  });
});

describe('创建 / 删除 / 重命名', () => {
  it('create-file 返回 { success, filePath }，已存在时报「文件已存在」', async () => {
    const result = await invoke('create-file', dir, '第一章.md');
    expect(result).toEqual({ success: true, filePath: path.join(dir, '第一章.md') });
    expect(await readFile(path.join(dir, '第一章.md'), 'utf-8')).toBe('');
    await expect(invoke('create-file', dir, '第一章.md')).rejects.toThrow(
      'Failed to create file: 文件已存在'
    );
  });

  it('create-directory 返回 { success, dirPath }，已存在时报「目录已存在」', async () => {
    expect(await invoke('create-directory', dir, '第一卷')).toEqual({
      success: true,
      dirPath: path.join(dir, '第一卷'),
    });
    await expect(invoke('create-directory', dir, '第一卷')).rejects.toThrow(
      'Failed to create directory: 目录已存在'
    );
  });

  it('delete-file / delete-directory 返回 { success: true }', async () => {
    const file = await touch('a.md');
    await touch('d/sub/b.md');
    expect(await invoke('delete-file', file)).toEqual({ success: true });
    expect(await invoke('delete-directory', path.join(dir, 'd'))).toEqual({ success: true });
    expect(await readdir(dir)).toEqual([]);
    await expect(invoke('delete-file', file)).rejects.toThrow(`Failed to delete file: ${file}`);
    await expect(invoke('delete-directory', path.join(dir, 'd'))).rejects.toThrow(
      'Failed to delete directory:'
    );
  });

  it('rename-file 返回传入的 newPath；目标已存在时拒绝覆盖', async () => {
    const a = await touch('a.md', 'A');
    const b = path.join(dir, 'b.md');
    expect(await invoke('rename-file', a, b)).toEqual({ success: true, newPath: b });
    expect(await readFile(b, 'utf-8')).toBe('A');

    const c = await touch('c.md', 'C');
    await expect(invoke('rename-file', c, b)).rejects.toThrow(`Failed to rename: ${c}`);
    expect(await readFile(b, 'utf-8')).toBe('A');
  });
});

describe('paste-files', () => {
  it('返回 { success, results }，同名时生成 copy 名称', async () => {
    const src = await touch('a.md', 'x');
    const result = await invoke('paste-files', [src], dir);
    expect(result).toEqual({
      success: true,
      results: [{ source: src, dest: path.join(dir, 'a copy.md') }],
    });
  });

  it('错误信息保持原样', async () => {
    await expect(invoke('paste-files', [], path.join(dir, 'nope'))).rejects.toThrow(
      '目标目录不存在: nope'
    );
  });
});

describe('生成资料清理', () => {
  it('返回 { success, removed }', async () => {
    await mkdir(path.join(dir, '资料', 'AI资料'), { recursive: true });
    const result = await invoke<{ success: boolean; removed: string[] }>(
      'cleanup-empty-generated-material-directories',
      dir
    );
    expect(result.success).toBe(true);
    expect(result.removed).toEqual([path.join(dir, '资料', 'AI资料'), path.join(dir, '资料')]);
  });
});

describe('Electron 专属能力', () => {
  it('open-in-system-app 透传 shell.openPath 结果', async () => {
    mocks.openPath.mockResolvedValueOnce('');
    expect(await invoke('open-in-system-app', '/x')).toEqual({ success: true });
    mocks.openPath.mockResolvedValueOnce('no app');
    await expect(invoke('open-in-system-app', '/x')).rejects.toThrow('无法打开文件: no app');
  });

  it('show-item-in-folder 只接受已存在的绝对路径', async () => {
    expect(await invoke('show-item-in-folder', dir)).toEqual({ success: true });
    expect(mocks.showItemInFolder).toHaveBeenCalledWith(path.normalize(dir));
    for (const bad of ['relative/path', path.join(dir, '不存在'), 42, null]) {
      await expect(invoke('show-item-in-folder', bad)).rejects.toThrow('路径不存在');
    }
    expect(mocks.showItemInFolder).toHaveBeenCalledTimes(1);
  });

  it('open-external-url 只放行 http(s) / mailto', async () => {
    mocks.openExternal.mockResolvedValue(undefined);
    expect(await invoke('open-external-url', 'https://example.com/a')).toEqual({ success: true });
    expect(mocks.openExternal).toHaveBeenCalledWith('https://example.com/a');
    await invoke('open-external-url', 'mailto:a@b.c');
    for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'not a url', 42]) {
      await expect(invoke('open-external-url', bad)).rejects.toThrow('不支持打开该链接');
    }
    expect(mocks.openExternal).toHaveBeenCalledTimes(2);
  });

  it('get-default-data-path / open-sample-data 从开发环境种子目录播种', async () => {
    const appPath = path.join(dir, 'app', 'pc');
    await touch('app/sample-data/示例/第一章.md', 'sample');
    mocks.getAppPath.mockReturnValue(appPath);
    mocks.getPath.mockReturnValue(path.join(dir, 'Documents'));

    const expected = path.join(dir, 'Documents', 'Novel Editor', 'sample-data');
    expect(await invoke('get-default-data-path')).toBe(expected);
    expect(await readFile(path.join(expected, '示例', '第一章.md'), 'utf-8')).toBe('sample');
    expect(await invoke('open-sample-data')).toBe(expected);
    expect(mocks.getPath).toHaveBeenCalledWith('documents');
  });

  it('export-project：目录不存在 / 取消 / 成功 / 重名', async () => {
    expect(await invoke('export-project', path.join(dir, 'none'))).toEqual({
      success: false,
      error: '项目目录不存在',
    });

    const project = path.join(dir, '我的小说');
    await touch('我的小说/第一章.md', '正文');
    const target = path.join(dir, 'exports');
    await mkdir(target);

    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await invoke('export-project', project)).toBeNull();

    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [target] });
    expect(await invoke('export-project', project)).toEqual({
      success: true,
      destPath: path.join(target, '我的小说'),
    });
    expect(await invoke('export-project', project)).toEqual({
      success: true,
      destPath: `${path.join(target, '我的小说')} (2)`,
    });
    expect(await exists(path.join(target, '我的小说 (2)', '第一章.md'))).toBe(true);
  });

  it('watch-file / unwatch-file 不抛错且可重复调用', async () => {
    const file = await touch('a.md');
    await invoke('watch-file', file);
    await invoke('watch-file', file);
    await invoke('unwatch-file', file);
    await invoke('unwatch-file', file);
  });

  it.runIf(process.platform === 'darwin')(
    'read-clipboard-file-paths 解析 macOS plist',
    async () => {
      mocks.clipboardRead.mockReturnValueOnce(
        '<plist><array><string>/a/b.md</string><string>rel</string></array></plist>'
      );
      expect(await invoke('read-clipboard-file-paths')).toEqual(['/a/b.md']);
    }
  );
});
