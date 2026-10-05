import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

// 模拟 Electron 保存对话框：返回由测试控制的目标路径
const dialogEnv = vi.hoisted(() => ({
  savePath: '' as string,
  showSaveDialog: vi.fn(),
}));

vi.mock('electron', () => ({
  dialog: { showSaveDialog: dialogEnv.showSaveDialog },
}));

import {
  beautifyPptx,
  buildPptxBuffer,
  buildWordBuffer,
  exportProjectToWord,
  exportToPptx,
  exportToWord,
  loadJSZip,
} from '../../../src/main/document-exporter';
import { collectProjectTextFiles } from '../../../src/main/document-exporter/project';
import {
  extractSlideTexts,
  sortSlideFileNames,
} from '../../../src/main/document-exporter/pptx-beautify';

const SAMPLE = [
  '# 第一章 启程',
  '',
  '少年**林动**踏上了旅程，见 [设定](https://example.com)。',
  '',
  '### 技能',
  '- 火球术',
  '- 冰盾',
  '',
  '| 属性 | 数值 |',
  '| --- | --- |',
  '| 力量 | 12 |',
  '',
  '```',
  'level = 3',
  '```',
  '> 他回头看了一眼。',
  '---',
  '1. 一',
].join('\n');

let workDir = '';

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ne-export-'));
  dialogEnv.showSaveDialog.mockReset();
  dialogEnv.showSaveDialog.mockImplementation(async () => ({
    canceled: false,
    filePath: dialogEnv.savePath,
  }));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function readZipEntries(filePath: string) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(await readFile(filePath));
  return zip;
}

describe('document-exporter 导出', () => {
  it('buildWordBuffer 生成合法的 docx 压缩包', async () => {
    const buffer = await buildWordBuffer(SAMPLE, { title: '测试', author: '作者' });
    const JSZip = await loadJSZip();
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file('word/document.xml')?.async('text');
    expect(documentXml).toContain('林动');
    expect(documentXml).toContain('火球术');
    expect(documentXml).toContain('作者');
  });

  it('exportToWord 写入对话框选择的路径', async () => {
    dialogEnv.savePath = join(workDir, 'out.docx');
    const result = await exportToWord(SAMPLE, { title: '小说' });
    expect(result).toBe(dialogEnv.savePath);
    expect(dialogEnv.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({ title: '导出为 Word', defaultPath: '小说.docx' })
    );
    const zip = await readZipEntries(dialogEnv.savePath);
    expect(zip.file('[Content_Types].xml')).toBeTruthy();
    expect(zip.file('word/document.xml')).toBeTruthy();
  });

  it('用户取消保存时返回 null', async () => {
    dialogEnv.showSaveDialog.mockImplementation(async () => ({ canceled: true, filePath: '' }));
    expect(await exportToWord('hello')).toBeNull();
  });

  it('exportToPptx 生成合法的 pptx 压缩包', async () => {
    dialogEnv.savePath = join(workDir, 'out.pptx');
    const result = await exportToPptx(SAMPLE, { title: '演示' });
    expect(result).toBe(dialogEnv.savePath);
    const zip = await readZipEntries(dialogEnv.savePath);
    const slides = sortSlideFileNames(Object.keys(zip.files));
    // 封面 + 目录 + 章节页 + 至少一张内容页
    expect(slides.length).toBeGreaterThanOrEqual(4);
    const allText = (await Promise.all(slides.map((name) => zip.files[name].async('text')))).join(
      ''
    );
    expect(allText).toContain('第一章 启程');
    expect(allText).toContain('火球术');
  });

  it('beautifyPptx 读取现有 PPT 文本并重新生成', async () => {
    const source = join(workDir, 'source.pptx');
    await writeFile(source, await buildPptxBuffer('## 旧标题\n\n旧正文', { title: '源' }));
    dialogEnv.savePath = join(workDir, 'pretty.pptx');

    const result = await beautifyPptx(source);
    expect(result).toBe(dialogEnv.savePath);
    expect(dialogEnv.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'source.pptx' })
    );
    const zip = await readZipEntries(dialogEnv.savePath);
    const slides = sortSlideFileNames(Object.keys(zip.files));
    const allText = (await Promise.all(slides.map((name) => zip.files[name].async('text')))).join(
      ''
    );
    expect(allText).toContain('旧标题');
    expect(allText).toContain('旧正文');
  });

  it('exportProjectToWord 合并文件夹中的 md/txt 文件', async () => {
    const project = join(workDir, '我的小说');
    await mkdir(join(project, '.hidden'), { recursive: true });
    await mkdir(join(project, 'node_modules'), { recursive: true });
    await mkdir(join(project, '卷一'), { recursive: true });
    await writeFile(join(project, '卷一', '02.md'), '第二章内容');
    await writeFile(join(project, '卷一', '01.txt'), '第一章内容');
    await writeFile(join(project, '.hidden', 'x.md'), '隐藏');
    await writeFile(join(project, 'node_modules', 'y.md'), '依赖');
    await writeFile(join(project, 'cover.png'), 'binary');

    const files = await collectProjectTextFiles(project);
    expect(files.map((f) => f.slice(project.length + 1))).toEqual([
      join('卷一', '01.txt'),
      join('卷一', '02.md'),
    ]);

    dialogEnv.savePath = join(workDir, 'project.docx');
    const result = await exportProjectToWord(project);
    expect(result).toBe(dialogEnv.savePath);
    expect(dialogEnv.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: '我的小说.docx' })
    );
    const zip = await readZipEntries(dialogEnv.savePath);
    const documentXml = await zip.file('word/document.xml')?.async('text');
    expect(documentXml).toContain('第一章内容');
    expect(documentXml).toContain('第二章内容');
    expect(documentXml).not.toContain('隐藏');
  });

  it('空文件夹不导出', async () => {
    expect(await exportProjectToWord(workDir)).toBeNull();
    expect(dialogEnv.showSaveDialog).not.toHaveBeenCalled();
  });
});

describe('document-exporter/pptx-beautify 工具函数', () => {
  it('提取 slide XML 中的非空文本', () => {
    expect(extractSlideTexts('<a:t>标题</a:t><a:t>  </a:t><a:t> 正文 </a:t>')).toEqual([
      '标题',
      '正文',
    ]);
  });

  it('按序号排序幻灯片文件', () => {
    expect(
      sortSlideFileNames([
        'ppt/slides/slide10.xml',
        'ppt/slides/_rels/slide1.xml.rels',
        'ppt/slides/slide2.xml',
        'ppt/slides/slide1.xml',
      ])
    ).toEqual(['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml', 'ppt/slides/slide10.xml']);
  });
});
