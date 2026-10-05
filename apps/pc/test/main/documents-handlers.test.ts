import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();

interface OpenResult {
  canceled: boolean;
  filePaths: string[];
}
const dialogState = { open: { canceled: true, filePaths: [] } as OpenResult };
const showOpenDialog = vi.fn(async (_opts: unknown) => dialogState.open);

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
  },
  dialog: { showOpenDialog: (opts: unknown) => showOpenDialog(opts) },
}));

const importFile = vi.fn();
vi.mock('../../src/main/file-importer', () => ({
  importFile: (...args: unknown[]) => importFile(...args),
  SUPPORTED_IMPORT_EXTENSIONS: ['.docx', '.xlsx'],
}));

const exportToWord = vi.fn();
const exportProjectToWord = vi.fn();
const exportToPptx = vi.fn();
const beautifyPptx = vi.fn();
const loadJSZipOverride = { value: null as unknown };
vi.mock('../../src/main/document-exporter', async () => {
  const jszip = await import('jszip');
  return {
    exportToWord: (...args: unknown[]) => exportToWord(...args),
    exportProjectToWord: (...args: unknown[]) => exportProjectToWord(...args),
    exportToPptx: (...args: unknown[]) => exportToPptx(...args),
    beautifyPptx: (...args: unknown[]) => beautifyPptx(...args),
    loadJSZip: async () => loadJSZipOverride.value ?? jszip.default,
  };
});

// mammoth 可控：默认抛错，从而走 JSZip 降级路径
const convertToHtml = vi.fn();
vi.mock('mammoth', () => ({
  convertToHtml: (...args: unknown[]) => convertToHtml(...args),
  default: { convertToHtml: (...args: unknown[]) => convertToHtml(...args) },
}));

const { registerDocumentHandlers } = await import('../../src/main/handlers/documents');
registerDocumentHandlers();

async function call<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`未注册: ${channel}`);
  return (await handler({}, ...args)) as T;
}

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'ne-docs-'));
  dialogState.open = { canceled: true, filePaths: [] };
  showOpenDialog.mockClear();
  importFile.mockReset();
  exportToWord.mockReset();
  exportProjectToWord.mockReset();
  exportToPptx.mockReset();
  beautifyPptx.mockReset();
  convertToHtml.mockReset();
  convertToHtml.mockRejectedValue(new Error('mammoth unsupported'));
  loadJSZipOverride.value = null;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeZip(file: string, entries: Record<string, string>): Promise<string> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  await writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }));
  return file;
}

interface XlsxResult {
  fileName: string;
  sheets: Array<{
    name: string;
    colWidths: number[];
    rows: Array<Array<{ value: string; style?: Record<string, unknown> }>>;
  }>;
}

describe('read-xlsx-data', () => {
  it('解析多 sheet、富文本、公式、日期、样式，并补齐列宽和空单元格', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('人物');
    ws.getColumn(1).width = 20;
    ws.getCell('A1').value = '姓名';
    ws.getCell('A1').font = { bold: true, italic: true, color: { argb: 'FFFF0000' } };
    ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00FF00' } };
    ws.getCell('A1').alignment = { horizontal: 'center' };
    ws.getCell('B1').value = { richText: [{ text: '等' }, { text: '级' }] };
    ws.getCell('C1').value = { formula: '1+1', result: 2 };
    ws.getCell('A2').value = 42;
    ws.getCell('C2').value = new Date(2026, 0, 2);
    ws.getCell('D3').value = '尾';
    ws.getCell('B2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
    wb.addWorksheet('空表');
    const file = path.join(dir, 'book.xlsx');
    await wb.xlsx.writeFile(file);

    const result = await call<XlsxResult>('read-xlsx-data', file);
    expect(result.fileName).toBe('book.xlsx');
    // 空 sheet 被丢弃
    expect(result.sheets.map((s) => s.name)).toEqual(['人物']);
    const sheet = result.sheets[0];
    expect(sheet.colWidths[0]).toBe(140);
    expect(sheet.colWidths).toHaveLength(4);
    expect(sheet.colWidths.slice(1).every((w) => w === 80)).toBe(true);

    const [r1, r2, r3] = sheet.rows;
    expect(sheet.rows.every((r) => r.length === 4)).toBe(true);
    expect(r1[0]).toEqual({
      value: '姓名',
      style: {
        bold: true,
        italic: true,
        fontColor: '#FF0000',
        bgColor: '#00FF00',
        alignment: 'center',
      },
    });
    expect(r1[1].value).toBe('等级');
    expect(r1[2].value).toBe('2');
    expect(r2[0]).toEqual({ value: '42' });
    // 黑色填充不作为背景色
    expect(r2[1].style?.bgColor).toBeUndefined();
    expect(r2[2].value).toBe(new Date(2026, 0, 2).toLocaleDateString());
    expect(r3[3].value).toBe('尾');
    expect(r3[0].value).toBe('');
  });

  // BUG（documents.ts:141）：友好提示只匹配 'Corrupted zip' / 'End of data'，但 exceljs(JSZip)
  // 对非 zip 文件实际抛出 "Can't find end of central directory : is this a zip file ?"，
  // 用户看到的是 “读取 Excel 文件失败: Can't find end of central directory...” 原始英文报错。
  it('非 zip 文件给出友好的“已损坏”提示', async () => {
    const file = path.join(dir, 'bad.xlsx');
    await writeFile(file, 'not a zip at all');
    await expect(call('read-xlsx-data', file)).rejects.toThrow(
      /^文件已损坏或不是有效的 Excel \(\.xlsx\) 格式$/
    );
  });

  it('文件不存在时报“读取 Excel 文件失败”', async () => {
    await expect(call('read-xlsx-data', path.join(dir, 'missing.xlsx'))).rejects.toThrow(
      '读取 Excel 文件失败'
    );
  });
});

interface PptxResult {
  fileName: string;
  slideCount: number;
  slides: Array<{ index: number; title: string; texts: string[]; noteText: string }>;
}

describe('read-pptx-data', () => {
  it('按数字顺序解析幻灯片文本与备注（忽略纯数字页码）', async () => {
    const file = await writeZip(path.join(dir, 'deck.pptx'), {
      'ppt/slides/slide10.xml': '<p:sld><a:t>第十页</a:t></p:sld>',
      'ppt/slides/slide2.xml': '<p:sld><a:t> 标题二 </a:t><a:t></a:t><a:t>要点A</a:t></p:sld>',
      'ppt/slides/slide1.xml': '<p:sld><a:t>  </a:t></p:sld>',
      'ppt/slides/_rels/slide1.xml.rels': '<x/>',
      'ppt/notesSlides/notesSlide2.xml': '<a:t>讲稿</a:t><a:t>2</a:t><a:t>继续</a:t>',
    });
    const result = await call<PptxResult>('read-pptx-data', file);
    expect(result.fileName).toBe('deck.pptx');
    expect(result.slideCount).toBe(3);
    expect(result.slides).toEqual([
      { index: 1, title: '幻灯片 1', texts: [], noteText: '' },
      { index: 2, title: '标题二', texts: ['要点A'], noteText: '讲稿 继续' },
      { index: 3, title: '第十页', texts: [], noteText: '' },
    ]);
  });

  it('JSZip 报 Corrupted zip 时给出友好的“已损坏”提示', async () => {
    const file = await writeZip(path.join(dir, 'deck.pptx'), { 'a.txt': 'x' });
    loadJSZipOverride.value = {
      loadAsync: async () => {
        throw new Error('Corrupted zip: missing 10 bytes');
      },
    };
    await expect(call('read-pptx-data', file)).rejects.toThrow(
      /^文件已损坏或不是有效的 PowerPoint \(\.pptx\) 格式$/
    );
  });

  // BUG（documents.ts:203-207）：友好提示只匹配 'Corrupted zip' / 'End of data' / 'not a valid zip'，
  // 但 JSZip 对非 zip 文件实际抛出的是 "Can't find end of central directory : is this a zip file ?"，
  // 于是用户打开一个改了扩展名的普通文件时拿到的是原始英文报错而不是“文件已损坏”提示。
  it('非 zip 文件报“已损坏”', async () => {
    const file = path.join(dir, 'bad.pptx');
    await writeFile(file, 'garbage');
    await expect(call('read-pptx-data', file)).rejects.toThrow(
      '文件已损坏或不是有效的 PowerPoint (.pptx) 格式'
    );
  });

  it('文件不存在时报“读取 PPT 文件失败”', async () => {
    await expect(call('read-pptx-data', path.join(dir, 'nope.pptx'))).rejects.toThrow(
      '读取 PPT 文件失败'
    );
  });

  it('JSZip 加载异常（无 loadAsync）时报错', async () => {
    const file = await writeZip(path.join(dir, 'deck.pptx'), { 'a.txt': 'x' });
    loadJSZipOverride.value = {};
    await expect(call('read-pptx-data', file)).rejects.toThrow(
      '读取 PPT 文件失败: JSZip 模块加载异常，loadAsync 不可用'
    );
  });
});

interface DocxResult {
  fileName: string;
  html: string;
  useExternal?: boolean;
}

describe('read-docx-data', () => {
  it('.doc 直接交给外部程序，不读取文件', async () => {
    await expect(call<DocxResult>('read-docx-data', path.join(dir, 'old.DOC'))).resolves.toEqual({
      fileName: 'old.DOC',
      html: '',
      useExternal: true,
    });
  });

  it('mammoth 成功时直接返回其 HTML', async () => {
    const file = path.join(dir, 'a.docx');
    await writeFile(file, 'whatever');
    convertToHtml.mockResolvedValue({ value: '<p>来自 mammoth</p>' });
    await expect(call<DocxResult>('read-docx-data', file)).resolves.toEqual({
      fileName: 'a.docx',
      html: '<p>来自 mammoth</p>',
    });
    const arg = convertToHtml.mock.calls[0][0] as { buffer: Buffer };
    expect(Buffer.isBuffer(arg.buffer)).toBe(true);
  });

  it('mammoth 失败时用 JSZip 解析 document.xml（标题、段落、转义）', async () => {
    const xml = [
      '<w:document><w:body>',
      '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>第一章</w:t></w:r></w:p>',
      '<w:p><w:r><w:t xml:space="preserve">正文 </w:t></w:r><w:r><w:t>a&lt;b &amp; c</w:t></w:r></w:p>',
      '<w:p><w:pPr><w:pStyle w:val="Heading9"/></w:pPr><w:r><w:t>深</w:t></w:r></w:p>',
      '<w:p><w:r></w:r></w:p>',
      '</w:body></w:document>',
    ].join('');
    const file = await writeZip(path.join(dir, 'b.docx'), { 'word/document.xml': xml });
    const result = await call<DocxResult>('read-docx-data', file);
    expect(result.fileName).toBe('b.docx');
    expect(result.useExternal).toBeUndefined();
    expect(result.html).toBe(
      ['<h2>第一章</h2>', '<p>正文 a&lt;b &amp; c</p>', '<h6>深</h6>'].join('\n')
    );
  });

  it('zip 中没有 document.xml 时回退外部程序', async () => {
    const file = await writeZip(path.join(dir, 'c.docx'), { 'other.xml': '<x/>' });
    await expect(call<DocxResult>('read-docx-data', file)).resolves.toEqual({
      fileName: 'c.docx',
      html: '',
      useExternal: true,
    });
  });

  it('既不是 docx 也不是 zip 时回退外部程序', async () => {
    const file = path.join(dir, 'd.docx');
    await writeFile(file, 'plain text');
    await expect(call<DocxResult>('read-docx-data', file)).resolves.toEqual({
      fileName: 'd.docx',
      html: '',
      useExternal: true,
    });
  });

  it('文件不存在时抛错', async () => {
    await expect(call('read-docx-data', path.join(dir, 'missing.docx'))).rejects.toThrow();
  });

  // BUG（documents.ts:20-30 escapeHtml）：先把 &amp; 解码成 & 再解码 &lt;，导致二次解码。
  // 文档里字面量文本 "&lt;"（XML 中存为 &amp;lt;）会被渲染成 "<"，而不是原样显示 "&lt;"。
  it('docx 中的字面量 "&lt;" 文本应原样显示，不能被二次解码成 "<"', async () => {
    const xml = '<w:p><w:r><w:t>写 &amp;lt; 号</w:t></w:r></w:p>';
    const file = await writeZip(path.join(dir, 'e.docx'), { 'word/document.xml': xml });
    const result = await call<DocxResult>('read-docx-data', file);
    expect(result.html).toBe('<p>写 &amp;lt; 号</p>');
  });
});

interface ImportResult {
  previews: Array<{ fileName: string; content: string; sourcePath: string }>;
  errors: Array<{ filePath: string; error: string }>;
}

describe.each([
  ['import-file', ['docx', 'xlsx']],
  ['import-structured-file', ['docx', 'xlsx', 'md', 'txt', 'json']],
])('%s', (channel, extensions) => {
  it('取消或未选择文件时返回 null', async () => {
    await expect(call(channel)).resolves.toBeNull();
    dialogState.open = { canceled: false, filePaths: [] };
    await expect(call(channel)).resolves.toBeNull();
    expect(importFile).not.toHaveBeenCalled();
    const opts = showOpenDialog.mock.calls[0][0] as {
      filters: Array<{ extensions: string[] }>;
      properties: string[];
    };
    expect(opts.filters[0].extensions).toEqual(extensions);
    expect(opts.properties).toEqual(['openFile', 'multiSelections']);
  });

  it('逐个导入，成功进 previews，失败进 errors（含非 Error 抛出）', async () => {
    dialogState.open = { canceled: false, filePaths: ['/a.docx', '/b.xlsx', '/c.docx'] };
    importFile.mockImplementation(async (p: string) => {
      if (p === '/b.xlsx') throw new Error('格式错误');
      if (p === '/c.docx') throw 'boom';
      return { fileName: 'a.md', content: '# A', sourceType: 'docx' };
    });
    await expect(call<ImportResult>(channel)).resolves.toEqual({
      previews: [{ fileName: 'a.md', content: '# A', sourcePath: '/a.docx' }],
      errors: [
        { filePath: '/b.xlsx', error: '格式错误' },
        { filePath: '/c.docx', error: '未知错误' },
      ],
    });
  });
});

describe.each([
  ['export-to-word', exportToWord, '# 正文'],
  ['export-project-to-word', exportProjectToWord, '/proj'],
  ['export-to-pptx', exportToPptx, '# 幻灯片'],
  ['beautify-pptx', beautifyPptx, '/src.pptx'],
])('%s', (channel, fn, firstArg) => {
  it('成功时返回文件路径并透传参数', async () => {
    fn.mockResolvedValue('/out/file');
    const options = { title: 'T', author: 'A' };
    await expect(call(channel, firstArg, options)).resolves.toEqual({
      success: true,
      filePath: '/out/file',
    });
    expect(fn).toHaveBeenCalledWith(firstArg, options);
  });

  it('用户取消（返回空路径）时 success=false', async () => {
    fn.mockResolvedValue(null);
    await expect(call(channel, firstArg)).resolves.toEqual({ success: false, filePath: null });
  });

  it('异常被捕获为 error 字段', async () => {
    fn.mockRejectedValueOnce(new Error('磁盘已满'));
    await expect(call(channel, firstArg)).resolves.toEqual({ success: false, error: '磁盘已满' });
    fn.mockRejectedValueOnce(42);
    await expect(call(channel, firstArg)).resolves.toEqual({ success: false, error: '未知错误' });
  });
});
