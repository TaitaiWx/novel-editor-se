/**
 * 文件导入模块：将 Word (.docx) 和 Excel (.xlsx) 转换为编辑器可用的 Markdown 格式
 */
import { readFile } from 'fs/promises';
import path from 'path';

export interface ImportResult {
  /** 建议的输出文件名（含扩展名） */
  fileName: string;
  /** 转换后的 Markdown 内容 */
  content: string;
  /** 源文件类型 */
  sourceType: 'docx' | 'xlsx';
}

/** 将 mammoth 输出的 HTML 转为简易 Markdown */
function htmlToMarkdown(html: string): string {
  let md = html;
  // 标题
  md = md.replace(/<h(\d)[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, text: string) => {
    return '#'.repeat(Number(level)) + ' ' + text.trim() + '\n\n';
  });
  // 粗体
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
  // 斜体
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');
  // 列表项
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  // 移除列表容器
  md = md.replace(/<\/?(ul|ol)[^>]*>/gi, '\n');
  // 段落 → 换行
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');
  // 换行
  md = md.replace(/<br\s*\/?>/gi, '\n');
  // 移除剩余 HTML 标签
  md = md.replace(/<[^>]+>/g, '');
  // HTML 实体
  md = md.replace(/&amp;/g, '&');
  md = md.replace(/&lt;/g, '<');
  md = md.replace(/&gt;/g, '>');
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");
  md = md.replace(/&nbsp;/g, ' ');
  // 清理多余空行
  md = md.replace(/\n{3,}/g, '\n\n');
  return md.trim() + '\n';
}

/**
 * 导入 Word (.docx) 文件，提取文本内容并转为 Markdown
 */
async function importDocx(filePath: string): Promise<ImportResult> {
  const mammoth = await import('mammoth');
  const buffer = await readFile(filePath);
  const result = await mammoth.convertToHtml({ buffer });

  if (result.messages.length > 0) {
    console.warn(
      '[file-importer] docx 转换警告:',
      result.messages.map((m: { message: string }) => m.message)
    );
  }

  const markdownContent = htmlToMarkdown(result.value);

  const baseName = path.basename(filePath, path.extname(filePath));
  return {
    fileName: `${baseName}.md`,
    content: markdownContent,
    sourceType: 'docx',
  };
}

/**
 * 导入 Excel (.xlsx) 文件，将每个 Sheet 转为 Markdown 表格
 */
async function importXlsx(filePath: string): Promise<ImportResult> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sections: string[] = [];

  workbook.eachSheet((worksheet) => {
    const rows: string[][] = [];
    let maxCols = 0;

    worksheet.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        // 安全地提取单元格文本值
        let text = '';
        if (cell.value === null || cell.value === undefined) {
          text = '';
        } else if (typeof cell.value === 'object' && 'richText' in cell.value) {
          // 富文本
          text = (cell.value.richText as { text: string }[]).map((rt) => rt.text).join('');
        } else if (typeof cell.value === 'object' && 'result' in cell.value) {
          // 公式结果
          text = String((cell.value as { result: unknown }).result ?? '');
        } else {
          text = String(cell.value);
        }
        // 确保 cells 数组与列号对齐（补空位）
        while (cells.length < colNumber - 1) cells.push('');
        cells.push(text.replace(/\|/g, '\\|').replace(/\n/g, ' '));
      });
      if (cells.length > maxCols) maxCols = cells.length;
      rows.push(cells);
    });

    if (rows.length === 0) return;

    // 补齐每行到相同列数
    for (const row of rows) {
      while (row.length < maxCols) row.push('');
    }

    // 生成 Markdown 表格
    const sheetTitle = `## ${worksheet.name}`;
    const header = rows[0];
    const headerLine = `| ${header.join(' | ')} |`;
    const separatorLine = `| ${header.map(() => '---').join(' | ')} |`;
    const dataLines = rows.slice(1).map((row) => `| ${row.join(' | ')} |`);

    sections.push([sheetTitle, '', headerLine, separatorLine, ...dataLines].join('\n'));
  });

  const baseName = path.basename(filePath, path.extname(filePath));
  return {
    fileName: `${baseName}.md`,
    content: sections.join('\n\n'),
    sourceType: 'xlsx',
  };
}

const IMPORTERS: Record<string, (filePath: string) => Promise<ImportResult>> = {
  '.docx': importDocx,
  '.xlsx': importXlsx,
};

/** 支持的导入格式列表 */
export const SUPPORTED_IMPORT_EXTENSIONS = Object.keys(IMPORTERS);

/**
 * 根据文件扩展名自动选择导入器
 */
export async function importFile(filePath: string): Promise<ImportResult> {
  const ext = path.extname(filePath).toLowerCase();
  const importer = IMPORTERS[ext];
  if (!importer) {
    throw new Error(`不支持的文件格式: ${ext}`);
  }
  return importer(filePath);
}
