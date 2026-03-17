/**
 * 文档导出模块：将 Markdown 内容导出为 Word (.docx) 和 PPT (.pptx)
 *
 * 业界标准库：
 * - docx (npm) — 成熟的 Word 文档生成库，支持表格、目录、样式
 * - pptxgenjs (npm) — 成熟的 PowerPoint 生成库，支持背景、动画、母版
 */

import { dialog } from 'electron';
import { writeFile } from 'fs/promises';
import { readdir, readFile as fsReadFile } from 'fs/promises';
import path from 'path';

// ─── Markdown 解析 ─────────────────────────────────────────────────────────

interface TextSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  link?: string; // href for hyperlinks
}

interface MarkdownNode {
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
  language?: string; // for code-block
  text?: string; // raw text for code-block
}

/** 解析行内格式（加粗、斜体、删除线、链接） */
function parseInlineFormatting(text: string): TextSegment[] {
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
function parseTableRow(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
  const clean = inner.endsWith('|') ? inner.slice(0, -1) : inner;
  return clean.split('|').map((cell) => cell.trim());
}

/** 将 Markdown 文本解析为结构化节点 */
function parseMarkdown(content: string): MarkdownNode[] {
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

// ─── Word 导出 ──────────────────────────────────────────────────────────────

export interface WordExportOptions {
  title?: string;
  author?: string;
}

export async function exportToWord(
  content: string,
  options: WordExportOptions = {}
): Promise<string | null> {
  const docx = await import('docx');
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    Table,
    TableRow,
    TableCell,
    WidthType,
    HeadingLevel,
    AlignmentType,
    BorderStyle,
    TableOfContents,
    Header,
    Footer,
    PageNumber,
    PageBreak,
    ShadingType,
    ExternalHyperlink,
    LevelFormat,
  } = docx;

  const nodes = parseMarkdown(content);
  const title = options.title || '文档';

  // ─── Word 内置列表样式定义 ─────────
  const numbering = {
    config: [
      {
        reference: 'bullet-list',
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: '\u2022',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          },
        ],
      },
      {
        reference: 'ordered-list',
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: '%1.',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          },
        ],
      },
    ],
  };

  /** 将 TextSegment 转为 Word TextRun（支持超链接、删除线） */
  const segmentsToRuns = (segs: TextSegment[], sizePt = 22, fontFace = 'Microsoft YaHei') => {
    return segs.flatMap((seg) => {
      const runProps = {
        text: seg.text,
        bold: seg.bold,
        italics: seg.italic,
        strike: seg.strike,
        size: sizePt,
        font: fontFace,
      };

      if (seg.link) {
        return [
          new ExternalHyperlink({
            children: [
              new TextRun({
                ...runProps,
                style: 'Hyperlink',
                color: '0563C1',
                underline: { type: 'single' as any },
              }),
            ],
            link: seg.link,
          }),
        ] as any[];
      }
      return [new TextRun(runProps)];
    });
  };

  // ─── 构建文档内容 ─────────────────
  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [];

  // 封面标题
  children.push(
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 56, font: 'Microsoft YaHei' })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 3000, after: 400 },
    })
  );
  if (options.author) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: options.author, size: 24, color: '666666', font: 'Microsoft YaHei' }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
      })
    );
  }

  // 分页 + 目录
  children.push(
    new Paragraph({
      children: [new PageBreak()],
    })
  );
  children.push(
    new Paragraph({
      children: [new TextRun({ text: '目录', bold: true, size: 36, font: 'Microsoft YaHei' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  );
  children.push(
    new TableOfContents('目录', {
      hyperlink: true,
      headingStyleRange: '1-3',
    })
  );

  // 分页后开始正文
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // 转换各节点
  const headingLevelMap: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
    4: HeadingLevel.HEADING_4,
    5: HeadingLevel.HEADING_5,
    6: HeadingLevel.HEADING_6,
  };

  for (const node of nodes) {
    switch (node.type) {
      case 'heading': {
        const level = node.level ?? 1;
        children.push(
          new Paragraph({
            heading: headingLevelMap[level] ?? HeadingLevel.HEADING_4,
            children: segmentsToRuns(node.segments ?? [], level === 1 ? 36 : level === 2 ? 28 : 24),
            spacing: { before: level === 1 ? 400 : 240, after: 120 },
            pageBreakBefore: level === 1, // H1 自动分页（章节）
          })
        );
        break;
      }

      case 'paragraph': {
        children.push(
          new Paragraph({
            children: segmentsToRuns(node.segments ?? []),
            spacing: { after: 120, line: 360 },
            indent: { firstLine: 420 }, // 段首缩进两字符
          })
        );
        break;
      }

      case 'table': {
        if (!node.rows || node.rows.length === 0) break;
        const colCount = node.rows[0].length;

        // 标准表格边框
        const tableBorder = {
          style: BorderStyle.SINGLE,
          size: 1,
          color: 'BFBFBF',
        };
        const cellBorders = {
          top: tableBorder,
          bottom: tableBorder,
          left: tableBorder,
          right: tableBorder,
        };

        const tableRows = node.rows.map(
          (row, rowIndex) =>
            new TableRow({
              tableHeader: rowIndex === 0,
              children: row.map(
                (cell) =>
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: cell,
                            bold: rowIndex === 0,
                            size: 20,
                            font: 'Microsoft YaHei',
                            color: rowIndex === 0 ? 'FFFFFF' : '333333',
                          }),
                        ],
                        alignment: rowIndex === 0 ? AlignmentType.CENTER : AlignmentType.LEFT,
                        spacing: { before: 60, after: 60 },
                      }),
                    ],
                    shading:
                      rowIndex === 0
                        ? { type: ShadingType.SOLID, color: '4472C4', fill: '4472C4' }
                        : rowIndex % 2 === 0
                          ? { type: ShadingType.SOLID, color: 'D9E2F3', fill: 'D9E2F3' }
                          : undefined,
                    borders: cellBorders,
                    width: { size: Math.floor(9000 / colCount), type: WidthType.DXA },
                    verticalAlign: 'center' as any,
                  })
              ),
            })
        );

        children.push(
          new Table({
            rows: tableRows,
            width: { size: 9000, type: WidthType.DXA },
          })
        );
        // 表后间距
        children.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
        break;
      }

      case 'list': {
        (node.items ?? []).forEach((itemSegments) => {
          children.push(
            new Paragraph({
              children: segmentsToRuns(itemSegments),
              spacing: { after: 60 },
              numbering: { reference: 'bullet-list', level: 0 },
            })
          );
        });
        break;
      }

      case 'ordered-list': {
        (node.items ?? []).forEach((itemSegments) => {
          children.push(
            new Paragraph({
              children: segmentsToRuns(itemSegments),
              spacing: { after: 60 },
              numbering: { reference: 'ordered-list', level: 0 },
            })
          );
        });
        break;
      }

      case 'code-block': {
        // 代码块：等宽字体 + 灰色背景 + 左边框
        const codeLines = (node.text ?? '').split('\n');
        for (const codeLine of codeLines) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: codeLine || ' ', // 空行保留空格占位
                  font: 'Consolas',
                  size: 19,
                  color: '2D2D2D',
                }),
              ],
              shading: { type: ShadingType.SOLID, color: 'F5F5F5', fill: 'F5F5F5' },
              border: {
                left: { style: BorderStyle.SINGLE, size: 8, color: '4472C4' },
              },
              spacing: { after: 0, line: 276 },
              indent: { left: 240 },
            })
          );
        }
        children.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
        break;
      }

      case 'blockquote': {
        children.push(
          new Paragraph({
            children: segmentsToRuns(node.segments ?? [], 22),
            shading: { type: ShadingType.SOLID, color: 'F9F9F9', fill: 'F9F9F9' },
            border: {
              left: { style: BorderStyle.SINGLE, size: 12, color: 'CCCCCC' },
            },
            spacing: { before: 120, after: 120, line: 360 },
            indent: { left: 480 },
          })
        );
        break;
      }

      case 'hr': {
        children.push(
          new Paragraph({
            children: [],
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' },
            },
            spacing: { before: 200, after: 200 },
          })
        );
        break;
      }
    }
  }

  // ─── 组装文档 ─────────────────────
  const doc = new Document({
    features: { updateFields: true },
    creator: options.author || 'Novel Editor',
    title,
    numbering,
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: title, size: 18, color: '999999', font: 'Microsoft YaHei' }),
                ],
                alignment: AlignmentType.RIGHT,
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: '第 ', size: 18, color: '999999' }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '999999' }),
                  new TextRun({ text: ' 页', size: 18, color: '999999' }),
                ],
                alignment: AlignmentType.CENTER,
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);

  // ─── 保存对话框 ─────────────────────
  const result = await dialog.showSaveDialog({
    title: '导出为 Word',
    defaultPath: `${title}.docx`,
    filters: [{ name: 'Word 文档', extensions: ['docx'] }],
  });
  if (result.canceled || !result.filePath) return null;

  await writeFile(result.filePath, buffer);
  return result.filePath;
}

// ─── 项目导出（整个文件夹 → 单个 Word） ────────────────────────────────────

export async function exportProjectToWord(
  folderPath: string,
  options: WordExportOptions = {}
): Promise<string | null> {
  // 递归收集所有 .md / .txt 文件并按名称排序
  const textFiles: string[] = [];
  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // 跳过隐藏目录和 node_modules
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          await walk(fullPath);
        }
      } else if (/\.(md|txt)$/i.test(entry.name)) {
        textFiles.push(fullPath);
      }
    }
  }
  await walk(folderPath);
  textFiles.sort((a, b) => a.localeCompare(b, 'zh-CN'));

  if (textFiles.length === 0) return null;

  const contents: string[] = [];
  for (const filePath of textFiles) {
    const text = await fsReadFile(filePath, 'utf-8');
    contents.push(text);
  }

  const merged = contents.join('\n\n---\n\n');
  const title = options.title || path.basename(folderPath);
  return exportToWord(merged, { ...options, title });
}

// ─── PPT 导出 ───────────────────────────────────────────────────────────────

export interface PptxExportOptions {
  title?: string;
  author?: string;
}

/** 主题配色方案 */
const PPTX_THEME = {
  primary: '1B2A4A', // 深蓝背景
  secondary: '2D4A7A', // 中蓝
  accent: '4A90D9', // 亮蓝点缀
  text: 'FFFFFF', // 白色主文字
  textDim: 'B0C4DE', // 浅蓝灰辅助文字
  surface: 'F5F7FA', // 浅灰内容面
  dark: '1A1A2E', // 渐变暗色
  bodyText: '333333', // 正文文字
  bodyBg: 'FFFFFF', // 内容页白色背景
  tableHeader: '2D4A7A',
  tableStripe: 'F0F4F8',
};

export async function exportToPptx(
  content: string,
  options: PptxExportOptions = {}
): Promise<string | null> {
  const PptxModule = await import('pptxgenjs');
  const PptxGenJS = PptxModule.default;

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 16:9 宽屏
  pptx.author = options.author || 'Novel Editor';
  pptx.title = options.title || '演示文稿';

  const title = options.title || '演示文稿';
  const nodes = parseMarkdown(content);

  // ─── 封面页 ─────────────────────────
  const titleSlide = pptx.addSlide();
  titleSlide.background = {
    color: PPTX_THEME.primary,
  };
  // 添加渐变装饰矩形
  titleSlide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: '100%',
    h: '100%',
    fill: { color: PPTX_THEME.dark, transparency: 60 },
  });
  // 左侧装饰线
  titleSlide.addShape(pptx.ShapeType.rect, {
    x: 0.8,
    y: 1.8,
    w: 0.06,
    h: 2.0,
    fill: { color: PPTX_THEME.accent },
  });
  titleSlide.addText(title, {
    x: 1.2,
    y: 1.8,
    w: 8,
    h: 1.2,
    fontSize: 40,
    color: PPTX_THEME.text,
    bold: true,
    fontFace: 'Microsoft YaHei',
  });
  if (options.author) {
    titleSlide.addText(options.author, {
      x: 1.2,
      y: 3.2,
      w: 8,
      h: 0.6,
      fontSize: 18,
      color: PPTX_THEME.textDim,
      fontFace: 'Microsoft YaHei',
    });
  }
  // 日期
  titleSlide.addText(
    new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }),
    {
      x: 1.2,
      y: options.author ? 3.9 : 3.2,
      w: 8,
      h: 0.5,
      fontSize: 14,
      color: PPTX_THEME.textDim,
      fontFace: 'Microsoft YaHei',
    }
  );
  // 底部装饰线
  titleSlide.addShape(pptx.ShapeType.rect, {
    x: 0.8,
    y: 6.8,
    w: 4,
    h: 0.04,
    fill: { color: PPTX_THEME.accent, transparency: 40 },
  });

  // 收集所有幻灯片引用（用于最后统一添加页码）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allSlides: any[] = [titleSlide];

  // ─── 目录页 ─────────────────────────
  const headings = nodes.filter((n) => n.type === 'heading' && (n.level ?? 1) <= 2);
  if (headings.length > 0) {
    const tocSlide = pptx.addSlide();
    allSlides.push(tocSlide);
    tocSlide.background = { color: PPTX_THEME.bodyBg };
    // 顶部装饰条
    tocSlide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: '100%',
      h: 0.08,
      fill: { color: PPTX_THEME.accent },
    });
    tocSlide.addText('目录', {
      x: 0.8,
      y: 0.5,
      w: 5,
      h: 0.7,
      fontSize: 28,
      color: PPTX_THEME.primary,
      bold: true,
      fontFace: 'Microsoft YaHei',
    });
    const tocItems = headings.map((h) => {
      const text = (h.segments ?? []).map((s) => s.text).join('');
      const prefix = (h.level ?? 1) === 1 ? '● ' : '    ○ ';
      return {
        text: `${prefix}${text}`,
        options: { fontSize: 16, color: PPTX_THEME.bodyText, bullet: false, breakLine: true },
      };
    });
    tocSlide.addText(tocItems as any, {
      x: 0.8,
      y: 1.5,
      w: 10,
      h: 5,
      fontFace: 'Microsoft YaHei',
      lineSpacingMultiple: 1.6,
      valign: 'top',
    });
  }

  // ─── 内容页 ─────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let currentSlide: any = null;
  let contentY = 1.5; // 当前文字 Y 位置
  const MAX_Y = 6.5; // 页面底部限制

  const ensureSlide = (slideTitle?: string) => {
    if (!currentSlide || contentY >= MAX_Y) {
      currentSlide = pptx.addSlide();
      allSlides.push(currentSlide);
      currentSlide.background = { color: PPTX_THEME.bodyBg };
      // 顶部装饰条
      currentSlide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: '100%',
        h: 0.08,
        fill: { color: PPTX_THEME.accent },
      });
      contentY = slideTitle ? 0.5 : 0.8;

      if (slideTitle) {
        currentSlide.addText(slideTitle, {
          x: 0.8,
          y: 0.4,
          w: 10,
          h: 0.8,
          fontSize: 24,
          color: PPTX_THEME.primary,
          bold: true,
          fontFace: 'Microsoft YaHei',
        });
        contentY = 1.4;
      }
    }
    return currentSlide!;
  };

  for (const node of nodes) {
    switch (node.type) {
      case 'heading': {
        const level = node.level ?? 1;
        const text = (node.segments ?? []).map((s) => s.text).join('');

        if (level <= 2) {
          // H1/H2 → 新的章节分隔页
          const sectionSlide = pptx.addSlide();
          allSlides.push(sectionSlide);
          sectionSlide.background = {
            color: level === 1 ? PPTX_THEME.primary : PPTX_THEME.secondary,
          };
          sectionSlide.addShape(pptx.ShapeType.rect, {
            x: 0,
            y: 0,
            w: '100%',
            h: '100%',
            fill: { color: PPTX_THEME.dark, transparency: 50 },
          });
          sectionSlide.addShape(pptx.ShapeType.rect, {
            x: 0.8,
            y: 2.2,
            w: 0.06,
            h: 1.5,
            fill: { color: PPTX_THEME.accent },
          });
          sectionSlide.addText(text, {
            x: 1.2,
            y: 2.2,
            w: 9,
            h: 1.2,
            fontSize: level === 1 ? 36 : 28,
            color: PPTX_THEME.text,
            bold: true,
            fontFace: 'Microsoft YaHei',
          });
          currentSlide = null;
          contentY = MAX_Y; // force new content slide
        } else {
          // H3+ → 内容页内标题
          const slide = ensureSlide();
          slide.addText(text, {
            x: 0.8,
            y: contentY,
            w: 10,
            h: 0.6,
            fontSize: 20,
            color: PPTX_THEME.primary,
            bold: true,
            fontFace: 'Microsoft YaHei',
          });
          contentY += 0.7;
        }
        break;
      }

      case 'paragraph': {
        const text = (node.segments ?? []).map((s) => s.text).join('');
        if (!text.trim()) break;
        const slide = ensureSlide();
        // 估算行高
        const lineCount = Math.ceil(text.length / 50);
        const blockHeight = Math.max(0.5, lineCount * 0.35);
        if (contentY + blockHeight > MAX_Y) {
          currentSlide = null;
          contentY = MAX_Y;
          const newSlide = ensureSlide();
          newSlide.addText(text, {
            x: 0.8,
            y: contentY,
            w: 10.4,
            h: blockHeight,
            fontSize: 16,
            color: PPTX_THEME.bodyText,
            fontFace: 'Microsoft YaHei',
            lineSpacingMultiple: 1.5,
            valign: 'top',
          });
          contentY += blockHeight + 0.2;
        } else {
          slide.addText(text, {
            x: 0.8,
            y: contentY,
            w: 10.4,
            h: blockHeight,
            fontSize: 16,
            color: PPTX_THEME.bodyText,
            fontFace: 'Microsoft YaHei',
            lineSpacingMultiple: 1.5,
            valign: 'top',
          });
          contentY += blockHeight + 0.2;
        }
        break;
      }

      case 'table': {
        if (!node.rows || node.rows.length === 0) break;
        currentSlide = null;
        contentY = MAX_Y;
        const tableSlide = ensureSlide();

        const tableRows = node.rows.map((row, rowIdx) =>
          row.map((cell) => ({
            text: cell,
            options: {
              fontSize: 14,
              color: rowIdx === 0 ? PPTX_THEME.text : PPTX_THEME.bodyText,
              bold: rowIdx === 0,
              fontFace: 'Microsoft YaHei',
              fill: {
                color:
                  rowIdx === 0
                    ? PPTX_THEME.tableHeader
                    : rowIdx % 2 === 0
                      ? PPTX_THEME.tableStripe
                      : PPTX_THEME.bodyBg,
              },
              border: [
                { type: 'solid' as const, pt: 0.5, color: 'CCCCCC' },
                { type: 'solid' as const, pt: 0.5, color: 'CCCCCC' },
                { type: 'solid' as const, pt: 0.5, color: 'CCCCCC' },
                { type: 'solid' as const, pt: 0.5, color: 'CCCCCC' },
              ],
            },
          }))
        );

        tableSlide.addTable(tableRows as any, {
          x: 0.8,
          y: 1.0,
          w: 10.4,
          colW: Array(node.rows[0].length).fill(10.4 / node.rows[0].length),
          rowH: 0.45,
          align: 'left',
          fontFace: 'Microsoft YaHei',
          fontSize: 14,
          autoPage: true,
          autoPageRepeatHeader: true,
        });
        currentSlide = null;
        contentY = MAX_Y;
        break;
      }

      case 'list':
      case 'ordered-list': {
        const slide = ensureSlide();
        const items = (node.items ?? []).map((segs, idx) => {
          const text = segs.map((s) => s.text).join('');
          const prefix = node.type === 'list' ? '• ' : `${idx + 1}. `;
          return {
            text: `${prefix}${text}`,
            options: {
              fontSize: 16,
              color: PPTX_THEME.bodyText,
              breakLine: true,
            },
          };
        });
        const blockHeight = items.length * 0.4;
        slide.addText(items as any, {
          x: 1.2,
          y: contentY,
          w: 9.6,
          h: Math.max(0.5, blockHeight),
          fontFace: 'Microsoft YaHei',
          lineSpacingMultiple: 1.4,
          valign: 'top',
        });
        contentY += blockHeight + 0.3;
        break;
      }

      case 'hr': {
        // 水平线 → 在当前幻灯片添加细线
        if (currentSlide) {
          currentSlide.addShape(pptx.ShapeType.rect, {
            x: 0.8,
            y: contentY,
            w: 10.4,
            h: 0.02,
            fill: { color: 'CCCCCC' },
          });
          contentY += 0.3;
        }
        break;
      }

      case 'code-block': {
        // 代码块 → 等宽字体 + 深色背景框
        const codeText = node.text ?? '';
        const codeLineCount = codeText.split('\n').length;
        const codeHeight = Math.max(0.6, codeLineCount * 0.28 + 0.3);

        if (contentY + codeHeight > MAX_Y) {
          currentSlide = null;
          contentY = MAX_Y;
        }
        const slide = ensureSlide();
        // 背景矩形
        slide.addShape(pptx.ShapeType.rect, {
          x: 0.8,
          y: contentY,
          w: 10.4,
          h: codeHeight,
          fill: { color: '1E1E1E' },
          rectRadius: 0.08,
        });
        slide.addText(codeText, {
          x: 1.0,
          y: contentY + 0.1,
          w: 10.0,
          h: codeHeight - 0.2,
          fontSize: 12,
          color: 'D4D4D4',
          fontFace: 'Consolas',
          lineSpacingMultiple: 1.3,
          valign: 'top',
          wrap: true,
        });
        contentY += codeHeight + 0.2;
        break;
      }

      case 'blockquote': {
        const quoteText = (node.segments ?? []).map((s) => s.text).join('');
        const quoteLines = Math.ceil(quoteText.length / 45);
        const quoteHeight = Math.max(0.5, quoteLines * 0.3 + 0.2);

        if (contentY + quoteHeight > MAX_Y) {
          currentSlide = null;
          contentY = MAX_Y;
        }
        const slide = ensureSlide();
        // 左侧蓝色竖线
        slide.addShape(pptx.ShapeType.rect, {
          x: 0.8,
          y: contentY,
          w: 0.06,
          h: quoteHeight,
          fill: { color: PPTX_THEME.accent },
        });
        slide.addText(quoteText, {
          x: 1.1,
          y: contentY,
          w: 10.1,
          h: quoteHeight,
          fontSize: 15,
          color: '666666',
          fontFace: 'Microsoft YaHei',
          italic: true,
          lineSpacingMultiple: 1.4,
          valign: 'top',
        });
        contentY += quoteHeight + 0.2;
        break;
      }
    }
  }

  // ─── 页码 ─────────────────────────
  allSlides.forEach((slide, idx) => {
    if (idx === 0) return; // 封面不加页码
    slide.addText(`${idx + 1}`, {
      x: 11.5,
      y: 7.0,
      w: 0.8,
      h: 0.35,
      fontSize: 10,
      color: '999999',
      align: 'right',
      fontFace: 'Microsoft YaHei',
    });
  });

  // ─── 保存 ─────────────────────────
  const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;

  const result = await dialog.showSaveDialog({
    title: '导出为 PPT',
    defaultPath: `${options.title || '演示文稿'}.pptx`,
    filters: [{ name: 'PowerPoint 演示文稿', extensions: ['pptx'] }],
  });
  if (result.canceled || !result.filePath) return null;

  await writeFile(result.filePath, buffer);
  return result.filePath;
}
