// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  useLibraryGeneration,
  type UseLibraryGenerationContext,
} from '@/render/hooks/useLibraryGeneration';
import type { FileNode } from '@/render/types';
import { installElectronMock, uninstallElectronMock, type InvokeHandler } from './electronMock';
import { makeToast, ref } from './hookCtx';

const FOLDER = '/w';

interface AiResponse {
  ok: boolean;
  text?: string;
  error?: string;
}

function dir(path: string, children: FileNode[] = []): FileNode {
  return { name: path.split('/').pop() || path, path, type: 'directory', children };
}
function file(path: string): FileNode {
  return { name: path.split('/').pop() || path, path, type: 'file' };
}

const fenced = (value: unknown) => `好的，结果如下：\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;

function setup(
  options: {
    handler?: InvokeHandler;
    aiResponses?: AiResponse[];
    files?: FileNode[];
    folder?: string | null;
    settings?: { ai: { contextTokens: number } } | null;
    novelId?: number | null;
    content?: string;
  } = {}
) {
  const queue = [...(options.aiResponses ?? [])];
  const electron = installElectronMock((channel, ...args) => {
    if (channel === 'ai-request') return queue.shift() ?? { ok: true, text: '' };
    return options.handler?.(channel, ...args);
  });
  const toast = makeToast();
  const ctx = {
    bumpWorkspaceCharactersVersion: vi.fn(),
    bumpWorkspaceLoreVersion: vi.fn(),
    ensurePersistedAiReady: vi.fn(async () =>
      options.settings === undefined ? { ai: { contextTokens: 0 } } : options.settings
    ),
    filesRef: ref<FileNode[]>(options.files ?? []),
    folderPathRef: ref<string | null>(options.folder === undefined ? FOLDER : options.folder),
    workScopePathRef: ref<string | null>(options.folder === undefined ? FOLDER : options.folder),
    getCurrentNovelId: vi.fn(async () => (options.novelId === undefined ? 1 : options.novelId)),
    refreshCurrentFolder: vi.fn(async () => undefined),
    resolveAIGenerationContext: vi.fn(async () => ({
      content: options.content ?? '林与老王在山门相遇。',
      label: '当前章节',
    })),
    setWorkspaceCharacters: vi.fn(),
    setWorkspaceLoreEntries: vi.fn(),
    toast,
  };
  const { result } = renderHook(() =>
    useLibraryGeneration(ctx as unknown as UseLibraryGenerationContext)
  );
  return { result, ctx, toast, electron };
}

function aiCalls(electron: ReturnType<typeof installElectronMock>) {
  return electron.invoke.mock.calls.filter((c) => c[0] === 'ai-request');
}

afterEach(() => {
  uninstallElectronMock();
});

describe('useLibraryGeneration · 人物', () => {
  const existingRows = [
    {
      id: 2,
      name: '王五',
      role: '师兄',
      description: '旧描述',
      attributes: '{"aliases":["老王"]}',
    },
  ];

  it('解析围栏 JSON，新建/更新人物并写入关系', async () => {
    const graph = {
      characters: [
        { name: '林', role: '主角', description: '少年', aliases: ['小林', ' '] },
        { name: '老王', role: '', description: '', aliases: ['王师兄'] },
      ],
      relations: [
        { source: '小林', target: '王师兄', label: ' 师兄弟 ', tone: 'ally', note: '' },
        { source: '林', target: '路人', label: 'x', tone: 'rival' },
        { source: '林', target: '小林', label: 'self', tone: 'other' },
        { source: '林', target: '老王', label: '', tone: 'weird' },
      ],
    };
    const { result, ctx, toast, electron } = setup({
      aiResponses: [{ ok: true, text: fenced(graph) }],
      handler: (channel) => {
        if (channel === 'db-character-list') return existingRows;
        if (channel === 'db-character-create') return { lastInsertRowid: BigInt(9) };
        if (channel === 'db-world-setting-list-by-folder')
          return [
            {
              id: 1,
              category: 'world',
              title: '宗门',
              content: '青云宗',
              tags: '[]',
              created_at: '',
              updated_at: '',
            },
          ];
        return undefined;
      },
    });
    await act(() => result.current.handleGenerateCharacters('current-chapter'));

    expect(toast.info).toHaveBeenCalledWith('正在从当前章节生成人物图谱...', 1800);
    const [request] = aiCalls(electron);
    const payload = request[1] as { context: string };
    expect(payload.context).toContain('设定集参考:\n宗门: 青云宗');
    expect(payload.context).toContain('正文片段 1/1');

    const update = electron.invoke.mock.calls.find((c) => c[0] === 'db-character-update');
    expect(update?.[1]).toBe(2);
    const updatePayload = update?.[2] as { role: string; appendAliases: string[] };
    expect(updatePayload).not.toHaveProperty('name');
    expect(updatePayload).not.toHaveProperty('attributes');
    expect(updatePayload).not.toHaveProperty('role');
    expect(updatePayload.appendAliases).toEqual(['王师兄']);

    const create = electron.invoke.mock.calls.find((c) => c[0] === 'db-character-create');
    expect(create?.slice(1, 5)).toEqual([1, '林', '主角', '少年']);

    const relationCall = electron.invoke.mock.calls.find(
      (c) => c[0] === 'db-settings-set' && String(c[1]).includes('character-relations')
    );
    const relations = JSON.parse(String(relationCall?.[2])) as Array<{
      sourceId: number;
      targetId: number;
      label: string;
      tone: string;
    }>;
    expect(relations).toEqual([
      expect.objectContaining({ sourceId: 9, targetId: 2, label: '师兄弟', tone: 'ally' }),
      expect.objectContaining({ sourceId: 9, targetId: 2, label: '其他', tone: 'other' }),
    ]);
    expect(ctx.setWorkspaceCharacters).toHaveBeenCalled();
    expect(ctx.bumpWorkspaceCharactersVersion).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('AI 已同步人物：新增 1，更新 1，关系 2');
  });

  it('长文本分块请求，坏块被跳过', async () => {
    const paragraph = '甲'.repeat(6000);
    const content = Array.from({ length: 3 }, () => paragraph).join('\n\n');
    const { result, toast, electron } = setup({
      content,
      aiResponses: [
        { ok: true, text: '这不是 JSON' },
        { ok: true, text: '{"characters":[{"name":"甲"}],"relations":[]}' },
        { ok: true, text: '```json\n{"characters": [ broken \n```' },
      ],
      handler: (channel) => {
        if (channel === 'db-character-list') return [];
        if (channel === 'db-character-create') return { lastInsertRowid: 3 };
        if (channel === 'db-world-setting-list-by-folder') return [];
        return undefined;
      },
    });
    await act(() => result.current.handleGenerateCharacters('whole-project'));
    expect(aiCalls(electron).length).toBe(3);
    expect(toast.success).toHaveBeenCalledWith('AI 已同步人物：新增 1，更新 0，关系 0');
  });

  it('AI 返回无法解析的内容时提示未识别到人物', async () => {
    const { result, toast, electron } = setup({
      aiResponses: [{ ok: true, text: '抱歉，我无法完成。' }],
      handler: (channel) => (channel === 'db-world-setting-list-by-folder' ? [] : undefined),
    });
    await act(() => result.current.handleGenerateCharacters('current-content'));
    expect(toast.warning).toHaveBeenCalledWith('AI 没有识别出足够明确的人物');
    expect(electron.invoke).not.toHaveBeenCalledWith('db-character-list', expect.anything());
  });

  it('AI 请求失败时提示错误（含默认文案）', async () => {
    const a = setup({
      aiResponses: [{ ok: false, error: 'rate limited' }],
      handler: () => [],
    });
    await act(() => a.result.current.handleGenerateCharacters('current-content'));
    expect(a.toast.error).toHaveBeenCalledWith('AI 生成人物失败: rate limited');
    uninstallElectronMock();

    const b = setup({ aiResponses: [{ ok: false }], handler: () => [] });
    await act(() => b.result.current.handleGenerateCharacters('current-content'));
    expect(b.toast.error).toHaveBeenCalledWith('AI 生成人物失败: AI 生成人物失败');
  });

  it('前置条件不满足时不发起请求', async () => {
    const a = setup({ folder: null });
    await act(() => a.result.current.handleGenerateCharacters('current-content'));
    expect(a.ctx.ensurePersistedAiReady).not.toHaveBeenCalled();

    const b = setup({ settings: null });
    await act(() => b.result.current.handleGenerateCharacters('current-content'));
    expect(b.ctx.getCurrentNovelId).not.toHaveBeenCalled();

    const c = setup({ novelId: null });
    await act(() => c.result.current.handleGenerateCharacters('current-content'));
    expect(c.ctx.resolveAIGenerationContext).not.toHaveBeenCalled();
  });
});

describe('useLibraryGeneration · 设定', () => {
  const row = (id: number, title: string, content: string) => ({
    id,
    category: 'world',
    title,
    content,
    tags: '[]',
    created_at: '',
    updated_at: '',
  });

  it('新增新条目、补全空摘要条目、跳过已有摘要条目', async () => {
    const entries = {
      entries: [
        { category: 'world', title: '灵脉', summary: '新摘要', tags: ['地理'] },
        { category: 'world', title: '宗门', summary: '不会覆盖' },
        { category: 'system', title: '境界', summary: '炼气筑基' },
        { category: 'bogus', title: '', summary: '无标题被过滤' },
      ],
    };
    const { result, ctx, toast, electron } = setup({
      aiResponses: [{ ok: true, text: fenced(entries) }],
      handler: (channel) =>
        channel === 'db-world-setting-list-by-folder'
          ? [row(1, '灵脉', ''), row(2, '宗门', '已有')]
          : undefined,
    });
    await act(() => result.current.handleGenerateLoreEntries('whole-project'));
    expect(electron.invoke).toHaveBeenCalledWith('db-world-setting-update', 1, {
      content: '新摘要',
      tags: '["地理"]',
    });
    expect(electron.invoke).toHaveBeenCalledWith(
      'db-world-setting-create-by-folder',
      '/w',
      'system',
      '境界',
      '炼气筑基',
      '[]'
    );
    expect(electron.invoke).not.toHaveBeenCalledWith(
      'db-world-setting-update',
      2,
      expect.anything()
    );
    expect(ctx.setWorkspaceLoreEntries).toHaveBeenCalled();
    expect(ctx.bumpWorkspaceLoreVersion).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('AI 已提炼设定：新增 1，补全 1');
  });

  it('上下文超过 90000 字时截断', async () => {
    const { result, electron } = setup({ content: '字'.repeat(95000) });
    await act(() => result.current.handleGenerateLoreEntries('whole-project'));
    const payload = aiCalls(electron)[0][1] as { context: string };
    expect(payload.context.length).toBeLessThan(90100);
  });

  it('畸形 JSON 时提示无条目；AI 失败提示；无设置不请求', async () => {
    const a = setup({ aiResponses: [{ ok: true, text: '{"entries": [oops' }] });
    await act(() => a.result.current.handleGenerateLoreEntries('current-content'));
    expect(a.toast.warning).toHaveBeenCalledWith('AI 没有生成可导入的设定条目');

    const b = setup({ aiResponses: [{ ok: false }] });
    await act(() => b.result.current.handleGenerateLoreEntries('current-content'));
    expect(b.toast.error).toHaveBeenCalledWith('AI 生成设定失败: AI 生成设定失败');

    const c = setup({ settings: null });
    await act(() => c.result.current.handleGenerateLoreEntries('current-content'));
    expect(c.ctx.resolveAIGenerationContext).not.toHaveBeenCalled();

    const d = setup({ folder: null });
    await act(() => d.result.current.handleGenerateLoreEntries('current-content'));
    expect(d.ctx.ensurePersistedAiReady).not.toHaveBeenCalled();
  });
});

describe('useLibraryGeneration · 资料', () => {
  const materials = {
    materials: [
      {
        title: 'A',
        summary: '摘要A',
        kind: 'scene',
        relatedChapter: '第1章',
        keywords: ['山', ' ', 1],
      },
      { title: 'B', summary: '摘要B' },
      { title: 'C', summary: '' },
    ],
  };

  it('复用已有 资料/AI资料 目录并去重文件名', async () => {
    const files = [dir('/w/资料', [dir('/w/资料/AI资料', [file('/w/资料/AI资料/A.md')])])];
    const { result, ctx, toast, electron } = setup({
      files,
      aiResponses: [{ ok: true, text: fenced(materials) }],
      handler: (channel, ...args) =>
        channel === 'create-file'
          ? { success: true, filePath: `${String(args[0])}/${String(args[1])}` }
          : undefined,
    });
    await act(() => result.current.handleGenerateMaterials('current-chapter'));
    expect(electron.invoke).not.toHaveBeenCalledWith(
      'create-directory',
      expect.anything(),
      expect.anything()
    );
    expect(electron.invoke).toHaveBeenCalledWith('create-file', '/w/资料/AI资料', 'A-2.md');
    expect(electron.invoke).toHaveBeenCalledWith(
      'write-file',
      '/w/资料/AI资料/A-2.md',
      '# A\n类型：scene\n关联章节：第1章\n关键词：山\n摘要A'
    );
    expect(electron.invoke).toHaveBeenCalledWith(
      'write-file',
      '/w/资料/AI资料/B.md',
      '# B\n类型：reference\n摘要B'
    );
    expect(ctx.refreshCurrentFolder).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('AI 已生成 2 条资料笔记');
  });

  it('缺少目录时创建；全部落盘失败时回收新建的空目录', async () => {
    const { result, toast, electron, ctx } = setup({
      aiResponses: [{ ok: true, text: fenced(materials) }],
      handler: (channel, ...args) => {
        if (channel === 'create-directory')
          return { success: true, dirPath: `${String(args[0])}/${String(args[1])}` };
        if (channel === 'create-file') return { success: false, filePath: '' };
        return undefined;
      },
    });
    await act(() => result.current.handleGenerateMaterials('current-chapter'));
    expect(electron.invoke).toHaveBeenCalledWith('create-directory', '/w', '资料');
    expect(electron.invoke).toHaveBeenCalledWith('create-directory', '/w/资料', 'AI资料');
    expect(electron.invoke).toHaveBeenCalledWith('delete-directory', '/w/资料/AI资料');
    expect(electron.invoke).toHaveBeenCalledWith('delete-directory', '/w/资料');
    expect(toast.warning).toHaveBeenCalledWith('资料条目未成功落盘，已取消创建空目录');
    expect(ctx.refreshCurrentFolder).not.toHaveBeenCalled();
  });

  it('已有目录时落盘失败不删除用户目录', async () => {
    const files = [dir('/w/资料', [dir('/w/资料/AI资料')])];
    const { result, electron } = setup({
      files,
      aiResponses: [{ ok: true, text: fenced(materials) }],
      handler: (channel) => (channel === 'create-file' ? { success: false } : undefined),
    });
    await act(() => result.current.handleGenerateMaterials('current-chapter'));
    expect(electron.invoke).not.toHaveBeenCalledWith('delete-directory', expect.anything());
  });

  it('畸形 / 空结果提示；AI 失败与写盘异常提示；前置条件', async () => {
    const a = setup({ aiResponses: [{ ok: true, text: '```\nnot json\n```' }] });
    await act(() => a.result.current.handleGenerateMaterials('current-content'));
    expect(a.toast.warning).toHaveBeenCalledWith('AI 没有生成可落库的资料条目');

    const b = setup({ aiResponses: [{ ok: false, error: 'quota' }] });
    await act(() => b.result.current.handleGenerateMaterials('current-content'));
    expect(b.toast.error).toHaveBeenCalledWith('AI 生成资料失败: quota');

    const c = setup({
      files: [dir('/w/资料', [dir('/w/资料/AI资料')])],
      aiResponses: [{ ok: true, text: fenced(materials) }],
      handler: () => {
        throw new Error('disk');
      },
    });
    await act(() => c.result.current.handleGenerateMaterials('current-content'));
    expect(c.toast.error).toHaveBeenCalledWith('AI 生成资料失败: disk');

    const d = setup({ settings: null });
    await act(() => d.result.current.handleGenerateMaterials('current-content'));
    expect(d.ctx.resolveAIGenerationContext).not.toHaveBeenCalled();

    const e = setup({ folder: null });
    await act(() => e.result.current.handleGenerateMaterials('current-content'));
    expect(e.ctx.ensurePersistedAiReady).not.toHaveBeenCalled();
  });
});
