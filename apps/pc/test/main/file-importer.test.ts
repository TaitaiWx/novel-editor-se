import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';

interface MammothResult {
  value: string;
  messages: Array<{ message: string }>;
}

const mammothMock = vi.hoisted(() => ({
  convertToHtml: vi.fn<(input: { buffer: Buffer }) => Promise<MammothResult>>(),
  extractRawText: vi.fn<(input: { buffer: Buffer }) => Promise<{ value: string }>>(),
}));

vi.mock('mammoth', () => ({ default: mammothMock, ...mammothMock }));

import { SUPPORTED_IMPORT_EXTENSIONS, importFile } from '../../src/main/file-importer';

let dir: string;
let counter = 0;

function writeTemp(ext: string, data: Buffer | string): string {
  counter += 1;
  const filePath = join(dir, `file-${counter}${ext}`);
  writeFileSync(filePath, data);
  return filePath;
}

async function makeDocxZip(documentXml: string | null): Promise<Buffer> {
  const zip = new JSZip();
  if (documentXml !== null) zip.file('word/document.xml', documentXml);
  zip.file('other.txt', 'x');
  return zip.generateAsync({ type: 'nodebuffer' });
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ne-import-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  mammothMock.convertToHtml.mockReset();
  mammothMock.extractRawText.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('importFile 分发', () => {
  it('列出支持的扩展名', () => {
    expect(SUPPORTED_IMPORT_EXTENSIONS).toEqual(['.doc', '.docx', '.xlsx', '.md', '.txt', '.json']);
  });

  it('不支持的格式抛错', async () => {
    await expect(importFile('/x/a.pdf')).rejects.toThrow('不支持的文件格式: .pdf');
    await expect(importFile('/x/noext')).rejects.toThrow('不支持的文件格式: ');
  });

  it('.doc 旧格式给出另存为提示', async () => {
    await expect(importFile('/x/a.doc')).rejects.toThrow(/另存为 \.docx/);
  });

  it('扩展名大小写不敏感', async () => {
    const p = writeTemp('.MD', '# hi');
    const result = await importFile(p);
    expect(result.sourceType).toBe('md');
    expect(result.content).toBe('# hi');
  });
});

describe('文本文件导入与编码识别', () => {
  it('UTF-8 文本，CRLF/CR 统一为 LF，保留原文件名', async () => {
    const p = writeTemp('.txt', '第一行\r\n第二行\r第三行');
    const result = await importFile(p);
    expect(result).toEqual({
      fileName: p.split(/[\\/]/).pop(),
      content: '第一行\n第二行\n第三行',
      sourceType: 'txt',
    });
  });

  it('json 文件 sourceType 为 json', async () => {
    const p = writeTemp('.json', '{"a":1}');
    expect((await importFile(p)).sourceType).toBe('json');
  });

  it('空文件返回空字符串', async () => {
    const p = writeTemp('.txt', Buffer.alloc(0));
    expect((await importFile(p)).content).toBe('');
  });

  it('去除 UTF-8 BOM', async () => {
    const p = writeTemp(
      '.md',
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('标题')])
    );
    expect((await importFile(p)).content).toBe('标题');
  });

  it('UTF-16 LE BOM', async () => {
    const p = writeTemp(
      '.txt',
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('你好 world', 'utf16le')])
    );
    expect((await importFile(p)).content).toBe('你好 world');
  });

  it('UTF-16 BE BOM', async () => {
    const le = Buffer.from('Hello 世界', 'utf16le');
    const be = Buffer.from(le).swap16();
    const p = writeTemp('.txt', Buffer.concat([Buffer.from([0xfe, 0xff]), be]));
    expect((await importFile(p)).content).toBe('Hello 世界');
  });

  it('无 BOM 的 UTF-16 LE/BE 通过空字节分布推断', async () => {
    const le = Buffer.from('plain ascii text', 'utf16le');
    expect((await importFile(writeTemp('.txt', le))).content).toBe('plain ascii text');
    const be = Buffer.from(le).swap16();
    expect((await importFile(writeTemp('.txt', be))).content).toBe('plain ascii text');
  });

  it('GBK/GB18030 编码文本被正确解码', async () => {
    // "中文小说第一章" 的 GBK 编码
    const gbk = Buffer.from([
      0xd6, 0xd0, 0xce, 0xc4, 0xd0, 0xa1, 0xcb, 0xb5, 0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2,
    ]);
    expect((await importFile(writeTemp('.txt', gbk))).content).toBe('中文小说第一章');
  });

  it('UTF-8 文本优先于 GB18030 误解码', async () => {
    const p = writeTemp('.txt', '纯正的 UTF-8 中文内容');
    expect((await importFile(p)).content).toBe('纯正的 UTF-8 中文内容');
  });

  it('少量空字节被剔除', async () => {
    const p = writeTemp('.txt', Buffer.from('abcdefghij\0klmnopqrstuvwxyz'));
    expect((await importFile(p)).content).toBe('abcdefghijklmnopqrstuvwxyz');
  });

  it('运行时不支持 gb18030 TextDecoder 时回退到 iconv-lite', async () => {
    const RealTextDecoder = globalThis.TextDecoder;
    class LimitedTextDecoder extends RealTextDecoder {
      constructor(label?: string, options?: TextDecoderOptions) {
        if (label === 'gb18030') throw new RangeError('unsupported');
        super(label, options);
      }
    }
    vi.stubGlobal('TextDecoder', LimitedTextDecoder);
    try {
      const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xd0, 0xa1, 0xcb, 0xb5]);
      expect((await importFile(writeTemp('.txt', gbk))).content).toBe('中文小说');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('docx 导入', () => {
  it('mammoth HTML 转 Markdown（标题/粗斜体/列表/实体/换行）', async () => {
    mammothMock.convertToHtml.mockResolvedValue({
      value:
        '<h1>第一章</h1><h2 class="x">  小节 </h2>' +
        '<p>他说<strong>重</strong>与<b>粗</b>，<em>斜</em><i>体</i></p>' +
        '<ul><li>甲</li><li>乙</li></ul>' +
        '<p>A&amp;B &lt;tag&gt; &quot;q&quot; &#39;s&#39;&nbsp;end<br/>next</p>' +
        '<table><tr><td>cell</td></tr></table>',
      messages: [{ message: 'unrecognised style' }],
    });
    const p = writeTemp('.docx', 'dummy');
    const result = await importFile(p);
    expect(result.sourceType).toBe('docx');
    expect(result.fileName).toMatch(/^file-\d+\.md$/);
    expect(result.content).toBe(
      '# 第一章\n\n## 小节\n\n他说**重**与**粗**，*斜**体*\n\n- 甲\n- 乙\n\n' +
        'A&B <tag> "q" \'s\' end\nnext\n\ncell\n'
    );
    expect(console.warn).toHaveBeenCalled();
  });

  it('HTML 为空时回退到 extractRawText', async () => {
    mammothMock.convertToHtml.mockResolvedValue({ value: '<p></p>', messages: [] });
    mammothMock.extractRawText.mockResolvedValue({ value: '  原始文本  ' });
    const result = await importFile(writeTemp('.docx', 'dummy'));
    expect(result.content).toBe('原始文本\n');
  });

  it('mammoth 失败时回退到 ZIP/XML 解析', async () => {
    mammothMock.convertToHtml.mockRejectedValue(new Error('corrupt'));
    const xml =
      '<w:document><w:body>' +
      '<w:p><w:r><w:t>第一段</w:t></w:r><w:r><w:t xml:space="preserve"> &amp; 续 </w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>前</w:t><w:tab/><w:t>后</w:t><w:br/><w:t>&lt;下一行&gt;</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>   </w:t></w:r></w:p>' +
      '<w:p/>' +
      '</w:body></w:document>';
    const p = writeTemp('.docx', await makeDocxZip(xml));
    const result = await importFile(p);
    expect(result.content).toBe('第一段 & 续\n\n前后<下一行>\n');
  });

  it('rawText 也为空时回退到 ZIP/XML', async () => {
    mammothMock.convertToHtml.mockResolvedValue({ value: '', messages: [] });
    mammothMock.extractRawText.mockResolvedValue({ value: '' });
    const xml = '<w:p><w:r><w:t>兜底</w:t></w:r></w:p>';
    const result = await importFile(writeTemp('.docx', await makeDocxZip(xml)));
    expect(result.content).toBe('兜底\n');
  });

  it('所有方式均无文本时抛错', async () => {
    mammothMock.convertToHtml.mockRejectedValue(new Error('corrupt'));
    await expect(importFile(writeTemp('.docx', await makeDocxZip(null)))).rejects.toThrow(
      /未提取到可用文本内容/
    );
    await expect(
      importFile(writeTemp('.docx', await makeDocxZip('<w:p><w:r><w:t> </w:t></w:r></w:p>')))
    ).rejects.toThrow(/未提取到可用文本内容/);
  });
});

describe('xlsx 导入', () => {
  it('每个 Sheet 转为 Markdown 表格', async () => {
    const workbook = new ExcelJS.Workbook();
    const roles = workbook.addWorksheet('角色');
    roles.addRow(['姓名', '等级', '备注']);
    roles.addRow(['亚瑟', 5, 'a|b']);
    roles.getCell('A3').value = { richText: [{ text: '梅' }, { text: '林' }] };
    roles.getCell('B3').value = { formula: 'B2*2', result: 10 };
    roles.getCell('D3').value = '多\n行';
    workbook.addWorksheet('空表');
    const second = workbook.addWorksheet('地图');
    second.addRow(['地点']);
    second.getCell('C2').value = '远处';
    const p = join(dir, 'world.xlsx');
    await workbook.xlsx.writeFile(p);

    const result = await importFile(p);
    expect(result.fileName).toBe('world.md');
    expect(result.sourceType).toBe('xlsx');
    expect(result.content).toBe(
      [
        '## 角色',
        '',
        '| 姓名 | 等级 | 备注 |  |',
        '| --- | --- | --- | --- |',
        '| 亚瑟 | 5 | a\\|b |  |',
        '| 梅林 | 10 |  | 多 行 |',
        '',
        '## 地图',
        '',
        '| 地点 |  |  |',
        '| --- | --- | --- |',
        '|  |  | 远处 |',
      ].join('\n')
    );
  });

  // 回归：单元格值提取曾只处理 richText / result 两种对象，未缓存结果的公式
  // ({ formula } 无 result 键)、超链接 ({ text, hyperlink }) 等对象值会被 String()
  // 成 "[object Object]"。
  it('未缓存结果的公式单元格不应输出 [object Object]', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('S');
    sheet.getCell('A1').value = { formula: '1+1' } as ExcelJS.CellFormulaValue;
    const p = join(dir, 'formula.xlsx');
    await workbook.xlsx.writeFile(p);
    const result = await importFile(p);
    expect(result.content).not.toContain('[object Object]');
  });

  it('超链接单元格应输出链接文本而不是 [object Object]', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('S');
    sheet.getCell('A1').value = { text: '设定集', hyperlink: 'https://example.com' };
    const p = join(dir, 'link.xlsx');
    await workbook.xlsx.writeFile(p);
    const result = await importFile(p);
    expect(result.content).toContain('设定集');
  });

  it('日期、错误值、富文本超链接、公式结果为对象时均渲染为可读文本', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('S');
    sheet.getCell('A1').value = new Date(Date.UTC(2024, 0, 2));
    sheet.getCell('B1').value = { error: '#N/A' } as ExcelJS.CellErrorValue;
    sheet.getCell('C1').value = {
      text: { richText: [{ text: '规则' }, { text: '之书' }] },
      hyperlink: 'https://example.com',
    };
    sheet.getCell('D1').value = {
      formula: 'NA()',
      result: { error: '#N/A' },
    } as ExcelJS.CellFormulaValue;
    sheet.getCell('E1').value = { formula: '1+1' } as ExcelJS.CellFormulaValue;
    const p = join(dir, 'mixed.xlsx');
    await workbook.xlsx.writeFile(p);
    const result = await importFile(p);
    expect(result.content).not.toContain('[object Object]');
    expect(result.content).toContain('| 2024-01-02 | #N/A | 规则之书 | #N/A | =1+1 |');
  });
});
