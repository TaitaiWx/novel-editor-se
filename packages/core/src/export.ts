/**
 * 格式转换与导出（txt / md / docx）
 *
 * - md → txt：去除 Markdown 标记，保留正文
 * - txt → md：每个非空行作为一个段落（段落之间空一行）
 * - * → docx：标题行（# 开头）映射为 Word 标题，其余为正文段落
 */
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { CoreError } from './errors';
import { isStoryFile, walkFiles } from './fs-ops';
import { listChapters, resolveNovelPath, type Project } from './project';

export type ExportFormat = 'txt' | 'md' | 'docx';
export const EXPORT_FORMATS: readonly ExportFormat[] = ['txt', 'md', 'docx'];

export function parseExportFormat(
  value: string | undefined,
  fallback?: ExportFormat
): ExportFormat {
  const normalized = (value ?? fallback ?? '').replace(/^\./, '').toLowerCase();
  const mapped = normalized === 'markdown' ? 'md' : normalized;
  if ((EXPORT_FORMATS as readonly string[]).includes(mapped)) return mapped as ExportFormat;
  throw new CoreError(
    'INVALID_ARGUMENT',
    `不支持的格式: ${value ?? '(空)'}（可选: ${EXPORT_FORMATS.join(' | ')}）`
  );
}

/** 根据扩展名判断源格式（只认 md / txt） */
export function detectSourceFormat(filePath: string): 'md' | 'txt' {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.md' || ext === '.markdown' ? 'md' : 'txt';
}

export function markdownToPlainText(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const output: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      output.push(line);
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      output.push('');
      continue;
    }
    const text = line
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/\s+#+\s*$/, '')
      .replace(/^\s{0,3}>\s?/, '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(\*|_)(\S(?:.*?\S)?)\1/g, '$2')
      .replace(/~~(.+?)~~/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/<[^>]+>/g, '');
    output.push(text);
  }
  return output.join('\n').replace(/\n{3,}/g, '\n\n');
}

export function plainTextToMarkdown(text: string): string {
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim());
  return paragraphs.length ? `${paragraphs.join('\n\n')}\n` : '';
}

/** 在两种文本格式之间转换内容 */
export function convertText(content: string, from: 'md' | 'txt', to: 'md' | 'txt'): string {
  if (from === to) return content;
  return from === 'md' ? markdownToPlainText(content) : plainTextToMarkdown(content);
}

const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

export interface DocxSection {
  /** 章节标题（为空则不额外插入标题） */
  title?: string;
  content: string;
  format: 'md' | 'txt';
}

/** 生成 docx 二进制；每个 section 的标题自动分页 */
export async function buildDocx(sections: DocxSection[], documentTitle?: string): Promise<Buffer> {
  const children: Paragraph[] = [];
  if (documentTitle) {
    children.push(new Paragraph({ text: documentTitle, heading: HeadingLevel.TITLE }));
  }
  sections.forEach((section, sectionIndex) => {
    const pageBreak = sectionIndex > 0 || Boolean(documentTitle);
    let firstHeadingUsed = false;
    if (section.title) {
      children.push(
        new Paragraph({
          text: section.title,
          heading: HeadingLevel.HEADING_1,
          pageBreakBefore: pageBreak,
        })
      );
      firstHeadingUsed = true;
    }
    for (const line of section.content.replace(/\r\n/g, '\n').split('\n')) {
      if (!line.trim()) continue;
      const heading = section.format === 'md' ? /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line) : null;
      if (heading) {
        children.push(
          new Paragraph({
            text: heading[2].replace(/\s+#+\s*$/, ''),
            heading: HEADING_LEVELS[heading[1].length - 1],
            pageBreakBefore: !firstHeadingUsed && pageBreak && heading[1].length === 1,
          })
        );
        firstHeadingUsed = true;
        continue;
      }
      const text = section.format === 'md' ? markdownToPlainText(line) : line;
      children.push(new Paragraph({ children: [new TextRun(text.trim())] }));
    }
  });
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

export interface ExportedFile {
  source: string;
  output: string;
}

async function writeOutput(target: string, data: string | Buffer): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, data);
}

/** 把单个正文文件转换为目标格式并写入 output */
export async function exportFile(
  source: string,
  output: string,
  format: ExportFormat
): Promise<void> {
  const content = await readFile(source, 'utf-8');
  const from = detectSourceFormat(source);
  if (format === 'docx') {
    await writeOutput(output, await buildDocx([{ content, format: from }]));
  } else {
    await writeOutput(output, convertText(content, from, format));
  }
}

function replaceExtension(file: string, format: ExportFormat): string {
  return `${file.slice(0, file.length - path.extname(file).length)}.${format}`;
}

/** 批量导出：把 target 下的所有正文文件按原目录结构导出到 outDir */
export async function batchExport(
  target: string,
  format: ExportFormat,
  outDir: string
): Promise<ExportedFile[]> {
  const absTarget = path.resolve(target);
  const absOut = path.resolve(outDir);
  const files = (await walkFiles(absTarget, { storyOnly: true })).filter(
    (file) => !file.startsWith(absOut + path.sep)
  );
  const isSingleFile = files.length === 1 && files[0] === absTarget;
  const result: ExportedFile[] = [];
  for (const file of files) {
    const relative = isSingleFile ? path.basename(file) : path.relative(absTarget, file);
    const output = replaceExtension(path.join(absOut, relative), format);
    await exportFile(file, output, format);
    result.push({ source: file, output });
  }
  return result;
}

export interface ConvertOptions {
  /** 输出目录；不传则输出到源文件旁边 */
  outDir?: string;
  /** 转换成功后删除源文件 */
  deleteSource?: boolean;
}

/** 批量格式转换：只处理扩展名为 from 的文件 */
export async function batchConvert(
  target: string,
  from: ExportFormat,
  to: ExportFormat,
  options: ConvertOptions = {}
): Promise<ExportedFile[]> {
  if (from === 'docx')
    throw new CoreError('UNSUPPORTED', '暂不支持从 docx 转换（只支持 md/txt 作为源格式）');
  if (from === to) throw new CoreError('INVALID_ARGUMENT', '--from 与 --to 不能相同');
  const absTarget = path.resolve(target);
  const files = (await walkFiles(absTarget, { storyOnly: true })).filter(
    (file) => detectSourceFormat(file) === from && isStoryFile(file)
  );
  const base = (await stat(absTarget)).isFile() ? path.dirname(absTarget) : absTarget;
  const result: ExportedFile[] = [];
  for (const file of files) {
    const output = options.outDir
      ? replaceExtension(path.join(path.resolve(options.outDir), path.relative(base, file)), to)
      : replaceExtension(file, to);
    await exportFile(file, output, to);
    if (options.deleteSource && output !== file) await rm(file);
    result.push({ source: file, output });
  }
  return result;
}

export interface NovelExportResult {
  novel: string;
  format: ExportFormat;
  output: string;
  chapterCount: number;
}

function ensureChapterHeading(title: string, content: string): string {
  const trimmed = content.replace(/^\uFEFF/, '').trimStart();
  return /^#{1,6}\s/.test(trimmed) ? trimmed : `# ${title}\n\n${trimmed}`;
}

/** 导出整部作品为单个文件（按章节顺序拼接） */
export async function exportNovel(
  project: Project,
  novel: string,
  format: ExportFormat,
  output: string
): Promise<NovelExportResult> {
  await resolveNovelPath(project, novel);
  const chapters = await listChapters(project, novel);
  const parts: Array<{ title: string; content: string; format: 'md' | 'txt' }> = [];
  for (const chapter of chapters) {
    parts.push({
      title: chapter.title,
      content: await readFile(chapter.path, 'utf-8'),
      format: detectSourceFormat(chapter.path),
    });
  }

  const absOutput = path.resolve(output);
  if (format === 'docx') {
    const sections = parts.map((part) => ({
      format: 'md' as const,
      content: ensureChapterHeading(part.title, convertText(part.content, part.format, 'md')),
    }));
    await writeOutput(absOutput, await buildDocx(sections, novel));
  } else if (format === 'md') {
    const body = parts
      .map((part) =>
        ensureChapterHeading(part.title, convertText(part.content, part.format, 'md')).trimEnd()
      )
      .join('\n\n');
    await writeOutput(absOutput, `${body}\n`);
  } else {
    const body = parts
      .map((part) => {
        const md = ensureChapterHeading(part.title, convertText(part.content, part.format, 'md'));
        return markdownToPlainText(md).trim();
      })
      .join('\n\n\n');
    await writeOutput(absOutput, `${novel}\n\n\n${body}\n`);
  }
  return { novel, format, output: absOutput, chapterCount: chapters.length };
}
