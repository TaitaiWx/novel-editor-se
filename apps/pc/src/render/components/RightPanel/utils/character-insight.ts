import type { Character, CharacterCamp, CharacterLink, CharacterRelation } from '../types';
import { ROLE_COLORS } from '../constants';

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function estimateAppearanceHeat(content: string, name: string): number {
  if (!name.trim()) return 0;
  const reg = new RegExp(escapeRegex(name.trim()), 'g');
  const matches = content.match(reg);
  return matches ? matches.length : 0;
}

export function inferCharacterCamp(
  character: Character,
  relations: CharacterRelation[]
): CharacterCamp {
  const role = character.role.toLowerCase();
  if (/\u4e3b\u89d2|\u4e3b\u4eba\u516c|\u7537\u4e3b|\u5973\u4e3b/.test(role)) return 'protagonist';
  if (/\u53cd\u6d3e|\u5bf9\u7acb|\u5bbf\u654c|\u654c/.test(role)) return 'antagonist';
  const hostile = relations.filter(
    (item) =>
      (item.sourceId === character.id || item.targetId === character.id) && item.tone === 'rival'
  ).length;
  const allied = relations.filter(
    (item) =>
      (item.sourceId === character.id || item.targetId === character.id) && item.tone !== 'rival'
  ).length;
  if (hostile > allied + 1) return 'antagonist';
  if (allied >= hostile) return 'protagonist';
  return 'support';
}

export function inferRelationStage(note: string): string {
  const text = note.trim();
  if (!text) return '未标注阶段';
  if (/(\u524d\u671f|\u521d\u8bc6|\u5f00\u7aef|\u65e9\u671f)/.test(text)) return '前期';
  if (/(\u4e2d\u671f|\u5347\u7ea7|\u52a0\u6df1|\u77db\u76fe)/.test(text)) return '中期';
  if (/(\u540e\u671f|\u51b3\u88c2|\u548c\u89e3|\u7ec8\u5c40|\u7ed3\u5c40)/.test(text))
    return '后期';
  return '阶段未定义';
}

export function buildCharacterLinks(characters: Character[]): CharacterLink[] {
  if (characters.length < 2) return [];
  return characters.slice(0, Math.min(characters.length - 1, 5)).map((character, index) => ({
    sourceId: character.id,
    targetId: characters[index + 1].id,
    label: character.role && characters[index + 1].role ? '角色关联' : '待定义',
  }));
}

export function getRoleColor(role: string): string {
  if (ROLE_COLORS[role]) return ROLE_COLORS[role];
  for (const key of Object.keys(ROLE_COLORS)) {
    if (role.includes(key)) return ROLE_COLORS[key];
  }
  return '#b5cea8';
}
