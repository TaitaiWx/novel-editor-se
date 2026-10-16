import { describe, expect, it } from 'vitest';
import {
  enrichmentBatches,
  parseEnrichment,
  parseEnrichmentResponse,
  type EnrichmentSection,
} from '../src/character-enrichment';
import { developmentEntries, type DevelopmentEntry } from '../src/character-development';

const person = { id: 7, name: '林舟' };
const at = '2026-10-11T00:00:00.000Z';
const ids = () => {
  let n = 0;
  return () => `draft:${++n}`;
};

describe('enrichment batches', () => {
  it.each<[EnrichmentSection, string[]]>([
    [
      'design',
      [
        'design:appearance',
        'design:outfit',
        'design:personality',
        'design:speech',
        'design:habits',
        'design:preferences',
        'design:weaknesses',
        'design:species',
        'design:health',
        'design:posture',
        'design:virtues',
        'design:lifestyle',
        'voice:gender',
        'voice:age',
        'voice:timbre',
      ],
    ],
    [
      'environment',
      [
        'design:environment',
        'design:background',
        'design:family',
        'design:education',
        'design:influences',
        'design:socialPosition',
        'design:relationships',
        'design:socialStyle',
        'design:intimacyStyle',
        'entry:identity',
      ],
    ],
    [
      'power',
      [
        'entry:strength',
        'entry:limitation',
        'entry:gift',
        'entry:cost',
        'entry:realm',
        'entry:skill',
        'entry:equipment',
        'entry:resource',
      ],
    ],
    [
      'plot',
      [
        'entry:selfImage',
        'entry:publicImage',
        'entry:needs',
        'entry:beliefs',
        'entry:contradiction',
        'entry:emotionalTriggers',
        'entry:coping',
        'entry:motivation',
        'entry:fear',
        'entry:values',
        'entry:circumstance',
        'entry:action',
        'entry:opposition',
        'entry:revelation',
        'entry:choice',
        'entry:role',
        'entry:goal',
        'entry:secret',
        'entry:foreshadow',
        'entry:payoff',
        'entry:arc',
      ],
    ],
  ])('%s covers every applicable field, including optional details, once', (section, want) => {
    const batches = enrichmentBatches(section);
    expect(batches.every((batch) => batch.length > 0 && batch.length <= 4)).toBe(true);
    expect(batches.flat().map((target) => `${target.type}:${target.key}`)).toEqual(want);
  });
});

describe('enrichment response boundary', () => {
  it('accepts fenced JSON with escaped multiline values', () => {
    expect(
      parseEnrichmentResponse(
        '```json\n{"design":{"speech":"第一句\\n第二句"},"voice":{},"entries":[]}\n```',
        'stop'
      )
    ).toEqual({ design: { speech: '第一句\n第二句' }, voice: {}, entries: [] });
  });

  it.each(['length', 'max_tokens'])(
    'rejects %s even when the prefix happens to be valid JSON',
    (reason) => {
      expect(() =>
        parseEnrichmentResponse('{"design":{},"voice":{},"entries":[]}', reason)
      ).toThrowError(expect.objectContaining({ kind: 'length' }));
    }
  );

  it.each([
    '{"design":{"appearance":"unfinished',
    '[]',
    '{"design":{},"entries":[]}',
    '{"design":{"health":null},"voice":{},"entries":[]}',
    '{"design":{},"voice":{"age":17},"entries":[]}',
    '{"design":{},"voice":{},"entries":[{"kind":"skill","name":"剑术"}]}',
  ])('rejects malformed or incomplete response: %s', (answer) => {
    expect(() => parseEnrichmentResponse(answer)).toThrowError(
      expect.objectContaining({ kind: 'format' })
    );
  });

  it('reports content filtering independently from invalid JSON', () => {
    expect(() => parseEnrichmentResponse('', 'content_filter')).toThrow(/内容限制/);
  });
});

describe('scoped enrichment drafts', () => {
  it('ignores output outside the current batch or page and trims accepted fields', () => {
    expect(
      parseEnrichment(
        {
          design: {
            health: ' 左膝旧伤 ',
            personality: '谨慎',
            background: '渔村',
            alienKey: '污染',
          },
          voice: { age: ' 17岁 ', gender: 'female', timbre: '沙哑' },
          entries: [{ kind: 'skill', name: '剑术', description: '熟练' }],
        },
        'design',
        person,
        ids(),
        at,
        [
          { type: 'design', key: 'health' },
          { type: 'voice', key: 'age' },
        ]
      )
    ).toEqual({ design: { health: '左膝旧伤' }, voice: { age: '17岁' }, development: {} });
  });

  it('rejects non-enumerated gender and non-text values, and caps large text fields', () => {
    const result = parseEnrichment(
      {
        design: { health: '伤'.repeat(900), species: 123, posture: '  ' },
        voice: { gender: 'robot', age: '长'.repeat(30), timbre: '低'.repeat(70) },
      },
      'design',
      person,
      ids(),
      at
    );
    expect(result.design).toEqual({ health: '伤'.repeat(800) });
    expect(result.voice).toEqual({ age: '长'.repeat(20), timbre: '低'.repeat(60) });
  });

  it('new entries remain creative plans despite model claims that they already happened', () => {
    const result = parseEnrichment(
      {
        entries: [
          {
            kind: 'skill',
            name: '  听风  ',
            description: ' 听出脚步方向 ',
            status: 'active',
            stage: '第二卷',
          },
          { kind: 'skill', name: '听风', description: '重复建议' },
          { kind: 'goal', name: '出海', description: '其他页内容' },
          { id: 'unknown', kind: 'equipment', name: '旧剑', description: '伪造旧条目' },
        ],
      },
      'power',
      person,
      ids(),
      at
    );
    expect(developmentEntries(result.development)).toEqual([
      {
        id: 'draft:1',
        kind: 'skill',
        name: '听风',
        description: '听出脚步方向',
        status: 'planned',
        stage: '第二卷',
        chapter: '',
        quote: '',
        relatedIds: [],
        growthEventId: '',
        events: [
          {
            id: 'draft:1',
            at,
            stage: '第二卷',
            status: 'planned',
            note: '听出脚步方向',
            chapter: '',
            quote: '',
            source: 'ai',
            growthEventId: '',
          },
        ],
      },
    ]);
  });

  it('updates the original entry id and preserves its full text, status, links and prior history', () => {
    const previous: DevelopmentEntry = {
      id: 'sword',
      kind: 'equipment',
      name: '旧剑',
      description: '师父赠送，剑柄有裂纹。',
      status: 'active',
      stage: '离乡',
      chapter: '第一章',
      quote: '师父递给他旧剑。',
      relatedIds: ['mentor'],
      growthEventId: 'growth:1',
      events: [
        {
          id: 'e0',
          at: 'earlier',
          stage: '离乡',
          status: 'active',
          note: '获得旧剑',
          chapter: '第一章',
          quote: '',
          source: 'manual',
          growthEventId: 'growth:1',
        },
      ],
    };
    const result = parseEnrichment(
      {
        entries: [
          {
            id: 'sword',
            kind: 'equipment',
            name: '模型改名',
            description: '师父赠送，剑柄有裂纹，可藏纸条。',
            status: 'retired',
          },
          { id: 'sword', kind: 'equipment', name: '重复', description: '不可覆盖前一条' },
        ],
      },
      'power',
      { ...person, development: { sword: JSON.stringify(previous) } },
      ids(),
      at
    );
    const [entry] = developmentEntries(result.development);
    expect(entry).toMatchObject({
      id: 'sword',
      name: '旧剑',
      status: 'active',
      stage: '离乡',
      relatedIds: ['mentor'],
      growthEventId: 'growth:1',
      description: '师父赠送，剑柄有裂纹，可藏纸条。',
    });
    expect(entry.events.map((event) => [event.note, event.source])).toEqual([
      ['师父赠送，剑柄有裂纹。', 'manual'],
      ['获得旧剑', 'manual'],
      ['师父赠送，剑柄有裂纹，可藏纸条。', 'ai'],
    ]);
    expect(previous.events).toHaveLength(1);
  });

  it('does not recreate a tombstoned legacy entry from an explicit model id', () => {
    expect(
      parseEnrichment(
        {
          entries: [{ id: 'legacy:identity', kind: 'identity', name: '铁匠', description: '学徒' }],
        },
        'environment',
        { ...person, development: { 'legacy:identity': '' } },
        ids(),
        at
      )
    ).toEqual({ design: {}, voice: {}, development: {} });
  });
});
