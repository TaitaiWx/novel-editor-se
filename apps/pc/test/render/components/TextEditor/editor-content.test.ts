import { describe, expect, it } from 'vitest';
import { serializeEditorContent } from '@/render/components/TextEditor/editor-content';

describe('serializeEditorContent', () => {
  it('defaults a new document to LF', () => {
    expect(serializeEditorContent('first\nsecond', '')).toBe('first\nsecond');
  });
  it('leaves an unchanged mixed-EOL document untouched', () => {
    const original = 'first\r\nsecond\nthird\rfourth';
    expect(serializeEditorContent('first\nsecond\nthird\nfourth', original)).toBe(original);
  });
  it.each(['\r\n', '\n', '\r'])(
    'uses the first separator %j after editing a mixed-EOL document',
    (first) => {
      const original = `first${first}second\rthird\nfourth`;
      expect(serializeEditorContent('first\nsecond\nthird\nfourth\nnew', original)).toBe(
        ['first', 'second', 'third', 'fourth', 'new'].join(first)
      );
    }
  );
});
