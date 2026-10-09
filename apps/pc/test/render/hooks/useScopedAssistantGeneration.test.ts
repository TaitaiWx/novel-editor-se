// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  useScopedAssistantGeneration,
  type UseScopedAssistantGenerationContext,
} from '@/render/hooks/useScopedAssistantGeneration';
import type { AssistantScopeTarget } from '@/render/app/types';
import type { FileNode } from '@/render/types';
import { WORKSPACE_TAB_LORE, createAssistantArtifactStorageKey } from '@/render/utils/workspace';
import {
  createAssistantGenerationStatusStorageKey,
  type AssistantArtifactGenerationStatus,
} from '@/render/utils/assistantGeneration';
import { installElectronMock, uninstallElectronMock, type InvokeHandler } from './electronMock';
import { deferred, makeToast, ref } from './hookCtx';

const FOLDER = '/w';
const CHAPTER: AssistantScopeTarget = { kind: 'chapter', path: '/w/正文/第1章.md', label: '第1章' };
const VOLUME: AssistantScopeTarget = { kind: 'volume', path: '/w/第一卷', label: '第一卷' };
const PROJECT: AssistantScopeTarget = { kind: 'project', path: '/w', label: '整部作品' };

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

const fenced = (value: unknown) => `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;

interface Props {
  currentAssistantScope: AssistantScopeTarget | null;
}

function setup(
  options: {
    handler?: InvokeHandler;
    ai?: (payload: unknown) => unknown;
    aiResponses?: AiResponse[];
    files?: FileNode[];
    folder?: string | null;
    settings?: { ai: { contextTokens: number } } | null;
    novelId?: number | null;
    content?: string;
    scope?: AssistantScopeTarget | null;
    noIpc?: boolean;
  } = {}
) {
  if (options.noIpc) uninstallElectronMock();
  const queue = [...(options.aiResponses ?? [])];
  const electron = options.noIpc
    ? null
    : installElectronMock((channel, ...args) => {
        if (channel === 'ai-request') {
          if (options.ai) return options.ai(args[0]);
          return queue.shift() ?? { ok: true, text: '' };
        }
        const value = options.handler?.(channel, ...args);
        if (channel === 'db-world-setting-list-by-folder') return value ?? [];
        return value;
      });
  const toast = makeToast();
  const base = {
    bumpWorkspaceCharactersVersion: vi.fn(),
    bumpWorkspaceLoreVersion: vi.fn(),
    ensurePersistedAiReady: vi.fn(async () =>
      options.settings === undefined ? { ai: { contextTokens: 0 } } : options.settings
    ),
    filesRef: ref<FileNode[]>(options.files ?? []),
    folderPathRef: ref<string | null>(options.folder === undefined ? FOLDER : options.folder),
    workScopePathRef: ref<string | null>(options.folder === undefined ? FOLDER : options.folder),
    getCurrentNovelId: vi.fn(async () => (options.novelId === undefined ? 1 : options.novelId)),
    openFileInTab: vi.fn(),
    refreshCurrentFolder: vi.fn(async () => undefined),
    resolveScopeTargetContext: vi.fn(async (scope: AssistantScopeTarget) => ({
      content: options.content ?? '林拜入师门。',
      label: scope.label,
    })),
    setAssistantCharacterGenerationStatus: vi.fn(),
    setAssistantScopedCharacters: vi.fn(),
    setAssistantScopedLoreEntries: vi.fn(),
    setAssistantScopedMaterials: vi.fn(),
    setWorkspaceCharacters: vi.fn(),
    setWorkspaceLoreEntries: vi.fn(),
    toast,
  };
  const hook = renderHook(
    (props: Props) =>
      useScopedAssistantGeneration({
        ...base,
        ...props,
      } as unknown as UseScopedAssistantGenerationContext),
    {
      initialProps: {
        currentAssistantScope: options.scope === undefined ? CHAPTER : options.scope,
      },
    }
  );
  return { ...hook, ctx: base, toast, electron };
}

function settingsWrites(electron: ReturnType<typeof installElectronMock> | null, key: string) {
  return (electron?.invoke.mock.calls ?? [])
    .filter((c) => c[0] === 'db-settings-set' && c[1] === key)
    .map((c) => JSON.parse(String(c[2])) as unknown);
}

afterEach(() => {
  uninstallElectronMock();
});

describe('useScopedAssistantGeneration · 持久化工具', () => {
  it('persistScopedAssistantArtifacts 按产物写入对应 key，非法路径跳过', async () => {
    const { result, electron } = setup();
    await act(() =>
      result.current.persistScopedAssistantArtifacts(CHAPTER, {
        characters: [{ name: '林', role: '', description: '' }],
        lore: [],
        materials: [],
      })
    );
    const writes = electron?.invoke.mock.calls.map((c) => c[1]);
    expect(writes).toEqual([
      createAssistantArtifactStorageKey('characters', 'chapter', CHAPTER.path),
      createAssistantArtifactStorageKey('lore', 'chapter', CHAPTER.path),
      createAssistantArtifactStorageKey('materials', 'chapter', CHAPTER.path),
    ]);

    electron?.invoke.mockClear();
    await act(() =>
      result.current.persistScopedAssistantArtifacts(
        { kind: 'chapter', path: '__untitled__:1', label: 'x' },
        { characters: [], lore: [], materials: [] }
      )
    );
    expect(electron?.invoke).not.toHaveBeenCalled();
  });

  it('persistScopedAssistantGenerationStatus 规范化数值并同步当前作用域状态', async () => {
    const { result, ctx, electron } = setup();
    await act(() =>
      result.current.persistScopedAssistantGenerationStatus(CHAPTER, 'characters', {
        state: 'running',
        scopeLabel: '',
        message: 'm',
        totalSteps: 3.7,
        completedSteps: 9,
        resultCount: -1,
        libraryCount: 2.2,
        createdCount: 1,
        updatedCount: 0,
        startedAt: 's',
        finishedAt: null,
      })
    );
    const status = ctx.setAssistantCharacterGenerationStatus.mock
      .calls[0][0] as AssistantArtifactGenerationStatus;
    expect(status).toMatchObject({
      artifact: 'characters',
      scopeKind: 'chapter',
      scopePath: CHAPTER.path,
      scopeLabel: '第1章',
      totalSteps: 3,
      completedSteps: 3,
      resultCount: 0,
      libraryCount: 2,
    });
    expect(
      settingsWrites(
        electron,
        createAssistantGenerationStatusStorageKey('characters', 'chapter', CHAPTER.path) ?? ''
      )
    ).toHaveLength(1);
  });

  it('非当前作用域 / 非人物产物不更新 UI 状态；无效 key 不写入', async () => {
    const { result, ctx, electron } = setup();
    const payload = {
      state: 'success' as const,
      scopeLabel: 'x',
      message: '',
      totalSteps: 1,
      completedSteps: 1,
      resultCount: 0,
      libraryCount: 0,
      createdCount: 0,
      updatedCount: 0,
      startedAt: 's',
      finishedAt: null,
    };
    await act(() =>
      result.current.persistScopedAssistantGenerationStatus(VOLUME, 'characters', payload)
    );
    await act(() =>
      result.current.persistScopedAssistantGenerationStatus(CHAPTER, 'lore', payload)
    );
    expect(ctx.setAssistantCharacterGenerationStatus).not.toHaveBeenCalled();
    expect(electron?.invoke).toHaveBeenCalledTimes(2);

    electron?.invoke.mockClear();
    await act(() =>
      result.current.persistScopedAssistantGenerationStatus(
        { kind: 'chapter', path: '', label: '' },
        'characters',
        payload
      )
    );
    expect(electron?.invoke).not.toHaveBeenCalled();
  });

  it('无 IPC 时持久化为空操作', async () => {
    const { result } = setup({ noIpc: true });
    await expect(
      result.current.persistScopedAssistantArtifacts(CHAPTER, { characters: [] })
    ).resolves.toBeUndefined();
  });
});

describe('useScopedAssistantGeneration · 人物', () => {
  const statusKey =
    createAssistantGenerationStatusStorageKey('characters', 'chapter', CHAPTER.path) ?? '';

  it('分析正文、同步角色库并写入作用域产物与进度', async () => {
    const graph = {
      characters: [
        { name: '林', role: '主角', description: '少年', aliases: ['小林'] },
        { name: '老王', aliases: ['王师兄', ''] },
      ],
      relations: [],
    };
    const existing = [
      { id: 2, name: '王五', role: '师兄', description: '旧', attributes: '{"aliases":["老王"]}' },
    ];
    const { result, ctx, toast, electron } = setup({
      aiResponses: [{ ok: true, text: fenced(graph) }],
      handler: (channel) => {
        if (channel === 'db-character-list') return existing;
        if (channel === 'db-world-setting-list-by-folder')
          return [
            {
              id: 1,
              category: 'world',
              title: '宗门',
              content: '青云',
              tags: '[]',
              created_at: '',
              updated_at: '',
            },
          ];
        return undefined;
      },
    });
    await act(() => result.current.handleGenerateScopedCharacters(CHAPTER));

    const aiPayload = electron?.invoke.mock.calls.find((c) => c[0] === 'ai-request')?.[1] as {
      context: string;
    };
    expect(aiPayload.context).toContain('项目设定参考:\n宗门: 青云');

    const update = electron?.invoke.mock.calls.find((c) => c[0] === 'db-character-update');
    expect(update?.[1]).toBe(2);
    const updatePayload = update?.[2] as {
      role?: string;
      description?: string;
      appendAliases: string[];
    };
    expect(updatePayload).not.toHaveProperty('role');
    expect(updatePayload).not.toHaveProperty('description');
    expect(updatePayload).not.toHaveProperty('attributes');
    expect(updatePayload.appendAliases).toEqual(['王师兄']);
    const create = electron?.invoke.mock.calls.find((c) => c[0] === 'db-character-create');
    expect(create?.slice(1, 5)).toEqual([1, '林', '主角', '少年']);

    expect(ctx.setWorkspaceCharacters).toHaveBeenCalled();
    expect(ctx.bumpWorkspaceCharactersVersion).toHaveBeenCalled();
    expect(ctx.setAssistantScopedCharacters).toHaveBeenCalledWith([
      { name: '林', role: '主角', description: '少年' },
      { name: '老王', role: '', description: '' },
    ]);

    const statuses = settingsWrites(electron, statusKey) as AssistantArtifactGenerationStatus[];
    expect(statuses.map((s) => s.state)).toEqual(['running', 'running', 'running', 'success']);
    expect(statuses[0].message).toBe('正在分析 第1章，共 1 段正文');
    expect(statuses[1].message).toBe('正在整理 第1章 的人物结果');
    expect(statuses[3]).toMatchObject({
      completedSteps: 3,
      totalSteps: 3,
      resultCount: 2,
      libraryCount: 1,
      createdCount: 1,
      updatedCount: 1,
    });
    expect(statuses[3].finishedAt).toEqual(expect.any(String));
    expect(toast.success).toHaveBeenCalledWith(
      '已为第1章生成人物上下文：识别 2 项，角色库现有 1 人'
    );
  });

  it('多段正文时逐段汇报进度', async () => {
    const content = Array.from({ length: 2 }, () => '字'.repeat(6000)).join('\n\n');
    const { result, electron } = setup({
      content,
      aiResponses: [
        { ok: true, text: '{"characters":[{"name":"甲"}]}' },
        { ok: true, text: '{"characters":[{"name":"乙"}]}' },
      ],
      handler: (channel) => (channel === 'db-character-list' ? [] : undefined),
    });
    await act(() => result.current.handleGenerateScopedCharacters(CHAPTER));
    const statuses = settingsWrites(electron, statusKey) as AssistantArtifactGenerationStatus[];
    expect(statuses[1].message).toBe('正在分析 第1章 · 第 1/2 段');
  });

  it('未关联角色库时仅保存作用域产物并给出警告', async () => {
    const { result, ctx, toast, electron } = setup({
      novelId: null,
      aiResponses: [{ ok: true, text: fenced({ characters: [{ name: '林' }] }) }],
    });
    await act(() => result.current.handleGenerateScopedCharacters(CHAPTER));
    expect(electron?.invoke).not.toHaveBeenCalledWith('db-character-list', expect.anything());
    expect(ctx.setAssistantScopedCharacters).toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith(
      '已为第1章生成人物上下文 1 项，但当前项目未关联角色库'
    );
    const statuses = settingsWrites(electron, statusKey) as AssistantArtifactGenerationStatus[];
    expect(statuses.at(-1)?.message).toContain('当前项目未关联角色库');
  });

  it('AI 返回畸形 JSON 时记录 empty 状态并警告', async () => {
    const a = setup({
      aiResponses: [{ ok: true, text: '```json\n{"characters": [ \n```' }],
      handler: (channel) => (channel === 'db-character-list' ? [] : undefined),
    });
    await act(() => a.result.current.handleGenerateScopedCharacters(CHAPTER));
    const statuses = settingsWrites(a.electron, statusKey) as AssistantArtifactGenerationStatus[];
    expect(statuses.at(-1)?.state).toBe('empty');
    expect(a.toast.warning).toHaveBeenCalledWith('已分析第1章，但没有识别到可用人物');
    a.unmount();

    const b = setup({ novelId: null, content: '' });
    await act(() => b.result.current.handleGenerateScopedCharacters(CHAPTER));
    const bStatuses = settingsWrites(b.electron, statusKey) as AssistantArtifactGenerationStatus[];
    expect(bStatuses[0].message).toBe('正在分析 第1章');
    expect(bStatuses.at(-1)?.message).toBe('已分析 第1章，但没有识别到可用人物');
  });

  it('AI 请求失败时写入 error 状态并提示', async () => {
    const { result, toast, electron } = setup({ aiResponses: [{ ok: false, error: '超时' }] });
    await act(() => result.current.handleGenerateScopedCharacters(CHAPTER));
    const statuses = settingsWrites(electron, statusKey) as AssistantArtifactGenerationStatus[];
    expect(statuses.at(-1)).toMatchObject({
      state: 'error',
      message: '为 第1章 生成人物上下文失败：超时',
    });
    expect(toast.error).toHaveBeenCalledWith('AI 生成人物上下文失败: 超时');
  });

  it('非 Error 异常使用默认文案', async () => {
    const { result, ctx, toast, electron } = setup();
    ctx.resolveScopeTargetContext.mockRejectedValueOnce('boom');
    await act(() => result.current.handleGenerateScopedCharacters(CHAPTER));
    const statuses = settingsWrites(electron, statusKey) as AssistantArtifactGenerationStatus[];
    expect(statuses.at(-1)?.message).toBe('为 第1章 生成人物上下文失败');
    expect(toast.error).toHaveBeenCalledWith('AI 生成人物上下文失败: 未知错误');
  });

  it('前置条件不满足时不请求', async () => {
    const a = setup({ folder: null });
    await act(() => a.result.current.handleGenerateScopedCharacters(CHAPTER));
    expect(a.ctx.ensurePersistedAiReady).not.toHaveBeenCalled();
    const b = setup({ settings: null });
    await act(() => b.result.current.handleGenerateScopedCharacters(CHAPTER));
    expect(b.ctx.resolveScopeTargetContext).not.toHaveBeenCalled();
  });

  it('生成非当前作用域时不覆盖当前面板的人物', async () => {
    const { result, ctx } = setup({
      novelId: null,
      aiResponses: [{ ok: true, text: fenced({ characters: [{ name: '林' }] }) }],
    });
    await act(() => result.current.handleGenerateScopedCharacters(VOLUME));
    expect(ctx.setAssistantScopedCharacters).not.toHaveBeenCalled();
    expect(ctx.setAssistantCharacterGenerationStatus).not.toHaveBeenCalled();
  });

  // BUG: useScopedAssistantGeneration.ts handleGenerateScopedCharacters 闭包捕获的是发起请求时的
  // currentAssistantScope。生成过程中用户切换到别的作用域后，旧请求返回时仍按旧作用域判断，
  // 会把第1章的人物结果写进当前（已切换为第一卷的）助手面板。
  it('生成期间切换作用域后，旧结果不应写入新作用域的面板', async () => {
    const gate = deferred<AiResponse>();
    const { result, ctx, rerender } = setup({ novelId: null, ai: () => gate.promise });
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.handleGenerateScopedCharacters(CHAPTER);
    });
    rerender({ currentAssistantScope: VOLUME });
    await act(async () => {
      gate.resolve({ ok: true, text: fenced({ characters: [{ name: '林' }] }) });
      await pending;
    });
    expect(ctx.setAssistantScopedCharacters).not.toHaveBeenCalled();
  });

  // BUG: useScopedAssistantGeneration.ts catch 分支先 await persistScopedAssistantGenerationStatus，
  // 若失败原因正是 db-settings-set 不可用，catch 内再次抛出，toast.error 永远不会执行，
  // 用户看不到任何失败提示且产生未处理的 rejection。
  it('状态持久化失败时仍应提示错误', async () => {
    const { result, toast } = setup({
      handler: (channel) => {
        if (channel === 'db-settings-set') throw new Error('db closed');
        return undefined;
      },
    });
    await act(async () => {
      await result.current.handleGenerateScopedCharacters(CHAPTER).catch(() => undefined);
    });
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('useScopedAssistantGeneration · 设定', () => {
  const row = (id: number, title: string, content: string) => ({
    id,
    category: 'world',
    title,
    content,
    tags: '[]',
    created_at: '',
    updated_at: '',
  });

  it('保存作用域设定并同步设定库，自动打开设定页', async () => {
    const { result, ctx, toast, electron } = setup({
      aiResponses: [
        {
          ok: true,
          text: fenced({
            entries: [
              { category: 'world', title: '灵脉', summary: '补全' },
              { category: 'world', title: '宗门', summary: '忽略' },
              { category: 'term', title: '灵石', summary: '货币' },
            ],
          }),
        },
      ],
      handler: (channel) =>
        channel === 'db-world-setting-list-by-folder'
          ? [row(1, '灵脉', ' '), row(2, '宗门', '已有')]
          : undefined,
    });
    await act(() => result.current.handleGenerateScopedLore(CHAPTER));
    const loreKey = createAssistantArtifactStorageKey('lore', 'chapter', CHAPTER.path) ?? '';
    expect(settingsWrites(electron, loreKey)[0]).toHaveLength(3);
    expect(electron?.invoke).toHaveBeenCalledWith('db-world-setting-update', 1, {
      content: '补全',
      tags: '[]',
    });
    expect(electron?.invoke).toHaveBeenCalledWith(
      'db-world-setting-create-by-folder',
      '/w',
      'term',
      '灵石',
      '货币',
      '[]'
    );
    expect(ctx.openFileInTab).toHaveBeenCalledWith(WORKSPACE_TAB_LORE);
    expect(ctx.setAssistantScopedLoreEntries).toHaveBeenCalled();
    expect(ctx.bumpWorkspaceLoreVersion).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      '已为第1章生成设定上下文 3 项，并同步设定库（新增 1，补全 1）'
    );
  });

  it('畸形 JSON 视为空结果；非当前作用域不更新面板', async () => {
    const { result, ctx, toast } = setup({ aiResponses: [{ ok: true, text: '{"entries":' }] });
    await act(() => result.current.handleGenerateScopedLore(VOLUME));
    expect(ctx.setAssistantScopedLoreEntries).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      '已为第一卷生成设定上下文 0 项，并同步设定库（新增 0，补全 0）'
    );
  });

  it('AI 失败提示；前置条件不满足不请求', async () => {
    const a = setup({ aiResponses: [{ ok: false }] });
    await act(() => a.result.current.handleGenerateScopedLore(CHAPTER));
    expect(a.toast.error).toHaveBeenCalledWith('AI 生成设定上下文失败: AI 生成设定上下文失败');
    const b = setup({ settings: null });
    await act(() => b.result.current.handleGenerateScopedLore(CHAPTER));
    expect(b.ctx.resolveScopeTargetContext).not.toHaveBeenCalled();
    const c = setup({ folder: null });
    await act(() => c.result.current.handleGenerateScopedLore(CHAPTER));
    expect(c.ctx.ensurePersistedAiReady).not.toHaveBeenCalled();
  });
});

describe('useScopedAssistantGeneration · 资料', () => {
  const materials = {
    materials: [
      { title: 'A', summary: '摘要A', kind: 'setting', relatedChapter: '第1章' },
      { title: 'B', summary: '摘要B' },
    ],
  };
  const fileHandler: InvokeHandler = (channel, ...args) => {
    if (channel === 'create-directory')
      return { success: true, dirPath: `${String(args[0])}/${String(args[1])}` };
    if (channel === 'create-file')
      return { success: true, filePath: `${String(args[0])}/${String(args[1])}` };
    return undefined;
  };

  it('按作用域写入 资料/章上下文 并复用已有目录', async () => {
    const files = [dir('/w/资料', [dir('/w/资料/章上下文', [file('/w/资料/章上下文/A.md')])])];
    const { result, ctx, toast, electron } = setup({
      files,
      aiResponses: [{ ok: true, text: fenced(materials) }],
      handler: fileHandler,
    });
    await act(() => result.current.handleGenerateScopedMaterials(CHAPTER));
    expect(electron?.invoke).not.toHaveBeenCalledWith(
      'create-directory',
      expect.anything(),
      expect.anything()
    );
    expect(electron?.invoke).toHaveBeenCalledWith(
      'write-file',
      '/w/资料/章上下文/A-2.md',
      '# A\n类型：setting\n关联章节：第1章\n摘要A'
    );
    expect(ctx.refreshCurrentFolder).toHaveBeenCalled();
    expect(ctx.setAssistantScopedMaterials).toHaveBeenCalledWith([
      { title: 'A', summary: '摘要A', kind: 'setting', relatedChapter: '第1章' },
      { title: 'B', summary: '摘要B', kind: 'reference', relatedChapter: '' },
    ]);
    expect(toast.success).toHaveBeenCalledWith('已为第1章生成资料上下文 2 项，并同步到资料目录');
  });

  it('卷 / 项目作用域创建对应目录', async () => {
    const a = setup({
      scope: VOLUME,
      aiResponses: [{ ok: true, text: fenced(materials) }],
      handler: fileHandler,
    });
    await act(() => a.result.current.handleGenerateScopedMaterials(VOLUME));
    expect(a.electron?.invoke).toHaveBeenCalledWith('create-directory', '/w', '资料');
    expect(a.electron?.invoke).toHaveBeenCalledWith('create-directory', '/w/资料', '卷上下文');
    a.unmount();

    const b = setup({
      files: [dir('/w/资料')],
      aiResponses: [{ ok: true, text: fenced(materials) }],
      handler: fileHandler,
    });
    await act(() => b.result.current.handleGenerateScopedMaterials(PROJECT));
    expect(b.electron?.invoke).toHaveBeenCalledWith('create-directory', '/w/资料', '项目上下文');
  });

  it('全部落盘失败时回收新建目录并警告', async () => {
    const { result, toast, electron, ctx } = setup({
      aiResponses: [{ ok: true, text: fenced(materials) }],
      handler: (channel, ...args) =>
        channel === 'create-file' ? { success: false } : fileHandler(channel, ...args),
    });
    await act(() => result.current.handleGenerateScopedMaterials(CHAPTER));
    expect(electron?.invoke).toHaveBeenCalledWith('delete-directory', '/w/资料/章上下文');
    expect(electron?.invoke).toHaveBeenCalledWith('delete-directory', '/w/资料');
    expect(toast.warning).toHaveBeenCalledWith('资料上下文未成功落盘，已取消创建空目录');
    expect(ctx.setAssistantScopedMaterials).not.toHaveBeenCalled();
  });

  it('空结果（畸形 JSON）不落盘但仍保存产物', async () => {
    const { result, ctx, electron } = setup({
      aiResponses: [{ ok: true, text: 'no json here' }],
    });
    await act(() => result.current.handleGenerateScopedMaterials(CHAPTER));
    expect(electron?.invoke).not.toHaveBeenCalledWith(
      'create-directory',
      expect.anything(),
      expect.anything()
    );
    expect(ctx.refreshCurrentFolder).not.toHaveBeenCalled();
    expect(ctx.setAssistantScopedMaterials).toHaveBeenCalledWith([]);
  });

  it('AI 失败提示；前置条件不满足不请求', async () => {
    const a = setup({ aiResponses: [{ ok: false, error: 'net' }] });
    await act(() => a.result.current.handleGenerateScopedMaterials(CHAPTER));
    expect(a.toast.error).toHaveBeenCalledWith('AI 生成资料上下文失败: net');
    const b = setup({ settings: null });
    await act(() => b.result.current.handleGenerateScopedMaterials(CHAPTER));
    expect(b.ctx.resolveScopeTargetContext).not.toHaveBeenCalled();
    const c = setup({ folder: null });
    await act(() => c.result.current.handleGenerateScopedMaterials(CHAPTER));
    expect(c.ctx.ensurePersistedAiReady).not.toHaveBeenCalled();
  });
});
