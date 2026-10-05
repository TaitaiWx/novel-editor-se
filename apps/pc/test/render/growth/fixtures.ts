import {
  applyGrowthEvent,
  checkMemory,
  createDndRuleset,
  createSheet,
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
  const merged = { ...base, ...overrides };
  return { ...merged, check: overrides.check ?? checkMemory(merged) };
}
