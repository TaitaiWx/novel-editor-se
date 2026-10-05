/** PPT (.pptx) 导出：基于 pptxgenjs，将 Markdown 节点转换为带封面、目录、章节页的演示文稿 */
import type PptxGenJS from 'pptxgenjs';
import { parseMarkdown } from './markdown';
import { saveBufferWithDialog } from './save';

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

/** 生成 PPT 二进制内容（不涉及对话框，便于测试与复用） */
export async function buildPptxBuffer(
  content: string,
  options: PptxExportOptions = {}
): Promise<Buffer> {
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
  const allSlides: PptxGenJS.Slide[] = [titleSlide];

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
    tocSlide.addText(tocItems, {
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
  let currentSlide: PptxGenJS.Slide | null = null;
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

        const tableRows: PptxGenJS.TableRow[] = node.rows.map((row, rowIdx) =>
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

        tableSlide.addTable(tableRows, {
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
        slide.addText(items, {
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
        // currentSlide 在 ensureSlide 闭包内被赋值，TS 控制流分析无法感知，这里显式放宽类型
        const hrSlide = currentSlide as PptxGenJS.Slide | null;
        if (hrSlide) {
          hrSlide.addShape(pptx.ShapeType.rect, {
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
  return buffer;
}

export async function exportToPptx(
  content: string,
  options: PptxExportOptions = {}
): Promise<string | null> {
  const buffer = await buildPptxBuffer(content, options);

  return saveBufferWithDialog(buffer, {
    title: '导出为 PPT',
    defaultPath: `${options.title || '演示文稿'}.pptx`,
    filters: [{ name: 'PowerPoint 演示文稿', extensions: ['pptx'] }],
  });
}
