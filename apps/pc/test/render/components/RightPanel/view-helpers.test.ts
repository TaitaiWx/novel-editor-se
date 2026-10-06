import type { FileNode, OpenLocalResult } from '@/render/types/File';
import type { PersistedOutlineVersionRow } from '@/render/types/electron-api';
import type {
  Character,
  CharacterTimelineItem,
  OutlineEntry,
} from '@/render/components/RightPanel/types';
import {
  DEFAULT_CURRENT_STATE_LABELS,
  NOVEL_CORPUS_READ_CONCURRENCY,
  buildDerivedCurrentStateItems,
  buildRelativeFileLabel,
  cloneCurrentStateItems,
  createCurrentStateItem,
  flattenFileNodes,
  formatTimelineLineLabel,
  isNovelCorpusFilePath,
  loadNovelCorpusFiles,
  stripTimelineFileExtension,
} from '@/render/components/RightPanel/CharactersView/helpers';
import type { TimelineIpcInvoker } from '@/render/components/RightPanel/CharactersView/helpers';
import {
  OUTLINE_AI_PRESETS,
  OUTLINE_VERSION_SOURCE_LABELS,
  buildCompareLabel,
  buildDiffLine,
  buildStoryIdeaCardTitle,
  buildStoryIdeaTermsPreview,
  getOutlineScopeLabel,
  jumpToStoryIdeaCard,
  parseVersionTree,
  serializeCurrentEntries,
  serializeVersionTree,
} from '@/render/components/RightPanel/OutlineView/helpers';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------------------------------------------------------------- CharactersView/helpers

describe('CharactersView/helpers', () => {
  const character: Character = {
    id: 1,
    name: '林远',
    role: ' 主角 ',
    category: 'major',
    description: '',
    currentState: [],
  };

  it('constants', () => {
    expect(NOVEL_CORPUS_READ_CONCURRENCY).toBe(4);
    expect(DEFAULT_CURRENT_STATE_LABELS).toContain('当前危机');
  });

  it('stripTimelineFileExtension', () => {
    expect(stripTimelineFileExtension('第一章.md')).toBe('第一章');
    expect(stripTimelineFileExtension('卷一/第二章.TXT')).toBe('卷一/第二章');
    expect(stripTimelineFileExtension('设定.markdown')).toBe('设定');
    expect(stripTimelineFileExtension('封面.png')).toBe('封面.png');
  });

  it('formatTimelineLineLabel', () => {
    expect(formatTimelineLineLabel()).toBe('');
    expect(formatTimelineLineLabel(0, 10)).toBe('');
    expect(formatTimelineLineLabel(5)).toBe('第 5 行');
    expect(formatTimelineLineLabel(5, 5)).toBe('第 5 行');
    expect(formatTimelineLineLabel(5, 12)).toBe('第 5-12 行');
  });

  it('createCurrentStateItem uses crypto.randomUUID when available', () => {
    const item = createCurrentStateItem('境界', '筑基');
    expect(item.label).toBe('境界');
    expect(item.value).toBe('筑基');
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(createCurrentStateItem()).toMatchObject({ label: '', value: '' });
  });

  it('createCurrentStateItem falls back without crypto', () => {
    vi.stubGlobal('crypto', undefined);
    expect(createCurrentStateItem('a', 'b').id).toMatch(/^state-\d+-[a-z0-9]+$/);
  });

  it('cloneCurrentStateItems copies items and backfills ids', () => {
    const source = [
      { id: 'x', label: '目标', value: '复仇' },
      { id: '', label: '伤势', value: '轻伤' },
    ];
    const cloned = cloneCurrentStateItems(source);
    expect(cloned).toEqual([
      { id: 'x', label: '目标', value: '复仇' },
      { id: 'state-copy-1', label: '伤势', value: '轻伤' },
    ]);
    expect(cloned[0]).not.toBe(source[0]);
  });

  it('buildDerivedCurrentStateItems derives from latest timeline item and role', () => {
    expect(buildDerivedCurrentStateItems(null, [])).toEqual([]);
    const timeline: CharacterTimelineItem[] = [
      { id: '1', title: '拜师', summary: '入门', source: 'auto' },
      { id: '2', title: '下山', summary: '离开宗门', source: 'auto', chapterLabel: '第五章' },
    ];
    expect(buildDerivedCurrentStateItems(character, timeline)).toEqual([
      { id: 'derived-current-chapter', label: '当前章节', value: '第五章' },
      { id: 'derived-current-progress', label: '当前进展', value: '下山' },
      { id: 'derived-current-summary', label: '当前状态', value: '离开宗门' },
      { id: 'derived-current-role', label: '角色定位', value: '主角' },
    ]);
    expect(buildDerivedCurrentStateItems({ ...character, role: '  ' }, [])).toEqual([]);
  });

  it('flattenFileNodes recurses into directories', () => {
    const tree: FileNode[] = [
      {
        name: '卷一',
        path: '/n/卷一',
        type: 'directory',
        children: [
          { name: '第一章.md', path: '/n/卷一/第一章.md', type: 'file' },
          { name: '空', path: '/n/卷一/空', type: 'directory' },
        ],
      },
      { name: '大纲.md', path: '/n/大纲.md', type: 'file' },
    ];
    expect(flattenFileNodes(tree).map((n) => n.name)).toEqual(['第一章.md', '大纲.md']);
  });

  it('buildRelativeFileLabel', () => {
    expect(buildRelativeFileLabel('/novel/', '/novel/卷一/第一章.md')).toBe('卷一/第一章.md');
    expect(buildRelativeFileLabel('C:\\novel', 'C:\\novel\\卷一\\第一章.md')).toBe(
      '卷一/第一章.md'
    );
    expect(buildRelativeFileLabel('/novel', '/other/第九章.md')).toBe('第九章.md');
    expect(buildRelativeFileLabel('/novel', '/other/')).toBe('/other/');
  });

  it('loadNovelCorpusFiles reads text files in sorted batches and drops empty files', async () => {
    const files: FileNode[] = [
      { name: '第10章.md', path: '/n/第10章.md', type: 'file' },
      { name: '第2章.md', path: '/n/第2章.md', type: 'file' },
      { name: '封面.png', path: '/n/封面.png', type: 'file' },
      {
        name: '卷一',
        path: '/n/卷一',
        type: 'directory',
        children: [
          { name: '第1章.txt', path: '/n/卷一/第1章.txt', type: 'file' },
          { name: '空.md', path: '/n/卷一/空.md', type: 'file' },
          { name: '第4章.md', path: '/n/卷一/第4章.md', type: 'file' },
          { name: '第3章.md', path: '/n/卷一/第3章.md', type: 'file' },
        ],
      },
    ];
    const contents: Record<string, string> = {
      '/n/第10章.md': '第十章 正文',
      '/n/第2章.md': ' 第二章 正文 ',
      '/n/卷一/第1章.txt': '第一章 正文',
      '/n/卷一/空.md': '   ',
      '/n/卷一/第4章.md': '第四章',
      '/n/卷一/第3章.md': '第三章',
    };
    const readPaths: string[] = [];
    const invoke = vi.fn(async (channel: string, path: string) => {
      if (channel === 'refresh-folder') {
        const result: OpenLocalResult = { path, files };
        return result;
      }
      readPaths.push(path);
      return contents[path];
    });
    const ipc = { invoke } as unknown as TimelineIpcInvoker;
    const corpus = await loadNovelCorpusFiles('/n', ipc);
    expect(invoke).toHaveBeenCalledWith('refresh-folder', '/n');
    expect(readPaths).toHaveLength(6);
    expect(corpus.map((f) => f.label)).toEqual([
      '第2章.md',
      '第10章.md',
      '卷一/第1章.txt',
      '卷一/第3章.md',
      '卷一/第4章.md',
    ]);
    expect(corpus[0]).toEqual({ path: '/n/第2章.md', label: '第2章.md', content: '第二章 正文' });
  });

  it('isNovelCorpusFilePath 排除生成资料目录（资料/、资料/记忆/）与项目外文件', () => {
    expect(isNovelCorpusFilePath('/n/卷一/第1章.md', '/n')).toBe(true);
    expect(isNovelCorpusFilePath('/n/资料/记忆/README.md', '/n')).toBe(false);
    expect(isNovelCorpusFilePath('/n/资料/AI资料/人物.md', '/n/')).toBe(false);
    expect(isNovelCorpusFilePath('C:\\n\\资料\\记忆\\README.md', 'C:\\n')).toBe(false);
    expect(isNovelCorpusFilePath('C:\\n\\第1章.txt', 'C:\\n')).toBe(true);
    // 只排除项目根下的资料目录，卷内同名子目录或「资料集」不受影响
    expect(isNovelCorpusFilePath('/n/卷一/资料/第1章.md', '/n')).toBe(true);
    expect(isNovelCorpusFilePath('/n/资料集/第1章.md', '/n')).toBe(true);
    expect(isNovelCorpusFilePath('/n/封面.png', '/n')).toBe(false);
    expect(isNovelCorpusFilePath('/other/第1章.md', '/n')).toBe(false);
  });

  it('loadNovelCorpusFiles 不读取资料目录下的记忆库文件', async () => {
    const files: FileNode[] = [
      { name: '第1章.md', path: '/n/第1章.md', type: 'file' },
      {
        name: '资料',
        path: '/n/资料',
        type: 'directory',
        children: [
          {
            name: '记忆',
            path: '/n/资料/记忆',
            type: 'directory',
            children: [{ name: 'README.md', path: '/n/资料/记忆/README.md', type: 'file' }],
          },
        ],
      },
    ];
    const readPaths: string[] = [];
    const invoke = vi.fn(async (channel: string, path: string) => {
      if (channel === 'refresh-folder') {
        const result: OpenLocalResult = { path, files };
        return result;
      }
      readPaths.push(path);
      return '林舟走进森林';
    });
    const corpus = await loadNovelCorpusFiles('/n', { invoke } as unknown as TimelineIpcInvoker);
    expect(readPaths).toEqual(['/n/第1章.md']);
    expect(corpus.map((f) => f.label)).toEqual(['第1章.md']);
  });
});

// ---------------------------------------------------------------- OutlineView/helpers

describe('OutlineView/helpers', () => {
  function makeVersion(
    overrides: Partial<PersistedOutlineVersionRow> = {}
  ): PersistedOutlineVersionRow {
    return {
      id: 1,
      novel_id: 1,
      scope_kind: 'project',
      scope_path: '',
      name: 'v1',
      source: 'manual',
      note: '',
      story_idea_card_id: null,
      story_idea_snapshot_json: '',
      tree_json: '[]',
      total_nodes: 0,
      created_at: '',
      ...overrides,
    };
  }

  it('buildDiffLine indents and collapses whitespace', () => {
    expect(buildDiffLine('第一章', undefined, 1)).toBe('- 第一章');
    expect(buildDiffLine('第一章', '  林远\n醒来 ', 3)).toBe('    - 第一章 :: 林远 醒来');
    expect(buildDiffLine('序', '', 0)).toBe('- 序');
  });

  it('serializeVersionTree walks nested children', () => {
    expect(
      serializeVersionTree([
        { title: '第一卷', content: '下山', children: [{ title: '第一章', children: [] }] },
        { title: '第二卷' },
      ])
    ).toEqual(['- 第一卷 :: 下山', '  - 第一章', '- 第二卷']);
  });

  it('parseVersionTree tolerates bad JSON', () => {
    expect(parseVersionTree(makeVersion({ tree_json: '[{"title":"A"}]' }))).toEqual([
      { title: 'A' },
    ]);
    expect(parseVersionTree(makeVersion({ tree_json: '{"title":"A"}' }))).toEqual([]);
    expect(parseVersionTree(makeVersion({ tree_json: 'oops' }))).toEqual([]);
  });

  it('serializeCurrentEntries', () => {
    const entries: OutlineEntry[] = [
      {
        cacheKey: 'a',
        line: 1,
        level: 1,
        text: '第一章',
        summary: '林远醒来',
        autoGenerated: false,
        wordCount: 4,
      },
      {
        cacheKey: 'b',
        line: 5,
        level: 2,
        text: '雪夜',
        summary: '',
        autoGenerated: false,
        wordCount: 0,
      },
    ];
    expect(serializeCurrentEntries(entries)).toBe('- 第一章 :: 林远醒来\n  - 雪夜');
  });

  it('scope and compare labels', () => {
    expect(getOutlineScopeLabel('chapter')).toBe('章纲');
    expect(getOutlineScopeLabel('volume')).toBe('卷纲');
    expect(getOutlineScopeLabel('project')).toBe('作品大纲');
    expect(buildCompareLabel('v2', 'chapter')).toBe('版本 v2');
    expect(buildCompareLabel(null, 'volume')).toBe('当前卷纲');
  });

  it('story idea preview helpers', () => {
    const snapshot = JSON.stringify({
      title: '  雪夜剑客 ',
      themeTerms: ['a', 'b', 'c', 'd'],
      conflictTerms: ['e', 'f', 'g'],
      twistTerms: ['h', 'i', 'j'],
    });
    const version = makeVersion({ story_idea_snapshot_json: snapshot, story_idea_card_id: 7 });
    expect(buildStoryIdeaTermsPreview(version)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
      'i',
    ]);
    expect(buildStoryIdeaTermsPreview(makeVersion())).toEqual([]);
    expect(buildStoryIdeaCardTitle(version)).toBe('雪夜剑客');
    expect(
      buildStoryIdeaCardTitle(
        makeVersion({ story_idea_snapshot_json: '{}', story_idea_card_id: 7 })
      )
    ).toBe('三签卡 #7');
    expect(buildStoryIdeaCardTitle(makeVersion())).toBe('三签创意卡');
  });

  it('jumpToStoryIdeaCard 请求在灵感弹窗中回填三签卡', () => {
    const target = new EventTarget();
    const received: Array<{ type: string; detail: unknown }> = [];
    const listener = (event: Event) => {
      received.push({ type: event.type, detail: (event as CustomEvent<unknown>).detail });
    };
    target.addEventListener('open-inspiration', listener);
    vi.stubGlobal('window', target);

    jumpToStoryIdeaCard(null);
    expect(received).toEqual([]);

    jumpToStoryIdeaCard(12);
    expect(received).toEqual([{ type: 'open-inspiration', detail: { cardId: 12 } }]);
  });

  it('presets and source labels', () => {
    expect(OUTLINE_VERSION_SOURCE_LABELS.ai).toBe('AI');
    expect(OUTLINE_AI_PRESETS.map((p) => p.key)).toEqual([
      'balanced',
      'cinematic',
      'detailed',
      'suspense',
    ]);
    OUTLINE_AI_PRESETS.forEach((preset) => {
      expect(preset.value.style).toBe(preset.key);
      expect(preset.value.maxDepth).toBeGreaterThanOrEqual(1);
      expect(preset.value.maxDepth).toBeLessThanOrEqual(4);
    });
  });
});
