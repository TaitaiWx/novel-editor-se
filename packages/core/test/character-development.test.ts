import { describe, expect, it } from 'vitest';
import {
  candidateEntry,
  describeDevelopment,
  developmentEntries,
  developmentHistory,
  identityEntryName,
  parseDevelopmentCandidates,
  parseDevelopmentEntry,
  parseDevelopmentMap,
  type DevelopmentCandidate,
  type DevelopmentEntry,
} from '../src/character-development';

const at = '2026-10-11T00:00:00.000Z';
const oldEntry = (patch: Partial<DevelopmentEntry> = {}): DevelopmentEntry => ({
  id: 'belief',
  kind: 'beliefs',
  name: '只靠自己',
  description: '不愿接受任何人的帮助。',
  stage: '离乡',
  status: 'active',
  chapter: '第一章',
  quote: '我从不求人。',
  relatedIds: ['mentor'],
  growthEventId: 'growth:1',
  events: [],
  ...patch,
});
const candidate = (patch: Partial<DevelopmentCandidate> = {}): DevelopmentCandidate => ({
  characterId: 7,
  kind: 'beliefs',
  name: '模型的新名称',
  detail: '开始相信同伴可以共同承担。',
  stage: '',
  status: 'active',
  quote: '这一次，我愿意相信你们。',
  ...patch,
});

describe('development storage and legacy migration', () => {
  it('preserves tombstones and unknown serialized records but rejects invalid keys or values', () => {
    expect(
      parseDevelopmentMap({
        'legacy:beliefs': '',
        future: '{"kind":"future-kind"}',
        'bad/id': '{}',
        numeric: 42,
      })
    ).toEqual({ 'legacy:beliefs': '', future: '{"kind":"future-kind"}' });
    expect(parseDevelopmentMap([])).toEqual({});
  });

  it('migrates legacy identity and psychology descriptions without reviving deleted entries', () => {
    const entries = developmentEntries(
      { 'legacy:beliefs': '' },
      {
        identity: ' 铁匠学徒，替师父接零活\n每晚练习修补 ',
        selfImage: '没人需要我：总是独来独往',
        beliefs: '相信承诺',
      }
    );
    expect(
      entries.map(({ id, name, kind, description, status, events }) => ({
        id,
        name,
        kind,
        description,
        status,
        events,
      }))
    ).toEqual([
      {
        id: 'legacy:identity',
        name: '铁匠学徒',
        kind: 'identity',
        description: ' 铁匠学徒，替师父接零活\n每晚练习修补 ',
        status: 'planned',
        events: [],
      },
      {
        id: 'legacy:selfImage',
        name: '没人需要我',
        kind: 'selfImage',
        description: '没人需要我：总是独来独往',
        status: 'planned',
        events: [],
      },
    ]);
  });

  it('hides malformed, mismatched and unknown stored entries without changing the source map', () => {
    const map = {
      broken: '{',
      mismatch: JSON.stringify(oldEntry()),
      future: '{"id":"future","kind":"not-yet-supported","name":"未来"}',
      belief: JSON.stringify(oldEntry()),
    };
    expect(developmentEntries(map).map((entry) => entry.id)).toEqual(['belief']);
    expect(map.broken).toBe('{');
    expect(map.future).toContain('not-yet-supported');
  });

  it.each([
    '守信，源于师父',
    '守信,源于师父',
    '守信。源于师父',
    '守信;源于师父',
    '守信；源于师父',
    '守信:源于师父',
    '守信：源于师父',
    '守信\n源于师父',
  ])('uses only the leading phrase for a legacy tag: %s', (description) => {
    expect(identityEntryName(description)).toBe('守信');
  });

  it('normalizes entry metadata, deduplicates links, and retains multiline history', () => {
    expect(
      parseDevelopmentEntry({
        id: 'entry:1',
        kind: 'coping',
        name: '  忙碌  ',
        description: '先沉默\n再做事',
        stage: ' 危机 ',
        status: 'unknown',
        relatedIds: ['mentor', 'mentor', '../escape', 5],
        events: [null, { id: 'e1', note: '沉默\n整理工具', source: 'ai', status: 'retired' }],
      })
    ).toEqual({
      id: 'entry:1',
      kind: 'coping',
      name: '忙碌',
      description: '先沉默\n再做事',
      stage: '危机',
      status: 'planned',
      chapter: '',
      quote: '',
      relatedIds: ['mentor'],
      growthEventId: '',
      events: [
        {
          id: 'e1',
          at: '',
          stage: '',
          status: 'retired',
          note: '沉默\n整理工具',
          chapter: '',
          quote: '',
          source: 'ai',
          growthEventId: '',
        },
      ],
    });
  });

  it.each([
    null,
    [],
    { id: '../bad', kind: 'skill', name: '剑' },
    { id: 'a', kind: 'unknown', name: '剑' },
    { id: 'a', kind: 'skill', name: ' ' },
  ])('rejects invalid stored entry %j', (raw) => {
    expect(parseDevelopmentEntry(raw)).toBeNull();
  });
});

describe('development updates and history', () => {
  it('snapshots legacy psychology before replacing the current belief and preserves identity and links', () => {
    const previous = oldEntry();
    const next = candidateEntry(candidate(), previous, '第二章', 'event:1', at);
    expect(next).toMatchObject({
      id: 'belief',
      name: '只靠自己',
      description: '开始相信同伴可以共同承担。',
      stage: '离乡',
      chapter: '第二章',
      relatedIds: ['mentor'],
      growthEventId: 'growth:1',
    });
    expect(next.events).toEqual([
      {
        id: 'event:1:initial',
        at,
        stage: '离乡',
        status: 'active',
        note: '不愿接受任何人的帮助。',
        chapter: '第一章',
        quote: '我从不求人。',
        source: 'manual',
        growthEventId: 'growth:1',
      },
      {
        id: 'event:1',
        at,
        stage: '离乡',
        status: 'active',
        note: '开始相信同伴可以共同承担。',
        chapter: '第二章',
        quote: '这一次，我愿意相信你们。',
        source: 'ai',
        growthEventId: '',
      },
    ]);
    expect(previous.description).toBe('不愿接受任何人的帮助。');
    expect(previous.events).toEqual([]);
  });

  it('records subsequent stages without adding a second initial snapshot', () => {
    const first = candidateEntry(candidate(), oldEntry(), '第二章', 'event:1', at);
    const next = candidateEntry(
      candidate({ detail: '愿意主动求助。', stage: '归来' }),
      first,
      '第三章',
      'event:2',
      at
    );
    expect(next.events.map((event) => [event.id, event.stage, event.note])).toEqual([
      ['event:1:initial', '离乡', '不愿接受任何人的帮助。'],
      ['event:1', '离乡', '开始相信同伴可以共同承担。'],
      ['event:2', '归来', '愿意主动求助。'],
    ]);
    expect(next.description).toBe('愿意主动求助。');
    expect(first.events).toHaveLength(2);
  });

  it('retiring equipment preserves its established description while appending the loss event', () => {
    const previous = oldEntry({
      id: 'sword',
      kind: 'equipment',
      name: '旧剑',
      description: '师父赠送的旧剑。',
    });
    const next = candidateEntry(
      candidate({ kind: 'equipment', detail: '将旧剑归还师父。', status: 'retired' }),
      previous,
      '终章',
      'event:2',
      at
    );
    expect(next.description).toBe('师父赠送的旧剑。');
    expect(next.status).toBe('retired');
    expect(next.events.map((event) => event.note)).toEqual(['将旧剑归还师父。']);
    expect(describeDevelopment({ sword: JSON.stringify(next) })).toContain(
      '师父赠送的旧剑。；最近变化：将旧剑归还师父。'
    );
  });

  it('snapshots identity labels and does not invent history for a new entry', () => {
    expect(developmentHistory(undefined, 'e', at)).toEqual([]);
    expect(developmentHistory(oldEntry({ kind: 'identity' }), 'e', at)).toMatchObject([
      { id: 'e', source: 'manual', note: '不愿接受任何人的帮助。', chapter: '第一章' },
    ]);
    const next = candidateEntry(
      candidate({ kind: 'needs', name: '归属感' }),
      undefined,
      '第一章',
      'new:1',
      at
    );
    expect(next.id).toBe('new:1');
    expect(next.name).toBe('归属感');
    expect(next.events).toHaveLength(1);
  });
});

describe('development evidence extraction', () => {
  const source = '林舟说：“这一次，我愿意相信你们。”他将旧剑归还师父。';
  const raw = {
    characterId: 7,
    kind: 'beliefs',
    name: '信任',
    detail: '开始信任同伴',
    status: 'active',
    quote: '这一次，我愿意相信你们。',
    stage: ' 重逢 ',
  };

  it('keeps supported changes and removes duplicates, unknown people, kinds, statuses and fabricated evidence', () => {
    const result = parseDevelopmentCandidates(
      `\`\`\`json\n${JSON.stringify([
        raw,
        raw,
        { ...raw, characterId: 99 },
        { ...raw, kind: 'invented' },
        { ...raw, status: 'invented' },
        { ...raw, quote: '他获得了新的神力。' },
        { ...raw, quote: '林舟' },
        { ...raw, detail: '  ' },
      ])}\n\`\`\``,
      source,
      [7]
    );
    expect(result).toEqual([
      {
        characterId: 7,
        kind: 'beliefs',
        name: '信任',
        detail: '开始信任同伴',
        status: 'active',
        quote: '这一次，我愿意相信你们。',
        stage: '重逢',
      },
    ]);
  });

  it('bounds accepted suggestions to thirty and rejects a non-array response', () => {
    expect(
      parseDevelopmentCandidates(
        JSON.stringify(
          Array.from({ length: 35 }, (_, index) => ({ ...raw, name: `信任${index}` }))
        ),
        source,
        [7]
      )
    ).toHaveLength(30);
    expect(() => parseDevelopmentCandidates('{}', source, [7])).toThrow();
  });
});
