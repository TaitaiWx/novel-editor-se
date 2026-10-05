/**
 * 大纲条目的纯函数工具：数据库行 → 树 / 扁平条目、锚点行号解析、版本命名与写库
 * 从 useOutlineEntries 拆出
 */
import type {
  OutlineVersionSource,
  PersistedOutlineNodeInput,
  PersistedOutlineScopeInput,
  PersistedOutlineRow,
} from '@/render/types/electron-api';
import type { OutlineEntry } from './types';
import { fnv1a32 } from './utils';

export interface SaveOutlineVersionInput {
  name: string;
  source: OutlineVersionSource;
  note?: string;
  entries?: PersistedOutlineNodeInput[];
  silentStatus?: boolean;
}

export function buildPersistedTreeFromRows(
  rows: PersistedOutlineRow[]
): PersistedOutlineNodeInput[] {
  if (rows.length === 0) return [];

  const childrenMap = new Map<number | null, PersistedOutlineRow[]>();
  rows.forEach((row) => {
    const key = row.parent_id ?? null;
    const bucket = childrenMap.get(key);
    if (bucket) bucket.push(row);
    else childrenMap.set(key, [row]);
  });

  for (const bucket of childrenMap.values()) {
    bucket.sort((left, right) => left.sort_order - right.sort_order || left.id - right.id);
  }

  const visit = (parentId: number | null): PersistedOutlineNodeInput[] => {
    const nodes = childrenMap.get(parentId) || [];
    return nodes.map((row, index) => ({
      title: row.title,
      content: row.content,
      anchorText: row.anchor_text,
      lineHint: row.line_hint,
      sortOrder: row.sort_order ?? index,
      children: visit(row.id),
    }));
  };

  return visit(null);
}

export function buildOutlineVersionName(source: OutlineVersionSource): string {
  const labels: Record<OutlineVersionSource, string> = {
    import: '导入大纲',
    rebuild: '正文重建',
    ai: 'AI 生成',
    manual: '手工保存',
  };
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${labels[source]} ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function normalizeAnchorText(value: string): string {
  return value
    .replace(/^#+\s*/, '')
    .replace(/[：:]+$/, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

function buildAnchorIndex(lines: string[]): Map<string, number> {
  const index = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const norm = normalizeAnchorText(lines[i]);
    if (norm && !index.has(norm)) {
      index.set(norm, i + 1);
    }
  }
  return index;
}

function resolveAnchorLineIndexed(
  anchorIndex: Map<string, number>,
  lines: string[],
  title: string,
  anchorText: string,
  lineHint: number | null
): number | null {
  const candidates = [anchorText, title].map((item) => normalizeAnchorText(item)).filter(Boolean);
  if (candidates.length === 0) {
    return typeof lineHint === 'number' && lineHint > 0 ? lineHint : null;
  }

  // Fast path: exact match in index
  for (const candidate of candidates) {
    const exact = anchorIndex.get(candidate);
    if (exact !== undefined) return exact;
  }

  // Fallback: substring match near lineHint
  const isMatch = (rawLine: string) => {
    const normalizedLine = normalizeAnchorText(rawLine);
    return candidates.some(
      (candidate) => normalizedLine === candidate || normalizedLine.includes(candidate)
    );
  };

  if (typeof lineHint === 'number' && lineHint > 0 && lineHint <= lines.length) {
    const windowStart = Math.max(0, lineHint - 4);
    const windowEnd = Math.min(lines.length, lineHint + 3);
    for (let index = windowStart; index < windowEnd; index += 1) {
      if (isMatch(lines[index])) return index + 1;
    }
  }

  return typeof lineHint === 'number' && lineHint > 0 ? lineHint : null;
}

function summarizeContent(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  return compact.length <= 180 ? compact : `${compact.slice(0, 180)}...`;
}

export function buildEntriesFromRows(rows: PersistedOutlineRow[], content: string): OutlineEntry[] {
  if (rows.length === 0) return [];
  const lines = content.split(/\r?\n/);
  const anchorIndex = buildAnchorIndex(lines);

  const childrenMap = new Map<number | null, PersistedOutlineRow[]>();
  rows.forEach((row) => {
    const key = row.parent_id ?? null;
    const bucket = childrenMap.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      childrenMap.set(key, [row]);
    }
  });

  for (const bucket of childrenMap.values()) {
    bucket.sort((left, right) => left.sort_order - right.sort_order || left.id - right.id);
  }

  const flattened: OutlineEntry[] = [];
  let sequence = 1;

  const visit = (parentId: number | null, level: number) => {
    const nodes = childrenMap.get(parentId) || [];
    nodes.forEach((row) => {
      const summary = summarizeContent(row.content);
      const resolvedLine = resolveAnchorLineIndexed(
        anchorIndex,
        lines,
        row.title,
        row.anchor_text || row.title,
        row.line_hint
      );
      flattened.push({
        id: row.id,
        parentId: row.parent_id,
        cacheKey: fnv1a32(`${row.id}:${row.title}:${row.updated_at}`),
        line: sequence++,
        lineHint: resolvedLine,
        level,
        text: row.title,
        summary,
        autoGenerated: false,
        source: 'database',
        anchorText: row.anchor_text || row.title,
        originalText: row.title,
        needsAiTitle: false,
        wordCount: row.content.replace(/\s+/g, '').length,
      });
      visit(row.id, level + 1);
    });
  };

  visit(null, 1);
  return flattened;
}

export async function writeOutlineTree(
  folderPath: string,
  entries: PersistedOutlineNodeInput[],
  scope?: PersistedOutlineScopeInput | null
) {
  return window.electron.ipcRenderer.invoke(
    'db-outline-replace-by-folder',
    folderPath,
    entries,
    scope ?? undefined
  );
}
