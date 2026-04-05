import type { AssistantArtifactKind, AssistantScopeKind } from './workspace';

export type AssistantGenerationState = 'running' | 'success' | 'empty' | 'error';

export interface AssistantArtifactGenerationStatus {
  artifact: AssistantArtifactKind;
  state: AssistantGenerationState;
  scopeKind: AssistantScopeKind;
  scopePath: string;
  scopeLabel: string;
  message: string;
  totalSteps: number;
  completedSteps: number;
  resultCount: number;
  libraryCount: number;
  createdCount: number;
  updatedCount: number;
  startedAt: string;
  finishedAt: string | null;
}

type ParsedAssistantArtifactGenerationStatus = Partial<AssistantArtifactGenerationStatus>;
type AssistantArtifactGenerationMetricsShape = Pick<
  AssistantArtifactGenerationStatus,
  'state' | 'totalSteps' | 'completedSteps' | 'resultCount' | 'libraryCount' | 'createdCount' | 'updatedCount'
>;

const VALID_STATES = new Set<AssistantGenerationState>(['running', 'success', 'empty', 'error']);
const VALID_ARTIFACTS = new Set<AssistantArtifactKind>(['characters', 'lore', 'materials']);
const VALID_SCOPE_KINDS = new Set<AssistantScopeKind>(['project', 'volume', 'chapter']);

function normalizeNonNegativeInt(value: unknown): number {
  const next = Number(value);
  if (!Number.isFinite(next) || next < 0) return 0;
  return Math.floor(next);
}

export function createAssistantGenerationStatusStorageKey(
  artifact: AssistantArtifactKind,
  scopeKind: AssistantScopeKind,
  scopePath: string | null
): string | null {
  if (!scopePath || scopePath.startsWith('__')) return null;
  return `novel-editor:assistant-generation:${artifact}:${scopeKind}:${scopePath}`;
}

export function parseAssistantArtifactGenerationStatus(
  raw: string | null | undefined
): AssistantArtifactGenerationStatus | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as ParsedAssistantArtifactGenerationStatus;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !VALID_ARTIFACTS.has(parsed.artifact as AssistantArtifactKind) ||
      !VALID_STATES.has(parsed.state as AssistantGenerationState) ||
      !VALID_SCOPE_KINDS.has(parsed.scopeKind as AssistantScopeKind) ||
      typeof parsed.scopePath !== 'string' ||
      !parsed.scopePath.trim()
    ) {
      return null;
    }

    const totalSteps = normalizeNonNegativeInt(parsed.totalSteps);
    const completedSteps = Math.min(normalizeNonNegativeInt(parsed.completedSteps), totalSteps || 0);

    return {
      artifact: parsed.artifact as AssistantArtifactKind,
      state: parsed.state as AssistantGenerationState,
      scopeKind: parsed.scopeKind as AssistantScopeKind,
      scopePath: parsed.scopePath.trim(),
      scopeLabel: typeof parsed.scopeLabel === 'string' ? parsed.scopeLabel.trim() : '',
      message: typeof parsed.message === 'string' ? parsed.message.trim() : '',
      totalSteps,
      completedSteps,
      resultCount: normalizeNonNegativeInt(parsed.resultCount),
      libraryCount: normalizeNonNegativeInt(parsed.libraryCount),
      createdCount: normalizeNonNegativeInt(parsed.createdCount),
      updatedCount: normalizeNonNegativeInt(parsed.updatedCount),
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
      finishedAt: typeof parsed.finishedAt === 'string' ? parsed.finishedAt : null,
    };
  } catch {
    return null;
  }
}

export function formatAssistantGenerationProgress(
  status: AssistantArtifactGenerationMetricsShape | null | undefined
): string {
  if (!status || status.state !== 'running' || status.totalSteps <= 0) return '';
  return `${Math.min(status.completedSteps, status.totalSteps)}/${status.totalSteps}`;
}

export function formatAssistantGenerationMetrics(
  status: AssistantArtifactGenerationMetricsShape | null | undefined
): string {
  if (!status) return '';

  const parts: string[] = [];
  if (status.resultCount > 0) {
    parts.push(`识别 ${status.resultCount} 项`);
  }
  if (status.libraryCount > 0 || status.state === 'success') {
    parts.push(`角色库 ${status.libraryCount} 人`);
  }
  if (status.createdCount > 0) {
    parts.push(`新增 ${status.createdCount}`);
  }
  if (status.updatedCount > 0) {
    parts.push(`更新 ${status.updatedCount}`);
  }
  return parts.join(' · ');
}
