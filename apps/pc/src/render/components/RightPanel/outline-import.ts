import { extractOutline } from '@novel-editor/basic-algorithm';
import type { PersistedOutlineNodeInput } from '@/render/types/electron-api';
import { buildOutlineEntries, extractJsonBlock, splitTextIntoChunks } from './utils';

export type OutlineAiStyle = 'balanced' | 'cinematic' | 'detailed' | 'suspense';
export type OutlineAiGranularity = 'coarse' | 'medium' | 'fine';

export interface OutlineAiGenerationOptions {
  style: OutlineAiStyle;
  granularity: OutlineAiGranularity;
  maxDepth: number;
}

export const DEFAULT_OUTLINE_AI_OPTIONS: OutlineAiGenerationOptions = {
  style: 'balanced',
  granularity: 'medium',
  maxDepth: 3,
};

export const OUTLINE_AI_STYLE_LABELS: Record<OutlineAiStyle, string> = {
  balanced: '均衡',
  cinematic: '电影感',
  detailed: '细纲',
  suspense: '悬疑钩子',
};

export const OUTLINE_AI_GRANULARITY_LABELS: Record<OutlineAiGranularity, string> = {
  coarse: '粗',
  medium: '中',
  fine: '细',
};

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

function clampDepth(value: number): number {
  return Math.min(4, Math.max(1, value));
}

function limitTreeDepth(
  nodes: PersistedOutlineNodeInput[],
  maxDepth: number,
  currentDepth = 1
): PersistedOutlineNodeInput[] {
  return nodes.map((node) => ({
    ...node,
    children:
      currentDepth >= maxDepth
        ? []
        : limitTreeDepth(node.children || [], maxDepth, currentDepth + 1),
  }));
}

function buildAiOutlinePrompt(options: OutlineAiGenerationOptions): string {
  const styleInstructions: Record<OutlineAiStyle, string> = {
    balanced: '风格要求：结构均衡，优先提炼稳定的章节骨架与核心推进。',
    cinematic: '风格要求：强调戏剧节拍、场景推进和画面感，适合影视化拆分。',
    detailed: '风格要求：尽量细化为可直接写作的细纲，保留关键事件与推进节点。',
    suspense: '风格要求：突出悬念、反转、钩子和信息揭示节奏。',
  };

  const granularityInstructions: Record<OutlineAiGranularity, string> = {
    coarse: '粒度要求：偏粗粒度，优先输出卷/章级结构，不要过度拆分场景。',
    medium: '粒度要求：中等粒度，优先输出章/节级结构。',
    fine: '粒度要求：偏细粒度，可以拆到章节下的场景或关键 beat。',
  };

  return [
    '请把原始大纲或章节文本解析为结构化小说目录。只返回 JSON。',
    '每个节点必须包含 title，可选 content 和 children。',
    'content 只保留 1 句摘要，不超过 80 个字。',
    `层级要求：最多 ${clampDepth(options.maxDepth)} 层，不能超过该层级深度。`,
    styleInstructions[options.style],
    granularityInstructions[options.granularity],
    '不要输出解释、Markdown 或额外文本。',
  ].join(' ');
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

export async function requestAiOutline(
  content: string,
  options: OutlineAiGenerationOptions = DEFAULT_OUTLINE_AI_OPTIONS
): Promise<PersistedOutlineNodeInput[] | null> {
  const ipc = window.electron?.ipcRenderer;
  if (!ipc) return null;

  const response = (await ipc.invoke('ai-request', {
    prompt: buildAiOutlinePrompt(options),
    systemPrompt:
      '你是小说大纲结构化助手。你只能输出严格 JSON，格式为数组，元素为 {"title":"","content":"","children":[]}。',
    context: `待解析文本:\n${content.slice(0, 12000)}`,
    maxTokens: 4096,
    temperature: 0.2,
  })) as { ok: boolean; text?: string; error?: string };

  if (!response.ok || !response.text) {
    return null;
  }

  const parsed = parseAiOutlineResponse(response.text);
  if (!parsed || parsed.length === 0) {
    return null;
  }

  return limitTreeDepth(parsed, clampDepth(options.maxDepth));
}

export async function buildOutlineTreeFromAi(
  content: string,
  aiReady: boolean,
  options: OutlineAiGenerationOptions = DEFAULT_OUTLINE_AI_OPTIONS
): Promise<PersistedOutlineNodeInput[]> {
  const rawContent = content.trim();
  if (!rawContent || !aiReady) return [];

  const aiNodes = await requestAiOutline(rawContent, options);
  if (!aiNodes || aiNodes.length === 0) {
    return [];
  }

  return aiNodes.map((item, index) => ({ ...item, sortOrder: index }));
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

export async function buildOutlineTreeFromContent(
  content: string,
  aiReady: boolean
): Promise<PersistedOutlineNodeInput[]> {
  const rawContent = content.trim();
  if (!rawContent) return [];

  const aiNodes = aiReady ? await requestAiOutline(rawContent) : null;
  const nodes = aiNodes && aiNodes.length > 0 ? aiNodes : buildFallbackOutline(rawContent);
  return nodes.map((item, index) => ({ ...item, sortOrder: index }));
}
