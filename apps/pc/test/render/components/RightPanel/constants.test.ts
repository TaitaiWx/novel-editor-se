import {
  LORE_CATEGORY_LABELS,
  RELATION_TONE_LABELS,
  ROLE_COLORS,
  TAB_KEYS,
  TAB_LABELS,
} from '@/render/components/RightPanel/constants';

describe('RightPanel constants', () => {
  it('derives tab keys from label maps in order', () => {
    expect(TAB_KEYS).toEqual(['storyline', 'characters', 'lore']);
    expect(TAB_KEYS.map((key) => TAB_LABELS[key])).toEqual(['故事线', '角色', '设定']);
  });

  it('uses valid hex colours', () => {
    Object.values(ROLE_COLORS).forEach((color) => {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  it('covers all enum values with labels', () => {
    expect(Object.keys(LORE_CATEGORY_LABELS)).toEqual(['world', 'faction', 'system', 'term']);
    expect(Object.keys(RELATION_TONE_LABELS)).toEqual([
      'ally',
      'rival',
      'family',
      'mentor',
      'other',
    ]);
  });
});
