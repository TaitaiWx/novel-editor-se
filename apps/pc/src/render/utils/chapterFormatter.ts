export interface ChapterFormatResult {
  content: string;
  changed: boolean;
  paragraphCount: number;
  mergedLineCount: number;
  collapsedBlankLineCount: number;
}

const FULL_WIDTH_INDENT = '　　';

function isBlankLine(line: string): boolean {
  return line.trim().length === 0;
}

function isAsciiWordBoundary(left: string, right: string): boolean {
  return /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right);
}

function isStructuralLine(trimmedLine: string): boolean {
  return (
    trimmedLine.startsWith('#') ||
    trimmedLine.startsWith('>') ||
    trimmedLine.startsWith('|') ||
    trimmedLine.startsWith('- ') ||
    trimmedLine.startsWith('* ') ||
    trimmedLine.startsWith('+ ') ||
    /^```/.test(trimmedLine) ||
    /^-{3,}$/.test(trimmedLine) ||
    /^\d+[.)、]/.test(trimmedLine) ||
    /^第[0-9零一二三四五六七八九十百千万两〇]+[章节卷部幕篇回集]/.test(trimmedLine) ||
    /^【[^】]+】$/.test(trimmedLine)
  );
}

function normalizeLineContent(line: string): string {
  return line.replace(/^[\s\u3000]+/, '').replace(/[ \t\u3000]+$/, '');
}

function mergeParagraphLines(lines: string[]): string {
  if (lines.length === 0) return '';
  return lines.reduce((merged, current, index) => {
    if (index === 0) return current;
    return isAsciiWordBoundary(merged, current) ? `${merged} ${current}` : `${merged}${current}`;
  }, '');
}

export function formatChapterContent(rawContent: string): ChapterFormatResult {
  const normalizedContent = rawContent.replace(/\r\n?/g, '\n');
  const sourceLines = normalizedContent.split('\n');
  const blocks: string[] = [];
  const paragraphBuffer: string[] = [];
  let inCodeFence = false;
  let paragraphCount = 0;
  let mergedLineCount = 0;
  let collapsedBlankLineCount = 0;

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) return;
    paragraphCount += 1;
    if (paragraphBuffer.length > 1) {
      mergedLineCount += paragraphBuffer.length - 1;
    }
    blocks.push(`${FULL_WIDTH_INDENT}${mergeParagraphLines(paragraphBuffer)}`);
    paragraphBuffer.length = 0;
  };

  for (const sourceLine of sourceLines) {
    const trimmedRight = sourceLine.replace(/[ \t\u3000]+$/, '');
    const trimmedLine = trimmedRight.trim();

    if (/^```/.test(trimmedLine)) {
      flushParagraph();
      inCodeFence = !inCodeFence;
      blocks.push(trimmedLine);
      continue;
    }

    if (inCodeFence) {
      blocks.push(trimmedRight);
      continue;
    }

    if (isBlankLine(trimmedRight)) {
      flushParagraph();
      if (blocks.length > 0 && blocks[blocks.length - 1] !== '') {
        blocks.push('');
      } else if (blocks.length > 0) {
        collapsedBlankLineCount += 1;
      }
      continue;
    }

    if (isStructuralLine(trimmedLine)) {
      flushParagraph();
      blocks.push(trimmedLine);
      continue;
    }

    paragraphBuffer.push(normalizeLineContent(trimmedRight));
  }

  flushParagraph();

  while (blocks[0] === '') {
    blocks.shift();
    collapsedBlankLineCount += 1;
  }
  while (blocks[blocks.length - 1] === '') {
    blocks.pop();
    collapsedBlankLineCount += 1;
  }

  const formattedContent = blocks.join('\n');
  return {
    content: formattedContent,
    changed: formattedContent !== rawContent,
    paragraphCount,
    mergedLineCount,
    collapsedBlankLineCount,
  };
}
