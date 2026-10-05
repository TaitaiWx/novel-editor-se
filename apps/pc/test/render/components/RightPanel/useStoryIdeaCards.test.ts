// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { StoryIdeaCardRow, StoryIdeaOutputRow } from '@/render/types/electron-api';
import { useStoryIdeaCards } from '@/render/components/RightPanel/useStoryIdeaCards';
import {
  createEmptyStoryIdeaDraft,
  type StoryIdeaCardDraft,
} from '@/render/components/RightPanel/story-idea';
import { installElectronMock, uninstallElectronMock } from '../../hooks/electronMock';

const FOLDER = '/novel';
const CONTENT = '第一幕 开端\n第一场 雪夜\n正文\n第二幕 发展\n第一场 追杀\n正文';

function makeCard(overrides: Partial<StoryIdeaCardRow> = {}): StoryIdeaCardRow {
  return {
    id: 1,
    novel_id: 1,
    title: '雪夜剑客',
    premise: '失忆剑客追查过去',
    tags_json: '[]',
    source: 'manual',
    status: 'draft',
    theme_seed: '雪夜',
    conflict_seed: '背叛',
    twist_seed: '',
    protagonist_wish: '',
    core_obstacle: '',
    irony_or_gap: '',
    escalation_path: '',
    payoff_hint: '',
    selected_logline: '',
    selected_direction: '',
    note: '',
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    ...overrides,
  };
}

function makeOutput(overrides: Partial<StoryIdeaOutputRow> = {}): StoryIdeaOutputRow {
  return {
    id: 10,
    idea_card_id: 1,
    novel_id: 1,
    type: 'logline',
    content: '一句话卖点',
    meta_json: '{}',
    sort_order: 0,
    is_selected: 0,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    ...overrides,
  } as StoryIdeaOutputRow;
}

function makeDraft(overrides: Partial<StoryIdeaCardDraft> = {}): StoryIdeaCardDraft {
  return {
    ...createEmptyStoryIdeaDraft(),
    title: '雪夜剑客',
    premise: '失忆剑客追查过去',
    themeTerms: ['雪夜'],
    ...overrides,
  };
}

type Handler = (...args: unknown[]) => unknown;

function setup(routes: Record<string, Handler> = {}) {
  const settings = new Map<string, string>();
  const defaults: Record<string, Handler> = {
    'db-story-idea-card-list-by-folder': () => [makeCard()],
    'db-outline-version-list-by-folder': () => [],
    'db-settings-get': (key) => settings.get(key as string) ?? null,
    'db-settings-set': (key, value) => {
      settings.set(key as string, value as string);
    },
    'db-story-idea-output-list': () => [],
  };
  const table = { ...defaults, ...routes };
  const mock = installElectronMock((channel, ...args) => {
    const fn = table[channel];
    return fn ? fn(...args) : undefined;
  });
  const calls = (channel: string) =>
    mock.invoke.mock.calls.filter((call) => call[0] === channel).map((call) => call.slice(1));
  return { mock, settings, calls };
}

async function renderReady(
  props: {
    folder?: string | null;
    content?: string;
    db?: boolean;
    ai?: boolean;
    line?: number;
  } = {}
) {
  const hook = renderHook(() =>
    useStoryIdeaCards(
      props.folder === undefined ? FOLDER : props.folder,
      props.content ?? CONTENT,
      props.db ?? true,
      props.ai ?? true,
      props.line
    )
  );
  await act(async () => {});
  return hook;
}

afterEach(() => {
  uninstallElectronMock();
  vi.restoreAllMocks();
});

describe('useStoryIdeaCards: 加载', () => {
  it('无项目或数据库未就绪时不加载，卡片为空', async () => {
    const { mock } = setup();
    const { result } = await renderReady({ db: false });
    expect(result.current.cards).toEqual([]);
    expect(result.current.outlineVersions).toEqual([]);
    expect(
      mock.invoke.mock.calls.some((call) => call[0] === 'db-story-idea-card-list-by-folder')
    ).toBe(false);
  });

  it('加载卡片、大纲版本与自定义词池，并基于历史卡片构建词池', async () => {
    const { settings } = setup({
      'db-outline-version-list-by-folder': () => [{ id: 3 }],
    });
    settings.set(
      `novel-editor:story-idea-term-pool:${FOLDER}`,
      JSON.stringify({ theme: ['孤城'], conflict: [], twist: [] })
    );
    const { result } = await renderReady();
    expect(result.current.cards).toHaveLength(1);
    expect(result.current.outlineVersions).toEqual([{ id: 3 }]);
    const themeTerms = result.current.termPool.theme.map((entry) => entry.term);
    expect(themeTerms).toContain('雪夜');
    expect(themeTerms).toContain('孤城');
    expect(result.current.loading).toBe(false);
  });

  it('加载失败时清空并显示错误信息', async () => {
    setup({
      'db-story-idea-card-list-by-folder': () => {
        throw new Error('db down');
      },
      'db-outline-version-list-by-folder': () => {
        throw new Error('x');
      },
      'db-settings-get': () => {
        throw new Error('y');
      },
    });
    const { result } = await renderReady();
    expect(result.current.cards).toEqual([]);
    expect(result.current.statusMessage).toBe('db down');
    expect(result.current.outlineVersions).toEqual([]);
    expect(result.current.termPool.theme).toEqual([]);
  });

  it('非 Error 抛出时使用默认文案', async () => {
    setup({
      'db-story-idea-card-list-by-folder': () => {
        throw 'boom';
      },
    });
    const { result } = await renderReady();
    expect(result.current.statusMessage).toBe('加载三签创意卡失败');
  });

  it('解析幕结构并按当前行推荐目标幕', async () => {
    setup();
    const { result } = await renderReady({ line: 5 });
    expect(result.current.acts.map((a) => a.title)).toEqual(['第一幕 开端', '第二幕 发展']);
    expect(result.current.suggestedBoardActIndex).toBe(1);
    const r2 = await renderReady({ line: 0 });
    expect(r2.result.current.suggestedBoardActIndex).toBe(0);
    const r3 = await renderReady({ content: '', line: 3 });
    expect(r3.result.current.acts).toEqual([]);
    expect(r3.result.current.suggestedBoardActIndex).toBe(0);
  });
});

describe('useStoryIdeaCards: 候选输出', () => {
  it('loadOutputs 按类型分组；cardId 为空时清空', async () => {
    setup({
      'db-story-idea-output-list': () => [
        makeOutput({ id: 1, type: 'logline' }),
        makeOutput({ id: 2, type: 'scene_hook' }),
        makeOutput({ id: 3, type: 'outline_direction' }),
      ],
    });
    const { result } = await renderReady();
    await act(async () => {
      await result.current.loadOutputs(1);
    });
    expect(result.current.outputsByType.logline).toHaveLength(1);
    expect(result.current.outputsByType.scene_hook).toHaveLength(1);
    expect(result.current.outputsByType.outline_direction).toHaveLength(1);
    await act(async () => {
      await result.current.loadOutputs(null);
    });
    expect(result.current.outputs).toEqual([]);
  });

  it('loadOutputs 失败时显示错误', async () => {
    setup({
      'db-story-idea-output-list': () => {
        throw 'nope';
      },
    });
    const { result } = await renderReady();
    await act(async () => {
      await result.current.loadOutputs(1);
    });
    expect(result.current.statusMessage).toBe('加载三签候选失败');
    expect(result.current.outputsLoading).toBe(false);
  });

  it('selectOutput 标记选中项并回写卡片选中的 logline / 方向', async () => {
    const { calls } = setup({
      'db-story-idea-output-list': () => [
        makeOutput({ id: 1, type: 'logline', is_selected: 1 }),
        makeOutput({ id: 2, type: 'logline' }),
        makeOutput({ id: 3, type: 'outline_direction', content: '方向A' }),
      ],
    });
    const { result } = await renderReady();
    await act(async () => {
      await result.current.loadOutputs(1);
    });
    const card = result.current.cards[0];
    await act(async () => {
      await result.current.selectOutput(card, result.current.outputs[1]);
    });
    expect(result.current.outputs.map((o) => o.is_selected)).toEqual([0, 1, 0]);
    expect(calls('db-story-idea-card-update')[0]).toEqual([
      1,
      { selected_logline: '一句话卖点', status: 'shortlisted' },
    ]);
    await act(async () => {
      await result.current.selectOutput(card, result.current.outputs[2]);
    });
    expect(calls('db-story-idea-card-update')[1]).toEqual([
      1,
      { selected_direction: '方向A', status: 'exploring' },
    ]);
    // 非 draft 状态保持原状态
    await act(async () => {
      await result.current.selectOutput(
        makeCard({ status: 'shortlisted' }),
        result.current.outputs[2]
      );
    });
    expect(calls('db-story-idea-card-update')[2][1]).toEqual({
      selected_direction: '方向A',
      status: 'shortlisted',
    });
    expect(result.current.cards[0].selected_direction).toBe('方向A');
  });

  it('replaceOutputs / deleteOutput 调用 IPC 并重新加载', async () => {
    const { calls } = setup();
    const { result } = await renderReady();
    await act(async () => {
      await result.current.replaceOutputs(1, 'logline', [{ content: 'a' }]);
      await result.current.deleteOutput(5, 1);
    });
    expect(calls('db-story-idea-output-replace-by-folder')[0]).toEqual([
      FOLDER,
      1,
      'logline',
      [{ content: 'a' }],
    ]);
    expect(calls('db-story-idea-output-delete')[0]).toEqual([5]);
    expect(calls('db-story-idea-output-list').length).toBe(2);
  });

  it('replaceOutputs 在数据库未就绪时拒绝', async () => {
    const { calls } = setup();
    const { result } = await renderReady({ db: false });
    await act(async () => {
      await result.current.replaceOutputs(1, 'logline', []);
    });
    expect(result.current.statusMessage).toContain('无法保存三签候选');
    expect(calls('db-story-idea-output-replace-by-folder')).toHaveLength(0);
  });
});

describe('useStoryIdeaCards: 卡片 CRUD', () => {
  it('createCard 发送映射后的字段并返回新 id', async () => {
    const { calls } = setup({
      'db-story-idea-card-create-by-folder': () => ({ changes: 1, lastInsertRowid: 42 }),
    });
    const { result } = await renderReady();
    let id: number | null = null;
    await act(async () => {
      id = await result.current.createCard(makeDraft({ note: '备注' }));
    });
    expect(id).toBe(42);
    const [folder, payload] = calls('db-story-idea-card-create-by-folder')[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(folder).toBe(FOLDER);
    expect(payload.title).toBe('雪夜剑客');
    expect(payload.themeSeed).toBe('雪夜');
    expect(payload.note).toBe('备注');
    expect(result.current.statusMessage).toBe('已创建三签创意卡');
  });

  it('createCard 没有 lastInsertRowid 时返回 null', async () => {
    setup({ 'db-story-idea-card-create-by-folder': () => ({ changes: 1 }) });
    const { result } = await renderReady();
    let id: number | null = 1;
    await act(async () => {
      id = await result.current.createCard(makeDraft());
    });
    expect(id).toBeNull();
  });

  it('createCard 在数据库未就绪时返回 null', async () => {
    setup();
    const { result } = await renderReady({ db: false });
    let id: number | null = 1;
    await act(async () => {
      id = await result.current.createCard(makeDraft());
    });
    expect(id).toBeNull();
    expect(result.current.statusMessage).toContain('无法创建');
  });

  it('deleteCard 移除卡片并清空候选', async () => {
    const { calls } = setup();
    const { result } = await renderReady();
    await act(async () => {
      await result.current.deleteCard(1);
    });
    expect(calls('db-story-idea-card-delete')[0]).toEqual([1]);
    expect(result.current.cards).toEqual([]);
    expect(result.current.statusMessage).toBe('已删除三签创意卡');
  });

  it('addTermsToPool 合并并持久化到设置', async () => {
    const { settings } = setup();
    const { result } = await renderReady();
    let entries: Array<{ term: string }> = [];
    await act(async () => {
      entries = await result.current.addTermsToPool('conflict', ['夺嫡', '复仇']);
    });
    expect(entries.map((e) => e.term)).toEqual(['夺嫡', '复仇']);
    const stored = settings.get(`novel-editor:story-idea-term-pool:${FOLDER}`);
    expect(stored).toContain('夺嫡');
    expect(result.current.statusMessage).toContain('冲突签');
    await act(async () => {
      await result.current.addTermsToPool('twist', ['反转']);
    });
    expect(result.current.statusMessage).toContain('变形签');
    await act(async () => {
      await result.current.addTermsToPool('theme', ['孤城']);
    });
    expect(result.current.statusMessage).toContain('题眼签');
  });
});

describe('useStoryIdeaCards: AI 补签与提炼', () => {
  const seedJson = JSON.stringify({
    title: '新标题',
    premise: '新前提',
    tags: ['武侠'],
    note: '备注',
    themeTerms: ['孤城'],
    conflictTerms: ['夺嫡'],
    twistTerms: ['替身'],
  });

  it('AI 未开启时直接拒绝', async () => {
    const { calls } = setup();
    const { result } = await renderReady({ ai: false });
    let ok = true;
    await act(async () => {
      ok = await result.current.generateIdeaSeeds(makeCard(), makeDraft());
    });
    expect(ok).toBe(false);
    expect(result.current.statusMessage).toContain('请先配置并开启 AI');
    await act(async () => {
      ok = await result.current.extractIdeaSeedsFromContent(makeCard(), makeDraft());
    });
    expect(ok).toBe(false);
    expect(calls('ai-request')).toHaveLength(0);
  });

  it('generateIdeaSeeds 解析 fenced JSON 并更新卡片', async () => {
    const { calls } = setup({
      'ai-request': () => ({ ok: true, text: '```json\n' + seedJson + '\n```' }),
    });
    const { result } = await renderReady();
    let ok = false;
    await act(async () => {
      ok = await result.current.generateIdeaSeeds(makeCard(), makeDraft());
    });
    expect(ok).toBe(true);
    const [, fields] = calls('db-story-idea-card-update')[0] as [number, Record<string, unknown>];
    expect(fields.title).toBe('新标题');
    expect(fields.source).toBe('ai');
    expect(fields.status).toBe('exploring');
    expect(result.current.statusMessage).toBe('已完成三签补签');
    expect(result.current.working).toBe(false);
  });

  // BUG: useStoryIdeaCards.ts generateIdeaSeeds/extractIdeaSeedsFromContent 用 `{ ...draft, ...parsed }`
  // 合并，而 parseStoryIdeaSeedResponse 对缺失字段返回显式 undefined（如 tags: undefined），
  // 覆盖了 draft.tags，导致 draftToStoryIdeaUpdatePayload -> normalizeIdeaTags(undefined) 抛
  // TypeError。AI 只返回部分字段（很常见）时补签直接崩溃。
  it('BUG: AI 返回不含 tags 的 JSON 时 generateIdeaSeeds 不应崩溃', async () => {
    setup({
      'ai-request': () => ({ ok: true, text: JSON.stringify({ themeTerms: ['孤城'] }) }),
    });
    const { result } = await renderReady();
    let ok = false;
    await act(async () => {
      ok = await result.current.generateIdeaSeeds(makeCard(), makeDraft({ tags: ['武侠'] }));
    });
    expect(ok).toBe(true);
  });

  it('generateIdeaSeeds：AI 返回错误或不可解析内容', async () => {
    let response: unknown = { ok: false, error: '限流' };
    setup({ 'ai-request': () => response });
    const { result } = await renderReady();
    await act(async () => {
      await result.current.generateIdeaSeeds(makeCard(), makeDraft());
    });
    expect(result.current.statusMessage).toBe('限流');
    response = { ok: false };
    await act(async () => {
      await result.current.generateIdeaSeeds(makeCard(), makeDraft());
    });
    expect(result.current.statusMessage).toBe('AI 补签失败');
    response = { ok: true, text: '不是 JSON' };
    await act(async () => {
      await result.current.generateIdeaSeeds(makeCard(), makeDraft());
    });
    expect(result.current.statusMessage).toBe('AI 返回内容无法解析为三签字段');
  });

  it('generateIdeaSeeds：IPC 抛错时 working 复位并向上抛出', async () => {
    setup({
      'ai-request': () => {
        throw new Error('ipc fail');
      },
    });
    const { result } = await renderReady();
    await act(async () => {
      await expect(result.current.generateIdeaSeeds(makeCard(), makeDraft())).rejects.toThrow(
        'ipc fail'
      );
    });
    expect(result.current.working).toBe(false);
  });

  it('extractIdeaSeedsFromContent 需要正文；成功时更新卡片', async () => {
    let response: unknown = { ok: true, text: seedJson };
    const { calls } = setup({ 'ai-request': () => response });
    const empty = await renderReady({ content: '   ' });
    await act(async () => {
      await empty.result.current.extractIdeaSeedsFromContent(makeCard(), makeDraft());
    });
    expect(empty.result.current.statusMessage).toBe('当前没有正文内容，无法提炼三签');

    const { result } = await renderReady();
    let ok = false;
    await act(async () => {
      ok = await result.current.extractIdeaSeedsFromContent(makeCard(), makeDraft());
    });
    expect(ok).toBe(true);
    expect(result.current.statusMessage).toBe('已从当前正文提炼三签');
    expect(calls('db-story-idea-card-update')).toHaveLength(1);

    response = { ok: false };
    await act(async () => {
      await result.current.extractIdeaSeedsFromContent(makeCard(), makeDraft());
    });
    expect(result.current.statusMessage).toBe('从正文提炼三签失败');
    response = { ok: true, text: '{bad json' };
    await act(async () => {
      await result.current.extractIdeaSeedsFromContent(makeCard(), makeDraft());
    });
    expect(result.current.statusMessage).toBe('AI 返回内容无法解析为签词结果');
  });
});

describe('useStoryIdeaCards: 生成候选', () => {
  const outputsJson = JSON.stringify({
    loglines: [{ content: '卖点一', reason: 'r' }],
    sceneHooks: [{ content: '钩子一', focus: 'f' }],
    outlineDirections: [{ title: '方向', summary: '概要', beats: ['b1'] }],
  });

  it('前置条件：数据库与 AI', async () => {
    setup();
    const noDb = await renderReady({ db: false });
    await act(async () => {
      await noDb.result.current.generateIdeaOutputs(makeCard(), makeDraft());
    });
    expect(noDb.result.current.statusMessage).toContain('无法生成候选');
    const noAi = await renderReady({ ai: false });
    await act(async () => {
      await noAi.result.current.generateIdeaOutputs(makeCard(), makeDraft());
    });
    expect(noAi.result.current.statusMessage).toContain('再生成候选');
  });

  it('成功时按三类替换候选并回写首选项', async () => {
    const { calls } = setup({ 'ai-request': () => ({ ok: true, text: outputsJson }) });
    const { result } = await renderReady();
    let ok = false;
    await act(async () => {
      ok = await result.current.generateIdeaOutputs(makeCard(), makeDraft());
    });
    expect(ok).toBe(true);
    const replaced = calls('db-story-idea-output-replace-by-folder').map((c) => c[2]);
    expect(replaced).toEqual(['logline', 'scene_hook', 'outline_direction']);
    const [, fields] = calls('db-story-idea-card-update')[0] as [number, Record<string, unknown>];
    expect(fields).toEqual({
      status: 'exploring',
      selected_logline: '卖点一',
      selected_direction: '方向：概要',
    });
  });

  it('空候选时保留卡片原有选中值', async () => {
    const { calls } = setup({
      'ai-request': () => ({
        ok: true,
        text: JSON.stringify({ loglines: [], sceneHooks: [], outlineDirections: [] }),
      }),
    });
    const { result } = await renderReady();
    await act(async () => {
      await result.current.generateIdeaOutputs(
        makeCard({ selected_logline: '旧', selected_direction: '旧方向' }),
        makeDraft()
      );
    });
    const [, fields] = calls('db-story-idea-card-update')[0] as [number, Record<string, unknown>];
    expect(fields.selected_logline).toBe('旧');
    expect(fields.selected_direction).toBe('旧方向');
  });

  it('AI 失败与解析失败', async () => {
    let response: unknown = { ok: false, error: 'E' };
    setup({ 'ai-request': () => response });
    const { result } = await renderReady();
    await act(async () => {
      await result.current.generateIdeaOutputs(makeCard(), makeDraft());
    });
    expect(result.current.statusMessage).toBe('E');
    response = { ok: true, text: 'garbage' };
    await act(async () => {
      await result.current.generateIdeaOutputs(makeCard(), makeDraft());
    });
    expect(result.current.statusMessage).toBe('AI 返回内容无法解析为候选结果');
  });
});

describe('useStoryIdeaCards: 相关签词与随机重抽', () => {
  it('requestRelatedTerms 成功时写入词池', async () => {
    const { settings } = setup({
      'ai-request': () => ({ ok: true, text: '```\n{"terms":["孤城","落雪"]}\n```' }),
    });
    const { result } = await renderReady();
    let terms: string[] | null = null;
    await act(async () => {
      terms = await result.current.requestRelatedTerms(makeDraft(), 'theme');
    });
    expect(terms).toEqual(['孤城', '落雪']);
    expect(settings.get(`novel-editor:story-idea-term-pool:${FOLDER}`)).toContain('落雪');
    expect(result.current.statusMessage).toBe('已为题眼签补入 2 个相关签词');
  });

  it('requestRelatedTerms：AI 未开启 / 失败 / 空结果', async () => {
    let response: unknown = { ok: false };
    setup({ 'ai-request': () => response });
    const off = await renderReady({ ai: false });
    let terms: string[] | null = [];
    await act(async () => {
      terms = await off.result.current.requestRelatedTerms(makeDraft(), 'theme');
    });
    expect(terms).toBeNull();
    const { result } = await renderReady();
    await act(async () => {
      terms = await result.current.requestRelatedTerms(makeDraft(), 'conflict');
    });
    expect(result.current.statusMessage).toBe('AI 随机提词失败');
    response = { ok: true, text: '{"terms":[]}' };
    await act(async () => {
      terms = await result.current.requestRelatedTerms(makeDraft(), 'twist');
    });
    expect(terms).toBeNull();
    expect(result.current.statusMessage).toBe('AI 返回内容无法解析为相关签词');
  });

  it('redrawIdeaTermRandomly 优先使用现有词池', async () => {
    const { calls } = setup();
    const { result } = await renderReady();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    // 历史卡片 conflict_seed=背叛
    let next: StoryIdeaCardDraft | null = null;
    await act(async () => {
      next = await result.current.redrawIdeaTermRandomly(
        makeDraft({ conflictTerms: ['旧'] }),
        'conflict'
      );
    });
    expect(next).not.toBeNull();
    expect((next as unknown as StoryIdeaCardDraft).conflictTerms).toEqual(['背叛']);
    expect(calls('ai-request')).toHaveLength(0);
    expect(result.current.statusMessage).toBe('已为冲突签随机重抽一签');
  });

  it('redrawIdeaTermRandomly 词池为空时向 AI 请求；请求失败返回 null', async () => {
    let response: unknown = { ok: true, text: '{"terms":["替身"]}' };
    setup({ 'ai-request': () => response });
    const { result } = await renderReady();
    let next: StoryIdeaCardDraft | null = null;
    await act(async () => {
      next = await result.current.redrawIdeaTermRandomly(makeDraft({ twistTerms: [] }), 'twist');
    });
    expect((next as unknown as StoryIdeaCardDraft).twistTerms).toEqual(['替身']);
    expect(result.current.statusMessage).toBe('已为变形签随机重抽一签');

    response = { ok: false };
    const fresh = await renderReady({ folder: '/other' });
    await act(async () => {
      next = await fresh.result.current.redrawIdeaTermRandomly(
        makeDraft({ twistTerms: [] }),
        'twist'
      );
    });
    expect(next).toBeNull();
  });
});

describe('useStoryIdeaCards: 转大纲与送入情节板', () => {
  const directionOutput = makeOutput({
    id: 7,
    type: 'outline_direction',
    content: '方向：概要',
    meta_json: JSON.stringify({ title: '方向', summary: '概要', beats: ['b1', 'b2'] }),
  });

  it('promoteToOutline 替换大纲、保存版本并更新卡片状态', async () => {
    const { calls } = setup();
    const { result } = await renderReady();
    let ok = false;
    await act(async () => {
      ok = await result.current.promoteToOutline(
        makeCard(),
        makeDraft({ selectedLogline: 'LL' }),
        directionOutput
      );
    });
    expect(ok).toBe(true);
    const [folder, entries] = calls('db-outline-replace-by-folder')[0] as [
      string,
      Array<{ title: string; children: unknown[] }>,
    ];
    expect(folder).toBe(FOLDER);
    expect(entries[0].title).toBe('方向');
    expect(entries[0].children).toHaveLength(2);
    const [, version] = calls('db-outline-version-create-by-folder')[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(version.storyIdeaCardId).toBe(1);
    expect(version.note).toBe('三签创作法转大纲：LL');
    expect(calls('db-story-idea-card-update')[0][1]).toMatchObject({
      status: 'promoted_to_outline',
    });
    expect(result.current.statusMessage).toContain('版本快照');
  });

  it('promoteToOutline 数据库未就绪时拒绝', async () => {
    setup();
    const { result } = await renderReady({ db: false });
    let ok = true;
    await act(async () => {
      ok = await result.current.promoteToOutline(makeCard(), makeDraft(), directionOutput);
    });
    expect(ok).toBe(false);
  });

  it('promoteToOutline IPC 失败时 working 复位', async () => {
    setup({
      'db-outline-replace-by-folder': () => {
        throw new Error('fail');
      },
    });
    const { result } = await renderReady();
    await act(async () => {
      await expect(
        result.current.promoteToOutline(makeCard(), makeDraft(), directionOutput)
      ).rejects.toThrow('fail');
    });
    expect(result.current.working).toBe(false);
  });

  it('pushSceneHookToBoard 把场景钩子写入情节板存储', async () => {
    const { settings, calls } = setup();
    const { result } = await renderReady();
    const hook = makeOutput({
      id: 9,
      type: 'scene_hook',
      content: '雪夜追杀：主角被围',
      meta_json: JSON.stringify({ focus: '围杀' }),
    });
    let ok = false;
    await act(async () => {
      ok = await result.current.pushSceneHookToBoard(makeCard(), hook, 1);
    });
    expect(ok).toBe(true);
    const stored = JSON.parse(
      settings.get(`novel-editor:plot-board:${FOLDER}`) as string
    ) as Record<
      string,
      {
        premise: string;
        sceneBoards: Array<{ sceneKey: string; title: string; objective: string }>;
      }
    >;
    const board = Object.values(stored)[0];
    const added = board.sceneBoards.find((s) => s.sceneKey === 'idea:1:9');
    expect(added?.title).toBe('雪夜追杀');
    expect(added?.objective).toBe('围杀');
    expect(board.premise).toBe('失忆剑客追查过去');
    expect(calls('db-story-idea-card-update')[0]).toEqual([1, { status: 'promoted_to_board' }]);
    expect(result.current.statusMessage).toContain('第二幕 发展');

    // 已有存储 + 损坏的 meta_json 时回退到卡片 premise
    await act(async () => {
      ok = await result.current.pushSceneHookToBoard(
        makeCard(),
        makeOutput({ id: 11, type: 'scene_hook', content: 'x', meta_json: '{bad' }),
        1
      );
    });
    const stored2 = JSON.parse(
      settings.get(`novel-editor:plot-board:${FOLDER}`) as string
    ) as typeof stored;
    const added2 = Object.values(stored2)[0].sceneBoards.find((s) => s.sceneKey === 'idea:1:11');
    expect(added2?.objective).toBe('失忆剑客追查过去');
  });

  it('pushSceneHookToBoard 校验前置条件', async () => {
    setup();
    const hook = makeOutput({ type: 'scene_hook' });
    const noDb = await renderReady({ db: false });
    let ok = true;
    await act(async () => {
      ok = await noDb.result.current.pushSceneHookToBoard(makeCard(), hook, 0);
    });
    expect(ok).toBe(false);
    const noActs = await renderReady({ content: '普通正文' });
    await act(async () => {
      ok = await noActs.result.current.pushSceneHookToBoard(makeCard(), hook, 0);
    });
    expect(noActs.result.current.statusMessage).toContain('未检测到幕结构');
    const { result } = await renderReady();
    await act(async () => {
      ok = await result.current.pushSceneHookToBoard(makeCard(), hook, 5);
    });
    expect(result.current.statusMessage).toBe('请先选择要送入的目标幕');
    expect(ok).toBe(false);
  });
});

describe('useStoryIdeaCards: folder 切换', () => {
  it('切换项目时重新加载', async () => {
    const { calls } = setup();
    const { rerender } = renderHook(({ folder }) => useStoryIdeaCards(folder, '', true, true), {
      initialProps: { folder: '/a' as string | null },
    });
    await waitFor(() => expect(calls('db-story-idea-card-list-by-folder')).toHaveLength(1));
    rerender({ folder: '/b' });
    await waitFor(() => expect(calls('db-story-idea-card-list-by-folder')).toHaveLength(2));
    expect(calls('db-story-idea-card-list-by-folder')[1]).toEqual(['/b']);
  });
});
