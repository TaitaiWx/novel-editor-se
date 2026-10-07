import {
  collectLoreFolders,
  relatedLoreEntries,
} from '@/render/components/RightPanel/LoreEntryDetail';
import type { LoreCategory, LoreEntry } from '@/render/components/RightPanel/types';
import { parseLoreDraftsFromImport } from '@/render/components/RightPanel/lore-import';
import {
  buildLoreDedupKey,
  loadLoreEntriesByFolder,
  mapLoreRow,
  parseLoreAuditSections,
  parseLoreDraftFromAuditItem,
  parseLoreAttributes,
  stringifyLoreAttributes,
} from '@/render/components/RightPanel/lore-data';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseLoreDraftsFromImport — JSON', () => {
  it('parses a top-level array of objects and strings', () => {
    const raw = JSON.stringify([
      { title: '青云宗', category: '宗门', summary: '正道魁首', tags: ['正道', 1] },
      { name: '灵根', content: '修炼资质分五行' },
      { title: '天机阁', description: '情报组织' },
      '玄铁令',
      { summary: '无标题被丢弃' },
      null,
    ]);
    expect(parseLoreDraftsFromImport(raw, 'lore.json', 'term')).toEqual([
      { category: 'faction', title: '青云宗', summary: '正道魁首', tags: ['正道'] },
      { category: 'term', title: '灵根', summary: '修炼资质分五行', tags: [] },
      { category: 'term', title: '天机阁', summary: '情报组织', tags: [] },
      { category: 'term', title: '玄铁令', summary: '' },
    ]);
  });

  it('infers category from title when category missing', () => {
    const raw = JSON.stringify({ entries: [{ title: '修炼等级', summary: '炼气、筑基、金丹' }] });
    expect(parseLoreDraftsFromImport(raw, 'a.json', 'world')[0].category).toBe('system');
  });

  it('accepts items / data wrappers', () => {
    expect(parseLoreDraftsFromImport('{"items":["甲"]}', 'x.json', 'world')).toHaveLength(1);
    expect(parseLoreDraftsFromImport('{"data":[{"title":"乙"}]}', 'x.json', 'world')).toHaveLength(
      1
    );
  });

  it('falls back to text parsing for empty JSON results or non-array JSON', () => {
    expect(parseLoreDraftsFromImport('[]', '空.json', 'world')).toEqual([
      { category: 'world', title: '空', summary: '[]' },
    ]);
    expect(parseLoreDraftsFromImport('{"foo":1}', 'cfg.json', 'term')).toEqual([
      { category: 'term', title: 'cfg', summary: '{"foo":1}' },
    ]);
  });
});

describe('parseLoreDraftsFromImport — text/markdown', () => {
  it('returns [] for blank content', () => {
    expect(parseLoreDraftsFromImport('   \n  ', 'a.md', 'world')).toEqual([]);
  });

  it('uses file name as title when no headings are detected', () => {
    const content =
      '这是一段很长很长的世界背景描述，讲述了九州大陆从上古到今日的漫长历史变迁以及诸多宗门兴衰的故事，内容远超过标题长度。';
    expect(parseLoreDraftsFromImport(content, '九州.设定.md', 'world')).toEqual([
      { category: 'world', title: '九州.设定', summary: content },
    ]);
    expect(parseLoreDraftsFromImport(content, '.hidden', 'term')[0].title).toBe('.hidden');
  });

  it('splits markdown sections, skipping empty pure category headings', () => {
    const content = [
      '# 势力', // 1
      '## 青云宗门', // 2
      '正道第一大宗，坐落青云山。', // 3
      '## 魔教', // 4
      '盘踞西域。', // 5
      '# 修炼体系', // 6
      '炼气、筑基、金丹、元婴。', // 7
      '# 术语', // 8
      '', // 9
    ].join('\n');
    expect(parseLoreDraftsFromImport(content, 'lore.md', 'world')).toEqual([
      { category: 'faction', title: '青云宗门', summary: '正道第一大宗，坐落青云山。' },
      // 无关键词的子标题继承上级“势力”分类
      { category: 'faction', title: '魔教', summary: '盘踞西域。' },
      { category: 'system', title: '修炼体系', summary: '炼气、筑基、金丹、元婴。' },
    ]);
  });

  // 回归（已修复）：lore-import.ts computes `inheritedCategory` from the parent heading but only applies it
  // to the pure category heading itself (which already matches its own keyword). Child entries
  // under "# 势力" whose titles carry no keyword fall back to fallbackCategory instead of faction.
  it('children of a pure category heading inherit its category', () => {
    const content = ['# 势力', '## 魔教', '盘踞西域。'].join('\n');
    expect(parseLoreDraftsFromImport(content, 'lore.md', 'world')[0].category).toBe('faction');
  });

  it('keeps a pure category heading that has its own body', () => {
    const content = ['# 世界观', '天圆地方，九州并立。', '## 地点', '青云山：宗门所在。'].join(
      '\n'
    );
    const drafts = parseLoreDraftsFromImport(content, 'w.md', 'term');
    expect(drafts[0]).toEqual({
      category: 'world',
      title: '世界观',
      summary: '天圆地方，九州并立。',
    });
    expect(drafts[1]).toEqual({ category: 'world', title: '地点', summary: '青云山：宗门所在。' });
  });

  it('falls back to whole file when all headings are empty category headings', () => {
    const content = '# 势力\n# 术语';
    expect(parseLoreDraftsFromImport(content, '空设定.md', 'system')).toEqual([
      { category: 'system', title: '空设定', summary: content },
    ]);
  });
});

describe('mapLoreRow', () => {
  const base = {
    id: 1,
    category: 'faction',
    title: '青云宗',
    content: '正道魁首',
    tags: '["正道",3,"宗门"]',
    created_at: '2026-01-01',
    updated_at: '2026-01-02',
  };

  it('maps DB rows', () => {
    expect(mapLoreRow(base)).toEqual({
      id: 1,
      category: 'faction',
      title: '青云宗',
      summary: '正道魁首',
      tags: ['正道', '宗门'],
      folder: '',
      media: [],
      createdAt: '2026-01-01',
      updatedAt: '2026-01-02',
    });
  });

  it('解析扩展字段：分类目录、封面与图集；无效 JSON 回退空值；序列化只保留有值的字段', () => {
    const entry = mapLoreRow({
      ...base,
      attributes: JSON.stringify({
        folder: ' 地理 / 北境 / ',
        cover: '资料/图集/设定/青云宗/a.png',
        media: [
          { id: 'x', path: '资料/图集/设定/青云宗/a.png', kind: 'concept', source: 'ai' },
          { id: 'bad', path: '../escape.png', kind: 'concept' },
        ],
      }),
    });
    expect(entry.folder).toBe('地理/北境');
    expect(entry.cover).toBe('资料/图集/设定/青云宗/a.png');
    expect(entry.media.map((item) => item.path)).toEqual(['资料/图集/设定/青云宗/a.png']);
    expect(parseLoreAttributes('{oops')).toEqual({ folder: '', media: [] });
    expect(stringifyLoreAttributes({ folder: '', media: [] })).toBe('{}');
    expect(JSON.parse(stringifyLoreAttributes({ folder: 'a//b', cover: 'c.png' }))).toEqual({
      folder: 'a/b',
      cover: 'c.png',
    });
  });

  it('normalizes unknown category, bad tags and empty strings', () => {
    const entry = mapLoreRow({ ...base, category: 'magic', tags: '{oops', title: '', content: '' });
    expect(entry.category).toBe('world');
    expect(entry.tags).toEqual([]);
    expect(entry.title).toBe('');
    expect(entry.summary).toBe('');
    expect(mapLoreRow({ ...base, tags: '' }).tags).toEqual([]);
    expect(mapLoreRow({ ...base, tags: '{"a":1}' }).tags).toEqual([]);
    for (const category of ['world', 'system', 'term']) {
      expect(mapLoreRow({ ...base, category }).category).toBe(category);
    }
  });
});

describe('loadLoreEntriesByFolder', () => {
  it('returns [] without ipc or folder', async () => {
    vi.stubGlobal('window', {});
    expect(await loadLoreEntriesByFolder('/novel')).toEqual([]);
    const invoke = vi.fn();
    vi.stubGlobal('window', { electron: { ipcRenderer: { invoke } } });
    expect(await loadLoreEntriesByFolder(null)).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('invokes ipc and maps rows', async () => {
    const invoke = vi.fn().mockResolvedValue([
      {
        id: 2,
        category: 'term',
        title: '玄铁令',
        content: '掌门信物',
        tags: '[]',
        created_at: 'c',
        updated_at: 'u',
      },
    ]);
    vi.stubGlobal('window', { electron: { ipcRenderer: { invoke } } });
    const entries = await loadLoreEntriesByFolder('/novel');
    expect(invoke).toHaveBeenCalledWith('db-world-setting-list-by-folder', '/novel');
    expect(entries).toEqual([
      {
        id: 2,
        category: 'term',
        title: '玄铁令',
        summary: '掌门信物',
        tags: [],
        folder: '',
        media: [],
        createdAt: 'c',
        updatedAt: 'u',
      },
    ]);
  });
});

describe('buildLoreDedupKey', () => {
  it('normalizes title case and whitespace', () => {
    expect(buildLoreDedupKey({ category: 'faction', title: '  Sky Sect ' })).toBe(
      'faction::sky sect'
    );
  });
});

describe('parseLoreAuditSections', () => {
  it('returns [] for blank input', () => {
    expect(parseLoreAuditSections('  \r\n ')).toEqual([]);
  });

  it('splits AI audit output into known sections', () => {
    const raw = [
      '整体来看设定较完整。',
      '',
      '1. 缺失设定：',
      '- 青云宗的宗规未说明',
      '2) 魔教总坛地点',
      '',
      '可能冲突:',
      '• 第三章说灵根分五行，第十章又说分七种',
      '',
      '建议补充条目模板',
      '1、修炼等级：炼气/筑基/金丹',
      '缺失设定',
    ].join('\r\n');
    expect(parseLoreAuditSections(raw)).toEqual([
      {
        key: 'other',
        title: '诊断结果',
        body: '整体来看设定较完整。',
        items: ['整体来看设定较完整。'],
      },
      {
        key: 'missing',
        title: '缺失设定',
        body: '- 青云宗的宗规未说明\n2) 魔教总坛地点',
        items: ['青云宗的宗规未说明', '魔教总坛地点'],
      },
      {
        key: 'conflict',
        title: '可能冲突',
        body: '• 第三章说灵根分五行，第十章又说分七种',
        items: ['第三章说灵根分五行，第十章又说分七种'],
      },
      {
        key: 'template',
        title: '建议补充的条目模板',
        body: '1、修炼等级：炼气/筑基/金丹',
        items: ['修炼等级：炼气/筑基/金丹'],
      },
    ]);
  });

  it('accepts the alternate template heading', () => {
    const sections = parseLoreAuditSections('建议补充的条目模板：\n- 地点：青云山');
    expect(sections).toHaveLength(1);
    expect(sections[0].key).toBe('template');
  });
});

describe('parseLoreDraftFromAuditItem', () => {
  it('splits title and summary on colon and infers category', () => {
    expect(parseLoreDraftFromAuditItem('- 修炼等级：炼气/筑基：金丹', 'term')).toEqual({
      category: 'system',
      title: '修炼等级',
      summary: '炼气/筑基：金丹',
    });
    expect(parseLoreDraftFromAuditItem('1. 青云宗: 正道门派', 'world')?.category).toBe('faction');
  });

  it('uses whole text as summary when there is no colon', () => {
    expect(parseLoreDraftFromAuditItem('玄铁令', 'term')).toEqual({
      category: 'term',
      title: '玄铁令',
      summary: '玄铁令',
    });
  });

  it('truncates long titles to 40 chars', () => {
    const draft = parseLoreDraftFromAuditItem('长'.repeat(60), 'world');
    expect(draft?.title).toHaveLength(40);
    expect(draft?.summary).toHaveLength(60);
  });

  it('returns null for empty or colon-only items', () => {
    expect(parseLoreDraftFromAuditItem('-  ', 'world')).toBeNull();
    expect(parseLoreDraftFromAuditItem('：:', 'world')).toBeNull();
  });
});

describe('设定详情：目录候选与相关设定', () => {
  const entry = (
    id: number,
    title: string,
    folder: string,
    tags: string[],
    category: LoreCategory = 'world'
  ): LoreEntry => ({
    id,
    title,
    summary: '',
    category,
    tags,
    folder,
    media: [],
    createdAt: '',
    updatedAt: '',
  });

  it('目录候选包含各级父目录并排序', () => {
    expect(
      collectLoreFolders([entry(1, 'a', '地理/北境/雪原', []), entry(2, 'b', '势力', [])])
    ).toEqual(['地理', '地理/北境', '地理/北境/雪原', '势力']);
  });

  it('相关设定：同目录 > 共享标签 > 同分类，排除自身与毫不相关的条目', () => {
    const self = entry(1, '雪原', '地理/北境', ['禁地']);
    const list = [
      self,
      entry(2, '寒潭', '地理/北境', []),
      entry(3, '古战场', '', ['禁地', '遗迹'], 'term'),
      entry(4, '王都', '地理', []),
      entry(5, '无关', '', [], 'system'),
    ];
    expect(relatedLoreEntries(self, list).map((item) => item.title)).toEqual([
      '寒潭',
      '古战场',
      '王都',
    ]);
  });
});
