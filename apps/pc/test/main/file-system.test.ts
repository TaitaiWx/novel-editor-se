import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
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
  getRecentFolders: vi.fn(() => []),
  app: { isPackaged: false } as { isPackaged: boolean },
}));

vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn(),
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

vi.mock('../../src/main/renderer-preparation', () => ({
  requestRendererPreparation: vi.fn(async () => ({ release: vi.fn() })),
}));

vi.mock('../../src/main/recent-folders', () => ({
  addRecentFolder: mocks.addRecentFolder,
  getRecentFolders: mocks.getRecentFolders,
}));

import { grantPathAccess, resetPathAccessForTest } from '../../src/main/path-access';
import { registerFileSystemHandlers } from '../../src/main/handlers/file-system';

function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const handler: Handler | undefined = mocks.handlers.get(channel);
  if (!handler) throw new Error(`未注册的通道: ${channel}`);
  return Promise.resolve(handler({ sender: { id: 1, send: mocks.send } }, ...args)) as Promise<T>;
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
  resetPathAccessForTest();
  await grantPathAccess({ id: 1 }, dir, true);
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
        'get-files-exist',
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

  it('write-file 同一文件并发保存时按调用顺序落盘（最后一次保存的内容生效）', async () => {
    // 正文文件保存前会先异步读取旧内容（写作日志），并发时旧内容不能晚于新内容落盘
    const file = await touch('001-并发.md', '原文');
    const versions = Array.from({ length: 12 }, (_, index) =>
      index % 2 === 0 ? `版本 ${index}\n${'长段落'.repeat(20_000)}` : `版本 ${index}`
    );
    await Promise.all(versions.map((content) => invoke('write-file', file, content)));
    expect(await readFile(file, 'utf-8')).toBe(versions.at(-1));
  });
});

describe('内部数据：refresh-folder 隐藏、write-file 拒绝', () => {
  it('refresh-folder 去掉成长档案 JSON / 分镜状态 / 提示词记录，保留派生摘要与作者的 JSON，场景目录带 sceneVideo', async () => {
    await touch('资料/记忆/规则.json', '{}');
    await touch('资料/记忆/README.md', '# 记忆库');
    await touch('资料/记忆/角色/林舟.json', '{}');
    await touch('资料/记忆/角色/林舟.md', '# 林舟');
    await touch('资料/视频/001-启程/第一场/分镜.json', '{}');
    await touch('资料/视频/001-启程/第一场/分镜.md', '# 分镜');
    await touch('资料/视频/001-启程/第一场/镜头1-v1.prompt.json', '{}');
    await touch('资料/人物表.json', '[]');
    const result = await invoke<{ files: LegacyNode[] }>('refresh-folder', dir);
    const all: Array<LegacyNode & { sceneVideo?: boolean }> = [];
    const walk = (nodes: LegacyNode[]) =>
      nodes.forEach((node) => {
        all.push(node);
        if (node.children) walk(node.children);
      });
    walk(result.files);
    const names = all.map((node) => path.relative(dir, node.path).split(path.sep).join('/'));
    expect(names).not.toContain('资料/记忆/规则.json');
    expect(names).not.toContain('资料/记忆/角色/林舟.json');
    expect(names).not.toContain('资料/视频/001-启程/第一场/分镜.json');
    expect(names).not.toContain('资料/视频/001-启程/第一场/镜头1-v1.prompt.json');
    expect(names).toEqual(
      expect.arrayContaining([
        '资料/记忆/README.md',
        '资料/记忆/角色/林舟.md',
        '资料/视频/001-启程/第一场/分镜.md',
        '资料/人物表.json',
      ])
    );
    const scene = all.find((node) => node.name === '第一场');
    expect(scene?.sceneVideo).toBe(true);
  });

  it('write-file 拒绝写入内部数据与派生摘要（专用 IPC 直接写文件，不受影响），作者的 JSON 照常保存', async () => {
    const rules = await touch('资料/记忆/规则.json', '{"a":1}');
    await expect(invoke('write-file', rules, '{}')).rejects.toThrow('软件内部数据');
    expect(await readFile(rules, 'utf-8')).toBe('{"a":1}');
    const state = await touch('资料/视频/001-启程/第一场/分镜.json', '{}');
    await expect(invoke('write-file', state, 'x')).rejects.toThrow('软件内部数据');
    const readme = await touch('资料/记忆/README.md', '# 记忆库');
    await expect(invoke('write-file', readme, 'x')).rejects.toThrow('软件内部数据');
    await expect(
      invoke('write-file', path.join(dir, '.novel-editor', 'config.json'), 'x')
    ).rejects.toThrow('软件内部数据');
    const own = await touch('资料/人物表.json', '[]');
    expect(await invoke('write-file', own, '[1]')).toEqual({ success: true });
    expect(await readFile(own, 'utf-8')).toBe('[1]');
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

  it('get-file-info-batch keeps authorized media candidates when other candidates are outside the workspace', async () => {
    const media = await touch('media/picture.png', 'image');
    const outside = await mkdtemp(path.join(os.tmpdir(), 'ne-pc-media-outside-'));
    const unapproved = path.join(outside, 'secret.png');
    await writeFile(unapproved, 'private');
    try {
      const result = await invoke<Array<{ path: string; info: { size: number } }>>(
        'get-file-info-batch',
        [unapproved, media, path.join(dir, 'missing')]
      );
      expect(result).toEqual([
        { path: media, info: expect.objectContaining({ size: 5, isFile: true }) },
      ]);
      expect(await invoke('get-file-info-batch', [unapproved])).toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
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
    expect(await invoke('open-in-system-app', dir)).toEqual({ success: true });
    mocks.openPath.mockResolvedValueOnce('no app');
    await expect(invoke('open-in-system-app', dir)).rejects.toThrow('无法打开文件: no app');
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

describe('IPC path authorization regressions', () => {
  it('rejects arbitrary files from a renderer without an approved workspace', async () => {
    const secret = await touch('private.txt', 'secret');
    const handler = mocks.handlers.get('read-file')!;
    await expect(
      Promise.resolve().then(() => handler({ sender: { id: 999 } }, secret))
    ).rejects.toThrow();
  });

  it('does not follow an in-workspace symbolic link to write outside', async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), 'ne-outside-'));
    try {
      const secret = path.join(outside, 'secret.txt');
      await writeFile(secret, 'original');
      await symlink(outside, path.join(dir, 'escape'));
      await expect(
        invoke('write-file', path.join(dir, 'escape', 'secret.txt'), 'changed')
      ).rejects.toThrow();
      expect(await readFile(secret, 'utf8')).toBe('original');
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('rejects deleting and renaming managed data and folders containing it', async () => {
    const managed = await touch('资料/记忆/规则.json', '{}');
    await expect(invoke('delete-file', managed)).rejects.toThrow();
    await expect(invoke('rename-file', managed, path.join(dir, 'rules.json'))).rejects.toThrow();
    await expect(invoke('delete-directory', path.join(dir, '资料'))).rejects.toThrow();
    expect(await readFile(managed, 'utf8')).toBe('{}');
  });
});

it('renames a structural work folder together with its managed material subtree', async () => {
  await touch('work/资料/记忆/规则.json', '{}');
  const renamed = path.join(dir, 'renamed');
  await expect(invoke('rename-file', path.join(dir, 'work'), renamed)).resolves.toEqual({
    success: true,
    newPath: renamed,
  });
  expect(await readFile(path.join(renamed, '资料/记忆/规则.json'), 'utf8')).toBe('{}');
  await expect(
    invoke('rename-file', path.join(renamed, '资料/记忆'), path.join(dir, 'exposed'))
  ).rejects.toThrow();
});

it('renames an approved workspace only to an unused sibling and moves its grants', async () => {
  const original = dir;
  const renamed = `${dir}-renamed`;
  await touch('.novel-editor/config.json', '{}');
  await touch('chapter.md', 'text');
  await expect(
    invoke('rename-file', original, path.join(os.tmpdir(), 'nested', 'elsewhere'))
  ).rejects.toThrow();
  await expect(invoke('rename-file', original, renamed)).resolves.toEqual({
    success: true,
    newPath: renamed,
  });
  dir = renamed;
  expect(await invoke('read-file', path.join(dir, 'chapter.md'))).toBe('text');
  await expect(invoke('write-file', path.join(original, 'chapter.md'), 'bad')).rejects.toThrow();
});

it('rejects malformed mutation requests and protected paste destinations', async () => {
  const source = await touch('rules.json', '{}');
  await mkdir(path.join(dir, '资料/记忆'), { recursive: true });
  for (const channel of ['create-file', 'create-directory']) {
    for (const name of ['../escape', '/absolute', 'a/b', null])
      await expect(invoke(channel, dir, name)).rejects.toThrow();
  }
  await expect(invoke('paste-files', [source], path.join(dir, '资料/记忆'))).rejects.toThrow();
  await expect(invoke('write-file', source, { data: 'bad' })).rejects.toThrow();
  await expect(invoke('get-file-info-batch', 'not-an-array')).rejects.toThrow();
});

it('keeps observing the file after repeated atomic replacement and isolates the sender', async () => {
  const file = await touch('watched.md', 'old');
  await invoke('watch-file', file);
  try {
    for (const content of ['one', 'two']) {
      mocks.send.mockClear();
      const temporary = await touch('temporary.md', content);
      await rename(temporary, file);
      await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledWith('file-changed', file), {
        timeout: 2000,
      });
    }
  } finally {
    await invoke('unwatch-file', file);
  }
});

it('deletes a whole work with managed data while refusing direct material-subtree deletion', async () => {
  await touch('work/资料/记忆/规则.json', '{}');
  await expect(invoke('delete-directory', path.join(dir, 'work/资料'))).rejects.toThrow();
  await expect(invoke('delete-directory', path.join(dir, 'work'))).resolves.toEqual({
    success: true,
  });
  expect(await exists(path.join(dir, 'work'))).toBe(false);
});

it('deleting a file or directory waits for previously submitted saves', async () => {
  const file = await touch('pending/chapter.md', 'old');
  const saves = Array.from({ length: 8 }, (_, index) =>
    invoke('write-file', file, `version ${index}\n${'text'.repeat(50000)}`)
  );
  await invoke('delete-directory', path.dirname(file));
  await Promise.all(saves);
  expect(await exists(path.dirname(file))).toBe(false);
  const standalone = await touch('pending.txt', 'old');
  const write = invoke('write-file', standalone, 'new');
  await invoke('delete-file', standalone);
  await write;
  expect(await exists(standalone)).toBe(false);
});

it('native folder selection grants the requesting window access', async () => {
  const file = await touch('selected.md', 'selected');
  mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [dir] });
  const event = { sender: { id: 999 } };
  await mocks.handlers.get('open-local-folder')!(event);
  expect(await mocks.handlers.get('read-file')!(event, file)).toBe('selected');
});

it('folder refresh never exposes symlink targets or migrates materials outside the workspace', async () => {
  const outside = await mkdtemp(path.join(os.tmpdir(), 'ne-outside-tree-'));
  try {
    await mkdir(path.join(outside, 'book'));
    await writeFile(path.join(outside, 'secret.txt'), 'secret');
    await symlink(outside, path.join(dir, 'external'));
    await touch('资料/note.md', 'keep');
    await touch('.novel-editor/config.json', JSON.stringify({ novelsDir: outside }));
    const result = await invoke<{ files: LegacyNode[]; project: unknown }>('refresh-folder', dir);
    expect(result.files.map((node) => node.name)).not.toContain('external');
    expect(result.project).toBeNull();
    expect(await readFile(path.join(dir, '资料/note.md'), 'utf8')).toBe('keep');
    expect(await exists(path.join(outside, 'book/资料'))).toBe(false);
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

it('rejects new saves while deletion is draining and releases the mutation lock afterwards', async () => {
  const file = await touch('deleting/chapter.md', 'old');
  const first = invoke('write-file', file, 'already queued');
  const deletion = invoke('delete-directory', path.dirname(file));
  await expect(invoke('write-file', file, 'late timer')).rejects.toThrow('正在删除或移动');
  await Promise.all([first, deletion]);
  expect(await exists(path.dirname(file))).toBe(false);
  const recreated = await touch('deleting/chapter.md', 'new intentional file');
  await expect(invoke('write-file', recreated, 'new save')).resolves.toEqual({ success: true });
});

it('saving a chapter cannot write its log through external metadata symlinks', async () => {
  const outside = await mkdtemp(path.join(os.tmpdir(), 'ne-outside-log-'));
  try {
    await writeFile(path.join(outside, 'config.json'), '{}');
    await symlink(outside, path.join(dir, '.novel-editor'));
    const chapter = await touch('novels/book/chapter.md', 'old');
    await expect(invoke('write-file', chapter, 'new text')).resolves.toEqual({ success: true });
    expect(await exists(path.join(outside, 'writing-log.json'))).toBe(false);
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

it('rejects late saves as soon as a rename across two authorized roots is admitted', async () => {
  const file = await touch('moving/chapter.md', 'old');
  const outside = await mkdtemp(path.join(os.tmpdir(), 'ne-rename-destination-'));
  try {
    await grantPathAccess({ id: 1 }, outside, true);
    const first = invoke('write-file', file, 'already queued');
    const destination = path.join(outside, 'moved');
    const rename = invoke('rename-file', path.dirname(file), destination);
    await expect(invoke('write-file', file, 'late timer')).rejects.toThrow('正在删除或移动');
    await Promise.all([first, rename]);
    expect(await readFile(path.join(destination, 'chapter.md'), 'utf8')).toBe('already queued');
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});
