import { describe, expect, it } from 'vitest';
import { formatChapterContent } from '../../src/render/utils/chapterFormatter';

describe('formatChapterContent', () => {
  it('会合并被硬换行拆开的正文段落并补全段首缩进', () => {
    const rawContent = ['第一段上半句', '第一段下半句', '', '第二段'].join('\n');
    const result = formatChapterContent(rawContent);

    expect(result.content).toBe(['　　第一段上半句第一段下半句', '', '　　第二段'].join('\n'));
    expect(result.mergedLineCount).toBe(1);
    expect(result.paragraphCount).toBe(2);
  });

  it('会保留章节标题与 markdown 结构行', () => {
    const rawContent = ['第1章 开端', '正文第一行', '正文第二行', '', '# 小节', '内容'].join('\n');
    const result = formatChapterContent(rawContent);

    expect(result.content).toBe(
      ['第1章 开端', '　　正文第一行正文第二行', '', '# 小节', '　　内容'].join('\n')
    );
  });

  it('会压缩多余空行并保持英文单词边界', () => {
    const rawContent = ['Hello', 'world', '', '', '中文', '换行'].join('\n');
    const result = formatChapterContent(rawContent);

    expect(result.content).toBe(['　　Hello world', '', '　　中文换行'].join('\n'));
    expect(result.collapsedBlankLineCount).toBe(1);
  });
});
