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
  sourceType: 'doc' | 'docx' | 'xlsx' | 'md' | 'txt' | 'json';
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

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function parseDocxXmlToMarkdown(xml: string): string {
  const paragraphs: string[] = [];
  const pRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let pMatch: RegExpExecArray | null;

  while ((pMatch = pRegex.exec(xml)) !== null) {
    const pContent = pMatch[1]
      .replace(/<w:tab\s*\/?\s*>/g, '\t')
      .replace(/<w:(br|cr)\s*\/?\s*>/g, '\n');

    const texts: string[] = [];
    const tRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRegex.exec(pContent)) !== null) {
      texts.push(decodeXmlEntities(tMatch[1]));
    }

    const paragraphText = texts.join('').replace(/\s+$/g, '');
    if (paragraphText.trim().length > 0) {
      paragraphs.push(paragraphText.trim());
    }
  }

  if (paragraphs.length === 0) return '';
  return `${paragraphs.join('\n\n')}\n`;
}

async function extractDocxMarkdownByZip(buffer: Buffer): Promise<string> {
  const jszip = await import('jszip');
  const JSZip = jszip.default ?? jszip;
  const zip = await JSZip.loadAsync(buffer);
  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!docXml) {
    return '';
  }
  return parseDocxXmlToMarkdown(docXml);
}

function looksLikeUtf16(buffer: Buffer): 'utf-16le' | 'utf-16be' | null {
  if (buffer.length < 2) return null;
  let zeroEven = 0;
  let zeroOdd = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0) {
      if (i % 2 === 0) zeroEven += 1;
      else zeroOdd += 1;
    }
  }
  const zeroRatio = (zeroEven + zeroOdd) / buffer.length;
  if (zeroRatio < 0.1) return null;
  return zeroOdd >= zeroEven ? 'utf-16le' : 'utf-16be';
}

function scoreDecodedText(text: string): number {
  if (!text) return -1_000;
  const replacementCount = (text.match(/\uFFFD/g) || []).length;
  const nullCount = text.split('\0').length - 1;
  // 得分越高越可信：惩罚替换字符和空字节。
  return text.length - replacementCount * 40 - nullCount * 80;
}

async function decodeTextBuffer(buffer: Buffer): Promise<string> {
  if (buffer.length === 0) return '';

  // BOM 优先。
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf8');
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buffer.subarray(2));
  }

  const utf16Guess = looksLikeUtf16(buffer);
  if (utf16Guess) {
    return new TextDecoder(utf16Guess).decode(buffer);
  }

  const candidates: string[] = [];
  // UTF-8 始终尝试（最常见）。
  candidates.push(buffer.toString('utf8'));

  // 一些历史 txt 常见于 GB18030/GBK，支持时作为回退。
  try {
    candidates.push(new TextDecoder('gb18030').decode(buffer));
  } catch {
    // Node 运行时不支持该编码时，回退到 iconv-lite（业界常用文本解码库）。
    try {
      const iconvLiteModule = await import('iconv-lite');
      const iconvLite = iconvLiteModule.default ?? iconvLiteModule;
      for (const encoding of ['gb18030', 'gbk', 'big5']) {
        try {
          candidates.push(iconvLite.decode(buffer, encoding));
        } catch {
          // 单个编码失败继续尝试其他编码。
        }
      }
    } catch {
      // iconv-lite 未加载成功时，仅使用 UTF-8 结果。
    }
  }

  let best = candidates[0] || '';
  let bestScore = scoreDecodedText(best);
  for (const text of candidates.slice(1)) {
    const score = scoreDecodedText(text);
    if (score > bestScore) {
      best = text;
      bestScore = score;
    }
  }

  return best.replaceAll('\0', '');
}

async function importDoc(_filePath: string): Promise<ImportResult> {
  throw new Error('暂不支持直接导入 .doc（二进制旧格式）。请在 Word/WPS 中另存为 .docx 后再导入。');
}

/**
 * 导入 Word (.docx) 文件，提取文本内容并转为 Markdown
 */
async function importDocx(filePath: string): Promise<ImportResult> {
  const buffer = await readFile(filePath);
  let markdownContent = '';

  try {
    const mammothModule = await import('mammoth');
    const mammoth = mammothModule.default ?? mammothModule;
    const result = await mammoth.convertToHtml({ buffer });
    if (result.messages.length > 0) {
      console.warn(
        '[file-importer] docx 转换警告:',
        result.messages.map((m: { message: string }) => m.message)
      );
    }
    markdownContent = htmlToMarkdown(result.value);

    // convertToHtml 未提取到正文时，继续尝试 rawText（对某些复杂样式文档更稳）。
    if (!markdownContent.trim()) {
      const rawTextResult = await mammoth.extractRawText({ buffer });
      markdownContent = `${rawTextResult.value ?? ''}`.trim();
      if (markdownContent) {
        markdownContent = `${markdownContent}\n`;
      }
    }
  } catch (error) {
    console.warn('[file-importer] mammoth 解析失败，准备回退到 ZIP/XML 解析:', error);
  }

  if (!markdownContent.trim()) {
    markdownContent = await extractDocxMarkdownByZip(buffer);
  }

  if (!markdownContent.trim()) {
    throw new Error('Word 文件解析失败：未提取到可用文本内容');
  }

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
  const ExcelMod = ExcelJS.default ?? ExcelJS;
  const workbook = new ExcelMod.Workbook();
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

async function importTextFile(filePath: string, sourceType: 'md' | 'txt' | 'json') {
  const buffer = await readFile(filePath);
  const content = (await decodeTextBuffer(buffer)).replace(/\r\n?/g, '\n');
  return {
    fileName: path.basename(filePath),
    content,
    sourceType,
  } satisfies ImportResult;
}

const IMPORTERS: Record<string, (filePath: string) => Promise<ImportResult>> = {
  '.doc': importDoc,
  '.docx': importDocx,
  '.xlsx': importXlsx,
  '.md': (filePath: string) => importTextFile(filePath, 'md'),
  '.txt': (filePath: string) => importTextFile(filePath, 'txt'),
  '.json': (filePath: string) => importTextFile(filePath, 'json'),
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
