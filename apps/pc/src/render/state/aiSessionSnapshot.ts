export interface InlineDiffSnapshot {
  from: number;
  to: number;
  oldText: string;
  newText: string;
}

export interface PendingApplyItem {
  filePath: string;
  content: string;
  targetLine?: number;
  createdAt: number;
}

export interface FixResultSnapshot {
  text: string;
  original?: string;
  modified?: string;
}

export interface AISessionSnapshot {
  workflow: string;
  result: string;
  snapshotFilePath: string | null;
  prompt: string;
  fixResults?: Record<number, FixResultSnapshot>;
  activeFilePath?: string | null;
  inlineDiff?: InlineDiffSnapshot | null;
  pendingApplyQueue?: PendingApplyItem[];
}

export const AI_SESSION_KEY_PREFIX = 'novel-editor:ai-session';

export function buildAISessionStorageKey(folderPath: string | null): string {
  return `${AI_SESSION_KEY_PREFIX}:${folderPath || '__global__'}`;
}

export function createEmptyAISessionSnapshot(): AISessionSnapshot {
  return {
    workflow: 'consistency',
    result: '',
    snapshotFilePath: null,
    prompt: '',
    fixResults: {},
    activeFilePath: null,
    inlineDiff: null,
    pendingApplyQueue: [],
  };
}

export function parseAISessionSnapshot(raw: string | null): AISessionSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AISessionSnapshot>;
    const base = createEmptyAISessionSnapshot();
    return {
      ...base,
      ...parsed,
      fixResults: parsed.fixResults || {},
      pendingApplyQueue: Array.isArray(parsed.pendingApplyQueue) ? parsed.pendingApplyQueue : [],
      inlineDiff: parsed.inlineDiff ?? null,
    };
  } catch {
    return null;
  }
}
