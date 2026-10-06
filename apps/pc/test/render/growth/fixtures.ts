import {
  applyGrowthEvent,
  checkMemory,
  createDndRuleset,
  createSheet,
  type GrowthEventInput,
  type GrowthSheet,
} from '@novel-editor/core/growth';
import type { GrowthSnapshot } from '@/render/types/growth-api';

export const FOLDER = '/tmp/novel';

/** 构造一个 DND 规则 + 「阿尔」400 经验（2 级）的记忆库快照 */
export function buildSnapshot(overrides: Partial<GrowthSnapshot> = {}): GrowthSnapshot {
  const ruleset = createDndRuleset();
  const sheet: GrowthSheet = applyGrowthEvent(ruleset, createSheet(ruleset, '阿尔'), {
    type: 'exp',
    delta: 400,
    chapter: 3,
    note: '击败哥布林',
  }).sheet;
  const base = {
    dir: `${FOLDER}/资料/记忆`,
    initialized: true,
    issues: [],
    ruleset,
    sheets: [sheet],
    party: { schemaVersion: 1, parties: [], companions: [] },
    atlas: { schemaVersion: 1, locations: [] },
  };
  const { check, ...rest } = overrides;
  const merged = { ...base, ...rest };
  return { ...merged, check: check ?? checkMemory(merged) };
}

export function ok<T>(data: T) {
  return { ok: true as const, data };
}

/**
 * 模拟主进程的成长档案 IPC：用 core 的 applyGrowthEvent 真实计算，便于断言等级 / 提示文案
 */
export function createGrowthBackend(initial: GrowthSnapshot = buildSnapshot()) {
  let snapshot = initial;
  const rebuild = (sheets: GrowthSheet[]) => {
    snapshot = buildSnapshot({ ...snapshot, sheets, check: undefined });
    return snapshot;
  };
  const handle = (channel: string, ...args: unknown[]): unknown => {
    switch (channel) {
      case 'growth-load':
        return ok(snapshot);
      case 'growth-init':
        snapshot = buildSnapshot({ sheets: [] });
        return ok(snapshot);
      case 'growth-ensure-sheet': {
        const name = String(args[1]);
        if (snapshot.sheets.some((sheet) => sheet.name === name)) return ok(snapshot);
        return ok(rebuild([...snapshot.sheets, createSheet(snapshot.ruleset, name)]));
      }
      case 'growth-apply-event': {
        const [, name, event, options] = args as [
          string,
          string,
          GrowthEventInput,
          { force?: boolean },
        ];
        const sheet = snapshot.sheets.find((item) => item.name === name);
        if (!sheet) return { ok: false, error: '角色不存在' };
        try {
          const result = applyGrowthEvent(snapshot.ruleset, sheet, event, {
            strict: !options?.force,
          });
          const next = rebuild(
            snapshot.sheets.map((item) => (item.name === name ? result.sheet : item))
          );
          return ok({ snapshot: next, levelUps: result.levelUps, warnings: result.warnings });
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      }
      case 'delete-file': {
        const file = String(args[0]);
        if (file.endsWith('.json')) {
          rebuild(snapshot.sheets.filter((sheet) => !file.endsWith(`/角色/${sheet.name}.json`)));
        }
        return { success: true };
      }
      case 'open-in-system-app':
      case 'memory-sync-snapshots':
        return channel === 'memory-sync-snapshots'
          ? ok({ dir: snapshot.dir, characterFiles: ['a.md'], settingFiles: [], removed: [] })
          : { success: true };
      default:
        return null;
    }
  };
  return {
    handle,
    get snapshot() {
      return snapshot;
    },
  };
}
