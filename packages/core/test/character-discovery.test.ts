import { describe, expect, it } from 'vitest';
import {
  normalizeCharacterName,
  parseAiJson,
  parseProfileCandidates,
} from '../src/character-discovery';
import { parseCharacterDesign } from '../src/entity-media';

const source = '林舟也叫小舟，左眉留着一道浅疤。苏晴从星港来，背着蓝色行囊。';
const roster = [
  { id: 7, name: '林舟', aliases: ['小舟'], design: parseCharacterDesign({ appearance: '黑发' }) },
];
const existing = {
  characterId: 7,
  name: '林舟',
  summary: '眉间有疤',
  quote: '林舟也叫小舟，左眉留着一道浅疤。',
  fields: [{ key: 'appearance', value: '黑发，左眉有浅疤', quote: '左眉留着一道浅疤' }],
};

describe('character discovery evidence', () => {
  it('keeps only new supported profile fields and leaves psychology to development records', () => {
    expect(
      parseProfileCandidates(
        [
          {
            ...existing,
            fields: [
              ...existing.fields,
              { key: 'appearance', value: '重复外貌', quote: '左眉留着一道浅疤' },
              { key: 'health', value: '缺乏证据', quote: '有不可治愈的疾病' },
              { key: 'personality', value: '谨慎', quote: '林舟' },
              { key: 'beliefs', value: '信任同伴', quote: '左眉留着一道浅疤' },
              { key: 'unknown', value: '污染', quote: '左眉留着一道浅疤' },
            ],
          },
        ],
        source,
        roster
      )
    ).toEqual([existing]);
  });

  it('ignores unchanged fields, empty values and unsupported people or mismatched names', () => {
    expect(
      parseProfileCandidates(
        [
          { ...existing, fields: [{ ...existing.fields[0], value: ' 黑发 ' }] },
          { ...existing, fields: [{ ...existing.fields[0], value: ' ' }] },
          { ...existing, characterId: 999 },
          { ...existing, name: '苏晴' },
          { ...existing, quote: '不在正文中的一句话' },
        ],
        source,
        roster
      )
    ).toEqual([]);
  });

  it('requires an existing character or alias to actually occur in the source', () => {
    expect(
      parseProfileCandidates(
        [{ ...existing, quote: '左眉留着一道浅疤。' }],
        '另一位旅人左眉留着一道浅疤。',
        roster
      )
    ).toEqual([]);
  });

  it('resolves a new candidate matching an alias to the canonical person and deduplicates it', () => {
    expect(
      parseProfileCandidates(
        [{ ...existing, characterId: null, name: '小舟' }, existing],
        source,
        roster
      )
    ).toEqual([existing]);
  });

  it('does not guess between characters sharing an alias', () => {
    expect(
      parseProfileCandidates([{ ...existing, characterId: null, name: '小舟' }], source, [
        ...roster,
        { id: 8, name: '周舟', aliases: ['小舟'] },
      ])
    ).toEqual([]);
  });

  it('allows an evidenced new minor character with no fields and rejects names absent from the source', () => {
    expect(
      parseProfileCandidates(
        [
          {
            characterId: null,
            name: '苏晴',
            summary: '来自星港',
            quote: '苏晴从星港来',
            fields: [],
          },
          {
            characterId: null,
            name: '无名刺客',
            summary: '凭空生成',
            quote: '苏晴从星港来',
            fields: [],
          },
        ],
        source,
        roster
      )
    ).toEqual([
      { characterId: null, name: '苏晴', summary: '来自星港', quote: '苏晴从星港来', fields: [] },
    ]);
  });

  it('normalizes compatibility forms and case when matching names', () => {
    expect(normalizeCharacterName(' ＡＬＩＣＥ ')).toBe('alice');
    expect(
      parseProfileCandidates(
        [
          {
            characterId: null,
            name: 'ＡＬＩＣＥ',
            summary: '',
            quote: 'ＡＬＩＣＥ穿着蓝外套',
            fields: [{ key: 'outfit', value: '蓝外套', quote: '穿着蓝外套' }],
          },
        ],
        'ＡＬＩＣＥ穿着蓝外套',
        [{ id: 9, name: 'Alice', aliases: ['ＡＬＩＣＥ'] }]
      )
    ).toMatchObject([
      { characterId: 9, name: 'Alice', fields: [{ key: 'outfit', value: '蓝外套' }] },
    ]);
  });

  it('creative ideas may omit evidence for an existing person, but cannot invent new people', () => {
    expect(
      parseProfileCandidates(
        [
          {
            ...existing,
            quote: '模型虚构的引用',
            fields: [{ key: 'family', value: ' 由师父抚养 ', quote: '虚构的引用' }],
          },
          { characterId: null, name: '新人物', fields: [{ key: 'family', value: '孤儿' }] },
        ],
        '',
        roster,
        true
      )
    ).toEqual([
      {
        characterId: 7,
        name: '林舟',
        summary: '眉间有疤',
        quote: '',
        fields: [{ key: 'family', value: '由师父抚养', quote: '' }],
      },
    ]);
  });

  it('preserves source-supported optional fields across physical, social and background dimensions', () => {
    const detail = '林舟身体健康，站姿挺直，出身匠户，师父教他识字，与人争执后总会主动解释。';
    expect(
      parseProfileCandidates(
        [
          {
            ...existing,
            quote: detail,
            fields: [
              { key: 'health', value: '身体健康', quote: '林舟身体健康' },
              { key: 'posture', value: '站姿挺直', quote: '站姿挺直' },
              { key: 'family', value: '出身匠户', quote: '出身匠户' },
              { key: 'education', value: '师父教他识字', quote: '师父教他识字' },
              { key: 'intimacyStyle', value: '争执后主动解释', quote: '与人争执后总会主动解释' },
            ],
          },
        ],
        detail,
        roster
      )[0].fields
    ).toEqual([
      { key: 'health', value: '身体健康', quote: '林舟身体健康' },
      { key: 'posture', value: '站姿挺直', quote: '站姿挺直' },
      { key: 'family', value: '出身匠户', quote: '出身匠户' },
      { key: 'education', value: '师父教他识字', quote: '师父教他识字' },
      { key: 'intimacyStyle', value: '争执后主动解释', quote: '与人争执后总会主动解释' },
    ]);
  });

  it('rejects invalid response envelopes and truncated JSON without recovering partial facts', () => {
    expect(() => parseProfileCandidates({}, source, roster)).toThrow();
    expect(() => parseAiJson('[{"name":"苏晴"')).toThrow(SyntaxError);
    expect(parseAiJson('```JSON\n{"characters":[]}\n```')).toEqual({ characters: [] });
  });
});
