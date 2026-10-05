/** Word (.docx) 导出：基于 docx 库，将 Markdown 节点转换为带封面、目录、页眉页脚的文档 */
import type { ParagraphChild } from 'docx';
import { parseMarkdown } from './markdown';
import type { TextSegment } from './markdown';
import { saveBufferWithDialog } from './save';

export interface WordExportOptions {
  title?: string;
  author?: string;
}

/** 生成 Word 文档二进制内容（不涉及对话框，便于测试与复用） */
export async function buildWordBuffer(
  content: string,
  options: WordExportOptions = {}
): Promise<Buffer> {
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
                underline: { type: docx.UnderlineType.SINGLE },
              }),
            ],
            link: seg.link,
          }),
        ] as ParagraphChild[];
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
                    verticalAlign: docx.VerticalAlignTable.CENTER,
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
  return buffer;
}

export async function exportToWord(
  content: string,
  options: WordExportOptions = {}
): Promise<string | null> {
  const title = options.title || '文档';
  const buffer = await buildWordBuffer(content, options);

  // ─── 保存对话框 ─────────────────────
  return saveBufferWithDialog(buffer, {
    title: '导出为 Word',
    defaultPath: `${title}.docx`,
    filters: [{ name: 'Word 文档', extensions: ['docx'] }],
  });
}
