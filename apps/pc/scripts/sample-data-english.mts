/**
 * 示例作品集的第三部作品《Starbound》（英文短篇，2 章）：演示英文结构规则
 * （「Chapter 1: The Harbor」「Act I」「Scene 1 — …」）与英文人物的声音设置。
 * 正文与资料笔记是手写的（novels/Starbound/），这里只生成 seed.json 里属于它的人物 / 设定 / 章纲。
 */

/** 作品目录（相对项目根） */
export const ENGLISH_WORK_DIR = 'novels/Starbound';

export function buildEnglishSeedParts() {
  const characters = [
    {
      name: 'Mara Quill',
      role: 'Protagonist · navigator',
      description:
        "A harbor girl from Port Lumen who carries her father's compass. The needle points at the dark lighthouse, not north.",
      attributes: JSON.stringify({
        aliases: ['Mara'],
        category: 'major',
        highlightColor: '#9cdcfe',
        highlightFirstMentionOnly: true,
        voice: { gender: 'female', age: 'teen', timbre: 'bright, dry, quick' },
        currentState: [{ id: 'state-1', label: 'Carrying', value: "Her father's compass" }],
      }),
    },
    {
      name: 'Captain Ives',
      role: 'Captain of the Kestrel',
      description:
        'Sails a black-sailed sloop out of Port Lumen. Speaks rarely; never wastes a word.',
      attributes: JSON.stringify({
        aliases: ['Ives'],
        category: 'secondary',
        highlightColor: '#9cdcfe',
        highlightFirstMentionOnly: true,
        voice: { gender: 'male', age: 'middle-aged', timbre: 'low, gravelly, unhurried' },
        currentState: [],
      }),
    },
  ];
  const lore: Array<[string, string, string, string[]]> = [
    [
      'world',
      'Port Lumen',
      'A harbor city at the western edge of the map. Its lighthouse has been dark for thirty years.',
      ['place'],
    ],
  ];
  const outlines = [
    {
      id: 201,
      scope_kind: 'chapter',
      scope_path: `${ENGLISH_WORK_DIR}/001-The Harbor.md`,
      title: 'Scene 1 — The Pier at Dusk',
      content: 'Mara finds Captain Ives at the last berth.',
      anchor_text: 'Scene 1 — The Pier at Dusk',
      parent_id: null,
      sort_order: 0,
    },
    {
      id: 202,
      scope_kind: 'chapter',
      scope_path: `${ENGLISH_WORK_DIR}/001-The Harbor.md`,
      title: 'Scene 2 — The Bargain',
      content: 'The compass points at the lighthouse; Ives agrees to sail at midnight.',
      anchor_text: 'Scene 2 — The Bargain',
      parent_id: null,
      sort_order: 1,
    },
  ];
  return { characters, lore, outlines };
}
