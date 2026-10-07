import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceContentSearchResponse } from '../../src/shared/workspace-search';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
const workspaceRoot = { value: null as string | null };

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
  },
}));
vi.mock('../../src/main/handlers/session', () => ({
  getWorkspaceRootForSender: () => workspaceRoot.value,
}));

const { buildMatchPreview, groupSearchMatches, registerWorkspaceSearchHandlers } = await import(
  '../../src/main/handlers/workspace-search'
);
registerWorkspaceSearchHandlers();

async function search(...args: unknown[]): Promise<WorkspaceContentSearchResponse> {
  const handler = handlers.get('workspace-search-content');
  if (!handler) throw new Error('未注册');
  return (await handler({ sender: { id: 1 } }, ...args)) as WorkspaceContentSearchResponse;
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'workspace-search-'));
  workspaceRoot.value = root;
  await mkdir(path.join(root, 'novels/星河旅人/第一卷'), { recursive: true });
  await mkdir(path.join(root, '.novel-editor'), { recursive: true });
  await writeFile(
    path.join(root, 'novels/星河旅人/第一卷/001-启程.md'),
    '# 启程\n\n清晨，林舟背起行囊走出家门。\n林舟回头看了一眼。\n',
    'utf-8'
  );
  await writeFile(path.join(root, '小说格式示例.md'), '这里没有那句话\n', 'utf-8');
  // 隐藏目录与非文本格式不参与搜索
  await writeFile(path.join(root, '.novel-editor/seed.json'), '林舟背起行囊', 'utf-8');
  await writeFile(path.join(root, 'novels/星河旅人/data.json'), '林舟背起行囊', 'utf-8');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('workspace-search-content', () => {
  it('在工作区的 .md / .txt 中按字面量搜索，按文件分组并给出高亮位置', async () => {
    const result = await search(root, '林舟背起行囊');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.files).toHaveLength(1);
    const [file] = result.data.files;
    expect(file.file).toBe(path.join(root, 'novels/星河旅人/第一卷/001-启程.md'));
    expect(file.matchCount).toBe(1);
    const [match] = file.matches;
    expect(match.line).toBe(3);
    expect(match.preview.slice(match.matchStart, match.matchStart + match.matchLength)).toBe(
      '林舟背起行囊'
    );
  });

  it('关键词按字面量处理（正则字符不生效），忽略大小写', async () => {
    await writeFile(path.join(root, 'notes.txt'), 'Hello (World).*\n', 'utf-8');
    const result = await search(root, '(world).*');
    expect(result.ok && result.data.files.map((item) => path.basename(item.file))).toEqual([
      'notes.txt',
    ]);
  });

  it('拒绝空关键词、过长关键词、相对路径与工作区外的目录', async () => {
    expect(await search(root, '   ')).toMatchObject({ ok: false });
    expect(await search(root, 'x'.repeat(101))).toMatchObject({ ok: false });
    expect(await search('novels', '林舟')).toMatchObject({ ok: false });
    expect(await search(root, 42)).toMatchObject({ ok: false });
    const outside = await mkdtemp(path.join(os.tmpdir(), 'workspace-search-outside-'));
    try {
      expect(await search(outside, '林舟')).toMatchObject({
        ok: false,
        error: '作品目录不在当前打开的项目内',
      });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe('预览与分组', () => {
  it('长行截取关键词附近的内容并加省略号', () => {
    const text = `${'前'.repeat(40)}关键词${'后'.repeat(100)}`;
    const preview = buildMatchPreview(text, 41, 3);
    expect(preview.preview.startsWith('…')).toBe(true);
    expect(preview.preview.endsWith('…')).toBe(true);
    expect(
      preview.preview.slice(preview.matchStart, preview.matchStart + preview.matchLength)
    ).toBe('关键词');
  });

  it('同一行多次命中只展示一次；超过文件数上限时截断', () => {
    const match = (file: string, line: number) => ({
      file,
      line,
      column: 1,
      match: 'a',
      text: 'a a',
    });
    const grouped = groupSearchMatches(
      [match('/a.md', 1), match('/a.md', 1), match('/a.md', 2), match('/b.md', 1)],
      1,
      3
    );
    expect(grouped.truncated).toBe(true);
    expect(grouped.files).toHaveLength(1);
    expect(grouped.files[0].matchCount).toBe(3);
    expect(grouped.files[0].matches.map((item) => item.line)).toEqual([1, 2]);
  });
});
