import { expect, it, vi } from 'vitest';
import JSZip from 'jszip';

const loading = vi.hoisted(() => ({ docx: 0 }));
vi.mock('docx', async (original) => {
  loading.docx += 1;
  return original();
});

it('keeps Word out of text conversion and loads it only when generating a valid Word document', async () => {
  const { convertText, buildDocx } = await import('../src/export');
  expect(convertText('# Heading\n\nBody', 'md', 'txt')).toBe('Heading\n\nBody');
  expect(loading.docx).toBe(0);

  const buffer = await buildDocx(
    [{ title: 'Chapter', content: 'Written words', format: 'txt' }],
    'Book'
  );
  const document = await JSZip.loadAsync(buffer);
  const xml = await document.file('word/document.xml')!.async('string');
  expect(xml).toContain('Book');
  expect(xml).toContain('Chapter');
  expect(xml).toContain('Written words');
  expect(loading.docx).toBe(1);
});
