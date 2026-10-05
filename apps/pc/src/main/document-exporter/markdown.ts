/** Markdown 解析：将 Markdown 文本解析为结构化节点，供 Word / PPT 导出使用 */

export interface TextSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  link?: string; // 超链接地址
}

export interface MarkdownNode {
  type:
    | 'heading'
    | 'paragraph'
    | 'table'
    | 'list'
    | 'ordered-list'
    | 'hr'
    | 'code-block'
    | 'blockquote';
  level?: number;
  segments?: TextSegment[];
  rows?: string[][];
  items?: TextSegment[][];
  language?: string; // 代码块语言
  text?: string; // 代码块原始文本
}

/** 解析行内格式（加粗、斜体、删除线、链接） */
export function parseInlineFormatting(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  // 匹配：[link](url)、***bold+italic***、**bold**、*italic*、~~strike~~
  const regex = /(\[([^\]]+)\]\(([^)]+)\)|\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|~~(.+?)~~)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index) });
    }
    if (match[2] && match[3]) {
      // [text](url)
      segments.push({ text: match[2], link: match[3] });
    } else if (match[4]) {
      segments.push({ text: match[4], bold: true, italic: true });
    } else if (match[5]) {
      segments.push({ text: match[5], bold: true });
    } else if (match[6]) {
      segments.push({ text: match[6], italic: true });
    } else if (match[7]) {
      segments.push({ text: match[7], strike: true });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex) });
  }
  if (segments.length === 0) {
    segments.push({ text });
  }
  return segments;
}

/** 解析 Markdown 表格行 */
export function parseTableRow(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
  const clean = inner.endsWith('|') ? inner.slice(0, -1) : inner;
  return clean.split('|').map((cell) => cell.trim());
}

/** 将 Markdown 文本解析为结构化节点 */
export function parseMarkdown(content: string): MarkdownNode[] {
  const lines = content.split('\n');
  const nodes: MarkdownNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行
    if (line.trim() === '') {
      i++;
      continue;
    }

    // 标题
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      nodes.push({
        type: 'heading',
        level: headingMatch[1].length,
        segments: parseInlineFormatting(headingMatch[2]),
      });
      i++;
      continue;
    }

    // 水平线
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      nodes.push({ type: 'hr' });
      i++;
      continue;
    }

    // 围栏代码块 ```
    if (line.trim().startsWith('```')) {
      const langMatch = line.trim().match(/^```(\w*)$/);
      const language = langMatch?.[1] || '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // 跳过结束 ```
      nodes.push({ type: 'code-block', text: codeLines.join('\n'), language });
      continue;
    }

    // 块引用 >
    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      nodes.push({ type: 'blockquote', segments: parseInlineFormatting(quoteLines.join('\n')) });
      continue;
    }

    // 表格（至少两行：表头 + 分隔符）
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const rows: string[][] = [];
      rows.push(parseTableRow(line));
      i += 2; // 跳过分隔行
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      nodes.push({ type: 'table', rows });
      continue;
    }

    // 无序列表
    if (/^[\s]*[-*+]\s+/.test(line)) {
      const items: TextSegment[][] = [];
      while (i < lines.length && /^[\s]*[-*+]\s+/.test(lines[i])) {
        items.push(parseInlineFormatting(lines[i].replace(/^[\s]*[-*+]\s+/, '')));
        i++;
      }
      nodes.push({ type: 'list', items });
      continue;
    }

    // 有序列表
    if (/^[\s]*\d+\.\s+/.test(line)) {
      const items: TextSegment[][] = [];
      while (i < lines.length && /^[\s]*\d+\.\s+/.test(lines[i])) {
        items.push(parseInlineFormatting(lines[i].replace(/^[\s]*\d+\.\s+/, '')));
        i++;
      }
      nodes.push({ type: 'ordered-list', items });
      continue;
    }

    // 普通段落（收集连续非空行）
    let paraText = '';
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].match(/^[\s]*[-*+]\s/) &&
      !lines[i].match(/^[\s]*\d+\.\s/) &&
      !lines[i].trim().startsWith('```') &&
      !/^>\s?/.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && /^\s*\|[\s:|-]+\|/.test(lines[i + 1]))
    ) {
      if (paraText) paraText += '\n';
      paraText += lines[i];
      i++;
    }
    if (paraText) {
      nodes.push({ type: 'paragraph', segments: parseInlineFormatting(paraText) });
    }
  }

  return nodes;
}

/** 将行内片段拼接为纯文本 */
export function segmentsToText(segments: TextSegment[] | undefined): string {
  return (segments ?? []).map((s) => s.text).join('');
}
