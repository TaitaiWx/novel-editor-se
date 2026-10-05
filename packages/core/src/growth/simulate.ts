/**
 * AI 成长推演（二）：解析 AI 返回、在角色卡副本上试算分支、采用分支
 *
 * 推演结果只是提案：parseGrowthSimulationResult 只做试算，作者确认后才调用 applySimulationBranch。
 */
import { isCoreError } from '../errors';
import { checkSheetConsistency } from './consistency';
import { applyGrowthEvent, findChoiceGroup } from './engine';
import { asNumber, asString, asStringArray, isRecord } from './normalize';
import type { GrowthSimulationMode, SimulationCandidate } from './simulate-prompt';
import type {
  GrowthEvent,
  GrowthEventInput,
  GrowthEventType,
  GrowthRuleset,
  GrowthSheet,
  GrowthWarning,
  SheetSkill,
} from './types';

// ─── 解析 AI 返回 ───────────────────────────────────────────────────────────

/** 从 AI 文本中提取第一个 JSON 对象（容忍 ```json 包裹、前后解释文字、尾逗号） */
export function extractJsonObject(text: string): unknown {
  const attempts: string[] = [];
  const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(text);
  if (fence) attempts.push(fence[1]);
  attempts.push(text);
  for (const attempt of attempts) {
    const trimmed = attempt.trim();
    const start = trimmed.indexOf('{');
    if (start === -1) continue;
    // 平衡括号扫描，跳过字符串内的括号
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let i = start; i < trimmed.length; i += 1) {
      const char = trimmed[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) continue;
    const body = trimmed.slice(start, end + 1);
    for (const candidate of [body, body.replace(/,\s*([}\]])/g, '$1')]) {
      try {
        return JSON.parse(candidate) as unknown;
      } catch {
        // 继续尝试
      }
    }
  }
  return undefined;
}

const EVENT_TYPE_ALIASES: Record<string, GrowthEventType> = {
  exp: 'exp',
  xp: 'exp',
  经验: 'exp',
  level: 'level',
  等级: 'level',
  attribute: 'attribute',
  attr: 'attribute',
  属性: 'attribute',
  skill: 'skill',
  技能: 'skill',
  'skill-exp': 'skill-exp',
  skill_exp: 'skill-exp',
  技能经验: 'skill-exp',
  choice: 'choice',
  抉择: 'choice',
  选择: 'choice',
  note: 'note',
  备注: 'note',
};

function parseChapter(value: unknown): number | undefined {
  const num = asNumber(value);
  if (num !== undefined) return num >= 0 ? Math.floor(num) : undefined;
  if (typeof value === 'string') {
    const match = /\d+/.exec(value);
    if (match) return Number(match[0]);
  }
  return undefined;
}

/** 把 AI 给出的事件规范化为 GrowthEventInput，无效事件返回 null */
export function normalizeSimulatedEvent(raw: unknown): GrowthEventInput | null {
  if (!isRecord(raw)) return null;
  const typeText = asString(raw.type)?.toLowerCase();
  const type = typeText ? EVENT_TYPE_ALIASES[typeText] : undefined;
  if (!type) return null;
  const target =
    asString(raw.target) ??
    asString(raw.key) ??
    asString(raw.skillId) ??
    asString(raw.skill) ??
    asString(raw.attribute) ??
    asString(raw.group) ??
    asString(raw.groupId);
  const delta = asNumber(raw.delta) ?? asNumber(raw.amount) ?? asNumber(raw.value);
  const value =
    type === 'choice'
      ? (asString(raw.value) ?? asString(raw.option) ?? asString(raw.optionId))
      : undefined;
  const chapter = parseChapter(raw.chapter);
  const note = asString(raw.note) ?? asString(raw.reason);
  if ((type === 'exp' || type === 'attribute' || type === 'skill-exp') && delta === undefined) {
    return null;
  }
  if ((type === 'attribute' || type === 'skill' || type === 'skill-exp') && !target) return null;
  if (type === 'choice' && (!target || !value)) return null;
  if (type === 'note' && !note) return null;
  return {
    type,
    ...(target ? { target } : {}),
    ...(value ? { value } : {}),
    ...(delta !== undefined && type !== 'choice' ? { delta } : {}),
    ...(chapter !== undefined ? { chapter } : {}),
    ...(note ? { note } : {}),
    source: 'ai-sim',
  };
}

export interface ProjectedState {
  level: number;
  exp: number;
  attributes: Record<string, number>;
  skills: SheetSkill[];
}

export interface SimulationBranch {
  id: string;
  candidateId?: string;
  title: string;
  summary: string;
  events: GrowthEventInput[];
  risks: string[];
  /** 试算后的角色状态 */
  projected: ProjectedState;
  /** 试算时发现的规则问题（包括无法应用而被跳过的事件） */
  warnings: GrowthWarning[];
}

export interface GrowthSimulationResult {
  mode?: GrowthSimulationMode;
  branches: SimulationBranch[];
  recommendation?: string;
  overallRisks: string[];
}

export type ParseSimulationOutcome =
  | { ok: true; result: GrowthSimulationResult; issues: string[] }
  | { ok: false; error: string; issues: string[] };

export interface DryRunResult {
  sheet: GrowthSheet;
  applied: GrowthEvent[];
  skipped: Array<{ event: GrowthEventInput; reason: string }>;
  warnings: GrowthWarning[];
}

/** 非严格地依次应用事件：违规记为 warning，无法应用的事件跳过 */
export function dryRunEvents(
  ruleset: GrowthRuleset,
  sheet: GrowthSheet,
  events: GrowthEventInput[],
  now?: string
): DryRunResult {
  let current = sheet;
  const applied: GrowthEvent[] = [];
  const skipped: DryRunResult['skipped'] = [];
  const warnings: GrowthWarning[] = [];
  for (const event of events) {
    try {
      const result = applyGrowthEvent(ruleset, current, event, { strict: false, now });
      current = result.sheet;
      applied.push(result.event);
      warnings.push(...result.warnings);
    } catch (error) {
      const reason = isCoreError(error) || error instanceof Error ? error.message : String(error);
      skipped.push({ event, reason });
      warnings.push({
        severity: 'warning',
        code: 'EVENT_SKIPPED',
        character: sheet.name,
        ...(event.chapter !== undefined ? { chapter: event.chapter } : {}),
        message: `事件无法应用（${event.type} ${event.target ?? ''}）: ${reason}`,
      });
    }
  }
  return { sheet: current, applied, skipped, warnings };
}

/** 若分支对应规则中的选择项且事件里没有记录抉择，补上一条 choice 事件 */
function withChoiceEvent(
  ruleset: GrowthRuleset,
  sheet: GrowthSheet,
  candidate: SimulationCandidate | undefined,
  events: GrowthEventInput[]
): GrowthEventInput[] {
  if (!candidate?.groupId || !candidate.optionId) return events;
  const alreadyChosen = sheet.choices.some(
    (choice) => choice.groupId === candidate.groupId && choice.optionId === candidate.optionId
  );
  const hasChoiceEvent = events.some(
    (event) =>
      event.type === 'choice' &&
      findChoiceGroup(ruleset, event.target ?? '')?.id === candidate.groupId
  );
  if (alreadyChosen || hasChoiceEvent) return events;
  const firstChapter = events.find((event) => event.chapter !== undefined)?.chapter;
  return [
    {
      type: 'choice',
      target: candidate.groupId,
      value: candidate.optionId,
      ...(firstChapter !== undefined ? { chapter: firstChapter } : {}),
      note: 'AI 推演分支',
      source: 'ai-sim',
    },
    ...events,
  ];
}

export interface ParseSimulationContext {
  ruleset: GrowthRuleset;
  sheet: GrowthSheet;
  candidates?: SimulationCandidate[];
  mode?: GrowthSimulationMode;
  /** 单个分支最多保留的事件数 */
  maxEventsPerBranch?: number;
}

/** 校验并试算 AI 返回的推演结果 */
export function parseGrowthSimulationResult(
  text: string | unknown,
  context: ParseSimulationContext
): ParseSimulationOutcome {
  const issues: string[] = [];
  const data = typeof text === 'string' ? extractJsonObject(text) : text;
  if (!isRecord(data)) {
    return { ok: false, error: 'AI 返回的内容不是有效的 JSON 对象', issues };
  }
  const rawBranches = Array.isArray(data.branches)
    ? data.branches
    : Array.isArray(data.results)
      ? data.results
      : [];
  if (rawBranches.length === 0) {
    return { ok: false, error: 'AI 返回的 JSON 中没有 branches', issues };
  }
  const maxEvents = context.maxEventsPerBranch ?? 60;
  const candidates = context.candidates ?? [];
  const baseline = new Set(
    checkSheetConsistency(context.ruleset, context.sheet).map((w) => `${w.code}:${w.message}`)
  );
  const branches: SimulationBranch[] = [];
  const usedIds = new Set<string>();

  rawBranches.slice(0, 6).forEach((raw, index) => {
    if (!isRecord(raw)) {
      issues.push(`第 ${index + 1} 个分支不是对象，已忽略`);
      return;
    }
    let id = asString(raw.id) ?? asString(raw.candidateId) ?? `branch-${index + 1}`;
    if (usedIds.has(id)) id = `${id}-${index + 1}`;
    usedIds.add(id);
    const candidateRef = asString(raw.candidateId) ?? asString(raw.choice) ?? asString(raw.id);
    const candidate =
      candidates.find((item) => item.id === candidateRef) ??
      (candidates.length === rawBranches.length ? candidates[index] : undefined);
    const rawEvents = Array.isArray(raw.events) ? raw.events : [];
    const events: GrowthEventInput[] = [];
    rawEvents.forEach((item, eventIndex) => {
      const event = normalizeSimulatedEvent(item);
      if (!event) {
        issues.push(`分支 ${id} 的第 ${eventIndex + 1} 个事件无效，已忽略`);
        return;
      }
      if (events.length < maxEvents) events.push(event);
    });
    if (rawEvents.length > maxEvents) issues.push(`分支 ${id} 事件过多，仅保留前 ${maxEvents} 个`);
    const fullEvents = withChoiceEvent(context.ruleset, context.sheet, candidate, events);
    const dry = dryRunEvents(context.ruleset, context.sheet, fullEvents);
    const consistency = checkSheetConsistency(context.ruleset, dry.sheet).filter(
      (w) => !baseline.has(`${w.code}:${w.message}`)
    );
    branches.push({
      id,
      ...(candidate ? { candidateId: candidate.id } : {}),
      title: asString(raw.title) ?? candidate?.label ?? `分支 ${index + 1}`,
      summary: asString(raw.summary) ?? asString(raw.narrative) ?? '',
      events: fullEvents,
      risks: asStringArray(raw.risks),
      projected: {
        level: dry.sheet.level,
        exp: dry.sheet.exp,
        attributes: dry.sheet.attributes,
        skills: dry.sheet.skills,
      },
      warnings: [...dry.warnings, ...consistency],
    });
  });

  if (branches.length === 0) return { ok: false, error: 'AI 返回的分支全部无效', issues };
  const recommendation = asString(data.recommendation);
  return {
    ok: true,
    issues,
    result: {
      ...(context.mode ? { mode: context.mode } : {}),
      branches,
      ...(recommendation ? { recommendation } : {}),
      overallRisks: asStringArray(data.overallRisks),
    },
  };
}

/** 作者采用某个分支：把分支事件真正写入角色卡（跳过无法应用的事件） */
export function applySimulationBranch(
  ruleset: GrowthRuleset,
  sheet: GrowthSheet,
  branch: Pick<SimulationBranch, 'events'>,
  now?: string
): DryRunResult {
  const events = branch.events.map((event) => ({ ...event, source: 'ai-sim' as const }));
  return dryRunEvents(ruleset, sheet, events, now);
}
