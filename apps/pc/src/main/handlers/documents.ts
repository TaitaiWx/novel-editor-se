/**
 * Document IPC Handlers
 *
 * Handles: XLSX/PPTX/DOCX reading, document export, file import
 */
import { ipcMain, dialog } from 'electron';
import { readFile } from 'fs/promises';
import path from 'path';
import { importFile, SUPPORTED_IMPORT_EXTENSIONS } from '../file-importer';
import {
  exportToWord,
  exportProjectToWord,
  exportToPptx,
  beautifyPptx,
} from '../document-exporter';

// ─── Helpers ────────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function docxXmlToHtml(xml: string): string {
  const paragraphs: string[] = [];
  const pRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let pMatch: RegExpExecArray | null;
  while ((pMatch = pRegex.exec(xml)) !== null) {
    const pContent = pMatch[1];
    const texts: string[] = [];
    const tRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRegex.exec(pContent)) !== null) {
      texts.push(escapeHtml(tMatch[1]));
    }
    if (texts.length > 0) {
      const styleMatch = pContent.match(/<w:pStyle\s+w:val="Heading(\d)"/i);
      if (styleMatch) {
        const level = Math.min(Number(styleMatch[1]), 6);
        paragraphs.push(`<h${level}>${texts.join('')}</h${level}>`);
      } else {
        paragraphs.push(`<p>${texts.join('')}</p>`);
      }
    }
  }
  return paragraphs.join('\n');
}

// ─── Register handlers ─────────────────────────────────────────────────────

export function registerDocumentHandlers(): void {
  // Read Excel files
  ipcMain.handle('read-xlsx-data', async (_event, filePath: string) => {
    try {
      const ExcelJS = await import('exceljs');
      const ExcelMod = ExcelJS.default ?? ExcelJS;
      const workbook = new ExcelMod.Workbook();
      await workbook.xlsx.readFile(filePath);

      const sheets: {
        name: string;
        rows: {
          value: string;
          style?: Record<string, unknown>;
          colSpan?: number;
          rowSpan?: number;
        }[][];
        colWidths: number[];
      }[] = [];

      workbook.eachSheet((worksheet) => {
        const rows: { value: string; style?: Record<string, unknown> }[][] = [];
        let maxCols = 0;
        const colWidths: number[] = [];
        for (let c = 1; c <= (worksheet.columnCount || 0); c++) {
          const col = worksheet.getColumn(c);
          colWidths.push(col.width ? Math.round(col.width * 7) : 80);
        }

        worksheet.eachRow((row) => {
          const cells: { value: string; style?: Record<string, unknown> }[] = [];
          row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            while (cells.length < colNumber - 1) cells.push({ value: '' });

            let text = '';
            if (cell.value === null || cell.value === undefined) {
              text = '';
            } else if (typeof cell.value === 'object' && 'richText' in cell.value) {
              text = (cell.value.richText as { text: string }[]).map((rt) => rt.text).join('');
            } else if (typeof cell.value === 'object' && 'result' in cell.value) {
              text = String((cell.value as { result: unknown }).result ?? '');
            } else if (cell.value instanceof Date) {
              text = cell.value.toLocaleDateString();
            } else {
              text = String(cell.value);
            }

            const style: Record<string, unknown> = {};
            if (cell.font?.bold) style.bold = true;
            if (cell.font?.italic) style.italic = true;
            if (cell.font?.color?.argb) {
              const argb = cell.font.color.argb;
              style.fontColor = `#${typeof argb === 'string' ? argb.slice(-6) : ''}`;
            }
            if (cell.fill && 'fgColor' in cell.fill && cell.fill.fgColor?.argb) {
              const argb = cell.fill.fgColor.argb;
              const hex = typeof argb === 'string' ? argb.slice(-6) : '';
              if (hex && hex !== '000000') style.bgColor = `#${hex}`;
            }
            if (cell.alignment?.horizontal) style.alignment = cell.alignment.horizontal;

            const hasStyle = Object.keys(style).length > 0;
            cells.push({ value: text, ...(hasStyle ? { style } : {}) });
          });

          if (cells.length > maxCols) maxCols = cells.length;
          rows.push(cells);
        });

        for (const row of rows) {
          while (row.length < maxCols) row.push({ value: '' });
        }
        while (colWidths.length < maxCols) colWidths.push(80);

        if (rows.length > 0) {
          sheets.push({ name: worksheet.name, rows, colWidths });
        }
      });

      return { sheets, fileName: path.basename(filePath) };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('Corrupted zip') || msg.includes('End of data')) {
        throw new Error('文件已损坏或不是有效的 Excel (.xlsx) 格式');
      }
      throw new Error(`读取 Excel 文件失败: ${msg}`);
    }
  });

  // Read PowerPoint files
  ipcMain.handle('read-pptx-data', async (_event, filePath: string) => {
    try {
      const buffer = await readFile(filePath);
      const arrayBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      );

      const jszip = await import('jszip');
      const JSZipCtor: any =
        typeof jszip === 'function'
          ? jszip
          : (jszip as Record<string, unknown>).default
            ? (jszip as Record<string, unknown>).default
            : jszip;

      if (typeof JSZipCtor.loadAsync !== 'function') {
        throw new Error('JSZip 模块加载异常，loadAsync 不可用');
      }

      const zip = await JSZipCtor.loadAsync(new Uint8Array(arrayBuffer));
      const slideFiles = Object.keys(zip.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((a, b) => {
          const numA = parseInt(a.match(/slide(\d+)/)?.[1] || '0');
          const numB = parseInt(b.match(/slide(\d+)/)?.[1] || '0');
          return numA - numB;
        });

      const slides: { index: number; title: string; texts: string[]; noteText: string }[] = [];

      for (let i = 0; i < slideFiles.length; i++) {
        const xml = await zip.files[slideFiles[i]].async('text');
        const texts: string[] = [];
        const textMatches = xml.matchAll(/<a:t>([^<]*)<\/a:t>/g);
        for (const m of textMatches) {
          const text = m[1].trim();
          if (text) texts.push(text);
        }
        const title = texts[0] || `幻灯片 ${i + 1}`;

        let noteText = '';
        const noteFile = `ppt/notesSlides/notesSlide${i + 1}.xml`;
        if (zip.files[noteFile]) {
          const noteXml = await zip.files[noteFile].async('text');
          const noteMatches = noteXml.matchAll(/<a:t>([^<]*)<\/a:t>/g);
          const noteTexts: string[] = [];
          for (const m of noteMatches) {
            const t = m[1].trim();
            if (t && !/^\d+$/.test(t)) noteTexts.push(t);
          }
          noteText = noteTexts.join(' ');
        }

        slides.push({ index: i + 1, title, texts: texts.slice(1), noteText });
      }

      return { fileName: path.basename(filePath), slideCount: slides.length, slides };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (
        msg.includes('Corrupted zip') ||
        msg.includes('End of data') ||
        msg.includes('not a valid zip')
      ) {
        throw new Error('文件已损坏或不是有效的 PowerPoint (.pptx) 格式');
      }
      throw new Error(`读取 PPT 文件失败: ${msg}`);
    }
  });

  // Read Word files
  ipcMain.handle('read-docx-data', async (_event, filePath: string) => {
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.doc') {
      return { fileName, html: '', useExternal: true };
    }

    const buffer = await readFile(filePath);

    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.convertToHtml({ buffer });
      return { fileName, html: result.value };
    } catch {
      // mammoth 不支持，降级
    }

    try {
      const arrayBuffer = new ArrayBuffer(buffer.length);
      new Uint8Array(arrayBuffer).set(buffer);
      const JSZipMod = await import('jszip');
      const JSZip = JSZipMod.default ?? JSZipMod;
      const zip = await JSZip.loadAsync(arrayBuffer);
      const docXml = await zip.file('word/document.xml')?.async('string');
      if (docXml) {
        return { fileName, html: docxXmlToHtml(docXml) };
      }
    } catch {
      // JSZip 也失败
    }

    return { fileName, html: '', useExternal: true };
  });

  // File import (Word/Excel → Markdown)
  ipcMain.handle('import-file', async () => {
    const result = await dialog.showOpenDialog({
      title: '导入文件',
      filters: [
        { name: 'Word / Excel', extensions: SUPPORTED_IMPORT_EXTENSIONS.map((e) => e.slice(1)) },
      ],
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const previews: { fileName: string; content: string; sourcePath: string }[] = [];
    const errors: { filePath: string; error: string }[] = [];

    for (const srcPath of result.filePaths) {
      try {
        const { fileName, content } = await importFile(srcPath);
        previews.push({ fileName, content, sourcePath: srcPath });
      } catch (error) {
        errors.push({
          filePath: srcPath,
          error: error instanceof Error ? error.message : '未知错误',
        });
      }
    }

    return { previews, errors };
  });

  // Structured file import (Word/Excel/Markdown/Text/JSON → preview)
  ipcMain.handle('import-structured-file', async () => {
    const result = await dialog.showOpenDialog({
      title: '导入设定或大纲资料',
      filters: [
        {
          name: '结构化文档',
          extensions: ['docx', 'xlsx', 'md', 'txt', 'json'],
        },
      ],
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const previews: { fileName: string; content: string; sourcePath: string }[] = [];
    const errors: { filePath: string; error: string }[] = [];

    for (const srcPath of result.filePaths) {
      try {
        const { fileName, content } = await importFile(srcPath);
        previews.push({ fileName, content, sourcePath: srcPath });
      } catch (error) {
        errors.push({
          filePath: srcPath,
          error: error instanceof Error ? error.message : '未知错误',
        });
      }
    }

    return { previews, errors };
  });

  // Document exports
  ipcMain.handle(
    'export-to-word',
    async (_event, content: string, options?: { title?: string; author?: string }) => {
      try {
        const filePath = await exportToWord(content, options);
        return { success: !!filePath, filePath };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '未知错误' };
      }
    }
  );

  ipcMain.handle(
    'export-project-to-word',
    async (_event, folderPath: string, options?: { title?: string; author?: string }) => {
      try {
        const filePath = await exportProjectToWord(folderPath, options);
        return { success: !!filePath, filePath };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '未知错误' };
      }
    }
  );

  ipcMain.handle(
    'export-to-pptx',
    async (_event, content: string, options?: { title?: string; author?: string }) => {
      try {
        const filePath = await exportToPptx(content, options);
        return { success: !!filePath, filePath };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '未知错误' };
      }
    }
  );

  ipcMain.handle(
    'beautify-pptx',
    async (_event, sourcePath: string, options?: { title?: string; author?: string }) => {
      try {
        const filePath = await beautifyPptx(sourcePath, options);
        return { success: !!filePath, filePath };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '未知错误' };
      }
    }
  );
}
