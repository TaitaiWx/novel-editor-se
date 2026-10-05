/** PPT 美化：读取现有 PPT 中的文本，使用统一主题重新生成 */
import { readFile } from 'fs/promises';
import path from 'path';
import type JSZip from 'jszip';
import { loadJSZip } from './jszip';
import { exportToPptx } from './pptx';
import type { PptxExportOptions } from './pptx';

/** 从 slide XML 中提取所有非空 <a:t> 文本 */
export function extractSlideTexts(xml: string): string[] {
  const texts: string[] = [];
  const textMatches = xml.matchAll(/<a:t>([^<]*)<\/a:t>/g);
  for (const m of textMatches) {
    const text = m[1].trim();
    if (text) texts.push(text);
  }
  return texts;
}

/** 按幻灯片序号排序 ppt/slides/slideN.xml */
export function sortSlideFileNames(fileNames: string[]): string[] {
  return fileNames
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/)?.[1] || '0');
      const numB = parseInt(b.match(/slide(\d+)/)?.[1] || '0');
      return numA - numB;
    });
}

/** 将已加载的 PPT zip 转换为 Markdown（每页第一行视为标题，其余为正文） */
export async function pptxZipToMarkdown(zip: JSZip): Promise<string> {
  const slideFiles = sortSlideFileNames(Object.keys(zip.files));

  const slideTexts: string[] = [];
  for (const slideFile of slideFiles) {
    const xml = await zip.files[slideFile].async('text');
    const texts = extractSlideTexts(xml);
    if (texts.length > 0) {
      // 第一行视为标题，其余为正文
      slideTexts.push(`## ${texts[0]}\n\n${texts.slice(1).join('\n\n')}`);
    }
  }

  return slideTexts.join('\n\n---\n\n');
}

export async function beautifyPptx(
  sourcePath: string,
  options: PptxExportOptions = {}
): Promise<string | null> {
  const buf = await readFile(sourcePath);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

  const JSZipCtor = await loadJSZip();

  const zip = await JSZipCtor.loadAsync(new Uint8Array(arrayBuffer));

  // 组装为 Markdown 再用美化主题导出
  const markdown = await pptxZipToMarkdown(zip);
  const title = options.title || path.basename(sourcePath, path.extname(sourcePath));
  return exportToPptx(markdown, { ...options, title });
}
