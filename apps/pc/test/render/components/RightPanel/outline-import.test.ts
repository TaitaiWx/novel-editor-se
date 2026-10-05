import type { Mock } from 'vitest';
import {
  DEFAULT_OUTLINE_AI_OPTIONS,
  OUTLINE_AI_GRANULARITY_LABELS,
  OUTLINE_AI_STYLE_LABELS,
  buildOutlineTreeFromAi,
  buildOutlineTreeFromContent,
  buildOutlineTreeFromImports,
  requestAiOutline,
} from '@/render/components/RightPanel/outline-import';

interface AiRequestPayload {
  prompt: string;
  systemPrompt: string;
  context: string;
  maxTokens: number;
  temperature: number;
}

function stubIpc(response: unknown): Mock {
  const invoke = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('window', { electron: { ipcRenderer: { invoke } } });
  return invoke;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const AI_TREE = `\`\`\`json
[
  {"title":"第一卷 下山","content":"林远  离开青云宗","line":1,
   "children":[
     {"title":"第一章 风起","summary":"雪夜遇袭","lineHint":3,
      "items":[{"title":"","description":"场景","children":[{"title":"第四层"}]}]}
   ]},
  {"content":"无标题节点","anchorText":"锚点"}
]
\`\`\``;

describe('constants', () => {
  it('expose defaults and labels', () => {
    expect(DEFAULT_OUTLINE_AI_OPTIONS).toEqual({
      style: 'balanced',
      granularity: 'medium',
      maxDepth: 3,
    });
    expect(OUTLINE_AI_STYLE_LABELS.suspense).toBe('悬疑钩子');
    expect(OUTLINE_AI_GRANULARITY_LABELS.fine).toBe('细');
  });
});

describe('requestAiOutline', () => {
  it('returns null without ipc', async () => {
    vi.stubGlobal('window', {});
    expect(await requestAiOutline('第一章')).toBeNull();
  });

  it('returns null for failed or empty AI responses', async () => {
    stubIpc({ ok: false, error: 'boom' });
    expect(await requestAiOutline('x')).toBeNull();
    stubIpc({ ok: true, text: '' });
    expect(await requestAiOutline('x')).toBeNull();
    stubIpc({ ok: true, text: '抱歉无法解析' });
    expect(await requestAiOutline('x')).toBeNull();
    stubIpc({ ok: true, text: '{"outlines": [}' });
    expect(await requestAiOutline('x')).toBeNull();
    stubIpc({ ok: true, text: '{"foo":[]}' });
    expect(await requestAiOutline('x')).toBeNull();
  });

  it('normalizes AI nodes and limits tree depth', async () => {
    const invoke = stubIpc({ ok: true, text: AI_TREE });
    const nodes = await requestAiOutline('正文'.repeat(7000), {
      style: 'suspense',
      granularity: 'fine',
      maxDepth: 2,
    });
    const payload = invoke.mock.calls[0][1] as AiRequestPayload;
    expect(invoke.mock.calls[0][0]).toBe('ai-request');
    expect(payload.prompt).toContain('最多 2 层');
    expect(payload.prompt).toContain('悬念');
    expect(payload.prompt).toContain('偏细粒度');
    expect(payload.context.length).toBe('待解析文本:\n'.length + 12000);
    expect(nodes).toEqual([
      {
        title: '第一卷 下山',
        content: '林远 离开青云宗',
        anchorText: '第一卷 下山',
        lineHint: 1,
        sortOrder: 0,
        children: [
          {
            title: '第一章 风起',
            content: '雪夜遇袭',
            anchorText: '第一章 风起',
            lineHint: 3,
            sortOrder: 0,
            children: [],
          },
        ],
      },
      {
        title: 'outline-2',
        content: '无标题节点',
        anchorText: '锚点',
        lineHint: null,
        sortOrder: 1,
        children: [],
      },
    ]);
  });

  it('clamps depth to [1,4] and supports wrapper keys', async () => {
    const invoke = stubIpc({
      ok: true,
      text: '{"chapters":[{"title":"A","children":[{"title":"B","items":[{"title":"C","children":[{"title":"D","children":[{"title":"E"}]}]}]}]}]}',
    });
    const deep = await requestAiOutline('x', {
      style: 'cinematic',
      granularity: 'coarse',
      maxDepth: 99,
    });
    expect((invoke.mock.calls[0][1] as AiRequestPayload).prompt).toContain('最多 4 层');
    expect(deep?.[0].children?.[0].children?.[0].children?.[0].title).toBe('D');
    expect(deep?.[0].children?.[0].children?.[0].children?.[0].children).toEqual([]);
    // nested auto-titles use the parent prefix
    stubIpc({ ok: true, text: '{"items":[{"children":[{}]}]}' });
    const shallow = await requestAiOutline('x', {
      style: 'detailed',
      granularity: 'medium',
      maxDepth: 0,
    });
    expect(shallow).toEqual([
      {
        title: 'outline-1',
        content: '',
        anchorText: '',
        lineHint: null,
        sortOrder: 0,
        children: [],
      },
    ]);
  });

  it('accepts the outlines wrapper key', async () => {
    stubIpc({ ok: true, text: '{"outlines":[{"title":"序章"}]}' });
    expect((await requestAiOutline('x'))?.[0].title).toBe('序章');
  });

  // 回归（已修复）：the system prompt asks the model for a bare JSON array, but extractJsonBlock only
  // handles fenced blocks or {...}; an unfenced multi-item array becomes `{..},{..}` and fails.
  it('parses an unfenced JSON array as instructed by the system prompt', async () => {
    stubIpc({ ok: true, text: '[{"title":"第一章"},{"title":"第二章"}]' });
    expect(await requestAiOutline('x')).toHaveLength(2);
  });
});

describe('buildOutlineTreeFromAi', () => {
  it('returns [] when content is blank or AI is not ready', async () => {
    const invoke = stubIpc({ ok: true, text: AI_TREE });
    expect(await buildOutlineTreeFromAi('   ', true)).toEqual([]);
    expect(await buildOutlineTreeFromAi('第一章', false)).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('returns [] when AI fails', async () => {
    stubIpc({ ok: false });
    expect(await buildOutlineTreeFromAi('第一章', true)).toEqual([]);
  });

  it('returns AI nodes with sortOrder', async () => {
    stubIpc({ ok: true, text: AI_TREE });
    const nodes = await buildOutlineTreeFromAi('第一章', true);
    expect(nodes.map((n) => [n.title, n.sortOrder])).toEqual([
      ['第一卷 下山', 0],
      ['outline-2', 1],
    ]);
  });
});

describe('buildOutlineTreeFromContent (fallback)', () => {
  it('returns [] for blank content', async () => {
    expect(await buildOutlineTreeFromContent('  ', false)).toEqual([]);
  });

  it('builds nodes from chapter headings without AI', async () => {
    const content = ['第一章 风起', '林远在雪夜醒来。', '第二章 云涌', '苏晴赶到。'].join('\n');
    expect(await buildOutlineTreeFromContent(content, false)).toEqual([
      {
        title: '第一章 风起',
        content: '林远在雪夜醒来。',
        anchorText: '第一章 风起',
        lineHint: 1,
        sortOrder: 0,
        children: [],
      },
      {
        title: '第二章 云涌',
        content: '苏晴赶到。',
        anchorText: '第二章 云涌',
        lineHint: 3,
        sortOrder: 1,
        children: [],
      },
    ]);
  });

  it('keeps a single non-generic heading', async () => {
    const nodes = await buildOutlineTreeFromContent('# 序章 雪夜\n林远醒来。', false);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].title).toBe('序章 雪夜');
  });

  it('chunks plain prose into import fragments', async () => {
    const content = ['林远推门而出，雪落满肩。', '', '苏晴站在廊下。'].join('\n');
    const nodes = await buildOutlineTreeFromContent(content, false);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      title: '林远推门而出，雪落满肩。',
      anchorText: '林远推门而出，雪落满肩。',
      lineHint: 1,
      sortOrder: 0,
    });
    expect(nodes[0].content).toBe('林远推门而出，雪落满肩。 苏晴站在廊下。');
  });

  it('creates numbered fragment titles for long multi-chunk prose', async () => {
    const big = '雪'.repeat(1795);
    const content = [`${big}一`, '', `${big}二`, '', '- 1.'].join('\n');
    const nodes = await buildOutlineTreeFromContent(content, false);
    expect(nodes.length).toBe(3);
    expect(nodes[0].title).toBe(`${'雪'.repeat(18)}...`);
    expect(nodes[0].content?.endsWith('...')).toBe(true);
    expect(nodes[1].lineHint).toBe(3);
    expect(nodes[2].title).toBe('导入片段 3');
  });

  it('prefers AI nodes when AI is ready and succeeds', async () => {
    stubIpc({ ok: true, text: '{"items":[{"title":"AI 第一卷"}]}' });
    const nodes = await buildOutlineTreeFromContent('第一章 风起\n正文', true);
    expect(nodes.map((n) => n.title)).toEqual(['AI 第一卷']);
  });

  it('falls back when AI is ready but fails', async () => {
    stubIpc({ ok: false });
    const nodes = await buildOutlineTreeFromContent('第一章 风起\n正文\n第二章 云涌\n正文', true);
    expect(nodes.map((n) => n.title)).toEqual(['第一章 风起', '第二章 云涌']);
  });
});

describe('buildOutlineTreeFromImports', () => {
  it('flattens a single preview into top-level nodes', async () => {
    const nodes = await buildOutlineTreeFromImports(
      [{ fileName: '大纲.md', content: '第一章 风起\n正文\n第二章 云涌\n正文', sourcePath: '/a' }],
      false
    );
    expect(nodes.map((n) => [n.title, n.sortOrder])).toEqual([
      ['第一章 风起', 0],
      ['第二章 云涌', 1],
    ]);
  });

  it('wraps multiple previews under file-title roots and skips empty files', async () => {
    const nodes = await buildOutlineTreeFromImports(
      [
        {
          fileName: '第一卷.md',
          content: '第一章 风起\n正文\n第二章 云涌\n正文',
          sourcePath: '/a',
        },
        { fileName: '空.md', content: '   ', sourcePath: '/b' },
        { fileName: '.md', content: '第三章 夜战\n刀光', sourcePath: '/c' },
      ],
      false
    );
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({ title: '第一卷', sortOrder: 0 });
    expect(nodes[0].children?.map((c) => c.title)).toEqual(['第一章 风起', '第二章 云涌']);
    expect(nodes[1]).toMatchObject({
      title: '导入大纲',
      content: '第三章 夜战 刀光',
      sortOrder: 1,
    });
  });

  it('uses AI per preview when ready', async () => {
    const invoke = stubIpc({ ok: true, text: '{"items":[{"title":"AI 节点"}]}' });
    const nodes = await buildOutlineTreeFromImports(
      [{ fileName: 'a.txt', content: '随便写点', sourcePath: '/a' }],
      true
    );
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(nodes.map((n) => n.title)).toEqual(['AI 节点']);
  });

  it('returns [] for no previews', async () => {
    expect(await buildOutlineTreeFromImports([], false)).toEqual([]);
  });
});
