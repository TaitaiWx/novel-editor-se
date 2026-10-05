/**
 * 成长记录器 IPC Handlers
 *
 * 数据位于 `<folder>/资料/记忆/`，全部计算与读写委托给 @novel-editor/core，
 * 与 CLI `ne growth` 共用同一实现。主进程负责：校验渲染进程传入的参数、调用已配置的 AI 做推演。
 *
 * 所有通道返回 `{ ok: true, data } | { ok: false, error }`，不向渲染进程抛异常。
 */
import { ipcMain } from 'electron';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import {
  GROWTH_SIMULATION_MODES,
  GROWTH_TEMPLATES,
  applyGrowthEvent,
  applySimulationBranch,
  buildGrowthSimulationPrompt,
  checkMemory,
  ensureSheet,
  findSheet,
  initMemory,
  loadMemory,
  normalizeSimulatedEvent,
  parseGrowthSimulationResult,
  saveAtlas,
  saveParty,
  saveRuleset,
  saveSheet,
  type Atlas,
  type GrowthEventInput,
  type GrowthRuleset,
  type GrowthSimulationMode,
  type GrowthTemplate,
  type GrowthWarning,
  type LoadedMemory,
  type MemoryCheckResult,
  type PartyBook,
  type SimulationCandidate,
  type GrowthSimulationResult,
} from '@novel-editor/core';
import { invokeConfiguredAI } from './ai';

export type GrowthIpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface GrowthSnapshot extends LoadedMemory {
  check: MemoryCheckResult;
}

export interface GrowthEventOutcome {
  snapshot: GrowthSnapshot;
  levelUps: number;
  warnings: GrowthWarning[];
}

export interface GrowthSimulationOutcome {
  result: GrowthSimulationResult;
  issues: string[];
  candidates: SimulationCandidate[];
  startChapter: number;
}

export interface GrowthSimulationRequest {
  choices?: string[];
  mode?: GrowthSimulationMode;
  horizon?: number;
  extraRules?: string[];
}

const MAX_NAME_LENGTH = 100;

/** 校验渲染进程传来的项目目录：必须是已存在的绝对路径目录 */
export async function assertFolder(folderPath: unknown): Promise<string> {
  if (typeof folderPath !== 'string' || !folderPath.trim() || !path.isAbsolute(folderPath)) {
    throw new Error('无效的项目目录');
  }
  const resolved = path.resolve(folderPath);
  const info = await stat(resolved).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`项目目录不存在: ${resolved}`);
  return resolved;
}

function assertName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim() || name.length > MAX_NAME_LENGTH) {
    throw new Error('无效的角色名');
  }
  return name.trim();
}

function asStringList(value: unknown, limit = 20): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);
}

async function snapshot(root: string): Promise<GrowthSnapshot> {
  const memory = await loadMemory(root);
  return { ...memory, check: checkMemory(memory) };
}

/** 统一包装：捕获异常转为 { ok: false, error } */
export async function guard<T>(task: () => Promise<T>): Promise<GrowthIpcResult<T>> {
  try {
    return { ok: true, data: await task() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 渲染进程传入的事件只保留白名单字段 */
function sanitizeEvent(raw: unknown): GrowthEventInput {
  const event = normalizeSimulatedEvent(raw);
  if (!event) throw new Error('无效的成长事件');
  return { ...event, source: 'gui' };
}

export async function growthSimulate(
  folderPath: unknown,
  name: unknown,
  request: GrowthSimulationRequest
): Promise<GrowthSimulationOutcome> {
  const root = await assertFolder(folderPath);
  const memory = await loadMemory(root);
  const sheet = findSheet(memory.sheets, assertName(name));
  if (!sheet) throw new Error('角色成长卡不存在');
  const mode = GROWTH_SIMULATION_MODES.includes(request?.mode as GrowthSimulationMode)
    ? (request.mode as GrowthSimulationMode)
    : 'controlled';
  const choices = asStringList(request?.choices, 6);
  if (mode === 'controlled' && choices.length === 0) {
    throw new Error('受控成长需要至少选择一个候选项');
  }
  const built = buildGrowthSimulationPrompt({
    ruleset: memory.ruleset,
    sheet,
    candidateChoices: choices,
    coreRules: asStringList(request?.extraRules),
    mode,
    horizon: typeof request?.horizon === 'number' ? request.horizon : 10,
  });
  const response = await invokeConfiguredAI({
    prompt: built.prompt,
    systemPrompt: built.systemPrompt,
    temperature: mode === 'free' ? 0.9 : 0.5,
  });
  if (!response.ok) throw new Error(response.error || 'AI 请求失败');
  const parsed = parseGrowthSimulationResult(response.text ?? '', {
    ruleset: memory.ruleset,
    sheet,
    candidates: built.candidates,
    mode,
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return {
    result: parsed.result,
    issues: parsed.issues,
    candidates: built.candidates,
    startChapter: built.startChapter,
  };
}

export function registerGrowthHandlers(): void {
  ipcMain.handle('growth-load', (_event, folderPath: unknown) =>
    guard(async () => snapshot(await assertFolder(folderPath)))
  );

  ipcMain.handle('growth-init', (_event, folderPath: unknown, template: unknown) =>
    guard(async () => {
      const root = await assertFolder(folderPath);
      const chosen = GROWTH_TEMPLATES.includes(template as GrowthTemplate)
        ? (template as GrowthTemplate)
        : 'dnd';
      await initMemory(root, { template: chosen });
      return snapshot(root);
    })
  );

  ipcMain.handle(
    'growth-ensure-sheet',
    (_event, folderPath: unknown, name: unknown, aliases: unknown) =>
      guard(async () => {
        const root = await assertFolder(folderPath);
        await ensureSheet(root, assertName(name), asStringList(aliases));
        return snapshot(root);
      })
  );

  ipcMain.handle(
    'growth-apply-event',
    (_event, folderPath: unknown, name: unknown, rawEvent: unknown, options: unknown) =>
      guard(async (): Promise<GrowthEventOutcome> => {
        const root = await assertFolder(folderPath);
        const { sheet, memory } = await ensureSheet(root, assertName(name));
        const force =
          typeof options === 'object' && options !== null && 'force' in options
            ? (options as { force?: unknown }).force === true
            : false;
        const result = applyGrowthEvent(memory.ruleset, sheet, sanitizeEvent(rawEvent), {
          strict: !force,
        });
        await saveSheet(root, result.sheet);
        return {
          snapshot: await snapshot(root),
          levelUps: result.levelUps,
          warnings: result.warnings,
        };
      })
  );

  ipcMain.handle(
    'growth-update-notes',
    (_event, folderPath: unknown, name: unknown, notes: unknown) =>
      guard(async () => {
        const root = await assertFolder(folderPath);
        const { sheet } = await ensureSheet(root, assertName(name));
        await saveSheet(root, { ...sheet, notes: asStringList(notes, 200) });
        return snapshot(root);
      })
  );

  ipcMain.handle('growth-save-ruleset', (_event, folderPath: unknown, ruleset: unknown) =>
    guard(async () => {
      const root = await assertFolder(folderPath);
      await saveRuleset(root, ruleset as GrowthRuleset);
      return snapshot(root);
    })
  );

  ipcMain.handle('growth-save-party', (_event, folderPath: unknown, party: unknown) =>
    guard(async () => {
      const root = await assertFolder(folderPath);
      await saveParty(root, party as PartyBook);
      return snapshot(root);
    })
  );

  ipcMain.handle('growth-save-atlas', (_event, folderPath: unknown, atlas: unknown) =>
    guard(async () => {
      const root = await assertFolder(folderPath);
      await saveAtlas(root, atlas as Atlas);
      return snapshot(root);
    })
  );

  ipcMain.handle(
    'growth-simulate',
    (_event, folderPath: unknown, name: unknown, request: GrowthSimulationRequest) =>
      guard(() => growthSimulate(folderPath, name, request))
  );

  ipcMain.handle(
    'growth-apply-branch',
    (_event, folderPath: unknown, name: unknown, branch: unknown) =>
      guard(async (): Promise<GrowthEventOutcome> => {
        const root = await assertFolder(folderPath);
        const memory = await loadMemory(root);
        const sheet = findSheet(memory.sheets, assertName(name));
        if (!sheet) throw new Error('角色成长卡不存在');
        const rawEvents =
          typeof branch === 'object' && branch !== null && 'events' in branch
            ? (branch as { events?: unknown }).events
            : undefined;
        if (!Array.isArray(rawEvents)) throw new Error('分支缺少事件列表');
        const events = rawEvents
          .slice(0, 100)
          .map((item) => normalizeSimulatedEvent(item))
          .filter((item): item is GrowthEventInput => item !== null);
        const applied = applySimulationBranch(memory.ruleset, sheet, { events });
        await saveSheet(root, applied.sheet);
        return {
          snapshot: await snapshot(root),
          levelUps: Math.max(0, applied.sheet.level - sheet.level),
          warnings: applied.warnings,
        };
      })
  );
}
