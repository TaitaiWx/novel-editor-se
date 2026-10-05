/**
 * 成长记录器 IPC 类型（与 main/handlers/growth.ts、memory.ts 保持一致）
 */
import type {
  Atlas,
  ForgottenCompanion,
  GrowthEventInput,
  GrowthRuleset,
  GrowthSheet,
  GrowthSimulationMode,
  GrowthSimulationResult,
  GrowthTemplate,
  GrowthWarning,
  MemoryCheckResult,
  PartyBook,
  SimulationCandidate,
} from '@novel-editor/core/growth';

export type {
  Atlas,
  ForgottenCompanion,
  GrowthEventInput,
  GrowthRuleset,
  GrowthSheet,
  GrowthSimulationMode,
  GrowthSimulationResult,
  GrowthTemplate,
  GrowthWarning,
  MemoryCheckResult,
  PartyBook,
  SimulationCandidate,
};

export type GrowthIpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface GrowthSnapshot {
  dir: string;
  initialized: boolean;
  issues: string[];
  ruleset: GrowthRuleset;
  sheets: GrowthSheet[];
  party: PartyBook;
  atlas: Atlas;
  check: MemoryCheckResult;
}

export interface GrowthEventOutcome {
  snapshot: GrowthSnapshot;
  levelUps: number;
  warnings: GrowthWarning[];
}

export interface GrowthSimulationRequest {
  choices?: string[];
  mode?: GrowthSimulationMode;
  horizon?: number;
  extraRules?: string[];
}

export interface GrowthSimulationOutcome {
  result: GrowthSimulationResult;
  issues: string[];
  candidates: SimulationCandidate[];
  startChapter: number;
}

export interface MemorySnapshotSyncResult {
  dir: string;
  characterFiles: string[];
  settingFiles: string[];
  removed: string[];
}

/** ElectronAPI.ipcRenderer.invoke 的成长记录器重载 */
export interface GrowthInvokeOverloads {
  invoke(channel: 'growth-load', folderPath: string): Promise<GrowthIpcResult<GrowthSnapshot>>;
  invoke(
    channel: 'growth-init',
    folderPath: string,
    template?: GrowthTemplate
  ): Promise<GrowthIpcResult<GrowthSnapshot>>;
  invoke(
    channel: 'growth-ensure-sheet',
    folderPath: string,
    name: string,
    aliases?: string[]
  ): Promise<GrowthIpcResult<GrowthSnapshot>>;
  invoke(
    channel: 'growth-apply-event',
    folderPath: string,
    name: string,
    event: GrowthEventInput,
    options?: { force?: boolean }
  ): Promise<GrowthIpcResult<GrowthEventOutcome>>;
  invoke(
    channel: 'growth-update-notes',
    folderPath: string,
    name: string,
    notes: string[]
  ): Promise<GrowthIpcResult<GrowthSnapshot>>;
  invoke(
    channel: 'growth-save-ruleset',
    folderPath: string,
    ruleset: GrowthRuleset
  ): Promise<GrowthIpcResult<GrowthSnapshot>>;
  invoke(
    channel: 'growth-save-party',
    folderPath: string,
    party: PartyBook
  ): Promise<GrowthIpcResult<GrowthSnapshot>>;
  invoke(
    channel: 'growth-save-atlas',
    folderPath: string,
    atlas: Atlas
  ): Promise<GrowthIpcResult<GrowthSnapshot>>;
  invoke(
    channel: 'growth-simulate',
    folderPath: string,
    name: string,
    request: GrowthSimulationRequest
  ): Promise<GrowthIpcResult<GrowthSimulationOutcome>>;
  invoke(
    channel: 'growth-apply-branch',
    folderPath: string,
    name: string,
    branch: { events: GrowthEventInput[] }
  ): Promise<GrowthIpcResult<GrowthEventOutcome>>;
  invoke(
    channel: 'memory-sync-snapshots',
    folderPath: string
  ): Promise<GrowthIpcResult<MemorySnapshotSyncResult>>;
}
