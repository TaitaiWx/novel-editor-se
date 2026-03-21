import { extractOutline } from '@novel-editor/basic-algorithm';
import type { PersistedOutlineNodeInput } from '@/render/types/electron-api';
import { buildOutlineEntries, extractJsonBlock, splitTextIntoChunks } from './utils';

interface StructuredPreview {
  fileName: string;
  content: string;
  sourcePath: string;
}

interface OutlineAiNode {
  title?: string;
  content?: string;
  summary?: string;
  description?: string;
  anchorText?: string;
  lineHint?: number;
  line?: number;
  children?: OutlineAiNode[];
  items?: OutlineAiNode[];
}

interface ChunkFallback {
  title: string;
  content: string;
  anchorText: string;
  lineHint: number | null;
}

function summarizeText(value: string, maxLength = 180): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}

function createTitleFromChunk(chunk: string, index: number): string {
  const line = chunk
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);
  if (!line) return `导入片段 ${index + 1}`;
  const compact = line.replace(/^[#\-*\d.\s一二三四五六七八九十章节回卷]+/, '').trim();
  if (!compact) return `导入片段 ${index + 1}`;
  return compact.length <= 18 ? compact : `${compact.slice(0, 18)}...`;
}

function normalizeNodes(rawNodes: OutlineAiNode[], prefix = 'node'): PersistedOutlineNodeInput[] {
  return rawNodes
    .map((node, index) => {
      const title = (node.title || '').trim() || `${prefix}-${index + 1}`;
      const content = summarizeText(node.content || node.summary || node.description || '');
      const children = Array.isArray(node.children)
        ? normalizeNodes(node.children, `${prefix}-${index + 1}`)
        : Array.isArray(node.items)
          ? normalizeNodes(node.items, `${prefix}-${index + 1}`)
          : [];
      return {
        title,
        content,
        anchorText: (node.anchorText || node.title || '').trim(),
        lineHint:
          typeof node.lineHint === 'number'
            ? node.lineHint
            : typeof node.line === 'number'
              ? node.line
              : null,
        sortOrder: index,
        children,
      };
    })
    .filter((node) => node.title.trim());
}

function parseAiOutlineResponse(raw: string): PersistedOutlineNodeInput[] | null {
  const jsonBlock = extractJsonBlock(raw);
  if (!jsonBlock) return null;

  try {
    const parsed = JSON.parse(jsonBlock) as
      | OutlineAiNode[]
      | { outlines?: OutlineAiNode[]; chapters?: OutlineAiNode[]; items?: OutlineAiNode[] };
    const rawNodes = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.outlines)
        ? parsed.outlines
        : Array.isArray(parsed.chapters)
          ? parsed.chapters
          : Array.isArray(parsed.items)
            ? parsed.items
            : [];

    const normalized = normalizeNodes(rawNodes, 'outline');
    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

function buildChunkFallbacks(content: string): ChunkFallback[] {
  const lines = content.split(/\r?\n/);
  const chunks = splitTextIntoChunks(content, 1800);
  if (chunks.length === 0) return [];

  const results: ChunkFallback[] = [];
  let cursor = 0;
  chunks.forEach((chunk, index) => {
    const anchorText =
      chunk
        .split(/\r?\n/)
        .map((item) => item.trim())
        .find(Boolean) || createTitleFromChunk(chunk, index);
    let lineHint: number | null = null;
    for (let lineIndex = cursor; lineIndex < lines.length; lineIndex += 1) {
      if (lines[lineIndex].trim() && anchorText.includes(lines[lineIndex].trim())) {
        lineHint = lineIndex + 1;
        cursor = lineIndex + 1;
        break;
      }
    }
    results.push({
      title: createTitleFromChunk(chunk, index),
      content: summarizeText(chunk),
      anchorText,
      lineHint,
    });
  });

  return results;
}

function buildFallbackOutline(content: string): PersistedOutlineNodeInput[] {
  const headings = extractOutline(content, { enableHeuristic: false });
  const entries = buildOutlineEntries(content, headings);
  const meaningfulEntries = entries.filter((entry) => entry.text.trim());

  if (
    meaningfulEntries.length > 1 ||
    (meaningfulEntries.length === 1 && !meaningfulEntries[0].needsAiTitle)
  ) {
    return meaningfulEntries.map((entry, index) => ({
      title: entry.text,
      content: summarizeText(entry.summary),
      anchorText: entry.originalText || entry.text,
      lineHint: entry.line,
      sortOrder: index,
      children: [],
    }));
  }

  const chunks = buildChunkFallbacks(content);
  if (chunks.length === 0) return [];
  return chunks.map((chunk, index) => ({
    title: chunk.title,
    content: chunk.content,
    anchorText: chunk.anchorText,
    lineHint: chunk.lineHint,
    sortOrder: index,
    children: [],
  }));
}

async function requestAiOutline(content: string): Promise<PersistedOutlineNodeInput[] | null> {
  const ipc = window.electron?.ipcRenderer;
  if (!ipc) return null;

  const response = (await ipc.invoke('ai-request', {
    prompt:
      '请把原始大纲或章节文本解析为结构化小说目录。只返回 JSON。每个节点必须包含 title，可选 content 和 children。content 只保留 1 句摘要，不超过 80 个字。不要输出解释、Markdown 或额外文本。',
    systemPrompt:
      '你是小说大纲结构化助手。你只能输出严格 JSON，格式为数组，元素为 {"title":"","content":"","children":[]}。',
    context: `待解析文本:\n${content.slice(0, 12000)}`,
    maxTokens: 4096,
    temperature: 0.2,
  })) as { ok: boolean; text?: string; error?: string };

  if (!response.ok || !response.text) {
    return null;
  }

  return parseAiOutlineResponse(response.text);
}

function getFileTitle(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').trim() || '导入大纲';
}

export async function buildOutlineTreeFromImports(
  previews: StructuredPreview[],
  aiReady: boolean
): Promise<PersistedOutlineNodeInput[]> {
  const trees: PersistedOutlineNodeInput[] = [];

  for (const preview of previews) {
    const rawContent = preview.content.trim();
    if (!rawContent) continue;

    const aiNodes = aiReady ? await requestAiOutline(rawContent) : null;
    const fallbackNodes =
      aiNodes && aiNodes.length > 0 ? aiNodes : buildFallbackOutline(rawContent);
    if (fallbackNodes.length === 0) continue;

    if (previews.length === 1) {
      trees.push(...fallbackNodes.map((item, index) => ({ ...item, sortOrder: index })));
      continue;
    }

    trees.push({
      title: getFileTitle(preview.fileName),
      content: summarizeText(rawContent),
      sortOrder: trees.length,
      children: fallbackNodes,
    });
  }

  return trees.map((item, index) => ({ ...item, sortOrder: index }));
}

export function buildOutlineTreeFromContent(content: string): PersistedOutlineNodeInput[] {
  return buildFallbackOutline(content).map((item, index) => ({ ...item, sortOrder: index }));
}
