/**
 * 规则之书编辑器的界面辅助（纯函数）
 */
import type { CoreRuleCheck, GrowthRuleset } from '@novel-editor/core/growth';

export type CheckKind = CoreRuleCheck['kind'] | 'none';

/** 切换校验类型时的默认参数（引用第一个可用的属性 / 技能 / 抉择） */
export function defaultCheck(kind: CheckKind, ruleset: GrowthRuleset): CoreRuleCheck | undefined {
  const attr = ruleset.attributes[0]?.key ?? '';
  const skill = ruleset.skills[0]?.id ?? '';
  const group = ruleset.choiceGroups[0]?.id ?? '';
  switch (kind) {
    case 'max-level':
      return { kind, value: ruleset.levels.maxLevel };
    case 'max-attribute':
      return { kind, key: attr, value: ruleset.attributes[0]?.max ?? 10 };
    case 'max-skill-level':
      return { kind, skillId: skill, value: 1 };
    case 'forbid-skill':
      return { kind, skillId: skill };
    case 'require-choice-by-level':
      return { kind, groupId: group, level: ruleset.choiceGroups[0]?.unlockLevel ?? 1 };
    default:
      return undefined;
  }
}

/** 删除确认的说明文字：哪些角色的成长卡、规则里哪些地方用到了它 */
export function describeUsage(
  label: string,
  usage: { characters: readonly string[]; references: readonly string[] }
): string {
  const parts: string[] = [];
  if (usage.characters.length > 0) {
    const names = usage.characters.slice(0, 5).join('、');
    const more = usage.characters.length > 5 ? ` 等 ${usage.characters.length} 个角色` : '';
    parts.push(
      `${names}${more} 的成长卡用到了${label}（数值保留在成长卡里，但不再按规则显示与校验）`
    );
  }
  if (usage.references.length > 0) {
    parts.push(`同时会移除：${usage.references.join('；')}`);
  }
  return parts.join('。');
}
