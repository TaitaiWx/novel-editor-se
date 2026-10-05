import {
  ACT_COLORS,
  INTENSITY_COLORS,
  INTENSITY_LABELS,
  LAYOUT_MODE_KEYS,
  LAYOUT_MODE_LABELS,
  LORE_CATEGORY_LABELS,
  PLOT_STATUS_LABELS,
  RELATION_TONE_LABELS,
  ROLE_COLORS,
  STRUCTURE_NODE_PRESETS,
  TAB_KEYS,
  TAB_LABELS,
} from '@/render/components/RightPanel/constants';

describe('RightPanel constants', () => {
  it('derives tab / layout keys from label maps in order', () => {
    expect(TAB_KEYS).toEqual(['storyline', 'characters', 'lore']);
    expect(TAB_KEYS.map((key) => TAB_LABELS[key])).toEqual(['故事线', '角色', '设定']);
    expect(LAYOUT_MODE_KEYS).toEqual(['board', 'timeline', 'causal']);
    expect(LAYOUT_MODE_LABELS.causal).toBe('因果链');
  });

  it('has one intensity colour and label per level 1-5', () => {
    expect(INTENSITY_COLORS).toHaveLength(5);
    expect(INTENSITY_LABELS).toHaveLength(5);
    expect(INTENSITY_LABELS[4]).toBe('高潮');
  });

  it('uses valid hex colours', () => {
    [...ACT_COLORS, ...Object.values(ROLE_COLORS)].forEach((color) => {
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
    expect(Object.keys(PLOT_STATUS_LABELS)).toEqual(['draft', 'ready', 'done']);
    expect(STRUCTURE_NODE_PRESETS[0]).toBe('引子');
    expect(new Set(STRUCTURE_NODE_PRESETS).size).toBe(STRUCTURE_NODE_PRESETS.length);
  });
});
